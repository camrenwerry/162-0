import { createHash, randomBytes } from 'node:crypto'
import {
  DRAFT_SUBMISSION_RETENTION_MS,
  DRAFT_SUBMISSION_SCHEMA_VERSION,
} from '../../functions/lib/draft-submission-constants'
import {
  RETENTION_CLEANUP_BATCH_SIZE,
  RETENTION_CLEANUP_MAX_BATCHES,
} from '../../workers/draft-validation/src/retention-cleanup-config'
import {
  boundedJsonRequest,
  D1C4_ENDPOINT_RESPONSE_LIMIT_BYTES,
  type D1C4Fetch,
} from '../lib/d1c4-bounded-fetch'
import {
  D1MutationError,
  draftSubmissionFingerprintsEqual,
  exactFingerprintChunks,
  type D1RequestOptions,
  type D1MutationFailureKind,
  type DraftSubmissionFingerprint,
  type PreviewD1MutationClient,
  type PreviewD1ReadClient,
  type RetentionPersistenceRow,
} from '../lib/d1c4-d1-client'
import {
  type ValidatedPreviewSmokeTarget,
} from '../lib/d1c4-preview-guard'

export const RETENTION_SMOKE_EXPIRED_COUNT = RETENTION_CLEANUP_BATCH_SIZE * RETENTION_CLEANUP_MAX_BATCHES + 1
export const RETENTION_SMOKE_RECENT_COUNT = 2
export const RETENTION_POLL_SECONDS_MIN = 5
export const RETENTION_POLL_SECONDS_MAX = 300
export const RETENTION_TIMEOUT_SECONDS_MIN = 3_600
export const RETENTION_TIMEOUT_SECONDS_MAX = 10_800
export const RETENTION_REQUEST_TIMEOUT_SECONDS_MIN = 1
export const RETENTION_REQUEST_TIMEOUT_SECONDS_MAX = 30
export const RETENTION_CLEANUP_RESERVE_SECONDS = 300
const INSERT_BATCH_SIZE = 400
const RUN_SCOPE_LENGTH = 28
const SENTINEL_RETAIN_UNTIL_MS = 1

export type RetentionSmokeFailureCode =
  | 'shared-database-contention'
  | 'inconclusive-ordering'
  | 'inconclusive-observation'
  | 'missed-scheduled-run-boundary'
  | 'ownership-ambiguity'
  | 'scheduled-timeout'
  | 'sentinel-ownership-failure'
  | 'sentinel-cleanup-failure'

export class RetentionSmokeFailure extends Error {
  readonly code: RetentionSmokeFailureCode
  readonly ownedTicketIds: readonly string[]
  readonly ownershipRecords: readonly RetentionOwnershipRecord[]

  constructor(
    code: RetentionSmokeFailureCode,
    message: string,
    ownershipRecords: readonly RetentionOwnershipRecord[] = [],
  ) {
    super(message)
    this.name = 'RetentionSmokeFailure'
    this.code = code
    this.ownershipRecords = freezeOwnershipRecords(ownershipRecords)
    this.ownedTicketIds = Object.freeze(this.ownershipRecords
      .filter((record) => record.status === 'confirmed-owned' || record.status === 'unresolved')
      .map((record) => record.ticketId))
  }
}

export type RetentionOwnershipStatus =
  | 'reserved'
  | 'insertion-attempted'
  | 'confirmed-owned'
  | 'absent'
  | 'mismatched-non-owned'
  | 'deleted'
  | 'unresolved'

export type RetentionMutationOutcome =
  | 'not-attempted'
  | 'confirmed-success'
  | 'confirmed-rejection'
  | 'ambiguous-reconciled'
  | 'partial'
  | 'unresolved'

export interface RetentionOwnershipRecord {
  readonly ticketId: string
  readonly expectedFingerprint: DraftSubmissionFingerprint
  readonly insertionAttempted: boolean
  readonly mutationFailureKind: D1MutationFailureKind | null
  readonly mutationOutcome: RetentionMutationOutcome
  readonly cleanupFailureKind: D1MutationFailureKind | null
  readonly status: RetentionOwnershipStatus
}

interface MutableRetentionOwnershipRecord {
  readonly ticketId: string
  readonly expectedFingerprint: DraftSubmissionFingerprint
  insertionAttempted: boolean
  mutationFailureKind: D1MutationFailureKind | null
  mutationOutcome: RetentionMutationOutcome
  cleanupFailureKind: D1MutationFailureKind | null
  status: RetentionOwnershipStatus
}

function freezeOwnershipRecords(records: readonly RetentionOwnershipRecord[]) {
  return Object.freeze(records.map((record) => Object.freeze({
    ...record,
    expectedFingerprint: Object.freeze({ ...record.expectedFingerprint }),
  })))
}

export interface RetentionSentinels {
  readonly scope: string
  readonly expired: readonly string[]
  readonly recent: readonly string[]
  readonly unrelated: readonly string[]
}

export interface RetentionSnapshot {
  readonly total: number
  readonly expired: number
  readonly recent: number
  readonly unrelated: number
  readonly exactIds: ReadonlySet<string>
}

export interface RetentionSmokeD1 {
  readonly read: PreviewD1ReadClient
  readonly mutate: PreviewD1MutationClient
}

export interface RetentionSmokeDependencies {
  readonly fetcher: D1C4Fetch
  readonly d1: RetentionSmokeD1
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly runId?: () => string
}

export interface RetentionSmokeExecution {
  readonly target: ValidatedPreviewSmokeTarget
  readonly pollSeconds: number
  readonly timeoutSeconds: number
  readonly requestTimeoutMs: number
}

function fail(
  code: RetentionSmokeFailureCode,
  message: string,
  ownershipRecords: readonly RetentionOwnershipRecord[] = [],
): never {
  throw new RetentionSmokeFailure(code, message, ownershipRecords)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function numericArgument(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail(
    'sentinel-ownership-failure',
    `${name} must be a whole number from ${minimum} through ${maximum}.`,
  )
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(
    'sentinel-ownership-failure',
    `${name} must be from ${minimum} through ${maximum}.`,
  )
  return parsed
}

function sentinelId(scope: string, kind: 'e' | 'r' | 'u', index: number) {
  const id = `${scope}${kind}${String(index).padStart(7, '0')}`
  if (id.length !== 36) fail('sentinel-ownership-failure', 'Retention sentinel ID must be exactly 36 characters.')
  return id
}

export function createRetentionSentinels(
  runId: string = randomBytes(24).toString('hex'),
): RetentionSentinels {
  const token = runId.toLowerCase().replaceAll('-', '')
  if (!/^[0-9a-f]{24,}$/.test(token)) {
    fail('sentinel-ownership-failure', 'Retention smoke run ID must contain at least 24 hexadecimal characters.')
  }
  const scope = `d1c4${token.slice(0, 24)}`
  if (scope.length !== RUN_SCOPE_LENGTH) {
    fail('sentinel-ownership-failure', 'Retention sentinel scope must be exactly 28 characters.')
  }
  return Object.freeze({
    scope,
    expired: Object.freeze(Array.from({ length: RETENTION_SMOKE_EXPIRED_COUNT }, (_, index) => sentinelId(scope, 'e', index))),
    recent: Object.freeze(Array.from({ length: RETENTION_SMOKE_RECENT_COUNT }, (_, index) => sentinelId(scope, 'r', index))),
    unrelated: Object.freeze([sentinelId(scope, 'u', 0)]),
  })
}

export function retentionSentinelIds(sentinels: RetentionSentinels) {
  return Object.freeze([...sentinels.expired, ...sentinels.recent, ...sentinels.unrelated])
}

export function createRetentionFingerprints(
  sentinels: RetentionSentinels,
  digest: string,
  startedAt: number,
) {
  const retainUntilMs = startedAt + DRAFT_SUBMISSION_RETENTION_MS
  if (!Number.isSafeInteger(retainUntilMs)) {
    fail('sentinel-ownership-failure', 'Retention smoke timestamp is outside the safe integer range.')
  }
  const fingerprint = (
    ticketId: string,
    submittedAtMs: number,
    rowRetainUntilMs: number,
  ): DraftSubmissionFingerprint => Object.freeze({
    ticketId,
    ticketTokenDigest: digest,
    transcriptDigest: digest,
    submittedAtMs,
    retainUntilMs: rowRetainUntilMs,
    submissionSchemaVersion: DRAFT_SUBMISSION_SCHEMA_VERSION,
    successResponseJson: '{}',
  })
  return Object.freeze([
    ...sentinels.expired.map((ticketId) => fingerprint(ticketId, 0, SENTINEL_RETAIN_UNTIL_MS)),
    ...protectedIds(sentinels).map((ticketId) => fingerprint(ticketId, startedAt, retainUntilMs)),
  ])
}

function createOwnershipRecords(fingerprints: readonly DraftSubmissionFingerprint[]) {
  return new Map<string, MutableRetentionOwnershipRecord>(fingerprints.map((expectedFingerprint) => [expectedFingerprint.ticketId, {
    ticketId: expectedFingerprint.ticketId,
    expectedFingerprint,
    insertionAttempted: false,
    mutationFailureKind: null,
    mutationOutcome: 'not-attempted',
    cleanupFailureKind: null,
    status: 'reserved',
  }]))
}

function recordSnapshot(records: ReadonlyMap<string, MutableRetentionOwnershipRecord>) {
  return freezeOwnershipRecords([...records.values()])
}

function protectedIds(sentinels: RetentionSentinels) {
  return [...sentinels.recent, ...sentinels.unrelated]
}

function assertProtected(snapshot: RetentionSnapshot, sentinels: RetentionSentinels) {
  if (snapshot.recent !== sentinels.recent.length || snapshot.unrelated !== sentinels.unrelated.length) {
    fail('inconclusive-observation', 'A protected sentinel aggregate changed; shared D1 activity prevents attribution to the cleanup runtime.')
  }
  for (const id of protectedIds(sentinels)) {
    if (!snapshot.exactIds.has(id)) {
      fail('inconclusive-observation', 'A protected exact sentinel disappeared; shared D1 activity prevents attribution to the cleanup runtime.')
    }
  }
}

export function assertInitialRetentionSnapshot(snapshot: RetentionSnapshot, sentinels: RetentionSentinels) {
  if (
    snapshot.expired !== sentinels.expired.length
    || snapshot.total !== retentionSentinelIds(sentinels).length
    || snapshot.exactIds.size !== retentionSentinelIds(sentinels).length
  ) fail('sentinel-ownership-failure', 'Initial retention sentinel aggregate or exact rows are incomplete.')
  assertProtected(snapshot, sentinels)
}

export function assertFirstBoundedRetentionSnapshot(snapshot: RetentionSnapshot, sentinels: RetentionSentinels) {
  const lastExpired = sentinels.expired.at(-1) as string
  if (
    snapshot.expired !== 1
    || snapshot.total !== 1 + protectedIds(sentinels).length
    || snapshot.exactIds.has(sentinels.expired[0])
    || !snapshot.exactIds.has(lastExpired)
  ) fail('inconclusive-observation', 'The observed first transition did not match one isolated bounded run; shared activity or a missed boundary is possible.')
  assertProtected(snapshot, sentinels)
}

export function assertFinalRetentionSnapshot(snapshot: RetentionSnapshot, sentinels: RetentionSentinels) {
  if (
    snapshot.expired !== 0
    || snapshot.total !== protectedIds(sentinels).length
    || snapshot.exactIds.has(sentinels.expired[0])
    || snapshot.exactIds.has(sentinels.expired.at(-1) as string)
  ) fail('inconclusive-observation', 'The observed final transition did not match one isolated second run; shared activity is possible.')
  assertProtected(snapshot, sentinels)
}

function requestOptions(
  execution: RetentionSmokeExecution,
  deadlineMs: number,
  now: () => number,
): D1RequestOptions {
  return Object.freeze({ timeoutMs: execution.requestTimeoutMs, deadlineMs, now })
}

function endpointTimeoutMs(execution: RetentionSmokeExecution, deadlineMs: number, now: () => number) {
  const remainingMs = deadlineMs - now()
  if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) {
    fail('scheduled-timeout', 'Overall retention smoke deadline elapsed before the next request.')
  }
  return Math.min(execution.requestTimeoutMs, remainingMs)
}

async function assertHealth(
  fetcher: D1C4Fetch,
  execution: RetentionSmokeExecution,
  deadlineMs: number,
  now: () => number,
) {
  const response = await boundedJsonRequest(`${execution.target.previewBaseUrl}/api/v1/health`, {
    description: 'Preview health',
    timeoutMs: endpointTimeoutMs(execution, deadlineMs, now),
    maxResponseBytes: D1C4_ENDPOINT_RESPONSE_LIMIT_BYTES,
    fetcher,
    init: { method: 'GET', headers: { Origin: execution.target.previewBaseUrl } },
  })
  const body = response.body
  const versions = isRecord(body) ? body.versions : null
  const features = isRecord(body) ? body.features : null
  const submission = isRecord(body) ? body.submission : null
  const backend = isRecord(body) ? body.backend : null
  const d1 = isRecord(backend) ? backend.d1 : null
  if (
    response.status !== 200 || !isRecord(body) || body.status !== 'healthy'
    || !isRecord(versions) || versions.submissionSchema !== DRAFT_SUBMISSION_SCHEMA_VERSION
    || !isRecord(submission) || submission.configured !== true || submission.schemaReady !== true
    || submission.operationalWriteReadiness !== 'externally-unverified'
    || !isRecord(features) || features.submissions !== 'schema-ready'
    || features.writes !== 'externally-unverified'
    || !isRecord(d1) || d1.schemaVersion !== 3 || d1.reachable !== true
  ) fail(
    'sentinel-ownership-failure',
    'Preview health does not prove Pages-visible schema readiness required before Cron smoke; private execution remains externally unverified.',
  )
}

function snapshotFromRows(
  rows: readonly RetentionPersistenceRow[],
  sentinels: RetentionSentinels,
  expectedFingerprints: ReadonlyMap<string, DraftSubmissionFingerprint>,
): RetentionSnapshot {
  const expected = new Set(retentionSentinelIds(sentinels))
  const exactIds = new Set<string>()
  let expired = 0
  let recent = 0
  let unrelated = 0
  for (const row of rows) {
    if (!expected.has(row.ticketId) || exactIds.has(row.ticketId)) {
      fail('shared-database-contention', 'Shared D1 activity introduced an unknown or duplicate row in the owned sentinel scope.')
    }
    const expectedFingerprint = expectedFingerprints.get(row.ticketId)
    if (!expectedFingerprint || !draftSubmissionFingerprintsEqual(row, expectedFingerprint)) {
      fail('ownership-ambiguity', 'A retention sentinel ID no longer matched its complete immutable fingerprint; the row was treated as non-owned.')
    }
    exactIds.add(row.ticketId)
    if (row.ticketId.startsWith(`${sentinels.scope}e`)) expired += 1
    else if (row.ticketId.startsWith(`${sentinels.scope}r`)) recent += 1
    else if (row.ticketId.startsWith(`${sentinels.scope}u`)) unrelated += 1
  }
  return Object.freeze({ total: rows.length, expired, recent, unrelated, exactIds })
}

async function readSnapshot(
  d1: PreviewD1ReadClient,
  sentinels: RetentionSentinels,
  expectedFingerprints: ReadonlyMap<string, DraftSubmissionFingerprint>,
  options: D1RequestOptions,
) {
  return snapshotFromRows(
    await d1.readRetentionScopeRows(sentinels.scope, options),
    sentinels,
    expectedFingerprints,
  )
}

async function assertNoOrderingCompetitor(
  d1: PreviewD1ReadClient,
  sentinels: RetentionSentinels,
  options: D1RequestOptions,
) {
  const first = sentinels.expired[0]
  const last = sentinels.expired.at(-1) as string
  const competitors = await d1.readRetentionOrderingCompetitors(
    sentinels.scope,
    SENTINEL_RETAIN_UNTIL_MS,
    last,
    options,
  )
  if (competitors.length === 0) return
  const competitor = competitors[0]
  const position = competitor.retainUntilMs < SENTINEL_RETAIN_UNTIL_MS || competitor.ticketId < first
    ? 'ahead of'
    : 'within'
  fail(
    'inconclusive-ordering',
    `Shared D1 contains an unrelated expired row sorting ${position} the sentinel range; the exact batch assertion is inconclusive.`,
  )
}

async function preflightOwnership(
  d1: PreviewD1ReadClient,
  sentinels: RetentionSentinels,
  options: D1RequestOptions,
) {
  const ids = retentionSentinelIds(sentinels)
  if ((await d1.readRetentionExactRows(ids, options)).length !== 0) {
    fail('sentinel-ownership-failure', 'A pre-existing exact retention sentinel ID collision was detected before insertion.')
  }
  if ((await d1.readRetentionScopeRows(sentinels.scope, options)).length !== 0) {
    fail('sentinel-ownership-failure', 'A pre-existing retention sentinel scope collision was detected before insertion.')
  }
  await assertNoOrderingCompetitor(d1, sentinels, options)
}

async function insertSentinels(
  d1: RetentionSmokeD1,
  sentinels: RetentionSentinels,
  fingerprints: ReadonlyMap<string, DraftSubmissionFingerprint>,
  options: D1RequestOptions,
  records: Map<string, MutableRetentionOwnershipRecord>,
) {
  const reconcileInsertion = async (
    expectedRows: readonly DraftSubmissionFingerprint[],
    changes: number | null,
    mutationError: unknown,
    description: string,
  ) => {
    let rows: readonly RetentionPersistenceRow[]
    try {
      rows = await d1.read.readRetentionExactRows(expectedRows.map((row) => row.ticketId), options)
    } catch {
      for (const expected of expectedRows) {
        const record = records.get(expected.ticketId) as MutableRetentionOwnershipRecord
        record.mutationFailureKind = mutationError instanceof D1MutationError
          ? mutationError.kind
          : mutationError === null ? null : 'unresolved'
        record.mutationOutcome = 'unresolved'
        record.status = 'unresolved'
      }
      fail(
        'ownership-ambiguity',
        `${description} could not reconcile its mutation outcome by complete immutable fingerprint.`,
        recordSnapshot(records),
      )
    }
    const actual = new Map(rows.map((row) => [row.ticketId, row]))
    let absent = 0
    let mismatched = 0
    let owned = 0
    for (const expected of expectedRows) {
      const record = records.get(expected.ticketId) as MutableRetentionOwnershipRecord
      const current = actual.get(expected.ticketId)
      if (!current) {
        record.status = 'absent'
        absent += 1
      } else if (!draftSubmissionFingerprintsEqual(current, expected)) {
        record.status = 'mismatched-non-owned'
        mismatched += 1
      } else {
        record.status = 'confirmed-owned'
        owned += 1
      }
    }
    const exactMutationResult = mutationError === null && changes === expectedRows.length
    const mutationFailureKind = mutationError instanceof D1MutationError
      ? mutationError.kind
      : mutationError === null ? null : 'unresolved'
    const outcome: RetentionMutationOutcome = exactMutationResult
      ? 'confirmed-success'
      : owned === expectedRows.length
        ? 'ambiguous-reconciled'
        : owned > 0 ? 'partial'
          : mutationError === null && changes === 0 && absent === expectedRows.length
            ? 'confirmed-rejection'
            : 'unresolved'
    for (const expected of expectedRows) {
      const record = records.get(expected.ticketId) as MutableRetentionOwnershipRecord
      record.mutationFailureKind = mutationFailureKind
      record.mutationOutcome = outcome
    }
    if (absent > 0 || mismatched > 0) {
      fail(
        'ownership-ambiguity',
        `${description} reconciled ${owned} owned, ${absent} absent, and ${mismatched} mismatching row(s); only complete matches are eligible for cleanup.`,
        recordSnapshot(records),
      )
    }
  }

  for (let offset = 0; offset < sentinels.expired.length; offset += INSERT_BATCH_SIZE) {
    const count = Math.min(INSERT_BATCH_SIZE, sentinels.expired.length - offset)
    const expectedRows = sentinels.expired.slice(offset, offset + count)
      .map((ticketId) => fingerprints.get(ticketId) as DraftSubmissionFingerprint)
    for (const expected of expectedRows) {
      const record = records.get(expected.ticketId) as MutableRetentionOwnershipRecord
      record.insertionAttempted = true
      record.status = 'insertion-attempted'
    }
    let changes: number | null = null
    let mutationError: unknown = null
    try {
      changes = await d1.mutate.insertExpiredRetentionRows(
        sentinels.scope,
        offset,
        count,
        expectedRows[0].ticketTokenDigest,
        DRAFT_SUBMISSION_SCHEMA_VERSION,
        options,
      )
    } catch (error) {
      mutationError = error
    }
    await reconcileInsertion(expectedRows, changes, mutationError, 'Expired sentinel insertion')
  }

  for (const id of protectedIds(sentinels)) {
    const expected = fingerprints.get(id) as DraftSubmissionFingerprint
    const record = records.get(id) as MutableRetentionOwnershipRecord
    record.insertionAttempted = true
    record.status = 'insertion-attempted'
    let changes: number | null = null
    let mutationError: unknown = null
    try {
      changes = await d1.mutate.insertProtectedRetentionRow(
        id,
        expected.ticketTokenDigest,
        expected.submittedAtMs,
        expected.retainUntilMs,
        expected.submissionSchemaVersion,
        options,
      )
    } catch (error) {
      mutationError = error
    }
    await reconcileInsertion([expected], changes, mutationError, 'Protected sentinel insertion')
  }
}

async function cleanupOwnedSentinels(
  d1: RetentionSmokeD1,
  records: Map<string, MutableRetentionOwnershipRecord>,
  options: D1RequestOptions,
) {
  const initiallyOwned = [...records.values()].filter((record) => record.status === 'confirmed-owned')
  for (const chunk of exactFingerprintChunks(initiallyOwned)) {
    let currentRows: readonly RetentionPersistenceRow[]
    try {
      currentRows = await d1.read.readRetentionExactRows(chunk.map((record) => record.ticketId), options)
    } catch {
      for (const record of chunk) record.status = 'unresolved'
      fail(
        'sentinel-cleanup-failure',
        'Retention ownership could not be re-read before destructive cleanup; no deletion was attempted for that chunk.',
        recordSnapshot(records),
      )
    }
    const current = new Map(currentRows.map((row) => [row.ticketId, row]))
    const deletable: MutableRetentionOwnershipRecord[] = []
    const mismatched: MutableRetentionOwnershipRecord[] = []
    for (const record of chunk) {
      const row = current.get(record.ticketId)
      if (!row) record.status = 'absent'
      else if (!draftSubmissionFingerprintsEqual(row, record.expectedFingerprint)) {
        record.status = 'mismatched-non-owned'
        mismatched.push(record)
      } else deletable.push(record)
    }

    if (deletable.length > 0) {
      let changes: number
      try {
        changes = await d1.mutate.deleteDraftSubmissionFingerprints(
          deletable.map((record) => record.expectedFingerprint),
          options,
        )
      } catch (error) {
        let after: readonly RetentionPersistenceRow[]
        try {
          after = await d1.read.readRetentionExactRows(deletable.map((record) => record.ticketId), options)
        } catch {
          for (const record of deletable) {
            record.cleanupFailureKind = error instanceof D1MutationError ? error.kind : 'unresolved'
            record.status = 'unresolved'
          }
          fail(
            'sentinel-cleanup-failure',
            `Fingerprint-constrained retention deletion and its read-only reconciliation were unresolved; the delete was not retried: ${error instanceof Error ? error.message : 'unknown mutation failure'}`,
            recordSnapshot(records),
          )
        }
        const afterMap = new Map(after.map((row) => [row.ticketId, row]))
        let absent = 0
        let mismatched = 0
        let stillOwned = 0
        for (const record of deletable) {
          const row = afterMap.get(record.ticketId)
          record.cleanupFailureKind = error instanceof D1MutationError ? error.kind : 'unresolved'
          if (!row) {
            record.status = 'absent'
            absent += 1
          } else if (!draftSubmissionFingerprintsEqual(row, record.expectedFingerprint)) {
            record.status = 'mismatched-non-owned'
            mismatched += 1
          } else {
            record.status = 'confirmed-owned'
            stillOwned += 1
          }
        }
        fail(
          mismatched > 0 ? 'ownership-ambiguity' : 'sentinel-cleanup-failure',
          `Fingerprint-constrained retention deletion had an ambiguous outcome and was not retried; reconciliation found ${absent} absent, ${mismatched} mismatching/non-owned, and ${stillOwned} still-owned row(s): ${error instanceof Error ? error.message : 'unknown mutation failure'}`,
          recordSnapshot(records),
        )
      }

      if (changes !== deletable.length) {
        let after: readonly RetentionPersistenceRow[]
        try {
          after = await d1.read.readRetentionExactRows(deletable.map((record) => record.ticketId), options)
        } catch {
          for (const record of deletable) record.status = 'unresolved'
          fail(
            'sentinel-cleanup-failure',
            'Conditional retention deletion reported an unexpected count and its read-only reconciliation failed; the delete was not retried.',
            recordSnapshot(records),
          )
        }
        const afterMap = new Map(after.map((row) => [row.ticketId, row]))
        let mismatchAfterDelete = false
        let absentAfterDelete = false
        for (const record of deletable) {
          const row = afterMap.get(record.ticketId)
          if (!row) {
            record.status = 'absent'
            absentAfterDelete = true
          } else if (!draftSubmissionFingerprintsEqual(row, record.expectedFingerprint)) {
            record.status = 'mismatched-non-owned'
            mismatchAfterDelete = true
          } else record.status = 'confirmed-owned'
        }
        fail(
          mismatchAfterDelete ? 'ownership-ambiguity' : 'sentinel-cleanup-failure',
          mismatchAfterDelete
            ? 'Conditional retention deletion reported an unexpected count and found a mismatching row, which was left untouched.'
            : absentAfterDelete
              ? 'Conditional retention deletion reported an unexpected count; a subsequent read classified affected rows as already absent.'
              : 'Conditional retention deletion reported an unexpected count while exact owned rows remained.',
          recordSnapshot(records),
        )
      }

      const after = await d1.read.readRetentionExactRows(deletable.map((record) => record.ticketId), options)
      if (after.length !== 0) {
        fail(
          'sentinel-cleanup-failure',
          'Conditional retention deletion reported the exact change count but an exact ticket ID remained.',
          recordSnapshot(records),
        )
      }
      for (const record of deletable) record.status = 'deleted'
    }

    if (mismatched.length > 0) {
      fail(
        'ownership-ambiguity',
        `Retention cleanup refused ${mismatched.length} row(s) whose immutable fingerprints no longer matched this run.`,
        recordSnapshot(records),
      )
    }
  }
}

/**
 * Historical D1C.4 orchestration retained only for deterministic local-fake
 * regression tests. It cannot construct live adapters or accept a real token.
 */
export async function runTestOnlyRetentionSmoke(
  execution: RetentionSmokeExecution,
  dependencies?: RetentionSmokeDependencies,
) {
  if (!dependencies
    || typeof dependencies.fetcher !== 'function'
    || !dependencies.d1
    || typeof dependencies.d1 !== 'object') {
    fail(
      'sentinel-ownership-failure',
      'Test-only D1C.4 retention orchestration requires explicit in-memory network and D1 adapters.',
    )
  }
  const fetcher = dependencies.fetcher
  const d1 = dependencies.d1
  const now = dependencies.now ?? Date.now
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const sentinels = createRetentionSentinels((dependencies.runId ?? (() => randomBytes(24).toString('hex')))())
  const startedAt = now()
  const timeoutMs = execution.timeoutSeconds * 1_000
  const deadlineMs = startedAt + timeoutMs
  const cleanupDeadlineMs = deadlineMs + RETENTION_CLEANUP_RESERVE_SECONDS * 1_000
  if (
    !Number.isSafeInteger(startedAt) || startedAt < 0
    || !Number.isSafeInteger(deadlineMs) || !Number.isSafeInteger(cleanupDeadlineMs)
  ) {
    fail('sentinel-ownership-failure', 'Retention smoke clock is outside the safe integer range.')
  }
  const digest = createHash('sha256').update(`pennant-pursuit:d1c4-retention:${sentinels.scope}`).digest('hex')
  const fingerprints = createRetentionFingerprints(sentinels, digest, startedAt)
  const expectedFingerprints = new Map(fingerprints.map((fingerprint) => [fingerprint.ticketId, fingerprint]))
  const ownershipRecords = createOwnershipRecords(fingerprints)
  let observedBoundedRun = false
  try {
    await assertHealth(fetcher, execution, deadlineMs, now)
    const options = requestOptions(execution, deadlineMs, now)
    await preflightOwnership(d1.read, sentinels, options)

    await insertSentinels(d1, sentinels, expectedFingerprints, options, ownershipRecords)
    assertInitialRetentionSnapshot(
      await readSnapshot(d1.read, sentinels, expectedFingerprints, options),
      sentinels,
    )

    while (true) {
      const remainingMs = deadlineMs - now()
      if (remainingMs <= 0) {
        fail('scheduled-timeout', 'Timed out waiting for two scheduled bounded cleanup runs.')
      }
      await sleep(Math.min(execution.pollSeconds * 1_000, remainingMs))
      if (deadlineMs - now() <= 0) {
        fail('scheduled-timeout', 'Timed out waiting for two scheduled bounded cleanup runs.')
      }
      const currentOptions = requestOptions(execution, deadlineMs, now)
      await assertNoOrderingCompetitor(d1.read, sentinels, currentOptions)
      const snapshot = await readSnapshot(d1.read, sentinels, expectedFingerprints, currentOptions)
      if (!observedBoundedRun && snapshot.expired === sentinels.expired.length) {
        assertProtected(snapshot, sentinels)
        continue
      }
      if (!observedBoundedRun && snapshot.expired === 1) {
        assertFirstBoundedRetentionSnapshot(snapshot, sentinels)
        observedBoundedRun = true
        continue
      }
      if (!observedBoundedRun && snapshot.expired === 0) {
        fail(
          'missed-scheduled-run-boundary',
          'Two scheduled runs completed between observations, so the exact first-run bound is inconclusive.',
        )
      }
      if (!observedBoundedRun) {
        fail(
          'inconclusive-observation',
          'Retention state changed without an isolated first bounded observation; shared activity can explain the transition.',
        )
      }
      if (snapshot.expired === 1) {
        assertFirstBoundedRetentionSnapshot(snapshot, sentinels)
        continue
      }
      if (snapshot.expired === 0) {
        assertFinalRetentionSnapshot(snapshot, sentinels)
        return Object.freeze({
          expiredRemoved: sentinels.expired.length,
          protectedRows: protectedIds(sentinels).length,
          boundedRuns: 2,
          createdRows: [...ownershipRecords.values()]
            .filter((record) => record.status === 'confirmed-owned').length,
        })
      }
      fail(
        'inconclusive-observation',
        'Retention state changed after the first observation in a pattern that shared activity can explain.',
      )
    }
  } catch (error) {
    if (error instanceof RetentionSmokeFailure && error.ownershipRecords.length === 0) {
      throw new RetentionSmokeFailure(error.code, error.message, recordSnapshot(ownershipRecords))
    }
    throw error
  } finally {
    if ([...ownershipRecords.values()].some((record) => record.status === 'confirmed-owned')) {
      await cleanupOwnedSentinels(
        d1,
        ownershipRecords,
        requestOptions(execution, cleanupDeadlineMs, now),
      )
    }
  }
}
