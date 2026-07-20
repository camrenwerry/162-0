export const D1C4_DEFAULT_REQUEST_TIMEOUT_MS = 10_000
export const D1C4_MAX_REQUEST_TIMEOUT_MS = 30_000
export const D1C4_ENDPOINT_RESPONSE_LIMIT_BYTES = 32_768
export const D1C4_D1_RESPONSE_LIMIT_BYTES = 1_048_576

export type D1C4Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type BoundedFetchFailureKind =
  | 'timeout'
  | 'redirect'
  | 'body-limit'
  | 'body-missing'
  | 'encoding'
  | 'http'
  | 'parse'
  | 'network'

export class BoundedFetchError extends Error {
  readonly kind: BoundedFetchFailureKind

  constructor(kind: BoundedFetchFailureKind, message: string) {
    super(message)
    this.name = 'BoundedFetchError'
    this.kind = kind
  }
}

export interface BoundedJsonResponse {
  readonly status: number
  readonly ok: boolean
  readonly bytes: Uint8Array
  readonly text: string
  readonly body: unknown
}

export interface BoundedJsonRequestOptions {
  readonly description: string
  readonly timeoutMs?: number
  readonly maxResponseBytes: number
  readonly fetcher?: D1C4Fetch
  readonly init?: RequestInit
}

function validatePositiveInteger(value: number, name: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BoundedFetchError('timeout', `${name} must be an integer from 1 through ${maximum}.`)
  }
}

function contentLength(response: Response, description: string) {
  const raw = response.headers.get('Content-Length')
  if (raw === null) return null
  if (!/^\d+$/.test(raw)) {
    throw new BoundedFetchError('body-limit', `${description} returned a malformed Content-Length header.`)
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) {
    throw new BoundedFetchError('body-limit', `${description} returned an unsafe Content-Length header.`)
  }
  return parsed
}

export function requireHttpSuccess(response: BoundedJsonResponse, description: string) {
  if (!response.ok) {
    throw new BoundedFetchError('http', `${description} failed with HTTP ${response.status}.`)
  }
  return response
}

export function rawBytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value)
}

export async function boundedJsonRequest(
  input: string | URL | Request,
  options: BoundedJsonRequestOptions,
): Promise<BoundedJsonResponse> {
  const timeoutMs = options.timeoutMs ?? D1C4_DEFAULT_REQUEST_TIMEOUT_MS
  validatePositiveInteger(timeoutMs, 'D1C.4 request timeout', D1C4_MAX_REQUEST_TIMEOUT_MS)
  validatePositiveInteger(options.maxResponseBytes, 'D1C.4 response byte limit', Number.MAX_SAFE_INTEGER)

  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutFailure = new BoundedFetchError(
    'timeout',
    `${options.description} timed out after ${timeoutMs} milliseconds.`,
  )
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutFailure)
      reject(timeoutFailure)
    }, timeoutMs)
  })
  const withinDeadline = <T>(operation: Promise<T>) => Promise.race([operation, timedOut])

  const cancelWithinDeadline = async (operation: () => Promise<void>) => {
    try {
      await withinDeadline(operation())
    } catch (error) {
      if (error === timeoutFailure || controller.signal.aborted) throw timeoutFailure
      // Cancellation is best-effort after the response has already failed closed.
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    let response: Response
    try {
      response = await withinDeadline((options.fetcher ?? fetch)(input, {
        ...options.init,
        redirect: 'manual',
        signal: controller.signal,
      }))
    } catch (error) {
      if (error === timeoutFailure || controller.signal.aborted) throw timeoutFailure
      throw new BoundedFetchError('network', `${options.description} failed before receiving an HTTP response.`)
    }

    const responseBody = response.body
    if (response.status >= 300 && response.status <= 399) {
      if (responseBody) await cancelWithinDeadline(() => responseBody.cancel())
      throw new BoundedFetchError(
        'redirect',
        `${options.description} rejected redirect HTTP ${response.status}; no redirect target was contacted.`,
      )
    }

    let declaredLength: number | null
    try {
      declaredLength = contentLength(response, options.description)
    } catch (error) {
      if (responseBody) await cancelWithinDeadline(() => responseBody.cancel())
      throw error
    }
    if (declaredLength !== null && declaredLength > options.maxResponseBytes) {
      if (responseBody) await cancelWithinDeadline(() => responseBody.cancel())
      throw new BoundedFetchError(
        'body-limit',
        `${options.description} response exceeded ${options.maxResponseBytes} bytes.`,
      )
    }
    if (responseBody === null) {
      throw new BoundedFetchError('body-missing', `${options.description} returned no response body.`)
    }

    reader = responseBody.getReader()
    let receivedBytes = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const chunk = await withinDeadline(reader.read())
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > options.maxResponseBytes) {
        const activeReader = reader
        await cancelWithinDeadline(() => activeReader.cancel())
        throw new BoundedFetchError(
          'body-limit',
          `${options.description} response exceeded ${options.maxResponseBytes} bytes.`,
        )
      }
      chunks.push(chunk.value.slice())
    }

    const bytes = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new BoundedFetchError(
        'encoding',
        `${options.description} returned a UTF-8 BOM, which the D1C.4 text-storage contract rejects.`,
      )
    }

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    } catch {
      throw new BoundedFetchError(
        'encoding',
        `${options.description} returned invalid UTF-8.`,
      )
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new BoundedFetchError(
        'parse',
        `${options.description} returned malformed JSON at HTTP ${response.status}.`,
      )
    }
    return Object.freeze({ status: response.status, ok: response.ok, bytes, text, body })
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (reader) {
      if (controller.signal.aborted) void reader.cancel().catch(() => undefined)
      try {
        reader.releaseLock()
      } catch {
        // A timed-out pending read must not replace the bounded timeout failure.
      }
    }
  }
}
