import { DraftValidationPublicError, draftValidationError } from './api-response'

export const MAX_DRAFT_VALIDATION_BODY_BYTES = 16_384

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
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > MAX_DRAFT_VALIDATION_BODY_BYTES) {
        await cancelReader(reader)
        draftValidationError('payload_too_large')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof DraftValidationPublicError) throw error
    draftValidationError('temporarily_unavailable')
  } finally {
    reader.releaseLock()
  }
  if (totalBytes === 0) draftValidationError('malformed_json')

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
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
    return JSON.parse(text)
  } catch {
    return draftValidationError('malformed_json')
  }
}
