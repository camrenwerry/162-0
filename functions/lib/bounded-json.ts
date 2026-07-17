import { DraftValidationPublicError, draftValidationError } from './api-response'

export const MAX_DRAFT_VALIDATION_BODY_BYTES = 16_384
export const MAX_DRAFT_VALIDATION_BODY_CHUNKS = 16_384

function requireJsonHeaders(request: Request) {
  const contentType = request.headers.get('Content-Type')
  const mediaType = contentType?.trim().toLowerCase()
  const contentEncoding = request.headers.get('Content-Encoding')
  const normalizedEncoding = contentEncoding?.trim().toLowerCase()
  if (mediaType !== 'application/json' || (normalizedEncoding !== undefined && normalizedEncoding !== 'identity')) {
    draftValidationError('unsupported_media_type')
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel()
  } catch {
    // The response is already determined; cancellation failure is not public.
  }
}

async function readBoundedBody(request: Request) {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_DRAFT_VALIDATION_BODY_BYTES) {
    draftValidationError('payload_too_large')
  }
  if (!request.body) draftValidationError('malformed_json')

  const reader = request.body.getReader()
  // A fixed, bounded allocation avoids retaining one object for every hostile
  // stream chunk. The view returned below exposes only received bytes.
  const body = new Uint8Array(MAX_DRAFT_VALIDATION_BODY_BYTES)
  let totalBytes = 0
  let chunkCount = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunkCount += 1
      if (chunkCount > MAX_DRAFT_VALIDATION_BODY_CHUNKS) {
        await cancelReader(reader)
        draftValidationError('payload_too_large')
      }
      if (!value?.byteLength) continue
      const nextTotalBytes = totalBytes + value.byteLength
      if (nextTotalBytes > MAX_DRAFT_VALIDATION_BODY_BYTES) {
        await cancelReader(reader)
        draftValidationError('payload_too_large')
      }
      body.set(value, totalBytes)
      totalBytes = nextTotalBytes
    }
  } catch (error) {
    if (error instanceof DraftValidationPublicError) throw error
    draftValidationError('temporarily_unavailable')
  } finally {
    reader.releaseLock()
  }
  if (totalBytes === 0) draftValidationError('malformed_json')

  return body.subarray(0, totalBytes)
}

type JsonObjectFrame = {
  readonly kind: 'object'
  keys: Set<string>
  state: 'key-or-end' | 'colon' | 'value' | 'comma-or-end'
}
type JsonArrayFrame = {
  readonly kind: 'array'
  state: 'value-or-end' | 'comma-or-end'
}
type JsonFrame = JsonObjectFrame | JsonArrayFrame

export class StrictJsonParseError extends Error {
  override readonly name = 'StrictJsonParseError'
  readonly reason: 'malformed' | 'duplicate_key'

  constructor(reason: 'malformed' | 'duplicate_key') {
    super(reason)
    this.reason = reason
  }
}

function skipJsonWhitespace(text: string, index: number) {
  while (index < text.length && /[\t\n\r ]/.test(text[index])) index += 1
  return index
}

function readJsonString(text: string, start: number) {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '"') {
      const raw = text.slice(start, index + 1)
      try {
        return { next: index + 1, value: JSON.parse(raw) as string }
      } catch {
        return { next: index + 1, value: raw }
      }
    }
    index += 1
  }
  return { next: index, value: text.slice(start) }
}

function consumeJsonValue(text: string, index: number, stack: JsonFrame[]) {
  index = skipJsonWhitespace(text, index)
  const token = text[index]
  if (token === '{') {
    stack.push({ kind: 'object', keys: new Set<string>(), state: 'key-or-end' })
    return index + 1
  }
  if (token === '[') {
    stack.push({ kind: 'array', state: 'value-or-end' })
    return index + 1
  }
  if (token === '"') return readJsonString(text, index).next
  while (index < text.length && !/[\t\n\r ,\]}]/.test(text[index])) index += 1
  return index
}

/**
 * JSON.parse accepts duplicate member names. This scanner only observes the
 * already body-bounded input and uses an explicit stack, so duplicate rejection
 * cannot add recursive parsing risk. JSON.parse remains the syntax authority.
 */
function hasDuplicateJsonObjectKeys(text: string) {
  const stack: JsonFrame[] = []
  let index = consumeJsonValue(text, 0, stack)
  while (stack.length) {
    const frame = stack.at(-1)
    if (!frame) break
    index = skipJsonWhitespace(text, index)

    if (frame.kind === 'object') {
      if (frame.state === 'key-or-end') {
        if (text[index] === '}') {
          stack.pop()
          index += 1
          continue
        }
        if (text[index] !== '"') return false
        const key = readJsonString(text, index)
        if (frame.keys.has(key.value)) return true
        frame.keys.add(key.value)
        frame.state = 'colon'
        index = key.next
        continue
      }
      if (frame.state === 'colon') {
        if (text[index] !== ':') return false
        frame.state = 'value'
        index += 1
        continue
      }
      if (frame.state === 'value') {
        frame.state = 'comma-or-end'
        index = consumeJsonValue(text, index, stack)
        continue
      }
      if (text[index] === ',') {
        frame.state = 'key-or-end'
        index += 1
        continue
      }
      if (text[index] === '}') {
        stack.pop()
        index += 1
        continue
      }
      return false
    }

    if (frame.state === 'value-or-end') {
      if (text[index] === ']') {
        stack.pop()
        index += 1
        continue
      }
      frame.state = 'comma-or-end'
      index = consumeJsonValue(text, index, stack)
      continue
    }
    if (text[index] === ',') {
      frame.state = 'value-or-end'
      index += 1
      continue
    }
    if (text[index] === ']') {
      stack.pop()
      index += 1
      continue
    }
    return false
  }
  return false
}

/**
 * Parses already-size-bounded JSON while preserving duplicate-key rejection.
 * Other server-only protocols, such as signed tickets, use this rather than
 * JSON.parse directly so their verification input has the same strictness as
 * HTTP request bodies.
 */
export function parseStrictJson(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StrictJsonParseError('malformed')
  }
  if (hasDuplicateJsonObjectKeys(text)) throw new StrictJsonParseError('duplicate_key')
  return parsed
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  requireJsonHeaders(request)
  const body = await readBoundedBody(request)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body)
  } catch {
    return draftValidationError('malformed_json')
  }
  if (!text.trim()) draftValidationError('malformed_json')
  try {
    return parseStrictJson(text)
  } catch (error) {
    if (error instanceof StrictJsonParseError && error.reason === 'duplicate_key') {
      return draftValidationError('invalid_request_schema')
    }
    return draftValidationError('malformed_json')
  }
}
