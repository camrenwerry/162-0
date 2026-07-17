import {
  DraftValidationPublicError,
  draftValidationErrorResponse,
  handleApiNotFoundRequest,
  jsonResponse,
} from '../../../functions/lib/api-response'
import { readBoundedJson } from '../../../functions/lib/bounded-json'
import {
  issueDraftTicket,
  validateDraftTicketIssueRequest,
} from '../../../functions/lib/draft-ticket'
import { requestOriginIsAllowed } from './authoritative-validation'

export interface TicketModeEnv {
  readonly DRAFT_TICKET_MODE?: unknown
  /** A Worker secret set only during a separately authorized deployment. */
  readonly DRAFT_TICKET_SIGNING_KEY?: unknown
}

export const DRAFT_TICKET_ALLOWED_METHODS = 'POST'

export function isTicketIssuanceEnabled(env: TicketModeEnv) {
  return env.DRAFT_TICKET_MODE === 'enabled'
}

function errorResponse(code: 'method_not_allowed' | 'origin_not_allowed' | 'temporarily_unavailable') {
  return draftValidationErrorResponse(new DraftValidationPublicError(code), code === 'method_not_allowed' ? { Allow: DRAFT_TICKET_ALLOWED_METHODS } : {})
}

/**
 * Private Worker-only issuance. It uses the shared bounded parser and the
 * Worker secret, but never returns the signing input, signature, or key.
 */
export async function handleAuthoritativeDraftTicketRequest(request: Request, env: TicketModeEnv = {}) {
  if (!isTicketIssuanceEnabled(env)) return handleApiNotFoundRequest(request)
  if (request.method !== DRAFT_TICKET_ALLOWED_METHODS) return errorResponse('method_not_allowed')
  if (!requestOriginIsAllowed(request)) return errorResponse('origin_not_allowed')

  let issueRequest
  try {
    issueRequest = validateDraftTicketIssueRequest(await readBoundedJson(request))
  } catch (error) {
    return error instanceof DraftValidationPublicError
      ? draftValidationErrorResponse(error)
      : errorResponse('temporarily_unavailable')
  }
  if (!issueRequest) return draftValidationErrorResponse(new DraftValidationPublicError('invalid_request_schema'))

  try {
    const issued = await issueDraftTicket(env.DRAFT_TICKET_SIGNING_KEY, issueRequest)
    return jsonResponse({
      ok: true,
      ticket: Object.freeze({
        value: issued.token,
        ticketId: issued.payload.ticketId,
        draftSeed: issued.payload.draftSeed,
        issuedAt: issued.payload.issuedAt,
        expiresAt: issued.payload.expiresAt,
        gameMode: issued.payload.gameMode,
      }),
    }, 201)
  } catch {
    return errorResponse('temporarily_unavailable')
  }
}
