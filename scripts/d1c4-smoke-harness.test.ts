import assert from 'node:assert/strict'
import {
  digestSubmissionTicketToken,
  digestSubmissionTranscript,
} from '../functions/lib/draft-submission'
import {
  DRAFT_SUBMISSION_RETENTION_MS,
  DRAFT_SUBMISSION_SCHEMA_VERSION,
} from '../functions/lib/draft-submission-constants'
import type { DraftTranscript } from '../src/game/DraftTranscript'
import {
  runSubmissionSmoke,
  submissionSmokeCli,
  assertStoredSuccessReceipt,
  validateSubmissionSuccessReceipt,
  type SubmissionSmokeD1,
} from './d1c4-submission-smoke'
import {
  createRetentionSentinels,
  retentionSentinelIds,
  retentionSmokeCli,
  RetentionSmokeFailure,
  runRetentionSmoke,
  type RetentionSmokeD1,
} from './d1c4-retention-smoke'
import type {
  PreviewD1MutationClient,
  PreviewD1ReadClient,
  DraftSubmissionFingerprint,
  SubmissionPersistenceRow,
} from './lib/d1c4-d1-client'
import {
  D1_BOUND_PARAMETER_LIMIT,
  DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT,
  draftSubmissionFingerprintsEqual,
  EXACT_FINGERPRINT_DELETE_LIMIT,
} from './lib/d1c4-d1-client'
import type { IssuedPreviewTicket } from './lib/d1c4-submission-fixture'
import {
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  readConfiguredPreviewIdentities,
  validatePreviewSmokeTarget,
} from './lib/d1c4-preview-guard'

type StoredRow = SubmissionPersistenceRow

class StatefulFakeD1 implements PreviewD1ReadClient, PreviewD1MutationClient {
  readonly rows = new Map<string, StoredRow>()
  readonly exactDeletedIds: string[] = []
  submissionReads = 0
  emptySubmissionReads = 0
  retentionInsertCalls = 0
  failRetentionInsertCall: number | null = null
  failAfterRetentionInsertCall: number | null = null
  mixedPartialRetentionInsertCall: number | null = null
  failCleanup = false
  failCleanupAfterDelete = false
  failCleanupReconciliationRead = false
  failReadAfterDeleteAttempt = false
  cleanupFailureObserved = false
  deleteCalls = 0
  readonly deleteBatchSizes: number[] = []
  beforeExpiredInsert?: (scope: string, offset: number, count: number) => void
  afterExpiredInsert?: (scope: string, offset: number, count: number) => void
  beforeDelete?: (fingerprints: readonly DraftSubmissionFingerprint[]) => void
  mutateSubmissionRead?: (row: StoredRow, read: number) => StoredRow

  async countSubmissionTickets(ticketIds: readonly string[]) {
    return ticketIds.filter((ticketId) => this.rows.has(ticketId)).length
  }

  async readSubmissionRows(ticketIds: readonly string[]) {
    const rows: SubmissionPersistenceRow[] = []
    for (const ticketId of ticketIds) {
      const row = this.rows.get(ticketId)
      if (!row) {
        this.emptySubmissionReads += 1
        continue
      }
      this.submissionReads += 1
      rows.push(this.mutateSubmissionRead?.(row, this.submissionReads) ?? row)
    }
    return rows
  }

  async readRetentionExactRows(ticketIds: readonly string[]) {
    if (
      (this.failCleanupReconciliationRead && this.cleanupFailureObserved)
      || (this.failReadAfterDeleteAttempt && this.deleteCalls > 0)
    ) {
      throw new Error('injected reconciliation read failure')
    }
    return ticketIds.flatMap((ticketId) => {
      const row = this.rows.get(ticketId)
      return row ? [{ ...row }] : []
    })
  }

  async readRetentionScopeRows(scope: string) {
    return [...this.rows.values()]
      .filter((row) => row.ticketId.startsWith(scope))
      .map((row) => ({ ...row }))
      .sort((left, right) => left.ticketId.localeCompare(right.ticketId))
  }

  async readRetentionOrderingCompetitors(
    scope: string,
    sentinelRetainUntilMs: number,
    lastSentinelId: string,
  ) {
    return [...this.rows.values()]
      .filter((row) => !row.ticketId.startsWith(scope))
      .filter((row) => row.retainUntilMs < sentinelRetainUntilMs
        || (row.retainUntilMs === sentinelRetainUntilMs && row.ticketId <= lastSentinelId))
      .sort((left, right) => left.retainUntilMs - right.retainUntilMs
        || left.ticketId.localeCompare(right.ticketId))
      .slice(0, 2)
      .map((row) => ({ ...row }))
  }

  async insertExpiredRetentionRows(
    scope: string,
    offset: number,
    count: number,
    digest: string,
    submissionSchemaVersion: string,
  ) {
    this.retentionInsertCalls += 1
    this.beforeExpiredInsert?.(scope, offset, count)
    if (this.retentionInsertCalls === this.failRetentionInsertCall) throw new Error('injected partial insertion')
    if (this.retentionInsertCalls === this.mixedPartialRetentionInsertCall) {
      const ownedId = `${scope}e${String(offset).padStart(7, '0')}`
      const mismatchedId = `${scope}e${String(offset + 1).padStart(7, '0')}`
      this.rows.set(ownedId, {
        ticketId: ownedId,
        ticketTokenDigest: digest,
        transcriptDigest: digest,
        submittedAtMs: 0,
        submissionSchemaVersion,
        successResponseJson: '{}',
        retainUntilMs: 1,
      })
      this.rows.set(mismatchedId, {
        ticketId: mismatchedId,
        ticketTokenDigest: 'f'.repeat(64),
        transcriptDigest: digest,
        submittedAtMs: 0,
        submissionSchemaVersion,
        successResponseJson: '{}',
        retainUntilMs: 1,
      })
      return 2
    }
    for (let index = 0; index < count; index += 1) {
      const ticketId = `${scope}e${String(offset + index).padStart(7, '0')}`
      if (this.rows.has(ticketId)) throw new Error('fake unique collision')
      this.rows.set(ticketId, {
        ticketId,
        ticketTokenDigest: digest,
        transcriptDigest: digest,
        submittedAtMs: 0,
        submissionSchemaVersion,
        successResponseJson: '{}',
        retainUntilMs: 1,
      })
    }
    this.afterExpiredInsert?.(scope, offset, count)
    if (this.retentionInsertCalls === this.failAfterRetentionInsertCall) {
      throw new Error('injected lost insertion response')
    }
    return count
  }

  async insertProtectedRetentionRow(
    ticketId: string,
    digest: string,
    submittedAtMs: number,
    retainUntilMs: number,
    submissionSchemaVersion: string,
  ) {
    if (this.rows.has(ticketId)) throw new Error('fake unique collision')
    this.rows.set(ticketId, {
      ticketId,
      ticketTokenDigest: digest,
      transcriptDigest: digest,
      submittedAtMs,
      submissionSchemaVersion,
      successResponseJson: '{}',
      retainUntilMs,
    })
    return 1
  }

  async deleteDraftSubmissionFingerprints(fingerprints: readonly DraftSubmissionFingerprint[]) {
    const parameterCount = fingerprints.length * DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT
    if (parameterCount > D1_BOUND_PARAMETER_LIMIT) throw new Error('fake D1 bound-parameter limit exceeded')
    this.deleteCalls += 1
    this.deleteBatchSizes.push(fingerprints.length)
    if (this.failCleanup) {
      this.cleanupFailureObserved = true
      throw new Error('injected cleanup failure')
    }
    this.beforeDelete?.(fingerprints)
    let changes = 0
    for (const fingerprint of fingerprints) {
      this.exactDeletedIds.push(fingerprint.ticketId)
      const current = this.rows.get(fingerprint.ticketId)
      if (current && draftSubmissionFingerprintsEqual(current, fingerprint)) {
        this.rows.delete(fingerprint.ticketId)
        changes += 1
      }
    }
    if (this.failCleanupAfterDelete) {
      this.cleanupFailureObserved = true
      throw new Error('injected lost deletion response')
    }
    return changes
  }

  runScheduledCleanup(now: number) {
    const eligible = [...this.rows.values()]
      .filter((row) => row.retainUntilMs <= now)
      .sort((left, right) => left.retainUntilMs - right.retainUntilMs
        || left.ticketId.localeCompare(right.ticketId))
      .slice(0, 5_000)
    for (const row of eligible) this.rows.delete(row.ticketId)
  }
}

const identities = readConfiguredPreviewIdentities()
const rawTarget = {
  previewBaseUrl: `https://develop.${identities.pagesProject}.pages.dev`,
  previewWorker: identities.previewWorker,
  previewEnvironment: 'preview',
  accountId: 'a'.repeat(32),
  databaseId: identities.previewDatabaseId,
  acknowledgement: D1C4_PREVIEW_ACKNOWLEDGEMENT,
}
const target = validatePreviewSmokeTarget(rawTarget)
const commonArguments = [
  '--preview-base-url', rawTarget.previewBaseUrl,
  '--preview-worker', rawTarget.previewWorker,
  '--preview-environment', rawTarget.previewEnvironment,
  '--account-id', rawTarget.accountId,
  '--database-id', rawTarget.databaseId,
  '--ack', rawTarget.acknowledgement,
]
const output = { log() {}, error() {} }

function healthResponse() {
  return new Response(JSON.stringify({
    ok: true,
    status: 'healthy',
    versions: { submissionSchema: DRAFT_SUBMISSION_SCHEMA_VERSION },
    backend: { d1: { configured: true, reachable: true, schemaVersion: 2 } },
    submission: {
      configured: true,
      schemaReady: true,
      operationalWriteReadiness: 'externally-unverified',
    },
    features: {
      submissions: 'schema-ready',
      writes: 'externally-unverified',
      d1: 'schema-ready',
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const tickets: readonly IssuedPreviewTicket[] = [
  {
    value: 'opaque-primary-ticket',
    ticketId: '11111111-1111-4111-8111-111111111111',
    draftSeed: 'seeded-v1:16201131b4578aea528f04a3f0c67e5c',
    issuedAt: Date.parse('2026-07-17T00:00:00.000Z'),
  },
  {
    value: 'opaque-recovery-ticket',
    ticketId: '22222222-2222-4222-8222-222222222222',
    draftSeed: 'seeded-v1:26201131b4578aea528f04a3f0c67e5c',
    issuedAt: Date.parse('2026-07-17T00:01:00.000Z'),
  },
]

const goldenTranscriptDigests = new Map([
  ['opaque-primary-ticket', '7989234bf3a25397a0f08a56c8f5b203f3ff03daa74184c7ef9b95816c925049'],
  ['opaque-recovery-ticket', 'c739e840d5d8855fa89d16a23ec9aab534ed0176c18cf54a5113230def66c1f8'],
])

// Fixed independently maintained production-contract oracle. The smoke harness
// does not import or call this fixture construction code.
function fixedGoldenReceipt(submittedAt: '2026-07-17T00:00:05.000Z' | '2026-07-17T00:01:05.000Z') {
  return JSON.stringify({
    ok: true,
    verified: true,
    submitted: true,
    submissionSchema: 'pennant-draft-submission-v1',
    submittedAt,
    versions: {
      transcriptSchema: 'draft-transcript-v1',
      app: '1.0.0',
      gameRules: 'classic-rules-v1',
      rng: 'seeded-v1',
      scoring: '2.3',
      data: 'lahman-2025-v1',
      canonicalDataDigest: 'e033f463caf37aa38037ba58c8fafe3be8358c93afe17f13a49ef117b6d4ed05',
    },
    result: {
      projectedWins: 105,
      projectedLosses: 57,
      overallScore: 80,
      overallGrade: 'B',
      tier: 'Championship Contender',
      categories: {
        offense: { score: 80, grade: 'B' },
        defense: { score: 75, grade: 'B-' },
        startingPitching: { score: 70, grade: 'C+' },
        reliefPitching: { score: 65, grade: 'C' },
        rosterBalance: { score: 60, grade: 'D' },
      },
      strongestCategory: 'offense',
      weakestCategory: 'rosterBalance',
    },
  })
}

const goldenReceipts = new Map([
  ['opaque-primary-ticket', fixedGoldenReceipt('2026-07-17T00:00:05.000Z')],
  ['opaque-recovery-ticket', fixedGoldenReceipt('2026-07-17T00:01:05.000Z')],
])

type AmbiguousSubmissionResponse =
  | 'http-503'
  | 'network-loss'
  | 'timeout'
  | 'redirect'
  | 'oversized'
  | 'bom'
  | 'malformed-json'
  | 'invalid-utf8'
  | 'missing-body'

interface SubmissionFakeOptions {
  readonly failAfterPersist?: boolean
  readonly loseResponseAfterPersist?: boolean
  readonly insertBeforeSubmission?: (d1: StatefulFakeD1, ticket: IssuedPreviewTicket) => Promise<void> | void
  readonly ambiguousAfterCompetitor?: AmbiguousSubmissionResponse
  readonly competitorOverrides?: Partial<StoredRow>
  readonly responseAfterPersist?: (receipt: string) => Response
}

function submissionFake(d1: StatefulFakeD1, options: SubmissionFakeOptions = {}) {
  let issued = 0
  return async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, 'manual')
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/health') return healthResponse()
    if (url.pathname === '/api/v1/draft-ticket') {
      const ticket = tickets[issued]
      issued += 1
      return new Response(JSON.stringify({ ok: true, ticket }), { status: 201 })
    }
    assert.equal(url.pathname, '/api/v1/submit-draft')
    const request = JSON.parse(String(init?.body)) as { ticket: string, transcript: DraftTranscript }
    const ticket = tickets.find((candidate) => candidate.value === request.ticket)
    assert(ticket)
    await options.insertBeforeSubmission?.(d1, ticket)
    const expectedDigest = goldenTranscriptDigests.get(ticket.value)
    assert(expectedDigest)
    const valid = await digestSubmissionTranscript(request.transcript) === expectedDigest
    if (options.ambiguousAfterCompetitor) {
      await seedSubmissionRow(d1, ticket, options.competitorOverrides)
      switch (options.ambiguousAfterCompetitor) {
        case 'http-503':
          return new Response(JSON.stringify({ ok: false, error: { code: 'submission_unavailable' } }), { status: 503 })
        case 'network-loss':
          throw new Error('injected network loss after competitor insertion')
        case 'timeout':
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          })
        case 'redirect':
          return new Response('{}', { status: 302, headers: { Location: 'https://external.example/private' } })
        case 'oversized':
          return new Response(JSON.stringify({ padding: 'x'.repeat(40_000) }), { status: 201 })
        case 'bom':
          return new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), { status: 201 })
        case 'malformed-json':
          return new Response('{', { status: 201 })
        case 'invalid-utf8':
          return new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 201 })
        case 'missing-body':
          return new Response(null, { status: 201 })
      }
    }
    const existing = d1.rows.get(ticket.ticketId)
    if (existing) {
      if (!valid) return new Response(JSON.stringify({ ok: false, error: { code: 'draft_ticket_already_consumed' } }), { status: 409 })
      return new Response(existing.successResponseJson, { status: 200 })
    }
    if (!valid) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'invalid_roll_sequence' } }), { status: 422 })
    }
    const submittedAtMs = ticket.issuedAt + 5_000
    const receipt = goldenReceipts.get(ticket.value) as string
    d1.rows.set(ticket.ticketId, {
      ticketId: ticket.ticketId,
      ticketTokenDigest: await digestSubmissionTicketToken(ticket.value),
      transcriptDigest: await digestSubmissionTranscript(request.transcript),
      submittedAtMs,
      submissionSchemaVersion: DRAFT_SUBMISSION_SCHEMA_VERSION,
      successResponseJson: receipt,
      retainUntilMs: submittedAtMs + DRAFT_SUBMISSION_RETENTION_MS,
    })
    if (options.loseResponseAfterPersist) throw new Error('injected lost endpoint response')
    if (options.failAfterPersist) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'injected_partial_failure' } }), { status: 500 })
    }
    if (options.responseAfterPersist) return options.responseAfterPersist(receipt)
    return new Response(receipt, { status: 201 })
  }
}

function submissionD1(d1: StatefulFakeD1): SubmissionSmokeD1 {
  return { read: d1, mutate: d1 }
}

async function seedSubmissionRow(
  d1: StatefulFakeD1,
  ticket: IssuedPreviewTicket,
  overrides: Partial<StoredRow> = {},
) {
  const submittedAtMs = ticket.issuedAt + 5_000
  const successResponseJson = goldenReceipts.get(ticket.value) as string
  d1.rows.set(ticket.ticketId, {
    ticketId: ticket.ticketId,
    ticketTokenDigest: await digestSubmissionTicketToken(ticket.value),
    transcriptDigest: goldenTranscriptDigests.get(ticket.value) as string,
    submittedAtMs,
    retainUntilMs: submittedAtMs + DRAFT_SUBMISSION_RETENTION_MS,
    submissionSchemaVersion: DRAFT_SUBMISSION_SCHEMA_VERSION,
    successResponseJson,
    ...overrides,
  })
}

// Complete submission success: independent persistence, exact retry, substitution,
// failed replay, stored receipts, and exact cleanup all pass through real orchestration.
const submissionState = new StatefulFakeD1()
const submissionResult = await runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(submissionState),
    createD1: () => submissionD1(submissionState),
  },
)
assert.deepEqual(submissionResult, {
  persistedRows: 2,
  exactRetry: true,
  failedReplayPreservedTicket: true,
  storedReceiptsVerified: true,
})
assert.equal(submissionState.rows.size, 0)
assert.deepEqual(new Set(submissionState.exactDeletedIds), new Set(tickets.map((ticket) => ticket.ticketId)))
assert(Math.max(...submissionState.deleteBatchSizes) <= EXACT_FINGERPRINT_DELETE_LIMIT)
assert(submissionState.submissionReads >= 7)
assert(submissionState.emptySubmissionReads >= 1, 'failed deterministic replay must be checked for an absent receipt')

const receipt = JSON.stringify({ ok: true, value: 1 })
const receiptBytes = new TextEncoder().encode(receipt)
assert.doesNotThrow(() => assertStoredSuccessReceipt({ successResponseJson: receipt }, receiptBytes))
assert.throws(() => assertStoredSuccessReceipt({ successResponseJson: '{ "ok": true, "value": 1 }' }, receiptBytes), /canonical UTF-8/)
assert.throws(() => assertStoredSuccessReceipt({ successResponseJson: '{"value":1,"ok":true}' }, receiptBytes), /canonical UTF-8/)
assert.throws(() => assertStoredSuccessReceipt({ successResponseJson: '{' }, receiptBytes), /not valid JSON/)
assert.throws(() => assertStoredSuccessReceipt({ successResponseJson: '' }, receiptBytes), /missing/)

function receiptApiResult(text: string, status = 201) {
  return {
    status,
    text,
    bytes: new TextEncoder().encode(text),
    body: JSON.parse(text) as Record<string, unknown>,
  }
}

const completeGoldenReceipt = goldenReceipts.get(tickets[0].value) as string
assert.deepEqual(validateSubmissionSuccessReceipt(receiptApiResult(completeGoldenReceipt)), {
  submittedAtMs: tickets[0].issuedAt + 5_000,
})
assert.throws(() => validateSubmissionSuccessReceipt(receiptApiResult(JSON.stringify({
  ok: true,
  verified: true,
  submitted: true,
  submissionSchema: DRAFT_SUBMISSION_SCHEMA_VERSION,
  submittedAt: '2026-07-17T00:00:05.000Z',
}))), /complete canonical persisted-submission receipt/)

interface MutableGoldenReceipt {
  unexpected?: boolean
  versions: Record<string, unknown>
  result: {
    projectedLosses?: unknown
    overallGrade?: unknown
    strongestCategory?: unknown
    categories: { offense: Record<string, unknown> }
    [key: string]: unknown
  }
  [key: string]: unknown
}

const receiptContractDefects: readonly [string, (body: MutableGoldenReceipt) => void][] = [
  ['unexpected top-level field', (body) => { body.unexpected = true }],
  ['wrong transcript version', (body) => { body.versions.transcriptSchema = 'wrong' }],
  ['missing result field', (body) => { delete body.result.projectedLosses }],
  ['wrong overall grade', (body) => { body.result.overallGrade = 'A' }],
  ['unexpected category field', (body) => { body.result.categories.offense.extra = true }],
  ['inconsistent category ranking', (body) => { body.result.strongestCategory = 'defense' }],
]
for (const [description, mutate] of receiptContractDefects) {
  const defective = JSON.parse(completeGoldenReceipt) as MutableGoldenReceipt
  mutate(defective)
  assert.throws(
    () => validateSubmissionSuccessReceipt(receiptApiResult(JSON.stringify(defective))),
    undefined,
    description,
  )
}

for (const changedAtRead of [2, 3]) {
  const changedState = new StatefulFakeD1()
  changedState.mutateSubmissionRead = (row, read) => read === changedAtRead
    ? { ...row, successResponseJson: `${row.successResponseJson} ` }
    : row
  await assert.rejects(() => runSubmissionSmoke(
    { target, apiToken: 'local-test-token' },
    { fetcher: submissionFake(changedState), createD1: () => submissionD1(changedState) },
  ), /immutable|canonical UTF-8/)
  assert.equal(changedState.rows.size, 0)
}

const partialSubmissionState = new StatefulFakeD1()
await assert.rejects(() => runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(partialSubmissionState, { failAfterPersist: true }),
    createD1: () => submissionD1(partialSubmissionState),
  },
), /no valid HTTP success receipt was received/)
assert.equal(partialSubmissionState.rows.size, 1, 'an HTTP failure cannot establish cleanup ownership')
assert.equal(partialSubmissionState.deleteCalls, 0)

const submissionCleanupFailure = new StatefulFakeD1()
submissionCleanupFailure.failCleanup = true
await assert.rejects(() => runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(submissionCleanupFailure),
    createD1: () => submissionD1(submissionCleanupFailure),
  },
), /injected cleanup failure/)
assert.equal(submissionCleanupFailure.rows.size, 2)

const lostSubmissionResponse = new StatefulFakeD1()
await assert.rejects(() => runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(lostSubmissionResponse, { loseResponseAfterPersist: true }),
    createD1: () => submissionD1(lostSubmissionResponse),
  },
), /no valid HTTP success receipt was received/)
assert.equal(lostSubmissionResponse.rows.size, 1, 'a lost response can never establish cleanup ownership')
assert.equal(lostSubmissionResponse.deleteCalls, 0)
assert.deepEqual(lostSubmissionResponse.exactDeletedIds, [])

const differentReceipt = JSON.stringify({
  ...(JSON.parse(completeGoldenReceipt) as Record<string, unknown>),
  result: {
    ...(JSON.parse(completeGoldenReceipt) as { result: Record<string, unknown> }).result,
    projectedWins: 106,
    projectedLosses: 56,
  },
})
const ambiguousCompetitorCases: readonly [string, AmbiguousSubmissionResponse, Partial<StoredRow>][] = [
  ['HTTP 503 with different receipt', 'http-503', { successResponseJson: differentReceipt }],
  ['HTTP 503 with different submitted_at_ms', 'http-503', { submittedAtMs: tickets[0].issuedAt + 5_001 }],
  ['HTTP 503 with different retain_until_ms', 'http-503', { retainUntilMs: tickets[0].issuedAt + 5_000 + DRAFT_SUBMISSION_RETENTION_MS + 1 }],
  ['HTTP 503 with an otherwise exact valid row', 'http-503', {}],
  ['network loss with an otherwise exact valid row', 'network-loss', {}],
  ['timeout with an otherwise exact valid row', 'timeout', {}],
  ['redirect with an otherwise exact valid row', 'redirect', {}],
  ['oversized body with an otherwise exact valid row', 'oversized', {}],
  ['BOM-prefixed body with an otherwise exact valid row', 'bom', {}],
  ['malformed receipt with an otherwise exact valid row', 'malformed-json', {}],
  ['invalid UTF-8 with an otherwise exact valid row', 'invalid-utf8', {}],
  ['missing body with an otherwise exact valid row', 'missing-body', {}],
]
for (const [description, ambiguousAfterCompetitor, competitorOverrides] of ambiguousCompetitorCases) {
  const state = new StatefulFakeD1()
  await assert.rejects(() => runSubmissionSmoke(
    { target, apiToken: 'local-test-token' },
    {
      fetcher: submissionFake(state, { ambiguousAfterCompetitor, competitorOverrides }),
      requestTimeoutMs: ambiguousAfterCompetitor === 'timeout' ? 5 : 1_000,
      createD1: () => submissionD1(state),
    },
  ), /submission ownership could not be established/, description)
  assert(state.rows.has(tickets[0].ticketId), `${description}: competitor row must remain present`)
  assert.equal(state.deleteCalls, 0, `${description}: competitor row must never enter owned cleanup`)
  assert.deepEqual(state.exactDeletedIds, [], `${description}: competitor row must never be deleted`)
}

const invalidCreatedReceiptState = new StatefulFakeD1()
await assert.rejects(() => runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(invalidCreatedReceiptState, {
      responseAfterPersist: (validReceipt) => {
        const defective = JSON.parse(validReceipt) as MutableGoldenReceipt
        defective.versions.scoring = 'wrong'
        return new Response(JSON.stringify(defective), { status: 201 })
      },
    }),
    createD1: () => submissionD1(invalidCreatedReceiptState),
  },
), /submission ownership could not be established/)
assert(invalidCreatedReceiptState.rows.has(tickets[0].ticketId))
assert.equal(invalidCreatedReceiptState.deleteCalls, 0, 'contract-invalid HTTP 201 must not establish ownership')

for (const [description, overrides] of [
  ['token digest', { ticketTokenDigest: 'c'.repeat(64) }],
  ['transcript digest', { transcriptDigest: 'd'.repeat(64) }],
] as const) {
  const mismatchingReservationRace = new StatefulFakeD1()
  let inserted = false
  await assert.rejects(() => runSubmissionSmoke(
    { target, apiToken: 'local-test-token' },
    {
      fetcher: submissionFake(mismatchingReservationRace, {
        insertBeforeSubmission: async (d1, ticket) => {
          if (!inserted && ticket.ticketId === tickets[0].ticketId) {
            inserted = true
            await seedSubmissionRow(d1, ticket, overrides)
          }
        },
      }),
      createD1: () => submissionD1(mismatchingReservationRace),
    },
  ), /mismatching row.*submission ownership could not be established/)
  assert(mismatchingReservationRace.rows.has(tickets[0].ticketId), `${description} competitor must remain untouched`)
  assert(!mismatchingReservationRace.exactDeletedIds.includes(tickets[0].ticketId))
}

const submissionCleanupMismatch = new StatefulFakeD1()
let changedBeforeSubmissionDelete = false
submissionCleanupMismatch.beforeDelete = (fingerprints) => {
  if (changedBeforeSubmissionDelete) return
  changedBeforeSubmissionDelete = true
  const ticketId = fingerprints[0].ticketId
  const row = submissionCleanupMismatch.rows.get(ticketId)
  assert(row)
  submissionCleanupMismatch.rows.set(ticketId, { ...row, transcriptDigest: 'e'.repeat(64) })
}
await assert.rejects(() => runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(submissionCleanupMismatch),
    createD1: () => submissionD1(submissionCleanupMismatch),
  },
), /unexpected count.*ownership mismatch/)
assert.equal(submissionCleanupMismatch.rows.size, 1)
assert.equal(submissionCleanupMismatch.rows.values().next().value?.transcriptDigest, 'e'.repeat(64))

const failedReplayCompetitor = new StatefulFakeD1()
let recoveryCompetitorInserted = false
await assert.rejects(() => runSubmissionSmoke(
  { target, apiToken: 'local-test-token' },
  {
    fetcher: submissionFake(failedReplayCompetitor, {
      insertBeforeSubmission: async (d1, ticket) => {
        if (!recoveryCompetitorInserted && ticket.ticketId === tickets[1].ticketId) {
          recoveryCompetitorInserted = true
          await seedSubmissionRow(d1, ticket, { ticketTokenDigest: 'f'.repeat(64) })
        }
      },
    }),
    createD1: () => submissionD1(failedReplayCompetitor),
  },
), /deliberately invalid deterministic replay|row-free/)
assert(failedReplayCompetitor.rows.has(tickets[1].ticketId), 'failed replay competitor must remain untouched')
assert(!failedReplayCompetitor.exactDeletedIds.includes(tickets[1].ticketId), 'failed replay must remain cleanup-free')

for (const [name, fetcher, requestTimeoutMs] of [
  ['redirect', async () => new Response('{}', { status: 302, headers: { Location: 'https://external.example/private' } }), 1_000],
  ['oversized', async () => new Response(JSON.stringify({ padding: 'x'.repeat(40_000) })), 1_000],
  ['missing', async () => new Response(null, { status: 200 }), 1_000],
  ['malformed', async () => new Response('{', { status: 200 }), 1_000],
  ['bom', async () => new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 1_000],
  ['invalid-utf8', async () => new Response(new Uint8Array([0x7b, 0xff, 0x7d])), 1_000],
  ['timeout', async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }), 5],
] as const) {
  const state = new StatefulFakeD1()
  const result = await submissionSmokeCli(
    [...commonArguments, '--execute'],
    { fetcher, requestTimeoutMs, createD1: () => submissionD1(state) },
    { CLOUDFLARE_API_TOKEN: 'local-test-token' },
    output,
  )
  assert.equal(result, 1, `submission ${name} must fail nonzero`)
  assert.equal(state.rows.size, 0)
}

let productionContacts = 0
let productionD1Creations = 0
assert.equal(await submissionSmokeCli([
  ...commonArguments.slice(0, 1),
  `https://${identities.pagesProject}.pages.dev`,
  ...commonArguments.slice(2),
  '--execute',
], {
  fetcher: async () => { productionContacts += 1; return healthResponse() },
  createD1: () => { productionD1Creations += 1; throw new Error('must not construct') },
}, { CLOUDFLARE_API_TOKEN: 'local-test-token' }, output), 1)
assert.equal(productionContacts, 0)
assert.equal(productionD1Creations, 0)

function retentionD1(d1: StatefulFakeD1): RetentionSmokeD1 {
  return { read: d1, mutate: d1 }
}

const RETENTION_RUN_ID = '1234567890abcdef1234567890abcdef1234567890abcdef'
const retentionExecution = {
  target,
  apiToken: 'local-test-token',
  pollSeconds: 5,
  timeoutSeconds: 3_600,
  requestTimeoutMs: 1_000,
}

function seedRow(d1: StatefulFakeD1, ticketId: string, retainUntilMs: number) {
  d1.rows.set(ticketId, {
    ticketId,
    ticketTokenDigest: 'a'.repeat(64),
    transcriptDigest: 'b'.repeat(64),
    submittedAtMs: 0,
    submissionSchemaVersion: DRAFT_SUBMISSION_SCHEMA_VERSION,
    successResponseJson: '{}',
    retainUntilMs,
  })
}

async function runRetentionFake(
  d1: StatefulFakeD1,
  schedule = true,
) {
  let clock = 1_000_000
  return runRetentionSmoke(retentionExecution, {
    fetcher: async () => healthResponse(),
    createD1: () => retentionD1(d1),
    runId: () => RETENTION_RUN_ID,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += schedule ? milliseconds : retentionExecution.timeoutSeconds * 1_000
      if (schedule) d1.runScheduledCleanup(clock)
    },
  })
}

const retentionState = new StatefulFakeD1()
const retentionResult = await runRetentionFake(retentionState)
assert.deepEqual(retentionResult, {
  expiredRemoved: 5_001,
  protectedRows: 3,
  boundedRuns: 2,
  createdRows: 5_004,
})
assert.equal(retentionState.rows.size, 0)
assert.equal(new Set(retentionState.exactDeletedIds).size, 3, 'scheduled cleanup removes expired rows; finally removes exact protected IDs')
assert(Math.max(...retentionState.deleteBatchSizes) <= EXACT_FINGERPRINT_DELETE_LIMIT)

const sentinels = createRetentionSentinels(RETENTION_RUN_ID)
assert.equal(new Set(retentionSentinelIds(sentinels)).size, 5_004)

const exactCollision = new StatefulFakeD1()
seedRow(exactCollision, sentinels.expired[0], 1)
await assert.rejects(() => runRetentionFake(exactCollision), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-ownership-failure')
  assert.match(error.message, /exact retention sentinel ID collision/)
  return true
})
assert(exactCollision.rows.has(sentinels.expired[0]))

const exactRaceAfterPreflight = new StatefulFakeD1()
let exactRaceInserted = false
exactRaceAfterPreflight.beforeExpiredInsert = (_scope, offset) => {
  if (exactRaceInserted || offset !== 0) return
  exactRaceInserted = true
  seedRow(exactRaceAfterPreflight, sentinels.expired[0], 1)
}
await assert.rejects(() => runRetentionFake(exactRaceAfterPreflight), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  assert(error.ownershipRecords.some((record) => (
    record.ticketId === sentinels.expired[0] && record.status === 'mismatched-non-owned'
  )))
  return true
})
assert(exactRaceAfterPreflight.rows.has(sentinels.expired[0]))
assert(!exactRaceAfterPreflight.exactDeletedIds.includes(sentinels.expired[0]))

const exactRaceBeforeFailedInsert = new StatefulFakeD1()
exactRaceBeforeFailedInsert.failRetentionInsertCall = 1
exactRaceBeforeFailedInsert.beforeExpiredInsert = () => {
  if (!exactRaceBeforeFailedInsert.rows.has(sentinels.expired[0])) {
    seedRow(exactRaceBeforeFailedInsert, sentinels.expired[0], 1)
  }
}
await assert.rejects(() => runRetentionFake(exactRaceBeforeFailedInsert), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  return true
})
assert(exactRaceBeforeFailedInsert.rows.has(sentinels.expired[0]))
assert.equal(exactRaceBeforeFailedInsert.exactDeletedIds.length, 0)

const prefixCollision = new StatefulFakeD1()
const interleavingId = `${sentinels.scope}e000000x`
assert(interleavingId > sentinels.expired[0] && interleavingId < (sentinels.expired.at(-1) as string))
seedRow(prefixCollision, interleavingId, 1)
await assert.rejects(() => runRetentionFake(prefixCollision), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-ownership-failure')
  assert.match(error.message, /scope collision/)
  return true
})
assert(prefixCollision.rows.has(interleavingId))

const orderingCompetitor = new StatefulFakeD1()
const sortingAheadId = '00000000-0000-4000-8000-000000000000'
seedRow(orderingCompetitor, sortingAheadId, 1)
await assert.rejects(() => runRetentionFake(orderingCompetitor), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'inconclusive-ordering')
  assert.match(error.message, /sorting ahead of/)
  return true
})
assert(orderingCompetitor.rows.has(sortingAheadId))

const sharedContention = new StatefulFakeD1()
let contentionClock = 1_000_000
await assert.rejects(() => runRetentionSmoke(retentionExecution, {
  fetcher: async () => healthResponse(),
  createD1: () => retentionD1(sharedContention),
  runId: () => RETENTION_RUN_ID,
  now: () => contentionClock,
  sleep: async (milliseconds) => {
    contentionClock += milliseconds
    seedRow(sharedContention, `${sentinels.scope}x0000000`, contentionClock + 86_400_000)
    sharedContention.runScheduledCleanup(contentionClock)
  },
}), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'shared-database-contention')
  assert(error.ownedTicketIds.length > 0)
  return true
})
assert(sharedContention.rows.has(`${sentinels.scope}x0000000`))

const transientOrderingCompetitor = new StatefulFakeD1()
let transientClock = 1_000_000
await assert.rejects(() => runRetentionSmoke(retentionExecution, {
  fetcher: async () => healthResponse(),
  createD1: () => retentionD1(transientOrderingCompetitor),
  runId: () => RETENTION_RUN_ID,
  now: () => transientClock,
  sleep: async (milliseconds) => {
    transientClock += milliseconds
    seedRow(transientOrderingCompetitor, sortingAheadId, 1)
    transientOrderingCompetitor.runScheduledCleanup(transientClock)
  },
}), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'inconclusive-observation')
  return true
})
assert.equal(transientOrderingCompetitor.rows.size, 0)

const competitorBeforeRangeAfterPreflight = new StatefulFakeD1()
let beforeRangeClock = 1_000_000
await assert.rejects(() => runRetentionSmoke(retentionExecution, {
  fetcher: async () => healthResponse(),
  createD1: () => retentionD1(competitorBeforeRangeAfterPreflight),
  runId: () => RETENTION_RUN_ID,
  now: () => beforeRangeClock,
  sleep: async (milliseconds) => {
    beforeRangeClock += milliseconds
    competitorBeforeRangeAfterPreflight.runScheduledCleanup(beforeRangeClock)
    seedRow(competitorBeforeRangeAfterPreflight, sortingAheadId, 1)
  },
}), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'inconclusive-ordering')
  return true
})
assert(competitorBeforeRangeAfterPreflight.rows.has(sortingAheadId))

const competitorInsideSentinelRange = new StatefulFakeD1()
let insideRangeClock = 1_000_000
await assert.rejects(() => runRetentionSmoke(retentionExecution, {
  fetcher: async () => healthResponse(),
  createD1: () => retentionD1(competitorInsideSentinelRange),
  runId: () => RETENTION_RUN_ID,
  now: () => insideRangeClock,
  sleep: async (milliseconds) => {
    insideRangeClock += milliseconds
    competitorInsideSentinelRange.runScheduledCleanup(insideRangeClock)
    seedRow(competitorInsideSentinelRange, interleavingId, 1)
  },
}), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'shared-database-contention')
  return true
})
assert(competitorInsideSentinelRange.rows.has(interleavingId))

const outsideCompetitor = new StatefulFakeD1()
const sortingAfterId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
assert(sortingAfterId > (sentinels.expired.at(-1) as string))
seedRow(outsideCompetitor, sortingAfterId, 1)
await runRetentionFake(outsideCompetitor)
assert.equal(outsideCompetitor.rows.size, 0)

const lostRetentionInsertResponse = new StatefulFakeD1()
lostRetentionInsertResponse.failAfterRetentionInsertCall = 1
await runRetentionFake(lostRetentionInsertResponse)
assert.equal(lostRetentionInsertResponse.rows.size, 0)

const lostRetentionInsertMismatch = new StatefulFakeD1()
lostRetentionInsertMismatch.failAfterRetentionInsertCall = 1
lostRetentionInsertMismatch.afterExpiredInsert = (_scope, offset) => {
  const id = sentinels.expired[offset]
  const row = lostRetentionInsertMismatch.rows.get(id)
  assert(row)
  lostRetentionInsertMismatch.rows.set(id, { ...row, transcriptDigest: 'c'.repeat(64) })
}
await assert.rejects(() => runRetentionFake(lostRetentionInsertMismatch), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  assert(error.ownershipRecords.some((record) => record.status === 'mismatched-non-owned'))
  return true
})
assert.equal(lostRetentionInsertMismatch.rows.size, 1)
assert(lostRetentionInsertMismatch.rows.has(sentinels.expired[0]))
assert(!lostRetentionInsertMismatch.exactDeletedIds.includes(sentinels.expired[0]))

const missedFirstBatch = new StatefulFakeD1()
let missedClock = 1_000_000
await assert.rejects(() => runRetentionSmoke(retentionExecution, {
  fetcher: async () => healthResponse(),
  createD1: () => retentionD1(missedFirstBatch),
  runId: () => RETENTION_RUN_ID,
  now: () => missedClock,
  sleep: async (milliseconds) => {
    missedClock += milliseconds
    missedFirstBatch.runScheduledCleanup(missedClock)
    missedFirstBatch.runScheduledCleanup(missedClock)
  },
}), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'missed-scheduled-run-boundary')
  return true
})
assert.equal(missedFirstBatch.rows.size, 0)

const partialRetention = new StatefulFakeD1()
partialRetention.failRetentionInsertCall = 2
await assert.rejects(() => runRetentionFake(partialRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  assert(error.ownershipRecords.some((record) => record.status === 'confirmed-owned'))
  assert(error.ownershipRecords.some((record) => record.status === 'absent'))
  return true
})
assert.equal(partialRetention.rows.size, 0, 'partial retention insertion must be cleaned by exact reserved IDs')
assert.equal(new Set(partialRetention.exactDeletedIds).size, 400)

const mixedPartialRetention = new StatefulFakeD1()
mixedPartialRetention.mixedPartialRetentionInsertCall = 1
await assert.rejects(() => runRetentionFake(mixedPartialRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  const attempted = error.ownershipRecords.filter((record) => record.insertionAttempted)
  assert(attempted.some((record) => record.status === 'confirmed-owned'))
  assert(attempted.some((record) => record.status === 'mismatched-non-owned'))
  assert(attempted.some((record) => record.status === 'absent'))
  assert(error.ownershipRecords.some((record) => !record.insertionAttempted && record.status === 'reserved'))
  return true
})
assert.equal(mixedPartialRetention.rows.size, 1)
assert(mixedPartialRetention.rows.has(sentinels.expired[1]))
assert.deepEqual(mixedPartialRetention.exactDeletedIds, [sentinels.expired[0]])

const timedOutRetention = new StatefulFakeD1()
await assert.rejects(() => runRetentionFake(timedOutRetention, false), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'scheduled-timeout')
  return true
})
assert.equal(timedOutRetention.rows.size, 0)

const unexplainedTransition = new StatefulFakeD1()
let implementationClock = 1_000_000
await assert.rejects(() => runRetentionSmoke(retentionExecution, {
  fetcher: async () => healthResponse(),
  createD1: () => retentionD1(unexplainedTransition),
  runId: () => RETENTION_RUN_ID,
  now: () => implementationClock,
  sleep: async (milliseconds) => {
    implementationClock += milliseconds
    const eligible = [...unexplainedTransition.rows.values()]
      .filter((row) => row.retainUntilMs <= implementationClock)
      .sort((left, right) => left.ticketId.localeCompare(right.ticketId))
      .slice(0, 4_999)
    for (const row of eligible) unexplainedTransition.rows.delete(row.ticketId)
  },
}), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'inconclusive-observation')
  return true
})
assert.equal(unexplainedTransition.rows.size, 0)

const cleanupFailedRetention = new StatefulFakeD1()
cleanupFailedRetention.failCleanup = true
await assert.rejects(() => runRetentionFake(cleanupFailedRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-cleanup-failure')
  assert(error.ownedTicketIds.length > 0, 'cleanup failure must retain the exact ownership record')
  const stillOwned = error.ownershipRecords.filter((record) => record.status === 'confirmed-owned')
  assert(stillOwned.length > 0)
  assert(stillOwned.every((record) => record.expectedFingerprint.ticketId === record.ticketId))
  return true
})
assert.equal(cleanupFailedRetention.rows.size, 3)
assert.equal(cleanupFailedRetention.deleteCalls, 1, 'an ambiguous delete must never be retried')

const zeroChangeAbsentRetention = new StatefulFakeD1()
zeroChangeAbsentRetention.beforeDelete = (fingerprints) => {
  for (const fingerprint of fingerprints) zeroChangeAbsentRetention.rows.delete(fingerprint.ticketId)
}
await assert.rejects(() => runRetentionFake(zeroChangeAbsentRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-cleanup-failure')
  assert.match(error.message, /already absent/)
  return true
})
assert.equal(zeroChangeAbsentRetention.rows.size, 0)

const zeroChangeMismatchRetention = new StatefulFakeD1()
let retentionFingerprintChanged = false
zeroChangeMismatchRetention.beforeDelete = (fingerprints) => {
  if (retentionFingerprintChanged) return
  retentionFingerprintChanged = true
  const row = zeroChangeMismatchRetention.rows.get(fingerprints[0].ticketId)
  assert(row)
  zeroChangeMismatchRetention.rows.set(row.ticketId, { ...row, ticketTokenDigest: 'd'.repeat(64) })
}
await assert.rejects(() => runRetentionFake(zeroChangeMismatchRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  assert(error.ownershipRecords.some((record) => record.status === 'mismatched-non-owned'))
  return true
})
assert.equal(zeroChangeMismatchRetention.rows.size, 1)

const zeroChangeUnreadableRetention = new StatefulFakeD1()
zeroChangeUnreadableRetention.failReadAfterDeleteAttempt = true
zeroChangeUnreadableRetention.beforeDelete = (fingerprints) => {
  for (const fingerprint of fingerprints) zeroChangeUnreadableRetention.rows.delete(fingerprint.ticketId)
}
await assert.rejects(() => runRetentionFake(zeroChangeUnreadableRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-cleanup-failure')
  assert(error.ownershipRecords.some((record) => record.status === 'unresolved'))
  return true
})
assert.equal(zeroChangeUnreadableRetention.deleteCalls, 1)

const lostCleanupResponseRetention = new StatefulFakeD1()
lostCleanupResponseRetention.failCleanupAfterDelete = true
await assert.rejects(() => runRetentionFake(lostCleanupResponseRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-cleanup-failure')
  assert(error.ownershipRecords.some((record) => record.status === 'absent'))
  assert(!error.ownershipRecords.some((record) => record.status === 'unresolved'))
  return true
})
assert.equal(lostCleanupResponseRetention.rows.size, 0)
assert.equal(lostCleanupResponseRetention.deleteCalls, 1, 'a lost delete response must never trigger a destructive retry')

const lostCleanupMismatchRetention = new StatefulFakeD1()
lostCleanupMismatchRetention.failCleanupAfterDelete = true
let changedBeforeLostDelete = false
lostCleanupMismatchRetention.beforeDelete = (fingerprints) => {
  if (changedBeforeLostDelete) return
  changedBeforeLostDelete = true
  const row = lostCleanupMismatchRetention.rows.get(fingerprints[0].ticketId)
  assert(row)
  lostCleanupMismatchRetention.rows.set(row.ticketId, { ...row, transcriptDigest: 'e'.repeat(64) })
}
await assert.rejects(() => runRetentionFake(lostCleanupMismatchRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'ownership-ambiguity')
  assert(error.ownershipRecords.some((record) => record.status === 'mismatched-non-owned'))
  return true
})
assert.equal(lostCleanupMismatchRetention.rows.size, 1)
assert.equal(lostCleanupMismatchRetention.deleteCalls, 1)

const lostCleanupUnreadableRetention = new StatefulFakeD1()
lostCleanupUnreadableRetention.failCleanup = true
lostCleanupUnreadableRetention.failCleanupReconciliationRead = true
await assert.rejects(() => runRetentionFake(lostCleanupUnreadableRetention), (error: unknown) => {
  assert(error instanceof RetentionSmokeFailure)
  assert.equal(error.code, 'sentinel-cleanup-failure')
  const unresolved = error.ownershipRecords.filter((record) => record.status === 'unresolved')
  assert(unresolved.length > 0)
  assert(unresolved.every((record) => record.expectedFingerprint.ticketId === record.ticketId))
  return true
})
assert.equal(lostCleanupUnreadableRetention.rows.size, 3)
assert.equal(lostCleanupUnreadableRetention.deleteCalls, 1)

const retentionRedirectState = new StatefulFakeD1()
const retentionRedirectContacts: string[] = []
assert.equal(await retentionSmokeCli([...commonArguments, '--execute'], {
  fetcher: async (input, init) => {
    retentionRedirectContacts.push(String(input))
    assert.equal(init?.redirect, 'manual')
    return new Response('{}', {
      status: 307,
      headers: { Location: 'http://localhost:5174/redirect-target' },
    })
  },
  createD1: () => retentionD1(retentionRedirectState),
}, { CLOUDFLARE_API_TOKEN: 'local-test-token' }, output), 1)
assert.deepEqual(retentionRedirectContacts, [`${target.previewBaseUrl}/api/v1/health`])
assert.equal(retentionRedirectState.rows.size, 0)

let retentionProductionContacts = 0
let retentionProductionD1Creations = 0
assert.equal(await retentionSmokeCli([
  ...commonArguments.slice(0, 1),
  `https://${identities.pagesProject}.pages.dev`,
  ...commonArguments.slice(2),
  '--execute',
], {
  fetcher: async () => { retentionProductionContacts += 1; return healthResponse() },
  createD1: () => { retentionProductionD1Creations += 1; throw new Error('must not construct') },
}, { CLOUDFLARE_API_TOKEN: 'local-test-token' }, output), 1)
assert.equal(retentionProductionContacts, 0)
assert.equal(retentionProductionD1Creations, 0)

for (const invalid of [
  ['--poll-seconds', '0'],
  ['--poll-seconds', '301'],
  ['--poll-seconds', '1.5'],
  ['--poll-seconds', '-1'],
  ['--timeout-seconds', '3599'],
  ['--timeout-seconds', '10801'],
  ['--request-timeout-seconds', '31'],
  ['--request-timeout-seconds', 'Infinity'],
  ['--request-timeout-seconds', 'NaN'],
]) {
  assert.equal(await retentionSmokeCli([...commonArguments, ...invalid], {}, {}, output), 1)
}

console.log('D1C.4 end-to-end harness tests passed: stateful offline submission and retention flows, raw-byte receipts, fingerprint races, ambiguous mutations, partial writes, conditional cleanup, conservative contention, malformed transport, and pre-contact production rejection are verified.')
