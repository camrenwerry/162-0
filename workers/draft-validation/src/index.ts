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
import {
  handleLeaderboardIdentityRequest,
  leaderboardIdentityErrorResponse,
  type LeaderboardIdentityEnv,
} from '../../../functions/lib/leaderboard-identity'
import {
  isLeaderboardIdentityEnabled,
  isLeaderboardIdentitySigningKey,
} from '../../../functions/lib/leaderboard-identity-mode'

const INTERNAL_RATE_KEY_HEADER = 'X-Pennant-Pursuit-Rate-Key'
const RATE_KEY_PATTERN = /^v1:[a-f0-9]{64}$/
const LEADERBOARD_IDENTITY_SCHEMA_VERSION = 4

export interface RateLimitBinding {
  limit(options: Readonly<{ key: string }>): Promise<Readonly<{ success: boolean }>>
}

export interface PrivateValidationWorkerEnv extends
  ValidationModeEnv,
  TicketModeEnv,
  SubmissionModeEnv,
  LeaderboardIdentityEnv {
  readonly RATE_LIMIT_BURST: RateLimitBinding
  readonly RATE_LIMIT_SUSTAINED: RateLimitBinding
  readonly DB?: D1Database
}

function unavailableResponse(kind: 'validation' | 'submission' | 'identity') {
  if (kind === 'identity') return leaderboardIdentityErrorResponse('identity_unavailable')
  return kind === 'submission'
    ? draftSubmissionErrorResponse(new DraftSubmissionPublicError('submission_unavailable'))
    : draftValidationErrorResponse(new DraftValidationPublicError('temporarily_unavailable'))
}

function rateLimitedResponse(kind: 'validation' | 'submission' | 'identity') {
  const headers = { 'Retry-After': '60' }
  if (kind === 'identity') {
    const response = leaderboardIdentityErrorResponse('rate_limited')
    const merged = new Headers(response.headers)
    merged.set('Retry-After', '60')
    return new Response(response.body, { status: response.status, headers: merged })
  }
  return kind === 'submission'
    ? draftSubmissionErrorResponse(new DraftSubmissionPublicError('rate_limited'), headers)
    : draftValidationErrorResponse(new DraftValidationPublicError('rate_limited'), headers)
}

async function withRateLimit(
  request: Request,
  env: PrivateValidationWorkerEnv,
  handler: (request: Request, env: PrivateValidationWorkerEnv) => Promise<Response>,
  kind: 'validation' | 'submission' | 'identity' = 'validation',
) {
  const rateKey = request.headers.get(INTERNAL_RATE_KEY_HEADER)
  if (!rateKey || !RATE_KEY_PATTERN.test(rateKey)) return unavailableResponse(kind)

  let burst: Readonly<{ success: boolean }>
  let sustained: Readonly<{ success: boolean }>
  try {
    burst = await env.RATE_LIMIT_BURST.limit({ key: rateKey })
    if (!burst.success) return rateLimitedResponse(kind)
    sustained = await env.RATE_LIMIT_SUSTAINED.limit({ key: rateKey })
  } catch {
    return unavailableResponse(kind)
  }
  if (!sustained.success) return rateLimitedResponse(kind)

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

  return withRateLimit(request, env, handleAuthoritativeSubmissionRequest, 'submission')
}

type IdentityAction = 'availability' | 'claim' | 'recover' | 'rename' | 'status'

export async function handlePrivateLeaderboardIdentityRequest(
  request: Request,
  env: PrivateValidationWorkerEnv,
  action: IdentityAction,
) {
  if (!isLeaderboardIdentityEnabled(env)) return handleApiNotFoundRequest(request)
  return withRateLimit(
    request,
    env,
    (forwarded, bindings) => handleLeaderboardIdentityRequest(forwarded, bindings, action),
    'identity',
  )
}

export async function handlePrivateLeaderboardIdentityHealthRequest(
  request: Request,
  env: PrivateValidationWorkerEnv,
) {
  if (
    request.method !== 'GET'
    || !isLeaderboardIdentityEnabled(env)
    || !isLeaderboardIdentitySigningKey(env.LEADERBOARD_IDENTITY_SIGNING_KEY)
    || !env.DB
  ) return new Response(null, { status: 503 })
  try {
    const schema = await env.DB
      .prepare('SELECT version FROM backend_schema WHERE id = 1')
      .first<{ version?: unknown }>()
    return new Response(null, {
      status: schema?.version === LEADERBOARD_IDENTITY_SCHEMA_VERSION ? 204 : 503,
    })
  } catch {
    return new Response(null, { status: 503 })
  }
}

export default {
  fetch(request: Request, env: PrivateValidationWorkerEnv) {
    const pathname = new URL(request.url).pathname
    if (pathname === '/internal/leaderboard-identity-health') {
      return handlePrivateLeaderboardIdentityHealthRequest(request, env)
    }
    if (pathname === '/api/v1/validate-draft') return handlePrivateValidationRequest(request, env)
    if (pathname === '/api/v1/draft-ticket') return handlePrivateDraftTicketRequest(request, env)
    if (pathname === '/api/v1/submit-draft') return handlePrivateSubmissionRequest(request, env)
    if (pathname === '/api/v1/leaderboard-name-availability') {
      return handlePrivateLeaderboardIdentityRequest(request, env, 'availability')
    }
    if (pathname === '/api/v1/leaderboard-identity-claim') {
      return handlePrivateLeaderboardIdentityRequest(request, env, 'claim')
    }
    if (pathname === '/api/v1/leaderboard-identity-recover') {
      return handlePrivateLeaderboardIdentityRequest(request, env, 'recover')
    }
    if (pathname === '/api/v1/leaderboard-identity-rename') {
      return handlePrivateLeaderboardIdentityRequest(request, env, 'rename')
    }
    if (pathname === '/api/v1/leaderboard-identity-status') {
      return handlePrivateLeaderboardIdentityRequest(request, env, 'status')
    }
    return handleApiNotFoundRequest(request)
  },
  async scheduled(_controller: ScheduledController, env: PrivateValidationWorkerEnv) {
    await cleanupRetainedDraftSubmissions(env)
  },
} satisfies ExportedHandler<PrivateValidationWorkerEnv>
