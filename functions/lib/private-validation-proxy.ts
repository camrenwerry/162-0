import {
  DraftValidationPublicError,
  draftValidationErrorResponse,
} from './api-response'
import {
  DraftSubmissionPublicError,
  draftSubmissionErrorResponse,
} from './draft-submission-response'
import type { BackendEnv } from './env'

export const PRIVATE_VALIDATION_ALLOWED_METHODS = 'POST'
export const INTERNAL_RATE_KEY_HEADER = 'X-Pennant-Pursuit-Rate-Key'
const RATE_KEY_VERSION = 'v1'
const TRUSTED_CONNECTING_IP_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^(?=[0-9A-Fa-f:]{2,45}$)(?=.*:)[0-9A-Fa-f:]+$/

type ValidationService = Pick<Fetcher, 'fetch'>
export type PrivateValidationProxyEnv = BackendEnv & { readonly VALIDATION_SERVICE?: ValidationService }

function validationErrorResponse(code: 'method_not_allowed' | 'origin_not_allowed' | 'temporarily_unavailable', headers: Readonly<Record<string, string>> = {}) {
  return draftValidationErrorResponse(new DraftValidationPublicError(code), headers)
}

function submissionErrorResponse(code: 'method_not_allowed' | 'origin_not_allowed' | 'submission_unavailable', headers: Readonly<Record<string, string>> = {}) {
  return draftSubmissionErrorResponse(new DraftSubmissionPublicError(code), headers)
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

/** The stable rate key is derived only from trusted Pages-boundary metadata. */
export async function deriveTrustedRateKey(connectingIp: string) {
  const source = new TextEncoder().encode(`pennant-pursuit-rate-key-${RATE_KEY_VERSION}:${connectingIp}`)
  const digest = await crypto.subtle.digest('SHA-256', source)
  return `${RATE_KEY_VERSION}:${hexadecimal(digest)}`
}

function forwardedRequest(request: Request, rateKey: string) {
  // Service Bindings receive only content headers and the server-derived key;
  // browser credentials, IP headers, and supplied rate keys never cross it.
  const headers = new Headers()
  for (const header of ['Content-Type', 'Content-Length', 'Content-Encoding']) {
    const value = request.headers.get(header)
    if (value !== null) headers.set(header, value)
  }
  headers.set(INTERNAL_RATE_KEY_HEADER, rateKey)
  return new Request(request, { headers })
}

/**
 * The public Pages boundary deliberately handles only method/origin checks,
 * trusted metadata derivation, and private Service Binding proxying. Request
 * parsing and ticket/validation logic remain in the private Worker.
 */
async function proxyPrivateRequest(
  request: Request,
  env: PrivateValidationProxyEnv,
  submission: boolean,
) {
  const errorResponse = (code: 'method_not_allowed' | 'origin_not_allowed' | 'temporarily_unavailable', headers: Readonly<Record<string, string>> = {}) => (
    submission
      ? submissionErrorResponse(code === 'temporarily_unavailable' ? 'submission_unavailable' : code, headers)
      : validationErrorResponse(code, headers)
  )
  if (request.method !== PRIVATE_VALIDATION_ALLOWED_METHODS) {
    return errorResponse('method_not_allowed', { Allow: PRIVATE_VALIDATION_ALLOWED_METHODS })
  }
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

export function proxyPrivateValidationRequest(request: Request, env: PrivateValidationProxyEnv = {}) {
  return proxyPrivateRequest(request, env, false)
}

export function proxyPrivateSubmissionRequest(request: Request, env: PrivateValidationProxyEnv = {}) {
  return proxyPrivateRequest(request, env, true)
}
