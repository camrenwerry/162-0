import assert from 'node:assert/strict'
import {
  cleanupSubmissionFingerprintChunk,
  type SubmissionCleanupAttemptResult,
  type SubmissionCleanupD1,
  type SubmissionCleanupOwnershipStatus,
} from './d1c4-submission-smoke'
import {
  draftSubmissionFingerprintsEqual,
  type DraftSubmissionFingerprint,
  type SubmissionPersistenceRow,
} from './lib/d1c4-d1-client'

const expectedFingerprint: DraftSubmissionFingerprint = Object.freeze({
  ticketId: '11111111-1111-4111-8111-111111111111',
  ticketTokenDigest: 'a'.repeat(64),
  transcriptDigest: 'b'.repeat(64),
  submittedAtMs: 1_000,
  retainUntilMs: 2_000,
  submissionSchemaVersion: 'pennant-draft-submission-v1',
  successResponseJson: '{"ok":true}',
})

type MutationBehavior =
  | 'throw-after-delete'
  | 'throw-before-delete'
  | 'zero-absent'
  | 'zero-owned'
  | 'zero-mismatched'
  | 'unexpected-absent'
  | 'unexpected-owned'
  | 'unexpected-mismatched'
  | 'confirmed'

class SubmissionCleanupFake {
  readonly rows = new Map<string, SubmissionPersistenceRow>([[
    expectedFingerprint.ticketId,
    expectedFingerprint,
  ]])
  readonly deleteArguments: DraftSubmissionFingerprint[][] = []
  deleteCalls = 0
  readCalls = 0

  constructor(
    readonly behavior: MutationBehavior,
    readonly failReconciliationRead = false,
  ) {}

  async readSubmissionRows(ticketIds: readonly string[]) {
    this.readCalls += 1
    if (this.failReconciliationRead) throw new Error('injected reconciliation read failure')
    return ticketIds.flatMap((ticketId) => {
      const row = this.rows.get(ticketId)
      return row ? [row] : []
    })
  }

  async deleteDraftSubmissionFingerprints(fingerprints: readonly DraftSubmissionFingerprint[]) {
    this.deleteCalls += 1
    this.deleteArguments.push(fingerprints.map((fingerprint) => ({ ...fingerprint })))
    const fingerprint = fingerprints[0]
    const mismatch = { ...fingerprint, transcriptDigest: 'c'.repeat(64) }
    switch (this.behavior) {
      case 'throw-after-delete':
        this.rows.delete(fingerprint.ticketId)
        throw new Error('injected lost delete response')
      case 'throw-before-delete':
        throw new Error('injected ambiguous delete failure')
      case 'zero-absent':
        this.rows.delete(fingerprint.ticketId)
        return 0
      case 'zero-owned':
        return 0
      case 'zero-mismatched':
        this.rows.set(fingerprint.ticketId, mismatch)
        return 0
      case 'unexpected-absent':
        this.rows.delete(fingerprint.ticketId)
        return 2
      case 'unexpected-owned':
        return 2
      case 'unexpected-mismatched':
        this.rows.set(fingerprint.ticketId, mismatch)
        return 2
      case 'confirmed':
        this.rows.delete(fingerprint.ticketId)
        return fingerprints.length
    }
  }
}

function assertSingleScopedDelete(fake: SubmissionCleanupFake) {
  assert.equal(fake.deleteCalls, 1, 'submission cleanup must make exactly one destructive attempt')
  assert.deepEqual(fake.deleteArguments, [[expectedFingerprint]])
  assert(draftSubmissionFingerprintsEqual(fake.deleteArguments[0][0], expectedFingerprint))
  assert.deepEqual(Object.keys(fake.deleteArguments[0][0]).sort(), [
    'retainUntilMs',
    'submissionSchemaVersion',
    'submittedAtMs',
    'successResponseJson',
    'ticketId',
    'ticketTokenDigest',
    'transcriptDigest',
  ])
}

function assertFinalStatus(
  result: SubmissionCleanupAttemptResult,
  expectedStatus: SubmissionCleanupOwnershipStatus,
) {
  assert.equal(result.ownershipRecords.length, 1)
  const record = result.ownershipRecords[0]
  assert.equal(record.ticketId, expectedFingerprint.ticketId)
  assert.equal(record.status, expectedStatus)
  assert.deepEqual(record.expectedFingerprint, expectedFingerprint)
  assert(draftSubmissionFingerprintsEqual(record.expectedFingerprint, expectedFingerprint))
}

async function runCase(
  behavior: MutationBehavior,
  expectedStatus: SubmissionCleanupOwnershipStatus,
  expectedOutcome: SubmissionCleanupAttemptResult['mutationOutcome'],
  expectedReads: number,
  failReconciliationRead = false,
) {
  const fake = new SubmissionCleanupFake(behavior, failReconciliationRead)
  const d1: SubmissionCleanupD1 = { read: fake, mutate: fake }
  const result = await cleanupSubmissionFingerprintChunk(d1, [expectedFingerprint])
  assert.equal(result.mutationOutcome, expectedOutcome, `${behavior}: mutation outcome`)
  assert.equal(result.reconciliationPerformed, expectedReads === 1, `${behavior}: reconciliation performed`)
  assert.equal(result.reconciliationFailed, failReconciliationRead, `${behavior}: reconciliation failure`)
  assert.equal(fake.readCalls, expectedReads, 'submission cleanup reconciliation read count must be exact')
  assertSingleScopedDelete(fake)
  assertFinalStatus(result, expectedStatus)
  return result
}

const thrownAbsent = await runCase(
  'throw-after-delete',
  'absent',
  'thrown-ambiguous-failure',
  1,
)
assert.match(thrownAbsent.mutationFailureMessage ?? '', /lost delete response/)

const thrownUnreadable = await runCase(
  'throw-before-delete',
  'unresolved',
  'thrown-ambiguous-failure',
  1,
  true,
)
assert.equal(thrownUnreadable.reconciliationFailed, true)

await runCase('zero-absent', 'absent', 'zero-change', 1)
await runCase('zero-owned', 'confirmed-owned', 'zero-change', 1)
await runCase('zero-mismatched', 'mismatched-non-owned', 'zero-change', 1)

for (const [behavior, expectedStatus] of [
  ['unexpected-absent', 'absent'],
  ['unexpected-owned', 'confirmed-owned'],
  ['unexpected-mismatched', 'mismatched-non-owned'],
] as const) {
  const result = await runCase(behavior, expectedStatus, 'unexpected-change-count', 1)
  assert.equal(result.reportedChanges, 2)
}

const confirmed = await runCase(
  'confirmed',
  'deleted',
  'confirmed-expected-change-count',
  0,
)
assert.equal(confirmed.reportedChanges, 1)
assert.equal(confirmed.reconciliationPerformed, false)

console.log('D1C.4 focused submission cleanup tests passed: one exact destructive attempt, one reconciliation only for zero, unexpected, or ambiguous outcomes, immediate unresolved classification on read failure, and complete-fingerprint ownership records are verified.')
