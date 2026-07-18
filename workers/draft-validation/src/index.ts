import {
  DraftValidationPublicError,
  draftValidationErrorResponse,
  handleApiNotFoundRequest,
} from '../../../functions/lib/api-response'
import {
  DraftSubmissionPublicError,
  draftSubmissionErrorResponse,
} from '../../../functions/lib/draft-submission-response'
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
import {
  handleAuthoritativeSubmissionRequest,
  isSubmissionEnabled,
  type SubmissionModeEnv,
} from './authoritative-submission'
import { cleanupRetainedDraftSubmissions } from './retention-cleanup'

const INTERNAL_RATE_KEY_HEADER = 'X-Pennant-Pursuit-Rate-Key'
const RATE_KEY_PATTERN = /^v1:[a-f0-9]{64}$/

export interface RateLimitBinding {
  limit(options: Readonly<{ key: string }>): Promise<Readonly<{ success: boolean }>>
}

export interface PrivateValidationWorkerEnv extends ValidationModeEnv, TicketModeEnv, SubmissionModeEnv {
  readonly RATE_LIMIT_BURST: RateLimitBinding
  readonly RATE_LIMIT_SUSTAINED: RateLimitBinding
  readonly DB?: D1Database
}

function unavailableResponse(submission: boolean) {
  return submission
    ? draftSubmissionErrorResponse(new DraftSubmissionPublicError('submission_unavailable'))
    : draftValidationErrorResponse(new DraftValidationPublicError('temporarily_unavailable'))
}

function rateLimitedResponse(submission: boolean) {
  const headers = { 'Retry-After': '60' }
  return submission
    ? draftSubmissionErrorResponse(new DraftSubmissionPublicError('rate_limited'), headers)
    : draftValidationErrorResponse(new DraftValidationPublicError('rate_limited'), headers)
}

async function withRateLimit(
  request: Request,
  env: PrivateValidationWorkerEnv,
  handler: (request: Request, env: PrivateValidationWorkerEnv) => Promise<Response>,
  submission = false,
) {
  const rateKey = request.headers.get(INTERNAL_RATE_KEY_HEADER)
  if (!rateKey || !RATE_KEY_PATTERN.test(rateKey)) return unavailableResponse(submission)

  let burst: Readonly<{ success: boolean }>
  let sustained: Readonly<{ success: boolean }>
  try {
    burst = await env.RATE_LIMIT_BURST.limit({ key: rateKey })
    if (!burst.success) return rateLimitedResponse(submission)
    sustained = await env.RATE_LIMIT_SUSTAINED.limit({ key: rateKey })
  } catch {
    return unavailableResponse(submission)
  }
  if (!sustained.success) return rateLimitedResponse(submission)

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

export async function handlePrivateSubmissionRequest(request: Request, env: PrivateValidationWorkerEnv) {
  if (!isSubmissionEnabled(env)) return handleApiNotFoundRequest(request)

  return withRateLimit(request, env, handleAuthoritativeSubmissionRequest, true)
}

export default {
  fetch(request: Request, env: PrivateValidationWorkerEnv) {
    const pathname = new URL(request.url).pathname
    if (pathname === '/api/v1/validate-draft') return handlePrivateValidationRequest(request, env)
    if (pathname === '/api/v1/draft-ticket') return handlePrivateDraftTicketRequest(request, env)
    if (pathname === '/api/v1/submit-draft') return handlePrivateSubmissionRequest(request, env)
    return handleApiNotFoundRequest(request)
  },
  async scheduled(_controller: ScheduledController, env: PrivateValidationWorkerEnv) {
    await cleanupRetainedDraftSubmissions(env)
  },
} satisfies ExportedHandler<PrivateValidationWorkerEnv>
