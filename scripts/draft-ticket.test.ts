import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import fixed113Data from './fixtures/transcripts/fixed-113.json'
import { handleDraftTicketRequest } from '../functions/api/v1/draft-ticket'
import {
  DRAFT_TICKET_GAME_MODE,
  DRAFT_TICKET_MAX_CLOCK_SKEW_MS,
  DRAFT_TICKET_REQUEST_SCHEMA_VERSION,
  DRAFT_TICKET_SCHEMA_VERSION,
  DRAFT_TICKET_TTL_MS,
  MAX_DRAFT_TICKET_TOKEN_BYTES,
  encodeSignedDraftTicket,
  issueDraftTicket,
  validateDraftTicketIssueRequest,
  verifyDraftTicket,
} from '../functions/lib/draft-ticket'
import { deriveTrustedRateKey, INTERNAL_RATE_KEY_HEADER } from '../functions/api/v1/validate-draft'
import {
  handlePrivateDraftTicketRequest,
  handlePrivateValidationRequest,
  type PrivateValidationWorkerEnv,
  type RateLimitBinding,
} from '../workers/draft-validation/src/index'

const ENDPOINT = 'https://preview.example.test/api/v1/draft-ticket'
const CLIENT_IP = '198.51.100.42'
const TEST_SIGNING_KEY = 'test-only-draft-ticket-signing-key-v1'
const TEST_NOW = 1_800_000_000_000
const TEST_TICKET_ID = '11111111-1111-4111-8111-111111111111'

class AllowingRateLimit implements RateLimitBinding {
  calls = 0

  async limit() {
    this.calls += 1
    return { success: true }
  }
}

function privateEnvironment(overrides: Partial<PrivateValidationWorkerEnv> = {}) {
  const burst = new AllowingRateLimit()
  const sustained = new AllowingRateLimit()
  return {
    env: {
      DRAFT_VALIDATION_MODE: 'enabled',
      DRAFT_TICKET_MODE: 'enabled',
      DRAFT_TICKET_SIGNING_KEY: TEST_SIGNING_KEY,
      RATE_LIMIT_BURST: burst,
      RATE_LIMIT_SUSTAINED: sustained,
      ...overrides,
    } as PrivateValidationWorkerEnv,
    burst,
    sustained,
  }
}

function publicTicketRequest(body: BodyInit | null, options: {
  readonly method?: string
  readonly origin?: string
  readonly includeClientIp?: boolean
} = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options.includeClientIp !== false) headers.set('CF-Connecting-IP', CLIENT_IP)
  if (options.origin) headers.set('Origin', options.origin)
  return new Request(ENDPOINT, {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' || options.method === 'HEAD' ? undefined : body,
  })
}

function requestBody() {
  return JSON.stringify({ ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION, gameMode: DRAFT_TICKET_GAME_MODE })
}

function assertSafeHeaders(response: Response) {
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
  assert.equal(response.headers.get('Set-Cookie'), null)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
}

function decodeTicketJson(token: string) {
  const padded = `${token.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (token.length % 4)) % 4)}`
  return JSON.parse(atob(padded)) as { schema: string, payload: Record<string, unknown>, signature: string }
}

function encodeTicketJson(value: unknown) {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

const deterministic = await issueDraftTicket(TEST_SIGNING_KEY, {
  ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION,
  gameMode: DRAFT_TICKET_GAME_MODE,
}, {
  now: () => TEST_NOW,
  ticketId: () => TEST_TICKET_ID,
  randomValues: (values) => {
    values.set(Uint8Array.from({ length: 16 }, (_, index) => index + 1))
    return values
  },
})
assert.equal(deterministic.payload.ticketId, TEST_TICKET_ID)
assert.equal(deterministic.payload.draftSeed, 'seeded-v1:0102030405060708090a0b0c0d0e0f10')
assert.equal(deterministic.payload.issuedAt, TEST_NOW)
assert.equal(deterministic.payload.expiresAt, TEST_NOW + DRAFT_TICKET_TTL_MS)
assert.deepEqual(await verifyDraftTicket(deterministic.token, TEST_SIGNING_KEY, TEST_NOW), {
  ok: true,
  payload: deterministic.payload,
})

const normalOne = await issueDraftTicket(TEST_SIGNING_KEY, {
  ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION,
  gameMode: DRAFT_TICKET_GAME_MODE,
})
const normalTwo = await issueDraftTicket(TEST_SIGNING_KEY, {
  ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION,
  gameMode: DRAFT_TICKET_GAME_MODE,
})
assert.notEqual(normalOne.payload.ticketId, normalTwo.payload.ticketId)
assert.notEqual(normalOne.payload.draftSeed, normalTwo.payload.draftSeed)

const modifiedPayload = decodeTicketJson(deterministic.token)
modifiedPayload.payload.draftSeed = 'seeded-v1:11111111111111111111111111111111'
assert.deepEqual(
  await verifyDraftTicket(encodeTicketJson(modifiedPayload), TEST_SIGNING_KEY, TEST_NOW),
  { ok: false, reason: 'invalid_ticket_signature' },
)
const modifiedSignature = decodeTicketJson(deterministic.token)
modifiedSignature.signature = `${modifiedSignature.signature[0] === 'a' ? 'b' : 'a'}${modifiedSignature.signature.slice(1)}`
assert.deepEqual(
  await verifyDraftTicket(encodeTicketJson(modifiedSignature), TEST_SIGNING_KEY, TEST_NOW),
  { ok: false, reason: 'invalid_ticket_signature' },
)

const expired = await encodeSignedDraftTicket(DRAFT_TICKET_SCHEMA_VERSION, {
  ...deterministic.payload,
  issuedAt: TEST_NOW - DRAFT_TICKET_TTL_MS,
  expiresAt: TEST_NOW,
}, TEST_SIGNING_KEY)
assert.deepEqual(await verifyDraftTicket(expired, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'expired_ticket' })
const future = await encodeSignedDraftTicket(DRAFT_TICKET_SCHEMA_VERSION, {
  ...deterministic.payload,
  issuedAt: TEST_NOW + DRAFT_TICKET_MAX_CLOCK_SKEW_MS + 1,
  expiresAt: TEST_NOW + DRAFT_TICKET_MAX_CLOCK_SKEW_MS + 1 + DRAFT_TICKET_TTL_MS,
}, TEST_SIGNING_KEY)
assert.deepEqual(await verifyDraftTicket(future, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'future_ticket' })
const wrongVersion = await encodeSignedDraftTicket(DRAFT_TICKET_SCHEMA_VERSION, {
  ...deterministic.payload,
  appVersion: 'not-authorized',
}, TEST_SIGNING_KEY)
assert.deepEqual(await verifyDraftTicket(wrongVersion, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'authoritative_version_mismatch' })
const wrongDigest = await encodeSignedDraftTicket(DRAFT_TICKET_SCHEMA_VERSION, {
  ...deterministic.payload,
  canonicalDataDigest: '0'.repeat(64),
}, TEST_SIGNING_KEY)
assert.deepEqual(await verifyDraftTicket(wrongDigest, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'canonical_data_mismatch' })
const wrongGameMode = await encodeSignedDraftTicket(DRAFT_TICKET_SCHEMA_VERSION, {
  ...deterministic.payload,
  gameMode: 'unsupported',
}, TEST_SIGNING_KEY)
assert.deepEqual(await verifyDraftTicket(wrongGameMode, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'unsupported_game_mode' })
const wrongSchema = await encodeSignedDraftTicket('pennant-draft-ticket-v0', deterministic.payload, TEST_SIGNING_KEY)
assert.deepEqual(await verifyDraftTicket(wrongSchema, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'unsupported_ticket_schema' })
assert.deepEqual(await verifyDraftTicket('not_base64url!', TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'malformed_ticket' })
assert.deepEqual(await verifyDraftTicket('a'.repeat(MAX_DRAFT_TICKET_TOKEN_BYTES + 1), TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'ticket_too_large' })
const duplicateEnvelope = decodeTicketJson(deterministic.token)
const duplicateRaw = `{"schema":"${DRAFT_TICKET_SCHEMA_VERSION}","schema":"${DRAFT_TICKET_SCHEMA_VERSION}","payload":${JSON.stringify(duplicateEnvelope.payload)},"signature":"${duplicateEnvelope.signature}"}`
const duplicateToken = btoa(duplicateRaw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
assert.deepEqual(await verifyDraftTicket(duplicateToken, TEST_SIGNING_KEY, TEST_NOW), { ok: false, reason: 'malformed_ticket' })
assert.equal(validateDraftTicketIssueRequest({ ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION, gameMode: 'unsupported' }), null)
assert.equal(validateDraftTicketIssueRequest({ ticketRequestSchemaVersion: 'unsupported', gameMode: DRAFT_TICKET_GAME_MODE }), null)
await assert.rejects(
  issueDraftTicket(TEST_SIGNING_KEY, { ticketRequestSchemaVersion: 'unsupported', gameMode: DRAFT_TICKET_GAME_MODE } as never),
  /Invalid draft-ticket issuance request/,
)

const previewPrivate = privateEnvironment()
let previewCalls = 0
const previewProxyEnvironment = {
  DRAFT_TICKET_MODE: 'enabled',
  VALIDATION_SERVICE: {
    async fetch(request: Request) {
      previewCalls += 1
      return handlePrivateDraftTicketRequest(request, previewPrivate.env)
    },
  },
}
const previewResponse = await handleDraftTicketRequest(publicTicketRequest(requestBody()), previewProxyEnvironment)
assert.equal(previewResponse.status, 201)
assertSafeHeaders(previewResponse)
const previewBody = await previewResponse.json() as { ok: boolean, ticket: { value: string, ticketId: string, draftSeed: string, issuedAt: number, expiresAt: number, gameMode: string } }
assert.equal(previewBody.ok, true)
assert.equal(previewCalls, 1)
assert.equal(previewBody.ticket.value.includes(TEST_SIGNING_KEY), false)
assert.equal(JSON.stringify(previewBody).includes(TEST_SIGNING_KEY), false)
const previewVerification = await verifyDraftTicket(previewBody.ticket.value, TEST_SIGNING_KEY)
assert.equal(previewVerification.ok, true)
if (previewVerification.ok) {
  assert.equal(previewVerification.payload.ticketId, previewBody.ticket.ticketId)
  assert.equal(previewVerification.payload.draftSeed, previewBody.ticket.draftSeed)
}

const rejectedPreviewCalls = previewCalls
assert.equal((await handleDraftTicketRequest(publicTicketRequest('', { method: 'GET' }), previewProxyEnvironment)).status, 405)
assert.equal(previewCalls, rejectedPreviewCalls)
assert.equal((await handleDraftTicketRequest(publicTicketRequest(requestBody(), { origin: 'https://attacker.example' }), previewProxyEnvironment)).status, 403)
assert.equal(previewCalls, rejectedPreviewCalls)
assert.equal((await handleDraftTicketRequest(publicTicketRequest(requestBody(), { includeClientIp: false }), previewProxyEnvironment)).status, 503)
assert.equal(previewCalls, rejectedPreviewCalls)

const malformedTicket = await handleDraftTicketRequest(publicTicketRequest('{'), previewProxyEnvironment)
assert.equal(malformedTicket.status, 400)
assertSafeHeaders(malformedTicket)
assert.equal(previewCalls, rejectedPreviewCalls + 1)
const duplicateRequestTicket = await handleDraftTicketRequest(publicTicketRequest(`{"ticketRequestSchemaVersion":"${DRAFT_TICKET_REQUEST_SCHEMA_VERSION}","ticketRequestSchemaVersion":"${DRAFT_TICKET_REQUEST_SCHEMA_VERSION}","gameMode":"${DRAFT_TICKET_GAME_MODE}"}`), previewProxyEnvironment)
assert.equal(duplicateRequestTicket.status, 400)
assertSafeHeaders(duplicateRequestTicket)
assert.equal(previewCalls, rejectedPreviewCalls + 2)

let productionCalls = 0
const productionTicketResponse = await handleDraftTicketRequest(publicTicketRequest(requestBody()), {
  DRAFT_TICKET_MODE: 'disabled',
  VALIDATION_SERVICE: { async fetch() { productionCalls += 1; return new Response() } },
})
assert.equal(productionTicketResponse.status, 404)
assert.equal(productionCalls, 0)
const disabledProductionWorker = privateEnvironment({ DRAFT_TICKET_MODE: 'disabled' })
assert.equal((await handlePrivateDraftTicketRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP) },
  body: requestBody(),
}), disabledProductionWorker.env)).status, 404)
assert.equal(disabledProductionWorker.burst.calls, 0)
assert.equal(disabledProductionWorker.sustained.calls, 0)

const d1Free = privateEnvironment().env
Object.defineProperty(d1Free, 'DB', { get() { throw new Error('ticket issuance must not access D1') } })
assert.equal((await handlePrivateDraftTicketRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP) },
  body: requestBody(),
}), d1Free)).status, 201)
const missingSecret = privateEnvironment({ DRAFT_TICKET_SIGNING_KEY: undefined })
assert.equal((await handlePrivateDraftTicketRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP) },
  body: requestBody(),
}), missingSecret.env)).status, 503)

const validationEnvironment = privateEnvironment()
const validationResponse = await handlePrivateValidationRequest(new Request('https://preview.example.test/api/v1/validate-draft', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP) },
  body: JSON.stringify({ transcript: fixed113Data.transcript }),
}), validationEnvironment.env)
assert.equal(validationResponse.status, 200)
const validationBody = await validationResponse.json() as { result: { projectedWins: number, projectedLosses: number } }
assert.deepEqual([validationBody.result.projectedWins, validationBody.result.projectedLosses], [113, 49])

const pagesConfig = readFileSync('wrangler.toml', 'utf8')
assert.match(pagesConfig, /\[vars\][\s\S]*DRAFT_TICKET_MODE = "enabled"/)
assert.match(pagesConfig, /\[env\.production\.vars\][\s\S]*DRAFT_TICKET_MODE = "disabled"/)
assert.match(pagesConfig, /\[\[services\]\][\s\S]*service = "pennant-pursuit-validation-preview"/)
assert.match(pagesConfig, /\[\[env\.production\.services\]\][\s\S]*service = "pennant-pursuit-validation-production"/)
const workerConfig = readFileSync('workers/draft-validation/wrangler.toml', 'utf8')
assert.match(workerConfig, /\[vars\][\s\S]*DRAFT_TICKET_MODE = "enabled"/)
assert.match(workerConfig, /\[env\.production\.vars\][\s\S]*DRAFT_TICKET_MODE = "disabled"/)
assert.doesNotMatch(pagesConfig + workerConfig, /^DRAFT_TICKET_SIGNING_KEY\s*=/m)
assert.doesNotMatch(workerConfig, /^(?:routes|route|custom_domain|d1_databases|kv_namespaces|r2_buckets|durable_objects|queues|analytics_engine_datasets|secrets_store_secrets)\s*=/m)

console.log('Draft ticket tests passed: signed preview issuance, deterministic verification, private routing, strict parsing, and no persistence.')
