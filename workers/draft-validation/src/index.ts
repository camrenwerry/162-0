import {
  DraftValidationPublicError,
  draftValidationErrorResponse,
  handleApiNotFoundRequest,
} from '../../../functions/lib/api-response'
import {
  handleAuthoritativeValidationRequest,
  isValidationEnabled,
  type ValidationModeEnv,
} from './authoritative-validation'
import {
  handleAuthoritativeDraftTicketRequest,
  isTicketIssuanceEnabled,
  type TicketModeEnv,
} from './authoritative-ticket'

export const INTERNAL_RATE_KEY_HEADER = 'X-Pennant-Pursuit-Rate-Key'
const RATE_KEY_PATTERN = /^v1:[a-f0-9]{64}$/

export interface RateLimitBinding {
  limit(options: Readonly<{ key: string }>): Promise<Readonly<{ success: boolean }>>
}

export interface PrivateValidationWorkerEnv extends ValidationModeEnv, TicketModeEnv {
  readonly RATE_LIMIT_BURST: RateLimitBinding
  readonly RATE_LIMIT_SUSTAINED: RateLimitBinding
}

function unavailableResponse() {
  return draftValidationErrorResponse(new DraftValidationPublicError('temporarily_unavailable'))
}

function rateLimitedResponse() {
  return draftValidationErrorResponse(new DraftValidationPublicError('rate_limited'), { 'Retry-After': '60' })
}

async function withRateLimit(
  request: Request,
  env: PrivateValidationWorkerEnv,
  handler: (request: Request, env: PrivateValidationWorkerEnv) => Promise<Response>,
) {
  const rateKey = request.headers.get(INTERNAL_RATE_KEY_HEADER)
  if (!rateKey || !RATE_KEY_PATTERN.test(rateKey)) return unavailableResponse()

  let burst: Readonly<{ success: boolean }>
  let sustained: Readonly<{ success: boolean }>
  try {
    burst = await env.RATE_LIMIT_BURST.limit({ key: rateKey })
    if (!burst.success) return rateLimitedResponse()
    sustained = await env.RATE_LIMIT_SUSTAINED.limit({ key: rateKey })
  } catch {
    return unavailableResponse()
  }
  if (!sustained.success) return rateLimitedResponse()

  return handler(request, env)
}

/**
 * This Worker has no public route, custom domain, workers.dev URL, or preview
 * URL. The header is a defense-in-depth contract for the Pages Service Binding,
 * not a substitute for that private routing boundary.
 */
export async function handlePrivateValidationRequest(request: Request, env: PrivateValidationWorkerEnv) {
  if (!isValidationEnabled(env)) return handleApiNotFoundRequest(request)

  return withRateLimit(request, env, handleAuthoritativeValidationRequest)
}

export async function handlePrivateDraftTicketRequest(request: Request, env: PrivateValidationWorkerEnv) {
  if (!isTicketIssuanceEnabled(env)) return handleApiNotFoundRequest(request)

  return withRateLimit(request, env, handleAuthoritativeDraftTicketRequest)
}

export default {
  fetch(request: Request, env: PrivateValidationWorkerEnv) {
    const pathname = new URL(request.url).pathname
    if (pathname === '/api/v1/validate-draft') return handlePrivateValidationRequest(request, env)
    if (pathname === '/api/v1/draft-ticket') return handlePrivateDraftTicketRequest(request, env)
    return handleApiNotFoundRequest(request)
  },
}
