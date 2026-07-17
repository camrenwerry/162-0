const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
export const SAFE_JSON_RESPONSE_HEADERS = Object.freeze({
  'Content-Type': JSON_CONTENT_TYPE,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
})

export const NOT_FOUND_PAYLOAD = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'not_found', message: 'API route not found' }),
})

export const DRAFT_VALIDATION_ERROR_DEFINITIONS = Object.freeze({
  not_found: Object.freeze({ status: 404, message: 'API route not found' }),
  method_not_allowed: Object.freeze({ status: 405, message: 'Method Not Allowed' }),
  origin_not_allowed: Object.freeze({ status: 403, message: 'Request origin is not allowed.' }),
  unsupported_media_type: Object.freeze({ status: 415, message: 'Request must use application/json without content encoding.' }),
  payload_too_large: Object.freeze({ status: 413, message: 'Request body exceeds the allowed size.' }),
  malformed_json: Object.freeze({ status: 400, message: 'Request body must contain valid JSON.' }),
  invalid_request_schema: Object.freeze({ status: 400, message: 'Request does not match the required schema.' }),
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
  scoring_failed: Object.freeze({ status: 500, message: 'Authoritative scoring failed.' }),
  temporarily_unavailable: Object.freeze({ status: 503, message: 'Draft validation is temporarily unavailable.' }),
})

export type DraftValidationErrorCode = keyof typeof DRAFT_VALIDATION_ERROR_DEFINITIONS

export class DraftValidationPublicError extends Error {
  override readonly name = 'DraftValidationPublicError'
  readonly code: DraftValidationErrorCode
  readonly status: number

  constructor(code: DraftValidationErrorCode) {
    const definition = DRAFT_VALIDATION_ERROR_DEFINITIONS[code]
    super(definition.message)
    this.code = code
    this.status = definition.status
  }
}

export function draftValidationError(code: DraftValidationErrorCode): never {
  throw new DraftValidationPublicError(code)
}

export function jsonResponse(payload: unknown, status: number, headers: Readonly<Record<string, string>> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      ...SAFE_JSON_RESPONSE_HEADERS,
    },
  })
}

export function draftValidationErrorResponse(error: DraftValidationPublicError, headers: Readonly<Record<string, string>> = {}) {
  return jsonResponse({
    ok: false,
    verified: false,
    error: Object.freeze({ code: error.code, message: error.message }),
  }, error.status, headers)
}

export function handleApiNotFoundRequest(request: Request) {
  const body = request.method === 'HEAD' ? null : JSON.stringify(NOT_FOUND_PAYLOAD)
  return new Response(body, {
    status: 404,
    headers: SAFE_JSON_RESPONSE_HEADERS,
  })
}
