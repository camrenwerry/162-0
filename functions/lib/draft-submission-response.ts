import { SAFE_JSON_RESPONSE_HEADERS } from './api-response'

export const DRAFT_SUBMISSION_ERROR_DEFINITIONS = Object.freeze({
  rate_limited: Object.freeze({ status: 429, message: 'Too Many Requests' }),
  method_not_allowed: Object.freeze({ status: 405, message: 'Method Not Allowed' }),
  origin_not_allowed: Object.freeze({ status: 403, message: 'Request origin is not allowed.' }),
  unsupported_media_type: Object.freeze({ status: 415, message: 'Request must use application/json without content encoding.' }),
  payload_too_large: Object.freeze({ status: 413, message: 'Request body exceeds the allowed size.' }),
  malformed_json: Object.freeze({ status: 400, message: 'Request body must contain valid JSON.' }),
  invalid_request_schema: Object.freeze({ status: 400, message: 'Request does not match the required schema.' }),
  invalid_draft_ticket: Object.freeze({ status: 422, message: 'Draft ticket is invalid or expired.' }),
  draft_ticket_mismatch: Object.freeze({ status: 422, message: 'Draft ticket does not match the submitted draft.' }),
  unsupported_transcript_version: Object.freeze({ status: 422, message: 'Transcript schema version is not supported.' }),
  unsupported_app_version: Object.freeze({ status: 422, message: 'Application version is not supported.' }),
  unsupported_rng_version: Object.freeze({ status: 422, message: 'RNG version is not supported.' }),
  unsupported_rules_version: Object.freeze({ status: 422, message: 'Game rules version is not supported.' }),
  unsupported_scoring_version: Object.freeze({ status: 422, message: 'Scoring version is not supported.' }),
  unsupported_data_version: Object.freeze({ status: 422, message: 'Data version is not supported.' }),
  canonical_data_mismatch: Object.freeze({ status: 422, message: 'Canonical game data does not match.' }),
  invalid_seed: Object.freeze({ status: 422, message: 'Gameplay seed is invalid.' }),
  invalid_roll_sequence: Object.freeze({ status: 422, message: 'Draft roll sequence is invalid.' }),
  invalid_reroll: Object.freeze({ status: 422, message: 'Draft reroll sequence is invalid.' }),
  invalid_card: Object.freeze({ status: 422, message: 'Draft card is invalid.' }),
  wrong_pool: Object.freeze({ status: 422, message: 'Draft card does not belong to the required pool.' }),
  invalid_position: Object.freeze({ status: 422, message: 'Draft position assignment is invalid.' }),
  duplicate_card: Object.freeze({ status: 422, message: 'Draft contains a duplicate canonical card.' }),
  incomplete_roster: Object.freeze({ status: 422, message: 'Draft roster is incomplete.' }),
  unexpected_event_order: Object.freeze({ status: 422, message: 'Draft events are not in the required order.' }),
  draft_ticket_already_consumed: Object.freeze({ status: 409, message: 'Draft ticket has already been used for another submission.' }),
  scoring_failed: Object.freeze({ status: 500, message: 'Authoritative scoring failed.' }),
  submission_unavailable: Object.freeze({ status: 503, message: 'Draft submission is temporarily unavailable.' }),
})

export type DraftSubmissionErrorCode = keyof typeof DRAFT_SUBMISSION_ERROR_DEFINITIONS

export class DraftSubmissionPublicError extends Error {
  override readonly name = 'DraftSubmissionPublicError'
  readonly code: DraftSubmissionErrorCode
  readonly status: number

  constructor(code: DraftSubmissionErrorCode) {
    const definition = DRAFT_SUBMISSION_ERROR_DEFINITIONS[code]
    super(definition.message)
    this.code = code
    this.status = definition.status
  }
}

export function draftSubmissionErrorResponse(
  error: DraftSubmissionPublicError,
  headers: Readonly<Record<string, string>> = {},
) {
  return new Response(JSON.stringify({
    ok: false,
    verified: false,
    submitted: false,
    error: Object.freeze({ code: error.code, message: error.message }),
  }), {
    status: error.status,
    headers: { ...headers, ...SAFE_JSON_RESPONSE_HEADERS },
  })
}

export function draftSubmissionSuccessResponse(body: string, status: 200 | 201) {
  return new Response(body, { status, headers: SAFE_JSON_RESPONSE_HEADERS })
}
