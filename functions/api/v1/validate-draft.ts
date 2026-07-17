import {
  DraftValidationPublicError,
  draftValidationErrorResponse,
  handleApiNotFoundRequest,
} from '../../lib/api-response'
import { isDraftValidationEnabled } from '../../lib/draft-validation-mode'
import type { BackendEnv } from '../../lib/env'

const ALLOWED_METHODS = 'POST'
export const INTERNAL_RATE_KEY_HEADER = 'X-Pennant-Pursuit-Rate-Key'
const RATE_KEY_VERSION = 'v1'
const TRUSTED_CONNECTING_IP_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^(?=[0-9A-Fa-f:]{2,45}$)(?=.*:)[0-9A-Fa-f:]+$/

type ValidationService = Pick<Fetcher, 'fetch'>
type ValidationProxyEnv = BackendEnv & { readonly VALIDATION_SERVICE?: ValidationService }

function errorResponse(code: 'method_not_allowed' | 'origin_not_allowed' | 'temporarily_unavailable', headers: Readonly<Record<string, string>> = {}) {
  return draftValidationErrorResponse(new DraftValidationPublicError(code), headers)
}

function requestOriginIsAllowed(request: Request) {
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('Origin')
  const host = request.headers.get('Host')
  return (origin === null || origin === requestUrl.origin)
    && (host === null || host.toLowerCase() === requestUrl.host.toLowerCase())
}

function trustedConnectingIp(request: Request) {
  const ip = request.headers.get('CF-Connecting-IP')?.trim()
  return ip && TRUSTED_CONNECTING_IP_PATTERN.test(ip) ? ip : null
}

function hexadecimal(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The value is derived only from Cloudflare's trusted connection metadata at
 * the public Pages boundary. It is never persisted, logged, returned, or
 * accepted from the browser as an input to the private Worker.
 */
export async function deriveTrustedRateKey(connectingIp: string) {
  const source = new TextEncoder().encode(`pennant-pursuit-rate-key-${RATE_KEY_VERSION}:${connectingIp}`)
  const digest = await crypto.subtle.digest('SHA-256', source)
  return `${RATE_KEY_VERSION}:${hexadecimal(digest)}`
}

function forwardedRequest(request: Request, rateKey: string) {
  // The private Worker needs only the validation content headers and the
  // server-derived limiter key. This avoids forwarding cookies, credentials,
  // request metadata, raw client-IP headers, or a browser-controlled key.
  const headers = new Headers()
  for (const header of ['Content-Type', 'Content-Length', 'Content-Encoding']) {
    const value = request.headers.get(header)
    if (value !== null) headers.set(header, value)
  }
  headers.set(INTERNAL_RATE_KEY_HEADER, rateKey)
  return new Request(request, { headers })
}

/**
 * C4.1's public boundary deliberately handles only feature gating, method and
 * same-origin checks, trusted metadata derivation, and Service Binding proxying.
 * Parsing, replay, scoring, and catalog access live only in the private Worker.
 */
export async function handleValidateDraftRequest(request: Request, env: ValidationProxyEnv = {}) {
  if (!isDraftValidationEnabled(env)) return handleApiNotFoundRequest(request)
  if (request.method !== ALLOWED_METHODS) return errorResponse('method_not_allowed', { Allow: ALLOWED_METHODS })
  if (!requestOriginIsAllowed(request)) return errorResponse('origin_not_allowed')

  const connectingIp = trustedConnectingIp(request)
  if (!connectingIp) return errorResponse('temporarily_unavailable')

  const service = env.VALIDATION_SERVICE
  if (!service || typeof service.fetch !== 'function') return errorResponse('temporarily_unavailable')

  try {
    return await service.fetch(forwardedRequest(request, await deriveTrustedRateKey(connectingIp)))
  } catch {
    return errorResponse('temporarily_unavailable')
  }
}

export const onRequest: PagesFunction<ValidationProxyEnv> = ({ request, env }) => handleValidateDraftRequest(request, env)
