import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import { handleAuthoritativeValidationRequest } from '../workers/draft-validation/src/authoritative-validation'
import {
  DRAFT_VALIDATION_ERROR_DEFINITIONS,
  DraftValidationPublicError,
  type DraftValidationErrorCode,
} from '../functions/lib/api-response'
import {
  MAX_DRAFT_VALIDATION_BODY_BYTES,
  MAX_DRAFT_VALIDATION_BODY_CHUNKS,
} from '../functions/lib/bounded-json'
import { validateDraftRequestEnvelope } from '../functions/lib/draft-validation-schema'
import { createLazyImmutable } from '../functions/lib/lazy-immutable'
import type { BackendEnv } from '../functions/lib/env'
import { CURRENT_REPLAY_VERSION_SUPPORT } from '../src/game/ReplayDraft'
import { replayDraftWithCatalog } from '../src/game/replay/replayDraft'
import { createWorkerReplayCatalog } from '../src/game/replay/WorkerCatalog'
import type { ReplayCatalog } from '../src/game/replay/types'
import {
  createBoundValidationFixture,
  TEST_DRAFT_TICKET_SIGNING_KEY,
} from './lib/draft-ticket-fixtures'

const ENDPOINT = 'https://preview.example.test/api/v1/validate-draft'
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const enabledEnv = {
  DRAFT_VALIDATION_MODE: 'enabled',
  DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY,
} as BackendEnv
let peakHeapBytes = process.memoryUsage().heapUsed

function sampleHeap() {
  peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed)
}

function request(body: BodyInit | null, headers: Record<string, string> = JSON_HEADERS) {
  return new Request(ENDPOINT, { method: 'POST', headers, body })
}

function streamRequest(
  produce: (controller: ReadableStreamDefaultController<Uint8Array>) => void,
  headers: Record<string, string> = JSON_HEADERS,
) {
  const body = new ReadableStream<Uint8Array>({ pull: produce })
  return new Request(ENDPOINT, {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

function assertSafeHeaders(response: Response) {
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(response.headers.get('Set-Cookie'), null)
}

async function assertFailure(response: Response, code?: DraftValidationErrorCode) {
  assertSafeHeaders(response)
  const body = await response.text()
  assert.doesNotMatch(body, /(?:stack|database|sql|seeded-v1:|canonicalCardId|sourcePlayerId|signature|ticketId|test-only-draft-ticket-signing-key)/i)
  const parsed: unknown = JSON.parse(body)
  assert.equal(typeof parsed, 'object')
  assert.notEqual(parsed, null)
  if (!code) return
  const definition = DRAFT_VALIDATION_ERROR_DEFINITIONS[code]
  assert.equal(response.status, definition.status)
  assert.deepEqual(parsed, {
    ok: false,
    verified: false,
    error: { code, message: definition.message },
  })
}

async function expectRequestFailure(
  input: Request,
  code?: DraftValidationErrorCode,
) {
  const response = await handleAuthoritativeValidationRequest(input, enabledEnv)
  await assertFailure(response, code)
  sampleHeap()
}

async function expectSuccess(input: Request) {
  const response = await handleAuthoritativeValidationRequest(input, enabledEnv)
  assert.equal(response.status, 200)
  assertSafeHeaders(response)
  const body = await response.text()
  assert.match(body, /"verified":true/)
  sampleHeap()
}

await expectRequestFailure(streamRequest((controller) => controller.close()), 'malformed_json')

const noRerollsFixture = await createBoundValidationFixture(noRerollsData.transcript)
const twoRerollsFixture = await createBoundValidationFixture(twoRerollsData.transcript)
const noRerollsTranscript = noRerollsFixture.transcript
const twoRerollsTranscript = twoRerollsFixture.transcript
const validBody = JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: noRerollsTranscript })
let oneByteOffset = 0
await expectSuccess(streamRequest((controller) => {
  if (oneByteOffset >= validBody.length) return controller.close()
  controller.enqueue(new TextEncoder().encode(validBody.slice(oneByteOffset, oneByteOffset + 1)))
  oneByteOffset += 1
}))

let tinyChunkCount = 0
await expectRequestFailure(streamRequest((controller) => {
  if (tinyChunkCount >= 12_000) return controller.close()
  controller.enqueue(new Uint8Array([0x20]))
  tinyChunkCount += 1
}), 'malformed_json')
assert.equal(tinyChunkCount, 12_000, 'one-byte streams must remain bounded by the body limit')

await expectRequestFailure(request(' '.repeat(MAX_DRAFT_VALIDATION_BODY_BYTES)), 'malformed_json')
await expectRequestFailure(request(' '.repeat(MAX_DRAFT_VALIDATION_BODY_BYTES + 1)), 'payload_too_large')

let underDeclaredPulls = 0
await expectRequestFailure(streamRequest((controller) => {
  underDeclaredPulls += 1
  if (underDeclaredPulls === 1) controller.enqueue(new Uint8Array(MAX_DRAFT_VALIDATION_BODY_BYTES))
  else if (underDeclaredPulls === 2) controller.enqueue(new Uint8Array([0x20]))
  else controller.close()
}, { ...JSON_HEADERS, 'Content-Length': '1' }), 'payload_too_large')
assert.equal(underDeclaredPulls, 2, 'actual bytes must override an understated Content-Length')

await expectRequestFailure(request('{}', {
  ...JSON_HEADERS,
  'Content-Length': String(MAX_DRAFT_VALIDATION_BODY_BYTES + 1),
}), 'payload_too_large')
await expectRequestFailure(request('{}'), 'invalid_request_schema')

let malformedUtf8Chunk = 0
await expectRequestFailure(streamRequest((controller) => {
  if (malformedUtf8Chunk === 0) controller.enqueue(new Uint8Array([0xc3]))
  else if (malformedUtf8Chunk === 1) controller.enqueue(new Uint8Array([0x28]))
  else controller.close()
  malformedUtf8Chunk += 1
}), 'malformed_json')

await expectRequestFailure(request(`${'['.repeat(7_000)}0${']'.repeat(7_000)}`))
const wideObject = `{${Array.from({ length: 1_000 }, (_, index) => `"x${index}":0`).join(',')}}`
await expectRequestFailure(request(wideObject), 'invalid_request_schema')
await expectRequestFailure(request('{"ticket":"a","transcript":{},"transcript":{}}'), 'invalid_request_schema')
const duplicateValidEnvelope = `{"ticket":${JSON.stringify(noRerollsFixture.ticket)},"transcript":${JSON.stringify(noRerollsTranscript)},"transcript":${JSON.stringify(noRerollsTranscript)}}`
await expectRequestFailure(request(duplicateValidEnvelope), 'invalid_request_schema')
const duplicateHeader = JSON.stringify(noRerollsTranscript.header).replace(
  '"appVersion":"1.0.0"',
  '"appVersion":"not-supported","appVersion":"1.0.0"',
)
await expectRequestFailure(request(`{"ticket":${JSON.stringify(noRerollsFixture.ticket)},"transcript":{"header":${duplicateHeader},"events":${JSON.stringify(noRerollsTranscript.events)}}}`), 'invalid_request_schema')
await expectRequestFailure(request('1e400'), 'invalid_request_schema')
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: { header: {}, events: [{ type: 'initial-roll', round: Number.MAX_SAFE_INTEGER + 1 }] } })), 'invalid_request_schema')

const longHeaderFields = [
  'transcriptSchemaVersion', 'appVersion', 'gameRulesVersion', 'rngVersion', 'scoringVersion',
  'dataVersion', 'canonicalDataDigest', 'draftId', 'gameplaySeed', 'createdAt',
] as const
for (const field of longHeaderFields) {
  const candidate = structuredClone(noRerollsTranscript)
  candidate.header[field] = 'a'.repeat(97) as never
  await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: candidate })))
}

const longEventFields: ReadonlyArray<readonly [number, string]> = [
  [0, 'combinationId'],
  [twoRerollsTranscript.events.findIndex((event) => event.type === 'reroll'), 'discardedCombinationId'],
  [twoRerollsTranscript.events.findIndex((event) => event.type === 'reroll'), 'resultingCombinationId'],
  [1, 'combinationId'], [1, 'canonicalCardId'], [1, 'sourcePlayerId'], [1, 'assignedPosition'],
]
for (const [eventIndex, field] of longEventFields) {
  assert(eventIndex >= 0)
  const candidate = structuredClone(twoRerollsTranscript) as { events: Record<string, unknown>[] }
  candidate.events[eventIndex][field] = 'a'.repeat(97)
  await expectRequestFailure(request(JSON.stringify({ ticket: twoRerollsFixture.ticket, transcript: candidate })))
}

assert.equal(twoRerollsTranscript.events.length, 30)
await expectSuccess(request(JSON.stringify({ ticket: twoRerollsFixture.ticket, transcript: twoRerollsTranscript })))
const thirtyOneEvents = structuredClone(twoRerollsTranscript)
thirtyOneEvents.events.push(structuredClone(thirtyOneEvents.events[0]))
await expectRequestFailure(request(JSON.stringify({ ticket: twoRerollsFixture.ticket, transcript: thirtyOneEvents })), 'unexpected_event_order')

const repeatedUnknownFields = JSON.stringify({
  ticket: noRerollsFixture.ticket,
  transcript: noRerollsTranscript,
  ...Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`unknown${index}`, true])),
})
await expectRequestFailure(request(repeatedUnknownFields), 'invalid_request_schema')

const malformedDiscriminator = structuredClone(noRerollsTranscript)
malformedDiscriminator.events[0].type = 'not-an-event' as never
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: malformedDiscriminator })), 'invalid_request_schema')

const controlCharacter = structuredClone(noRerollsTranscript)
const firstPick = controlCharacter.events.find((event) => event.type === 'pick')
assert(firstPick && firstPick.type === 'pick')
firstPick.sourcePlayerId = '\u0000' as never
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: controlCharacter })), 'invalid_request_schema')

const nullPrototypeEnvelope = Object.create(null) as { transcript: unknown }
nullPrototypeEnvelope.transcript = Object.create(null)
assert.throws(() => validateDraftRequestEnvelope(nullPrototypeEnvelope), (error: unknown) => (
  error instanceof DraftValidationPublicError && error.code === 'invalid_request_schema'
))
await expectRequestFailure(request('[]'), 'invalid_request_schema')
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: [] })), 'invalid_request_schema')
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: { header: [], events: {} } })), 'invalid_request_schema')

const invalidFirst = structuredClone(noRerollsTranscript)
invalidFirst.events[0].combinationId = 'ana-1960s'
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: invalidFirst })), 'invalid_roll_sequence')

const invalidFinal = structuredClone(noRerollsTranscript)
const finalPick = invalidFinal.events.at(-1)
assert(finalPick && finalPick.type === 'pick')
finalPick.canonicalCardId = 'not-a-canonical-card'
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: invalidFinal })), 'invalid_card')

const invalidLateReroll = structuredClone(twoRerollsTranscript)
const lateReroll = [...invalidLateReroll.events].reverse().find((event) => event.type === 'reroll')
assert(lateReroll && lateReroll.type === 'reroll')
lateReroll.resultingCombinationId = 'ana-1960s'
await expectRequestFailure(request(JSON.stringify({ ticket: twoRerollsFixture.ticket, transcript: invalidLateReroll })), 'invalid_reroll')

const alteredMetadata = structuredClone(noRerollsTranscript)
alteredMetadata.header.canonicalDataDigest = '0'.repeat(64)
await expectRequestFailure(request(JSON.stringify({ ticket: noRerollsFixture.ticket, transcript: alteredMetadata })), 'canonical_data_mismatch')

let oversizePulls = 0
let oversizeCancelled = false
await expectRequestFailure(streamRequest((controller) => {
  oversizePulls += 1
  controller.enqueue(new Uint8Array(8_193))
}, JSON_HEADERS), 'payload_too_large')
assert.equal(oversizePulls, 2, 'reader must stop on the chunk that crosses 16 KiB')

// Verify cancellation with a source that observes it rather than relying on an
// implementation-specific close after the rejected request.
const cancellationStream = new ReadableStream<Uint8Array>({
  pull(controller) { controller.enqueue(new Uint8Array(8_193)) },
  cancel() { oversizeCancelled = true },
})
await expectRequestFailure(new Request(ENDPOINT, {
  method: 'POST', headers: JSON_HEADERS, body: cancellationStream, duplex: 'half',
} as RequestInit & { duplex: 'half' }), 'payload_too_large')
assert.equal(oversizeCancelled, true)

let zeroByteChunks = 0
let zeroByteCancelled = false
const zeroByteStream = new ReadableStream<Uint8Array>({
  pull(controller) {
    zeroByteChunks += 1
    controller.enqueue(new Uint8Array())
  },
  cancel() { zeroByteCancelled = true },
})
await expectRequestFailure(new Request(ENDPOINT, {
  method: 'POST', headers: JSON_HEADERS, body: zeroByteStream, duplex: 'half',
} as RequestInit & { duplex: 'half' }), 'payload_too_large')
assert.equal(zeroByteChunks, MAX_DRAFT_VALIDATION_BODY_CHUNKS + 1, 'zero-byte chunk streams must have a fixed read bound')
assert.equal(zeroByteCancelled, true)

const workerCatalog = createWorkerReplayCatalog()
let fallbackCardViewCalls = 0
const indexedCatalog: ReplayCatalog = {
  dataDigest: workerCatalog.dataDigest,
  getCombinations: () => workerCatalog.getCombinations(),
  getCardViews: (combination) => {
    fallbackCardViewCalls += 1
    return workerCatalog.getCardViews(combination)
  },
  hydrateCard: (combination, cardId) => workerCatalog.hydrateCard(combination, cardId),
  getCombinationPlayability: workerCatalog.getCombinationPlayability,
  findCombination: workerCatalog.findCombination,
  findCardCombination: workerCatalog.findCardCombination,
}
replayDraftWithCatalog(noRerollsTranscript, indexedCatalog, CURRENT_REPLAY_VERSION_SUPPORT)
assert.equal(fallbackCardViewCalls, 0, 'Worker replay must not materialize every catalog eligibility view')

let initializationCalls = 0
const lazyValue = createLazyImmutable(() => Object.freeze({ initialized: ++initializationCalls }))
assert.deepEqual(lazyValue(), { initialized: 1 })
assert.deepEqual(lazyValue(), { initialized: 1 })
assert.equal(initializationCalls, 1, 'immutable catalog initialization must occur at most once per isolate')
let failedInitializationCalls = 0
const lazyFailure = createLazyImmutable<number>(() => {
  failedInitializationCalls += 1
  throw new Error('catalog unavailable')
})
assert.equal(lazyFailure(), null)
assert.equal(lazyFailure(), null)
assert.equal(failedInitializationCalls, 1, 'failed initialization must be cached')

const validationRouteSource = readFileSync('workers/draft-validation/src/authoritative-validation.ts', 'utf8')
assert.doesNotMatch(validationRouteSource, /\benv\.DB\b|\bwaitUntil\b|\bconsole\.(?:log|warn|error)\b/)
assert.doesNotMatch(validationRouteSource, /\bfetch\s*\(|\bcaches\.open\s*\(|Set-Cookie|Access-Control-Allow-Origin/)
await expectRequestFailure(request(validBody, { ...JSON_HEADERS, Host: 'attacker.example' }), 'origin_not_allowed')

const maximumValidBody = `${validBody}${' '.repeat(MAX_DRAFT_VALIDATION_BODY_BYTES - validBody.length)}`
assert.equal(new TextEncoder().encode(maximumValidBody).byteLength, MAX_DRAFT_VALIDATION_BODY_BYTES)
const maximumStarted = performance.now()
await expectSuccess(request(maximumValidBody))
const maximumDurationMs = performance.now() - maximumStarted

console.log(JSON.stringify({
  cases: 'bounded hostile-stream, parser, schema, replay, metadata, catalog, and header hardening',
  maxValidRequestMs: Number(maximumDurationMs.toFixed(3)),
  approximatePeakHeapMiB: Number((peakHeapBytes / 1024 / 1024).toFixed(2)),
}, null, 2))
