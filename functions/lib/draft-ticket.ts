import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION } from '../../src/game/DraftTranscript'
import { parseStrictJson, StrictJsonParseError } from './bounded-json'

export const DRAFT_TICKET_SCHEMA_VERSION = 'pennant-draft-ticket-v1'
export const DRAFT_TICKET_REQUEST_SCHEMA_VERSION = 'pennant-draft-ticket-request-v1'
export const DRAFT_TICKET_GAME_MODE = 'classic'
export const DRAFT_TICKET_TTL_MS = 15 * 60 * 1000
export const DRAFT_TICKET_MAX_CLOCK_SKEW_MS = 60 * 1000
export const MAX_DRAFT_TICKET_TOKEN_BYTES = 4_096

const TICKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DRAFT_SEED_PATTERN = /^seeded-v1:([0-9a-f]{32})$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const TICKET_PAYLOAD_FIELDS = [
  'ticketSchemaVersion', 'ticketId', 'draftSeed', 'issuedAt', 'expiresAt',
  'appVersion', 'gameRulesVersion', 'rngVersion', 'scoringVersion', 'dataVersion',
  'canonicalDataDigest', 'transcriptSchemaVersion', 'gameMode',
] as const

export interface DraftTicketPayload {
  readonly ticketSchemaVersion: string
  readonly ticketId: string
  readonly draftSeed: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly appVersion: string
  readonly gameRulesVersion: string
  readonly rngVersion: string
  readonly scoringVersion: string
  readonly dataVersion: string
  readonly canonicalDataDigest: string
  readonly transcriptSchemaVersion: string
  readonly gameMode: string
}

export interface DraftTicketEnvelope {
  readonly schema: string
  readonly payload: DraftTicketPayload
  readonly signature: string
}

export interface DraftTicketIssueRequest {
  readonly ticketRequestSchemaVersion: typeof DRAFT_TICKET_REQUEST_SCHEMA_VERSION
  readonly gameMode: typeof DRAFT_TICKET_GAME_MODE
}

export interface DraftTicketIssuanceSources {
  readonly now: () => number
  readonly ticketId: () => string
  readonly randomValues: (values: Uint8Array) => Uint8Array
}

export type DraftTicketVerificationFailure =
  | 'malformed_ticket'
  | 'ticket_too_large'
  | 'unsupported_ticket_schema'
  | 'invalid_ticket_signature'
  | 'expired_ticket'
  | 'future_ticket'
  | 'invalid_ticket_timestamp'
  | 'authoritative_version_mismatch'
  | 'canonical_data_mismatch'
  | 'unsupported_game_mode'
  | 'missing_signing_key'

export type DraftTicketVerificationResult =
  | Readonly<{ ok: true, payload: DraftTicketPayload }>
  | Readonly<{ ok: false, reason: DraftTicketVerificationFailure }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTicketPayloadShape(value: unknown): value is DraftTicketPayload {
  if (!isRecord(value) || !hasExactKeys(value, TICKET_PAYLOAD_FIELDS)) return false
  return typeof value.ticketSchemaVersion === 'string'
    && typeof value.ticketId === 'string'
    && typeof value.draftSeed === 'string'
    && isSafeTimestamp(value.issuedAt)
    && isSafeTimestamp(value.expiresAt)
    && typeof value.appVersion === 'string'
    && typeof value.gameRulesVersion === 'string'
    && typeof value.rngVersion === 'string'
    && typeof value.scoringVersion === 'string'
    && typeof value.dataVersion === 'string'
    && typeof value.canonicalDataDigest === 'string'
    && typeof value.transcriptSchemaVersion === 'string'
    && typeof value.gameMode === 'string'
}

function canonicalPayload(payload: DraftTicketPayload) {
  return JSON.stringify({
    ticketSchemaVersion: payload.ticketSchemaVersion,
    ticketId: payload.ticketId,
    draftSeed: payload.draftSeed,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    appVersion: payload.appVersion,
    gameRulesVersion: payload.gameRulesVersion,
    rngVersion: payload.rngVersion,
    scoringVersion: payload.scoringVersion,
    dataVersion: payload.dataVersion,
    canonicalDataDigest: payload.canonicalDataDigest,
    transcriptSchemaVersion: payload.transcriptSchemaVersion,
    gameMode: payload.gameMode,
  })
}

/** Fixed field order and a domain prefix make the HMAC input unambiguous. */
export function canonicalizeDraftTicketSigningInput(schema: string, payload: DraftTicketPayload) {
  return `pennant-pursuit:draft-ticket-signature:v1\n{"schema":${JSON.stringify(schema)},"payload":${canonicalPayload(payload)}}`
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value) || value.length > MAX_DRAFT_TICKET_TOKEN_BYTES) return null
  try {
    const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (value.length % 4)) % 4)}`
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return base64UrlEncode(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

function defaultIssuanceSources(): DraftTicketIssuanceSources {
  return {
    now: () => Date.now(),
    ticketId: () => crypto.randomUUID(),
    randomValues: (values) => crypto.getRandomValues(values),
  }
}

/** Generates an engine-compatible seeded-v1 seed with Web Crypto randomness. */
export function generateSecureDraftSeed(randomValues: DraftTicketIssuanceSources['randomValues'] = defaultIssuanceSources().randomValues) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const values = randomValues(new Uint8Array(16))
    if (values.byteLength !== 16 || !values.some((value) => value !== 0)) continue
    return `seeded-v1:${Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')}`
  }
  throw new Error('Secure draft seed generation failed.')
}

function validSigningKey(signingKey: unknown): signingKey is string {
  return typeof signingKey === 'string' && signingKey.length > 0
}

async function importSigningKey(signingKey: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function signTicket(schema: string, payload: DraftTicketPayload, signingKey: string) {
  const key = await importSigningKey(signingKey)
  const input = new TextEncoder().encode(canonicalizeDraftTicketSigningInput(schema, payload))
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, input))
}

function signaturesEqual(provided: Uint8Array, expected: Uint8Array) {
  const subtle = crypto.subtle
  if (typeof subtle.timingSafeEqual === 'function') {
    // Cloudflare Workers provides this native constant-time primitive. Keep its
    // equal-length contract while avoiding a length-based early return.
    return provided.byteLength === expected.byteLength
      ? subtle.timingSafeEqual(provided, expected)
      : !subtle.timingSafeEqual(expected, expected)
  }

  // Node's standards-only Web Crypto has no timingSafeEqual extension. The
  // fallback visits all bytes and exists only for shared local/test execution;
  // deployed Workers take the native branch above.
  const maximumLength = Math.max(provided.byteLength, expected.byteLength)
  let difference = provided.byteLength ^ expected.byteLength
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (provided[index] ?? 0) ^ (expected[index] ?? 0)
  }
  return difference === 0
}

function serializeEnvelope(envelope: DraftTicketEnvelope) {
  return JSON.stringify({ schema: envelope.schema, payload: envelope.payload, signature: envelope.signature })
}

export function encodeDraftTicketEnvelope(envelope: DraftTicketEnvelope) {
  return base64UrlEncode(new TextEncoder().encode(serializeEnvelope(envelope)))
}

/**
 * Shared server-only signer used by ticket issuance. Calling it requires the
 * Worker secret; it is never exposed as a public verification endpoint.
 */
export async function encodeSignedDraftTicket(schema: string, payload: DraftTicketPayload, signingKey: unknown) {
  if (!validSigningKey(signingKey)) throw new Error('Missing draft-ticket signing key.')
  const envelope: DraftTicketEnvelope = Object.freeze({
    schema,
    payload,
    signature: base64UrlEncode(await signTicket(schema, payload, signingKey)),
  })
  return encodeDraftTicketEnvelope(envelope)
}

function parseDraftTicketEnvelope(token: unknown): DraftTicketEnvelope | null {
  if (typeof token !== 'string') return null
  const bytes = base64UrlDecode(token)
  if (!bytes) return null
  let value: unknown
  try {
    value = parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch (error) {
    if (error instanceof StrictJsonParseError || error instanceof TypeError) return null
    return null
  }
  if (!isRecord(value) || !hasExactKeys(value, ['schema', 'payload', 'signature'])) return null
  if (typeof value.schema !== 'string' || typeof value.signature !== 'string' || !isTicketPayloadShape(value.payload)) return null
  return { schema: value.schema, payload: value.payload, signature: value.signature }
}

function validateAuthoritativePayload(payload: DraftTicketPayload, now: number): DraftTicketVerificationFailure | null {
  if (payload.ticketSchemaVersion !== DRAFT_TICKET_SCHEMA_VERSION) return 'unsupported_ticket_schema'
  if (!TICKET_ID_PATTERN.test(payload.ticketId) || !DRAFT_SEED_PATTERN.test(payload.draftSeed) || payload.draftSeed.endsWith('0'.repeat(32))) return 'malformed_ticket'
  if (payload.expiresAt - payload.issuedAt !== DRAFT_TICKET_TTL_MS) return 'invalid_ticket_timestamp'
  if (payload.issuedAt > now + DRAFT_TICKET_MAX_CLOCK_SKEW_MS) return 'future_ticket'
  if (now >= payload.expiresAt) return 'expired_ticket'
  if (payload.appVersion !== APP_VERSION || payload.gameRulesVersion !== GAME_RULES_VERSION || payload.rngVersion !== RNG_VERSION || payload.scoringVersion !== SCORING_VERSION || payload.dataVersion !== DATA_VERSION || payload.transcriptSchemaVersion !== TRANSCRIPT_SCHEMA_VERSION) {
    return 'authoritative_version_mismatch'
  }
  if (!DIGEST_PATTERN.test(payload.canonicalDataDigest) || payload.canonicalDataDigest !== DATA_DIGEST) return 'canonical_data_mismatch'
  if (payload.gameMode !== DRAFT_TICKET_GAME_MODE) return 'unsupported_game_mode'
  return null
}

export function validateDraftTicketIssueRequest(value: unknown): DraftTicketIssueRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ticketRequestSchemaVersion', 'gameMode'])) return null
  if (value.ticketRequestSchemaVersion !== DRAFT_TICKET_REQUEST_SCHEMA_VERSION || value.gameMode !== DRAFT_TICKET_GAME_MODE) return null
  return { ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION, gameMode: DRAFT_TICKET_GAME_MODE }
}

export async function issueDraftTicket(signingKey: unknown, request: DraftTicketIssueRequest, sources: Partial<DraftTicketIssuanceSources> = {}) {
  if (!validSigningKey(signingKey)) throw new Error('Missing draft-ticket signing key.')
  const issueRequest = validateDraftTicketIssueRequest(request)
  if (!issueRequest) throw new Error('Invalid draft-ticket issuance request.')
  const defaults = defaultIssuanceSources()
  const now = sources.now ?? defaults.now
  const ticketId = sources.ticketId ?? defaults.ticketId
  const randomValues = sources.randomValues ?? defaults.randomValues
  const issuedAt = now()
  const payload: DraftTicketPayload = Object.freeze({
    ticketSchemaVersion: DRAFT_TICKET_SCHEMA_VERSION,
    ticketId: ticketId(),
    draftSeed: generateSecureDraftSeed(randomValues),
    issuedAt,
    expiresAt: issuedAt + DRAFT_TICKET_TTL_MS,
    appVersion: APP_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    rngVersion: RNG_VERSION,
    scoringVersion: SCORING_VERSION,
    dataVersion: DATA_VERSION,
    canonicalDataDigest: DATA_DIGEST,
    transcriptSchemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    gameMode: issueRequest.gameMode,
  })
  if (!TICKET_ID_PATTERN.test(payload.ticketId) || !isSafeTimestamp(issuedAt)) throw new Error('Invalid server ticket source.')
  return Object.freeze({
    token: await encodeSignedDraftTicket(DRAFT_TICKET_SCHEMA_VERSION, payload, signingKey),
    payload,
  })
}

export async function verifyDraftTicket(token: unknown, signingKey: unknown, now = Date.now()): Promise<DraftTicketVerificationResult> {
  if (typeof token === 'string' && new TextEncoder().encode(token).byteLength > MAX_DRAFT_TICKET_TOKEN_BYTES) {
    return { ok: false, reason: 'ticket_too_large' }
  }
  if (!validSigningKey(signingKey)) return { ok: false, reason: 'missing_signing_key' }
  const envelope = parseDraftTicketEnvelope(token)
  if (!envelope) return { ok: false, reason: 'malformed_ticket' }
  if (envelope.schema !== DRAFT_TICKET_SCHEMA_VERSION) return { ok: false, reason: 'unsupported_ticket_schema' }

  const providedSignature = base64UrlDecode(envelope.signature)
  const expectedSignature = await signTicket(envelope.schema, envelope.payload, signingKey)
  const received = providedSignature ?? new Uint8Array(expectedSignature.byteLength)
  const signaturesMatch = signaturesEqual(received, expectedSignature)
  if (!providedSignature || !signaturesMatch) return { ok: false, reason: 'invalid_ticket_signature' }

  const failure = validateAuthoritativePayload(envelope.payload, now)
  return failure ? { ok: false, reason: failure } : { ok: true, payload: envelope.payload }
}
