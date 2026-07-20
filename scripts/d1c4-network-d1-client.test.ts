import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  boundedJsonRequest,
  BoundedFetchError,
  rawBytesEqual,
  requireHttpSuccess,
  utf8Bytes,
  type D1C4Fetch,
} from './lib/d1c4-bounded-fetch'
import {
  assertSingleD1Statement,
  authorizePreviewD1Mutations,
  createPreviewD1Client,
  createPreviewD1MutationClient,
  D1_BOUND_PARAMETER_LIMIT,
  DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT,
  D1MutationError,
  exactFingerprintChunks,
  EXACT_FINGERPRINT_DELETE_LIMIT,
} from './lib/d1c4-d1-client'
import {
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  readConfiguredPreviewIdentities,
  validatePreviewSmokeTarget,
  type ValidatedPreviewSmokeTarget,
} from './lib/d1c4-preview-guard'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function assertBoundedKind(kind: BoundedFetchError['kind']) {
  return (error: unknown) => {
    assert(error instanceof BoundedFetchError)
    assert.equal(error.kind, kind)
    return true
  }
}

const identities = readConfiguredPreviewIdentities()
const target = validatePreviewSmokeTarget({
  previewBaseUrl: `https://develop.${identities.pagesProject}.pages.dev`,
  previewWorker: identities.previewWorker,
  previewEnvironment: 'preview',
  accountId: 'a'.repeat(32),
  databaseId: identities.previewDatabaseId,
  acknowledgement: D1C4_PREVIEW_ACKNOWLEDGEMENT,
})

// Bounded Fetch accepts exactly the byte limit and rejects every unbounded edge.
const exactText = JSON.stringify({ value: 'bounded' })
const exactBytes = new TextEncoder().encode(exactText).byteLength
const exact = await boundedJsonRequest('https://example.test/exact', {
  description: 'Exact body',
  timeoutMs: 1_000,
  maxResponseBytes: exactBytes,
  fetcher: async () => new Response(exactText, {
    headers: { 'Content-Length': String(exactBytes) },
  }),
})
assert.equal(exact.text, exactText)
assert(rawBytesEqual(exact.bytes, utf8Bytes(exactText)))
assert(rawBytesEqual(utf8Bytes('{"ok":true}'), utf8Bytes('{"ok":true}')))
assert(!rawBytesEqual(utf8Bytes('{"ok":true}'), utf8Bytes('{ "ok": true }')))
assert(!rawBytesEqual(utf8Bytes('{"a":1,"b":2}'), utf8Bytes('{"b":2,"a":1}')))

const chunkedBytes = utf8Bytes(exactText)
const chunked = await boundedJsonRequest('https://example.test/chunked', {
  description: 'Differently chunked body',
  timeoutMs: 1_000,
  maxResponseBytes: exactBytes,
  fetcher: async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunkedBytes.slice(0, 2))
      controller.enqueue(chunkedBytes.slice(2, 7))
      controller.enqueue(chunkedBytes.slice(7))
      controller.close()
    },
  })),
})
assert(rawBytesEqual(chunked.bytes, exact.bytes), 'delivery chunking must not alter the exact received bytes')

await assert.rejects(() => boundedJsonRequest('https://example.test/bom', {
  description: 'BOM body',
  timeoutMs: 1_000,
  maxResponseBytes: 100,
  fetcher: async () => new Response(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes('{}')])),
}), assertBoundedKind('encoding'))

await assert.rejects(() => boundedJsonRequest('https://example.test/invalid-utf8', {
  description: 'Invalid UTF-8 body',
  timeoutMs: 1_000,
  maxResponseBytes: 100,
  fetcher: async () => new Response(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d])),
}), assertBoundedKind('encoding'))

await assert.rejects(() => boundedJsonRequest('https://example.test/large', {
  description: 'Large body',
  timeoutMs: 1_000,
  maxResponseBytes: exactBytes - 1,
  fetcher: async () => new Response(exactText),
}), assertBoundedKind('body-limit'))

await assert.rejects(() => boundedJsonRequest('https://example.test/content-length', {
  description: 'Malformed length',
  timeoutMs: 1_000,
  maxResponseBytes: 100,
  fetcher: async () => new Response('{}', { headers: { 'Content-Length': 'not-a-number' } }),
}), assertBoundedKind('body-limit'))

await assert.rejects(() => boundedJsonRequest('https://example.test/missing', {
  description: 'Missing body',
  timeoutMs: 1_000,
  maxResponseBytes: 100,
  fetcher: async () => new Response(null, { status: 200 }),
}), assertBoundedKind('body-missing'))

await assert.rejects(() => boundedJsonRequest('https://example.test/parse', {
  description: 'Malformed JSON',
  timeoutMs: 1_000,
  maxResponseBytes: 100,
  fetcher: async () => new Response('{'),
}), assertBoundedKind('parse'))

await assert.rejects(() => boundedJsonRequest('https://example.test/timeout', {
  description: 'Timed request',
  timeoutMs: 5,
  maxResponseBytes: 100,
  fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }),
}), assertBoundedKind('timeout'))

await assert.rejects(() => boundedJsonRequest('https://example.test/body-timeout', {
  description: 'Timed response body',
  timeoutMs: 5,
  maxResponseBytes: 100,
  fetcher: async () => new Response(new ReadableStream<Uint8Array>({ pull() {} })),
}), assertBoundedKind('timeout'))

const httpFailure = await boundedJsonRequest('https://example.test/http', {
  description: 'HTTP failure',
  timeoutMs: 1_000,
  maxResponseBytes: 100,
  fetcher: async () => jsonResponse({ ok: false }, 503),
})
assert.throws(() => requireHttpSuccess(httpFailure, 'HTTP failure'), assertBoundedKind('http'))

const redirectCases = [
  [301, `https://${identities.pagesProject}.pages.dev/production`],
  [302, 'http://localhost:5174/private'],
  [303, 'https://external.example/private'],
  [307, 'https://external.example/ticket'],
  [308, 'https://external.example/transcript'],
] as const
for (const [status, location] of redirectCases) {
  const contacts: string[] = []
  await assert.rejects(() => boundedJsonRequest(target.previewBaseUrl, {
    description: `Redirect ${status}`,
    timeoutMs: 1_000,
    maxResponseBytes: 100,
    fetcher: async (input, init) => {
      contacts.push(String(input))
      assert.equal(init?.redirect, 'manual')
      return new Response('{}', { status, headers: { Location: location } })
    },
  }), assertBoundedKind('redirect'))
  assert.deepEqual(contacts, [target.previewBaseUrl])
  assert(!contacts.includes(location), 'redirect target must never be contacted')
}

// Preview target objects are runtime-guarded as well as branded at compile time.
assert.throws(() => createPreviewD1Client(
  { ...target } as ValidatedPreviewSmokeTarget,
  'test-token',
), /not created by the preview target guard/)
assert.throws(() => validatePreviewSmokeTarget({ ...target, accountId: 'not-an-account' }))
assert.throws(() => validatePreviewSmokeTarget({ ...target, databaseId: 'not-a-database' }))
assert.throws(() => validatePreviewSmokeTarget({ ...target, databaseId: identities.productionDatabaseId }))
assert.throws(() => validatePreviewSmokeTarget({ ...target, previewWorker: identities.productionWorker }))
assert.throws(() => validatePreviewSmokeTarget({ ...target, previewEnvironment: 'production' }))

assert.doesNotThrow(() => assertSingleD1Statement('SELECT 1', 'read'))
assert.throws(() => assertSingleD1Statement('SELECT 1; DELETE FROM draft_submissions', 'read'), /one comment-free statement/)
assert.throws(() => assertSingleD1Statement('DELETE FROM draft_submissions', 'read'), /required read/)

function d1Access(fetcher: D1C4Fetch) {
  const read = createPreviewD1Client(target, 'test-secret-token', fetcher)
  const authorization = authorizePreviewD1Mutations(target, D1C4_PREVIEW_ACKNOWLEDGEMENT)
  return { read, mutate: createPreviewD1MutationClient(read, authorization) }
}

function d1Envelope(result: unknown) {
  return jsonResponse({ success: true, result: [result] })
}

// Read operations require rows but accept omitted optional metadata.
let observedAuthorization = ''
let observedParameters: unknown
const readable = d1Access(async (_input, init) => {
  observedAuthorization = new Headers(init?.headers).get('Authorization') ?? ''
  observedParameters = JSON.parse(String(init?.body)).params
  assert.equal(init?.redirect, 'manual')
  return d1Envelope({ success: true, results: [{ row_count: 1 }] })
})
assert.equal(await readable.read.countSubmissionTickets(['11111111-1111-4111-8111-111111111111']), 1)
assert.equal(observedAuthorization, 'Bearer test-secret-token')
assert.deepEqual(observedParameters, ['11111111-1111-4111-8111-111111111111'])

const completeRow = {
  ticket_id: '11111111-1111-4111-8111-111111111111',
  ticket_token_digest: 'a'.repeat(64),
  transcript_digest: 'b'.repeat(64),
  submitted_at_ms: 1_000,
  retain_until_ms: 2_000,
  submission_schema_version: 'pennant-draft-submission-v1',
  success_response_json: '{"ok":true}',
}
assert.deepEqual(await d1Access(async () => d1Envelope({ success: true, results: [completeRow] }))
  .read.readSubmissionRows([completeRow.ticket_id]), [{
  ticketId: completeRow.ticket_id,
  ticketTokenDigest: completeRow.ticket_token_digest,
  transcriptDigest: completeRow.transcript_digest,
  submittedAtMs: completeRow.submitted_at_ms,
  retainUntilMs: completeRow.retain_until_ms,
  submissionSchemaVersion: completeRow.submission_schema_version,
  successResponseJson: completeRow.success_response_json,
}])

// Mutation operations accept omitted results but require meta.changes.
let deletionSql = ''
let deletionParameters: unknown[] = []
const mutable = d1Access(async (_input, init) => {
  const body = JSON.parse(String(init?.body))
  deletionSql = body.sql
  deletionParameters = body.params
  return d1Envelope({ success: true, meta: { changes: 1 } })
})
const deletionFingerprint = {
  ticketId: '22222222-2222-4222-8222-222222222222',
  ticketTokenDigest: 'a'.repeat(64),
  transcriptDigest: 'b'.repeat(64),
  submittedAtMs: 1_000,
  retainUntilMs: 2_000,
  submissionSchemaVersion: 'pennant-draft-submission-v1',
  successResponseJson: '{"ok":true}',
}
assert.equal(await mutable.mutate.deleteDraftSubmissionFingerprints([deletionFingerprint]), 1)
assert.match(deletionSql, /^DELETE FROM draft_submissions WHERE \(\s*ticket_id = \?/)
for (const column of [
  'ticket_token_digest',
  'transcript_digest',
  'submission_schema_version',
  'submitted_at_ms',
  'retain_until_ms',
  'success_response_json',
]) assert.match(deletionSql, new RegExp(`AND ${column} = \\?`))
assert.deepEqual(deletionParameters, [
  deletionFingerprint.ticketId,
  deletionFingerprint.ticketTokenDigest,
  deletionFingerprint.transcriptDigest,
  deletionFingerprint.submissionSchemaVersion,
  deletionFingerprint.submittedAtMs,
  deletionFingerprint.retainUntilMs,
  deletionFingerprint.successResponseJson,
])
assert.doesNotMatch(deletionSql, /\bIN\s*\(|substr|LIKE/i)

assert.equal(
  EXACT_FINGERPRINT_DELETE_LIMIT,
  Math.floor(D1_BOUND_PARAMETER_LIMIT / DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT),
)
assert.equal(D1_BOUND_PARAMETER_LIMIT, 100)
assert.equal(DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT, 7)
assert.equal(EXACT_FINGERPRINT_DELETE_LIMIT, 14)

function numberedFingerprint(index: number) {
  return {
    ...deletionFingerprint,
    ticketId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }
}

let boundaryFetches = 0
let boundaryParameterCount = 0
let boundarySql = ''
const parameterLimitedFake: D1C4Fetch = async (_input, init) => {
  boundaryFetches += 1
  const body = JSON.parse(String(init?.body)) as { sql: string, params: unknown[] }
  if (body.params.length > D1_BOUND_PARAMETER_LIMIT) {
    return jsonResponse({ success: false, errors: [{ message: 'too many bound parameters' }] }, 400)
  }
  boundaryParameterCount = body.params.length
  boundarySql = body.sql
  return d1Envelope({
    success: true,
    meta: { changes: body.params.length / DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT },
  })
}
const boundaryMutation = d1Access(parameterLimitedFake).mutate
const fourteenFingerprints = Array.from({ length: EXACT_FINGERPRINT_DELETE_LIMIT }, (_, index) => numberedFingerprint(index))
assert.equal(await boundaryMutation.deleteDraftSubmissionFingerprints(fourteenFingerprints), 14)
assert.equal(boundaryFetches, 1)
assert.equal(boundaryParameterCount, 98)
assert.equal((boundarySql.match(/ticket_id = \?/g) ?? []).length, 14)
assert.equal((boundarySql.match(/success_response_json = \?/g) ?? []).length, 14)

const beforeRejectedBoundary = boundaryFetches
await assert.rejects(
  () => boundaryMutation.deleteDraftSubmissionFingerprints([
    ...fourteenFingerprints,
    numberedFingerprint(EXACT_FINGERPRINT_DELETE_LIMIT),
  ]),
  /1 through 14 rows/,
)
assert.equal(boundaryFetches, beforeRejectedBoundary, '15 fingerprints must fail before network contact')

const fakeOverLimitResponse = await parameterLimitedFake('https://d1.invalid/query', {
  method: 'POST',
  body: JSON.stringify({ sql: 'DELETE FROM draft_submissions', params: Array.from({ length: 101 }, () => 'x') }),
})
assert.equal(fakeOverLimitResponse.status, 400, 'the fake D1 transport must enforce the 100-parameter limit')

const retentionScaleChunks = exactFingerprintChunks(Array.from({ length: 5_004 }, (_, index) => index))
assert.equal(retentionScaleChunks.length, 358)
assert.equal(retentionScaleChunks.at(-1)?.length, 6)
assert.equal(Math.max(...retentionScaleChunks.map((chunk) => chunk.length)), EXACT_FINGERPRINT_DELETE_LIMIT)
assert.equal(retentionScaleChunks.flat().length, 5_004)

assert.equal(await d1Access(async () => d1Envelope({ success: true, meta: { changes: 0 } }))
  .mutate.deleteDraftSubmissionFingerprints([deletionFingerprint]), 0)

let destructiveRequests = 0
await assert.rejects(() => d1Access(async () => {
  destructiveRequests += 1
  throw new Error('lost mutation response')
}).mutate.deleteDraftSubmissionFingerprints([deletionFingerprint]), (error: unknown) => {
  assert(error instanceof D1MutationError)
  assert.equal(error.kind, 'response-lost')
  return true
})
assert.equal(destructiveRequests, 1, 'destructive D1 operations must never retry automatically')

for (const [kind, fetcher] of [
  ['timeout', async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  })],
  ['malformed-response', async () => d1Envelope({ success: true })],
  ['confirmed-rejection', async () => d1Envelope({ success: false })],
] as const) {
  await assert.rejects(() => d1Access(fetcher)
    .mutate.deleteDraftSubmissionFingerprints([deletionFingerprint], { timeoutMs: kind === 'timeout' ? 5 : 1_000 }), (error: unknown) => {
    assert(error instanceof D1MutationError)
    assert.equal(error.kind, kind)
    return true
  })
}

await assert.rejects(() => d1Access(async () => d1Envelope({ success: true }))
  .read.countSubmissionTickets(['11111111-1111-4111-8111-111111111111']), /requires result rows/)
await assert.rejects(() => d1Access(async () => d1Envelope({ success: true, results: [] }))
  .mutate.deleteDraftSubmissionFingerprints([{ ...deletionFingerprint, ticketId: '11111111-1111-4111-8111-111111111111' }]), /requires a non-negative mutation count/)
await assert.rejects(() => d1Access(async () => jsonResponse({ success: false, errors: [{ message: 'private' }] }, 403))
  .read.countSubmissionTickets(['11111111-1111-4111-8111-111111111111']), (error: unknown) => {
  assert(error instanceof Error)
  assert.doesNotMatch(error.message, /test-secret-token|private/)
  return true
})
await assert.rejects(() => d1Access(async () => jsonResponse({ success: true, result: 'invalid' }))
  .read.countSubmissionTickets(['11111111-1111-4111-8111-111111111111']), /malformed API envelope/)
await assert.rejects(() => d1Access(async () => jsonResponse({ success: true, result: [] }))
  .read.countSubmissionTickets(['11111111-1111-4111-8111-111111111111']), /exactly one result set/)
await assert.rejects(() => d1Access(async () => jsonResponse({
  success: true,
  result: [
    { success: true, results: [{ row_count: 1 }] },
    { success: true, results: [{ row_count: 1 }] },
  ],
}))
  .read.countSubmissionTickets(['11111111-1111-4111-8111-111111111111']), /exactly one result set/)

await assert.rejects(() => d1Access(async (_input, init) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
})).read.countSubmissionTickets(
  ['11111111-1111-4111-8111-111111111111'],
  { timeoutMs: 1_000, deadlineMs: 5, now: () => 0 },
), assertBoundedKind('timeout'))

assert.deepEqual(Object.keys(readable.read).sort(), [
  'countSubmissionTickets',
  'readRetentionExactRows',
  'readRetentionOrderingCompetitors',
  'readRetentionScopeRows',
  'readSubmissionRows',
])
assert.deepEqual(Object.keys(mutable.mutate).sort(), [
  'deleteDraftSubmissionFingerprints',
  'insertExpiredRetentionRows',
  'insertProtectedRetentionRow',
])
const d1ClientSource = readFileSync('scripts/lib/d1c4-d1-client.ts', 'utf8')
assert.doesNotMatch(d1ClientSource, /export (?:async )?function query|export interface D1ApiTarget/)
assert.doesNotMatch(d1ClientSource, /\bexec\s*\(|\bbatch\s*\(/)

console.log('D1C.4 bounded-network and D1 client tests passed: raw bytes, UTF-8 policy, redirects, timeouts, streaming bounds, guarded targets, narrow operations, fingerprint-constrained cleanup, and REST mutation metadata are verified offline.')
