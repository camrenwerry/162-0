import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import fixed113Data from './fixtures/transcripts/fixed-113.json'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import { handleSubmitDraftRequest } from '../functions/api/v1/submit-draft'
import { deriveTrustedRateKey, INTERNAL_RATE_KEY_HEADER } from '../functions/api/v1/validate-draft'
import { MAX_DRAFT_VALIDATION_BODY_BYTES, parseStrictJson } from '../functions/lib/bounded-json'
import {
  canonicalizeSubmissionTranscript,
  constantTimeDigestEqual,
  digestSubmissionTicketToken,
  digestSubmissionTranscript,
  DRAFT_SUBMISSION_RETENTION_MS,
  DRAFT_SUBMISSION_SCHEMA_VERSION,
  TICKET_TOKEN_DIGEST_DOMAIN,
  TRANSCRIPT_DIGEST_DOMAIN,
} from '../functions/lib/draft-submission'
import {
  DRAFT_SUBMISSION_ERROR_DEFINITIONS,
  type DraftSubmissionErrorCode,
} from '../functions/lib/draft-submission-response'
import { parseDraftRequestEnvelope } from '../functions/lib/draft-validation-schema'
import {
  DRAFT_TICKET_MAX_CLOCK_SKEW_MS,
  DRAFT_TICKET_TTL_MS,
  type DraftTicketPayload,
} from '../functions/lib/draft-ticket'
import type { DraftTranscript } from '../src/game/DraftTranscript'
import {
  handleAuthoritativeSubmissionRequest,
} from '../workers/draft-validation/src/authoritative-submission'
import {
  handlePrivateSubmissionRequest,
  type PrivateValidationWorkerEnv,
  type RateLimitBinding,
} from '../workers/draft-validation/src/index'
import {
  createBoundValidationFixture,
  TEST_DRAFT_TICKET_SIGNING_KEY,
} from './lib/draft-ticket-fixtures'

const ENDPOINT = 'https://preview.example.test/api/v1/submit-draft'
const CLIENT_IP = '198.51.100.42'
const NOW = 1_800_000_000_000
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const SAFE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

type MockRow = {
  ticket_id: string
  ticket_token_digest: string
  transcript_digest: string
  submitted_at_ms: number
  retain_until_ms: number
  submission_schema_version: string
  success_response_json: string
}

type BatchMode = 'normal' | 'fail' | 'malformed' | 'missing-row' | 'bad-changes'
type ConflictMode = 'none' | 'same' | 'transcript' | 'token'

class MockStatement {
  bindings: unknown[] = []

  constructor(readonly database: MockDatabase, readonly query: string) {}

  bind(...values: unknown[]) {
    this.bindings = values
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.database.first(this.query) as T | null
  }
}

class MockDatabase {
  row: MockRow | null = null
  schemaVersion = 2
  batchMode: BatchMode = 'normal'
  conflictMode: ConflictMode = 'none'
  batchCalls = 0
  readonly queries: string[] = []

  prepare(query: string) {
    this.queries.push(query)
    return new MockStatement(this, query)
  }

  first(query: string): unknown {
    if (query.includes('FROM backend_schema')) return { version: this.schemaVersion }
    if (query.includes('FROM draft_submissions')) return this.row ? structuredClone(this.row) : null
    throw new Error('Unexpected test query')
  }

  async batch(statements: MockStatement[]) {
    this.batchCalls += 1
    if (this.batchMode === 'fail') throw new Error('private D1 batch failure')
    if (this.batchMode === 'malformed') return [{ success: true, meta: { changes: 1 } }]

    const values = statements[0]?.bindings
    assert.equal(values?.length, 7)
    const proposal: MockRow = {
      ticket_id: String(values[0]),
      ticket_token_digest: String(values[1]),
      transcript_digest: String(values[2]),
      submitted_at_ms: Number(values[3]),
      retain_until_ms: Number(values[4]),
      submission_schema_version: String(values[5]),
      success_response_json: String(values[6]),
    }
    let changes = 0
    if (!this.row) {
      if (this.conflictMode === 'none') {
        this.row = structuredClone(proposal)
        changes = 1
      } else {
        this.row = structuredClone(proposal)
        if (this.conflictMode === 'transcript') this.row.transcript_digest = 'f'.repeat(64)
        if (this.conflictMode === 'token') this.row.ticket_token_digest = 'e'.repeat(64)
      }
    }
    if (this.batchMode === 'bad-changes') changes = 2
    return [
      { success: true, meta: { changes }, results: [] },
      { success: true, meta: { changes: 0 }, results: this.batchMode === 'missing-row' ? [] : [structuredClone(this.row)] },
    ]
  }
}

class DeterministicRateLimit implements RateLimitBinding {
  calls = 0

  constructor(private readonly allowedCalls = Number.POSITIVE_INFINITY) {}

  async limit() {
    this.calls += 1
    return { success: this.calls <= this.allowedCalls }
  }
}

function request(body: unknown, options: { method?: string, headers?: Record<string, string>, origin?: string } = {}) {
  const headers = new Headers({ ...JSON_HEADERS, ...options.headers })
  if (options.origin) headers.set('Origin', options.origin)
  return new Request(ENDPOINT, {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' || options.method === 'HEAD' ? undefined : JSON.stringify(body),
  })
}

function rawRequest(body: BodyInit, headers: Record<string, string> = JSON_HEADERS) {
  return new Request(ENDPOINT, { method: 'POST', headers, body })
}

function enabledEnvironment(database: MockDatabase, signingKey: unknown = TEST_DRAFT_TICKET_SIGNING_KEY) {
  return {
    DRAFT_SUBMISSION_MODE: 'enabled',
    DRAFT_TICKET_SIGNING_KEY: signingKey,
    DB: database,
  }
}

function assertSafeHeaders(response: Response) {
  for (const [header, value] of Object.entries(SAFE_HEADERS)) assert.equal(response.headers.get(header), value)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(response.headers.get('Set-Cookie'), null)
}

async function assertError(response: Response, code: DraftSubmissionErrorCode) {
  const definition = DRAFT_SUBMISSION_ERROR_DEFINITIONS[code]
  assert.equal(response.status, definition.status, code)
  assertSafeHeaders(response)
  const serialized = await response.text()
  assert.deepEqual(JSON.parse(serialized), {
    ok: false,
    verified: false,
    submitted: false,
    error: { code, message: definition.message },
  })
  assert.doesNotMatch(serialized, /(?:database|draft_submissions|sql|stack|signature|ticket_id|digest|seeded-v1:|private)/i)
}

function reversedObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedObjects)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversedObjects(child)]))
}

const fixture = await createBoundValidationFixture(noRerollsData.transcript, { issuedAt: NOW - 1_000 })
const envelope = { ticket: fixture.ticket, transcript: fixture.transcript }
const stableSources = { now: () => NOW }

// Canonical fixed-field serialization and both exact domain-separated digests.
const canonicalFixed = canonicalizeSubmissionTranscript(fixed113Data.transcript as DraftTranscript)
const canonicalFixedValue = JSON.parse(canonicalFixed) as { header: Record<string, unknown>, events: Record<string, unknown>[] }
assert.deepEqual(Object.keys(canonicalFixedValue), ['header', 'events'])
assert.deepEqual(Object.keys(canonicalFixedValue.header), [
  'transcriptSchemaVersion', 'appVersion', 'gameRulesVersion', 'rngVersion', 'scoringVersion',
  'dataVersion', 'canonicalDataDigest', 'draftId', 'gameplaySeed', 'createdAt',
])
assert.deepEqual(Object.keys(canonicalFixedValue.events.find(({ type }) => type === 'initial-roll') ?? {}), ['type', 'round', 'combinationId'])
assert.deepEqual(Object.keys(canonicalFixedValue.events.find(({ type }) => type === 'reroll') ?? {}), [
  'type', 'reroll', 'round', 'discardedCombinationId', 'resultingCombinationId',
])
assert.deepEqual(Object.keys(canonicalFixedValue.events.find(({ type }) => type === 'pick') ?? {}), [
  'type', 'round', 'pickOrder', 'combinationId', 'canonicalCardId', 'sourcePlayerId', 'assignedPosition', 'featuredSeason',
])
assert.equal(TRANSCRIPT_DIGEST_DOMAIN, 'pennant-pursuit:submission-transcript:v1\n')
assert.equal(TICKET_TOKEN_DIGEST_DOMAIN, 'pennant-pursuit:submission-ticket-token:v1\n')
assert.equal(await digestSubmissionTranscript(fixed113Data.transcript as DraftTranscript), '04b3827920ae1495c7b31fa21adce360dd72d60d50aa6e09f509053b6a01d4cd')
assert.equal(await digestSubmissionTicketToken('opaque-ticket\nwith-exact-bytes'), '89d40d38c7bdf15686ebccf3f91f2f7d66d56611e811202a32068500a2179384')
assert.match(await digestSubmissionTranscript(fixed113Data.transcript as DraftTranscript), /^[0-9a-f]{64}$/)

const canonicalEnvelope = { ticket: 'opaque', transcript: fixed113Data.transcript }
const prettyParsed = parseDraftRequestEnvelope(parseStrictJson(JSON.stringify(canonicalEnvelope, null, 2)))
const permutedParsed = parseDraftRequestEnvelope(reversedObjects(canonicalEnvelope))
const escapedRaw = JSON.stringify(canonicalEnvelope).replace('poseybu01', '\\u0070oseybu01')
const escapedParsed = parseDraftRequestEnvelope(parseStrictJson(escapedRaw))
const canonicalDigest = await digestSubmissionTranscript(prettyParsed.transcript)
assert.equal(await digestSubmissionTranscript(permutedParsed.transcript), canonicalDigest)
assert.equal(await digestSubmissionTranscript(escapedParsed.transcript), canonicalDigest)
const meaningfulMutation = structuredClone(prettyParsed.transcript)
meaningfulMutation.events.find((event) => event.type === 'pick')!.featuredSeason += 1
assert.notEqual(await digestSubmissionTranscript(meaningfulMutation), canonicalDigest)
const reorderedEvents = structuredClone(prettyParsed.transcript)
;[reorderedEvents.events[0], reorderedEvents.events[1]] = [reorderedEvents.events[1], reorderedEvents.events[0]]
assert.notEqual(await digestSubmissionTranscript(reorderedEvents), canonicalDigest)
assert.notEqual(await digestSubmissionTicketToken('opaque-ticket\nwith-exact-bytes '), await digestSubmissionTicketToken('opaque-ticket\nwith-exact-bytes'))
assert.equal(constantTimeDigestEqual('a'.repeat(64), 'a'.repeat(64)), true)
assert.equal(constantTimeDigestEqual('a'.repeat(64), 'b'.repeat(64)), false)
assert.equal(constantTimeDigestEqual('A'.repeat(64), 'a'.repeat(64)), null)

// Strict envelope parsing rejects unknown, missing, duplicate, null, type, and numeric violations.
const schemaCases: unknown[] = [
  { ...envelope, extra: true },
  { transcript: fixture.transcript },
  { ticket: null, transcript: fixture.transcript },
  { ticket: fixture.ticket, transcript: null },
  { ticket: fixture.ticket, transcript: { ...fixture.transcript, extra: true } },
]
for (const body of schemaCases) {
  await assertError(await handleAuthoritativeSubmissionRequest(request(body), enabledEnvironment(new MockDatabase()), stableSources), 'invalid_request_schema')
}
const unsafeNumber = JSON.stringify(envelope).replace('"round":1', '"round":1e400')
await assertError(await handleAuthoritativeSubmissionRequest(rawRequest(unsafeNumber), enabledEnvironment(new MockDatabase()), stableSources), 'invalid_request_schema')
const duplicateKey = `{"ticket":${JSON.stringify(fixture.ticket)},"ticket":${JSON.stringify(fixture.ticket)},"transcript":${JSON.stringify(fixture.transcript)}}`
await assertError(await handleAuthoritativeSubmissionRequest(rawRequest(duplicateKey), enabledEnvironment(new MockDatabase()), stableSources), 'invalid_request_schema')
await assertError(await handleAuthoritativeSubmissionRequest(rawRequest('{'), enabledEnvironment(new MockDatabase()), stableSources), 'malformed_json')

// Public Pages boundary: fail-closed gate, trusted metadata, exact forwarding, and no direct D1.
let disabledServiceCalls = 0
let disabledPulls = 0
const disabledStream = new ReadableStream<Uint8Array>({
  pull() {
    disabledPulls += 1
    throw new Error('disabled submission body must stay unread')
  },
})
const disabledPublicRequest = new Request(ENDPOINT, {
  method: 'PUT', headers: JSON_HEADERS, body: disabledStream, duplex: 'half',
} as RequestInit & { duplex: 'half' })
await Promise.resolve()
const pullsBeforeDisabled = disabledPulls
const disabledPublicResponse = await handleSubmitDraftRequest(disabledPublicRequest, {
  DRAFT_SUBMISSION_MODE: 'disabled',
  VALIDATION_SERVICE: { async fetch() { disabledServiceCalls += 1; return new Response() } },
})
assert.equal(disabledPublicResponse.status, 404)
assert.deepEqual(await disabledPublicResponse.json(), { ok: false, error: { code: 'not_found', message: 'API route not found' } })
assert.equal(disabledServiceCalls, 0)
assert.equal(disabledPulls, pullsBeforeDisabled)
await disabledPublicRequest.body?.cancel().catch(() => undefined)

const publicBase = { DRAFT_SUBMISSION_MODE: 'enabled' } as const
await assertError(await handleSubmitDraftRequest(request('', { method: 'GET', headers: { 'CF-Connecting-IP': CLIENT_IP } }), publicBase), 'method_not_allowed')
await assertError(await handleSubmitDraftRequest(request(envelope, { origin: 'https://attacker.example', headers: { 'CF-Connecting-IP': CLIENT_IP } }), publicBase), 'origin_not_allowed')
await assertError(await handleSubmitDraftRequest(request(envelope), publicBase), 'submission_unavailable')
await assertError(await handleSubmitDraftRequest(request(envelope, { headers: { 'CF-Connecting-IP': CLIENT_IP } }), publicBase), 'submission_unavailable')

let forwarded: Request | null = null
const relayedBody = JSON.stringify({ ok: false, verified: false, submitted: false, error: { code: 'submission_unavailable', message: 'Draft submission is temporarily unavailable.' } })
const relayResponse = await handleSubmitDraftRequest(request(envelope, {
  headers: {
    'CF-Connecting-IP': CLIENT_IP,
    'Content-Length': '123',
    'Content-Encoding': 'identity',
    [INTERNAL_RATE_KEY_HEADER]: `v1:${'0'.repeat(64)}`,
    Cookie: 'not-forwarded',
    Authorization: 'not-forwarded',
  },
}), {
  DRAFT_SUBMISSION_MODE: 'enabled',
  VALIDATION_SERVICE: {
    async fetch(received: Request) {
      forwarded = received
      return new Response(relayedBody, { status: 503, headers: SAFE_HEADERS })
    },
  },
})
assert.equal(relayResponse.status, 503)
assert.equal(await relayResponse.text(), relayedBody)
assert(forwarded)
assert.equal(forwarded.headers.get('Content-Type'), 'application/json')
assert.equal(forwarded.headers.get('Content-Length'), '123')
assert.equal(forwarded.headers.get('Content-Encoding'), 'identity')
assert.equal(forwarded.headers.get(INTERNAL_RATE_KEY_HEADER), await deriveTrustedRateKey(CLIENT_IP))
for (const header of ['CF-Connecting-IP', 'Cookie', 'Authorization']) assert.equal(forwarded.headers.get(header), null)
const noPagesD1 = new Proxy({
  DRAFT_SUBMISSION_MODE: 'enabled',
  VALIDATION_SERVICE: { async fetch() { return new Response(relayedBody, { status: 503, headers: SAFE_HEADERS }) } },
}, {
  get(target, property, receiver) {
    if (property === 'DB') throw new Error('Pages must not touch D1')
    return Reflect.get(target, property, receiver)
  },
})
assert.equal((await handleSubmitDraftRequest(request(envelope, { headers: { 'CF-Connecting-IP': CLIENT_IP } }), noPagesD1)).status, 503)

// Private transport boundary: gate precedes rate/body/D1; enabled requests use both limits.
const privateBurst = new DeterministicRateLimit()
const privateSustained = new DeterministicRateLimit()
const privateDisabledEnv = Object.defineProperty({
  DRAFT_SUBMISSION_MODE: 'disabled',
  RATE_LIMIT_BURST: privateBurst,
  RATE_LIMIT_SUSTAINED: privateSustained,
}, 'DB', { get() { throw new Error('disabled private route must not touch D1') } }) as PrivateValidationWorkerEnv
assert.equal((await handlePrivateSubmissionRequest(request(envelope), privateDisabledEnv)).status, 404)
assert.equal(privateBurst.calls, 0)
assert.equal(privateSustained.calls, 0)

const privateDatabase = new MockDatabase()
const privateEnv = {
  ...enabledEnvironment(privateDatabase),
  RATE_LIMIT_BURST: privateBurst,
  RATE_LIMIT_SUSTAINED: privateSustained,
} as PrivateValidationWorkerEnv
await assertError(await handlePrivateSubmissionRequest(request(envelope), privateEnv), 'submission_unavailable')
assert.equal(privateBurst.calls, 0)
const rateKey = await deriveTrustedRateKey(CLIENT_IP)
const privateMethod = new Request(ENDPOINT, { method: 'GET', headers: { [INTERNAL_RATE_KEY_HEADER]: rateKey } })
const privateMethodResponse = await handlePrivateSubmissionRequest(privateMethod, privateEnv)
await assertError(privateMethodResponse, 'method_not_allowed')
assert.equal(privateMethodResponse.headers.get('Allow'), 'POST')
assert.equal(privateBurst.calls, 1)
assert.equal(privateSustained.calls, 1)

const deniedBurst = new DeterministicRateLimit(0)
const untouchedSustained = new DeterministicRateLimit()
const deniedEnv = { ...privateEnv, RATE_LIMIT_BURST: deniedBurst, RATE_LIMIT_SUSTAINED: untouchedSustained }
const limited = await handlePrivateSubmissionRequest(new Request(ENDPOINT, {
  method: 'POST', headers: { ...JSON_HEADERS, [INTERNAL_RATE_KEY_HEADER]: rateKey }, body: '{',
}), deniedEnv)
await assertError(limited, 'rate_limited')
assert.equal(limited.headers.get('Retry-After'), '60')
assert.equal(deniedBurst.calls, 1)
assert.equal(untouchedSustained.calls, 0)

const deniedSustained = new DeterministicRateLimit(0)
const sustainedEnv = { ...privateEnv, RATE_LIMIT_BURST: new DeterministicRateLimit(), RATE_LIMIT_SUSTAINED: deniedSustained }
await assertError(await handlePrivateSubmissionRequest(new Request(ENDPOINT, {
  method: 'POST', headers: { ...JSON_HEADERS, [INTERNAL_RATE_KEY_HEADER]: rateKey }, body: '{',
}), sustainedEnv), 'rate_limited')
assert.equal(deniedSustained.calls, 1)

await assertError(await handleAuthoritativeSubmissionRequest(rawRequest('{}', { 'Content-Type': 'text/plain' }), enabledEnvironment(new MockDatabase()), stableSources), 'unsupported_media_type')
await assertError(await handleAuthoritativeSubmissionRequest(rawRequest('{}', { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }), enabledEnvironment(new MockDatabase()), stableSources), 'unsupported_media_type')
await assertError(await handleAuthoritativeSubmissionRequest(rawRequest('{}', { 'Content-Type': 'application/json', 'Content-Length': String(MAX_DRAFT_VALIDATION_BODY_BYTES + 1) }), enabledEnvironment(new MockDatabase()), stableSources), 'payload_too_large')
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope, { origin: 'https://attacker.example' }), enabledEnvironment(new MockDatabase()), stableSources), 'origin_not_allowed')
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope, { headers: { Host: 'attacker.example' } }), enabledEnvironment(new MockDatabase()), stableSources), 'origin_not_allowed')
let chunkCount = 0
const tooManyChunks = new ReadableStream<Uint8Array>({
  pull(controller) {
    chunkCount += 1
    controller.enqueue(new Uint8Array(0))
  },
})
await assertError(await handleAuthoritativeSubmissionRequest(new Request(ENDPOINT, {
  method: 'POST', headers: JSON_HEADERS, body: tooManyChunks, duplex: 'half',
} as RequestInit & { duplex: 'half' }), enabledEnvironment(new MockDatabase()), stableSources), 'payload_too_large')
assert.equal(chunkCount, 16_385)

// Required secret, preview D1 binding, and exact schema fail closed.
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(new MockDatabase(), null), stableSources), 'submission_unavailable')
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), { DRAFT_SUBMISSION_MODE: 'enabled', DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY }, stableSources), 'submission_unavailable')
const wrongSchemaDatabase = new MockDatabase()
wrongSchemaDatabase.schemaVersion = 1
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(wrongSchemaDatabase), stableSources), 'submission_unavailable')
assert.equal(wrongSchemaDatabase.batchCalls, 0)

// First authoritative commit creates exactly the approved immutable receipt.
const firstDatabase = new MockDatabase()
const firstResponse = await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(firstDatabase), stableSources)
assert.equal(firstResponse.status, 201)
assertSafeHeaders(firstResponse)
const firstBytes = await firstResponse.text()
const firstReceipt = JSON.parse(firstBytes) as Record<string, unknown>
assert.deepEqual(Object.keys(firstReceipt), ['ok', 'verified', 'submitted', 'submissionSchema', 'submittedAt', 'versions', 'result'])
assert.equal(firstReceipt.ok, true)
assert.equal(firstReceipt.verified, true)
assert.equal(firstReceipt.submitted, true)
assert.equal(firstReceipt.submissionSchema, DRAFT_SUBMISSION_SCHEMA_VERSION)
assert.equal(firstReceipt.submittedAt, new Date(NOW).toISOString())
assert(firstDatabase.row)
assert.equal(firstDatabase.row.submitted_at_ms, NOW)
assert.equal(firstDatabase.row.retain_until_ms, NOW + DRAFT_SUBMISSION_RETENTION_MS)
assert.equal(firstDatabase.row.success_response_json, firstBytes)
assert.equal(firstDatabase.batchCalls, 1)
assert.deepEqual(Object.keys(firstReceipt.result as Record<string, unknown>), [
  'projectedWins', 'projectedLosses', 'overallScore', 'overallGrade', 'tier',
  'categories', 'strongestCategory', 'weakestCategory',
])
assert.doesNotMatch(firstBytes, /"(?:ticket|ticketId|draftId|submissionId|transcript|transcriptDigest|roster|player|seed|idempotentRetry|metadata)":/i)

// Retained exact retry uses only stored authority, survives expiry/key rotation, and returns exact bytes.
const noRecalculationSources = {
  now: () => { throw new Error('retained retry must not read current time') },
  verifyTicket: async () => { throw new Error('retained retry must not verify') },
  getCatalog: () => { throw new Error('retained retry must not initialize catalog') },
  replay: () => { throw new Error('retained retry must not replay') },
  score: () => { throw new Error('retained retry must not rescore') },
}
const retainedResponse = await handleAuthoritativeSubmissionRequest(
  request(envelope),
  enabledEnvironment(firstDatabase, 'rotated-nonempty-signing-key'),
  noRecalculationSources,
)
assert.equal(retainedResponse.status, 200)
assert.equal(await retainedResponse.text(), firstBytes)
assert.equal(firstDatabase.batchCalls, 1)
assert.equal(firstDatabase.row.submitted_at_ms, NOW)
const farFutureRetry = await handleAuthoritativeSubmissionRequest(
  request(envelope),
  enabledEnvironment(firstDatabase),
  { now: () => NOW + DRAFT_TICKET_TTL_MS + 1 },
)
assert.equal(farFutureRetry.status, 200)
assert.equal(await farFutureRetry.text(), firstBytes)
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(firstDatabase, null), noRecalculationSources), 'submission_unavailable')

const changedTranscript = structuredClone(fixture.transcript)
changedTranscript.events.find((event) => event.type === 'pick')!.featuredSeason += 1
await assertError(await handleAuthoritativeSubmissionRequest(
  request({ ticket: fixture.ticket, transcript: changedTranscript }),
  enabledEnvironment(firstDatabase),
  noRecalculationSources,
), 'draft_ticket_already_consumed')
await assertError(await handleAuthoritativeSubmissionRequest(
  request({ ticket: 'different-opaque-token', transcript: fixture.transcript }),
  enabledEnvironment(firstDatabase),
  noRecalculationSources,
), 'invalid_draft_ticket')

const corruptDigestDatabase = new MockDatabase()
corruptDigestDatabase.row = { ...firstDatabase.row, ticket_token_digest: 'A'.repeat(64) }
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(corruptDigestDatabase), noRecalculationSources), 'submission_unavailable')
const corruptReceiptDatabase = new MockDatabase()
corruptReceiptDatabase.row = { ...firstDatabase.row, success_response_json: '{}' }
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(corruptReceiptDatabase), noRecalculationSources), 'submission_unavailable')
const inconsistentReceiptDatabase = new MockDatabase()
const inconsistentReceipt = JSON.parse(firstBytes) as { result: { projectedLosses: number } }
inconsistentReceipt.result.projectedLosses += 1
inconsistentReceiptDatabase.row = { ...firstDatabase.row, success_response_json: JSON.stringify(inconsistentReceipt) }
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(inconsistentReceiptDatabase), noRecalculationSources), 'submission_unavailable')

// Invalid, expired, future, substituted, or differently bound new tickets never write.
for (const invalidTicket of ['not-a-ticket', `${fixture.ticket.slice(0, -1)}x`]) {
  const database = new MockDatabase()
  await assertError(await handleAuthoritativeSubmissionRequest(
    request({ ticket: invalidTicket, transcript: fixture.transcript }), enabledEnvironment(database), stableSources,
  ), 'invalid_draft_ticket')
  assert.equal(database.batchCalls, 0)
}
const expired = await createBoundValidationFixture(noRerollsData.transcript, { issuedAt: NOW - DRAFT_TICKET_TTL_MS })
await assertError(await handleAuthoritativeSubmissionRequest(request({ ticket: expired.ticket, transcript: expired.transcript }), enabledEnvironment(new MockDatabase()), stableSources), 'invalid_draft_ticket')
const future = await createBoundValidationFixture(noRerollsData.transcript, { issuedAt: NOW + DRAFT_TICKET_MAX_CLOCK_SKEW_MS + 1 })
await assertError(await handleAuthoritativeSubmissionRequest(request({ ticket: future.ticket, transcript: future.transcript }), enabledEnvironment(new MockDatabase()), stableSources), 'invalid_draft_ticket')

const bindingMutations: Array<(transcript: DraftTranscript) => void> = [
  (transcript) => { transcript.header.draftId = '22222222-2222-4222-8222-222222222222' },
  (transcript) => { transcript.header.gameplaySeed = `seeded-v1:${'1'.repeat(32)}` },
  (transcript) => { transcript.header.createdAt = new Date(NOW - 999).toISOString() },
  (transcript) => { transcript.header.transcriptSchemaVersion = 'draft-transcript-v2' as never },
  (transcript) => { transcript.header.appVersion = '2.0.0' },
  (transcript) => { transcript.header.gameRulesVersion = 'classic-rules-v2' },
  (transcript) => { transcript.header.rngVersion = 'seeded-v2' },
  (transcript) => { transcript.header.scoringVersion = '3.0' },
  (transcript) => { transcript.header.dataVersion = 'lahman-2026-v1' },
  (transcript) => { transcript.header.canonicalDataDigest = '0'.repeat(64) },
]
for (const mutate of bindingMutations) {
  const transcript = structuredClone(fixture.transcript)
  mutate(transcript)
  await assertError(await handleAuthoritativeSubmissionRequest(
    request({ ticket: fixture.ticket, transcript }), enabledEnvironment(new MockDatabase()), stableSources,
  ), 'draft_ticket_mismatch')
}
await assertError(await handleAuthoritativeSubmissionRequest(
  request(envelope), enabledEnvironment(new MockDatabase()), {
    ...stableSources,
    verifyTicket: async () => ({ ok: true, payload: { ...fixture.payload, gameMode: 'other' } }),
  },
), 'draft_ticket_mismatch')

// Current-version policy is enforced only after successful verification and binding.
const versionCases: ReadonlyArray<readonly [keyof DraftTranscript['header'], keyof DraftTicketPayload, string, DraftSubmissionErrorCode]> = [
  ['transcriptSchemaVersion', 'transcriptSchemaVersion', 'draft-transcript-v2', 'unsupported_transcript_version'],
  ['appVersion', 'appVersion', '2.0.0', 'unsupported_app_version'],
  ['gameRulesVersion', 'gameRulesVersion', 'classic-rules-v2', 'unsupported_rules_version'],
  ['rngVersion', 'rngVersion', 'seeded-v2', 'unsupported_rng_version'],
  ['scoringVersion', 'scoringVersion', '3.0', 'unsupported_scoring_version'],
  ['dataVersion', 'dataVersion', 'lahman-2026-v1', 'unsupported_data_version'],
  ['canonicalDataDigest', 'canonicalDataDigest', '0'.repeat(64), 'canonical_data_mismatch'],
]
for (const [headerField, payloadField, value, code] of versionCases) {
  const transcript = structuredClone(fixture.transcript)
  transcript.header[headerField] = value as never
  const payload = { ...fixture.payload, [payloadField]: value }
  await assertError(await handleAuthoritativeSubmissionRequest(
    request({ ticket: fixture.ticket, transcript }), enabledEnvironment(new MockDatabase()), {
      ...stableSources,
      verifyTicket: async () => ({ ok: true, payload }),
    },
  ), code)
}
const invalidSeed = structuredClone(fixture.transcript)
invalidSeed.header.gameplaySeed = `seeded-v1:${'0'.repeat(32)}`
await assertError(await handleAuthoritativeSubmissionRequest(request({ ticket: fixture.ticket, transcript: invalidSeed }), enabledEnvironment(new MockDatabase()), stableSources), 'invalid_seed')

// Deterministic replay rejects every major tamper class before persistence.
const fixedFixture = await createBoundValidationFixture(fixed113Data.transcript, { issuedAt: NOW - 1_000 })
const pickIndices = fixedFixture.transcript.events.flatMap((event, index) => event.type === 'pick' ? [index] : [])
const initialIndices = fixedFixture.transcript.events.flatMap((event, index) => event.type === 'initial-roll' ? [index] : [])
const rerollIndex = fixedFixture.transcript.events.findIndex((event) => event.type === 'reroll')
async function assertReplayTamper(code: DraftSubmissionErrorCode, mutate: (transcript: DraftTranscript) => void) {
  const transcript = structuredClone(fixedFixture.transcript)
  mutate(transcript)
  const database = new MockDatabase()
  await assertError(await handleAuthoritativeSubmissionRequest(
    request({ ticket: fixedFixture.ticket, transcript }), enabledEnvironment(database), stableSources,
  ), code)
  assert.equal(database.batchCalls, 0)
}
await assertReplayTamper('invalid_roll_sequence', (transcript) => { transcript.events[initialIndices[0]].combinationId = 'ana-1960s' })
await assertReplayTamper('invalid_reroll', (transcript) => {
  const event = transcript.events[rerollIndex]
  if (event.type === 'reroll') event.resultingCombinationId = 'ana-1960s'
})
await assertReplayTamper('invalid_card', (transcript) => {
  const event = transcript.events[pickIndices[0]]
  if (event.type === 'pick') event.canonicalCardId = 'not-a-canonical-card'
})
await assertReplayTamper('wrong_pool', (transcript) => {
  const event = transcript.events[pickIndices[0]]
  if (event.type === 'pick') event.canonicalCardId = 'ana-1960s-adcocjo01'
})
await assertReplayTamper('invalid_position', (transcript) => {
  const event = transcript.events[pickIndices[0]]
  if (event.type === 'pick') event.assignedPosition = 'RP'
})
await assertReplayTamper('duplicate_card', (transcript) => {
  const first = transcript.events[pickIndices[0]]
  const second = transcript.events[pickIndices[1]]
  if (first.type === 'pick' && second.type === 'pick') second.canonicalCardId = first.canonicalCardId
})
await assertReplayTamper('unexpected_event_order', (transcript) => {
  ;[transcript.events[0], transcript.events[1]] = [transcript.events[1], transcript.events[0]]
})
await assertReplayTamper('incomplete_roster', (transcript) => { transcript.events.splice(pickIndices[0], 1) })

const scoringDatabase = new MockDatabase()
await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(scoringDatabase), {
  ...stableSources,
  score: () => { throw new Error('private scoring details') },
}), 'scoring_failed')
assert.equal(scoringDatabase.batchCalls, 0)

// Atomic INSERT-on-conflict + SELECT reconciliation covers every race outcome.
for (const [conflictMode, code, status] of [
  ['same', null, 200],
  ['transcript', 'draft_ticket_already_consumed', 409],
  ['token', 'invalid_draft_ticket', 422],
] as const) {
  const database = new MockDatabase()
  database.conflictMode = conflictMode
  const response = await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(database), stableSources)
  if (code) await assertError(response, code)
  else {
    assert.equal(response.status, status)
    assert.equal(await response.text(), database.row?.success_response_json)
  }
  assert.equal(database.batchCalls, 1)
  assert(database.row)
  assert.equal(database.row.ticket_id, fixture.transcript.header.draftId)
}

for (const batchMode of ['fail', 'malformed', 'missing-row', 'bad-changes'] as const) {
  const database = new MockDatabase()
  database.batchMode = batchMode
  await assertError(await handleAuthoritativeSubmissionRequest(request(envelope), enabledEnvironment(database), stableSources), 'submission_unavailable')
  if (batchMode === 'fail') assert.equal(database.row, null, 'a rolled-back batch must not consume the ticket')
}

// Repository safety remains fully disabled and production-private D1-free.
const pagesConfig = readFileSync('wrangler.toml', 'utf8')
const workerConfig = readFileSync('workers/draft-validation/wrangler.toml', 'utf8')
const versionSource = readFileSync('src/config/versions.ts', 'utf8')
const submissionSource = readFileSync('workers/draft-validation/src/authoritative-submission.ts', 'utf8')
assert.equal((pagesConfig.match(/^DRAFT_SUBMISSION_MODE = "disabled"$/gm) ?? []).length, 2)
assert.equal((workerConfig.match(/^DRAFT_SUBMISSION_MODE = "disabled"$/gm) ?? []).length, 2)
assert.equal((pagesConfig.match(/^DRAFT_SUBMISSION_MODE = "enabled"$/gm) ?? []).length, 0)
assert.equal((workerConfig.match(/^DRAFT_SUBMISSION_MODE = "enabled"$/gm) ?? []).length, 0)
assert.equal((workerConfig.match(/^\[\[d1_databases\]\]$/gm) ?? []).length, 1)
assert.equal((workerConfig.match(/^\[\[env\.production\.d1_databases\]\]$/gm) ?? []).length, 0)
assert.match(workerConfig, /^\[triggers\]\ncrons = \["17 \* \* \* \*"\]$/m)
assert.match(workerConfig, /^\[env\.production\.triggers\]\ncrons = \[\]$/m)
assert.match(versionSource, /SUBMISSION_SCHEMA_VERSION: null/)
assert.doesNotMatch(submissionSource, /\bconsole\.|\bwaitUntil\b|\bMath\.random\b|\braw_ticket\b|\bsignature\b/)
assert.match(submissionSource, /ON CONFLICT\(ticket_id\) DO NOTHING/)
assert.match(submissionSource, /database\.batch\(\[insert, select\]\)/)
assert.doesNotMatch(submissionSource, /ticket_token_digest\s*===\s*|transcript_digest\s*===\s*/)

console.log('D1C.2 submission tests passed: canonical digests, disabled proxying, retained idempotency, ticket binding, replay/scoring, immutable receipts, and atomic D1 reconciliation are verified.')
