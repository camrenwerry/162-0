import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import { handleLeaderboardRequest } from '../functions/lib/leaderboard'
import { handleLeaderboardIdentityRequest } from '../functions/lib/leaderboard-identity'
import { DRAFT_SUBMISSION_RETENTION_MS } from '../functions/lib/draft-submission'
import { handleAuthoritativeSubmissionRequest } from '../workers/draft-validation/src/authoritative-submission'
import { cleanupRetainedDraftSubmissions } from '../workers/draft-validation/src/retention-cleanup'
import {
  createBoundValidationFixture,
  TEST_DRAFT_TICKET_SIGNING_KEY,
} from './lib/draft-ticket-fixtures'
import { SqliteD1Database, type SqliteD1Statement } from './lib/sqlite-d1'

const SUBMISSION_ENDPOINT = 'https://preview.example.test/api/v1/submit-draft'
const LEADERBOARD_ENDPOINT = 'https://preview.example.test/api/v1/leaderboards?period=all-time'
const CURSOR_KEY = 'leaderboard-integration-cursor-key-with-at-least-thirty-two-bytes'
const IDENTITY_KEY = 'leaderboard-integration-identity-key-with-at-least-thirty-two-bytes'
const FIRST_NOW = 1_800_000_000_000
const SECOND_NOW = FIRST_NOW + 100
const JSON_HEADERS = { 'Content-Type': 'application/json' }

function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    'migrations/0001_backend_foundation.sql',
    'migrations/0002_draft_submissions.sql',
    'migrations/0003_leaderboard_foundation.sql',
    'migrations/0004_leaderboard_identity_ranking.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'))
  return sqlite
}

function submissionRequest(body: unknown) {
  return new Request(SUBMISSION_ENDPOINT, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

function submissionSources(now: number) {
  return {
    now: () => now,
    classifyLeaderboardRun: () => ({ environment: 'production' as const, isSmoke: false }),
  }
}

function submissionEnv(database: SqliteD1Database) {
  return {
    DRAFT_SUBMISSION_MODE: 'enabled',
    DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY,
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    LEADERBOARD_IDENTITY_SIGNING_KEY: IDENTITY_KEY,
    DB: database,
  }
}

function leaderboardEnv(database: SqliteD1Database) {
  return {
    LEADERBOARD_READ_MODE: 'enabled',
    LEADERBOARD_ENVIRONMENT: 'production',
    LEADERBOARD_CURSOR_SIGNING_KEY: CURSOR_KEY,
    DB: database,
  }
}

const sqlite = migratedDatabase()
const database = new SqliteD1Database(sqlite)
const firstFixture = await createBoundValidationFixture(noRerollsData.transcript, {
  issuedAt: FIRST_NOW - 1_000,
})
const firstEnvelope = { ticket: firstFixture.ticket, transcript: firstFixture.transcript }
const firstResponse = await handleAuthoritativeSubmissionRequest(
  submissionRequest(firstEnvelope),
  submissionEnv(database),
  submissionSources(FIRST_NOW),
)
assert.equal(firstResponse.status, 201)
const firstReceipt = await firstResponse.json() as {
  submittedAt: string
  result: { projectedWins: number, overallScore: number, tier: string }
  leaderboard: {
    identity: { setupRequired: boolean }
    claim: { state: string, capability: string }
    periods: Record<'daily' | 'weekly' | 'all-time', { qualifies: boolean, rank: number }>
  }
}
assert.equal(firstReceipt.submittedAt, new Date(FIRST_NOW).toISOString())
assert.equal(firstReceipt.leaderboard.identity.setupRequired, true)
assert.equal(firstReceipt.leaderboard.claim.state, 'available')
assert.deepEqual(
  Object.values(firstReceipt.leaderboard.periods).map(({ qualifies, rank }) => ({ qualifies, rank })),
  Array.from({ length: 3 }, () => ({ qualifies: true, rank: 1 })),
)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_players').get().count, 0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 1)
assert.deepEqual(
  { ...sqlite.prepare(`
    SELECT
      game_mode,
      environment,
      is_smoke,
      submitted_at_ms,
      verified_wins,
      verified_overall_score_tenths,
      tier_label,
      eligibility_status,
      eligibility_reason
    FROM leaderboard_runs
  `).get() },
  {
    game_mode: 'classic',
    environment: 'production',
    is_smoke: 0,
    submitted_at_ms: FIRST_NOW,
    verified_wins: firstReceipt.result.projectedWins,
    verified_overall_score_tenths: firstReceipt.result.overallScore * 10,
    tier_label: firstReceipt.result.tier,
    eligibility_status: 'identity_pending',
    eligibility_reason: 'identity_unavailable',
  },
)

const identityEnv = {
  LEADERBOARD_IDENTITY_MODE: 'enabled',
  LEADERBOARD_RECOVERY_MODE: 'enabled',
  LEADERBOARD_IDENTITY_SIGNING_KEY: IDENTITY_KEY,
  DB: database,
}
const claimResponse = await handleLeaderboardIdentityRequest(
  new Request('https://preview.example.test/api/v1/leaderboard-identity-claim', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      claimCapability: firstReceipt.leaderboard.claim.capability,
      displayName: 'Player Cedar',
    }),
  }),
  identityEnv,
  'claim',
  () => FIRST_NOW + 1,
)
assert.equal(claimResponse.status, 201)
const claimedIdentity = await claimResponse.json() as {
  identity: { deviceCredential: string, recoveryCode: string }
}
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_players').get().count, 1)
assert.equal(
  sqlite.prepare('SELECT eligibility_status FROM leaderboard_runs WHERE run_id = 1').get().eligibility_status,
  'eligible',
)

const exactRetry = await handleAuthoritativeSubmissionRequest(
  submissionRequest(firstEnvelope),
  submissionEnv(database),
  {
    now: () => FIRST_NOW + DRAFT_SUBMISSION_RETENTION_MS + 1,
    resolveLeaderboardIdentity: () => { throw new Error('retry must not resolve identity') },
    classifyLeaderboardRun: () => { throw new Error('retry must not classify') },
  },
)
assert.equal(exactRetry.status, 200)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 1)

// A client cannot add score or eligibility fields to influence persistence.
const tamperedResponse = await handleAuthoritativeSubmissionRequest(
  submissionRequest({ ...firstEnvelope, score: 162, eligible: true }),
  submissionEnv(database),
  submissionSources(FIRST_NOW),
)
assert.equal(tamperedResponse.status, 400)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 1)

// An independent signed ticket may produce the same roster and score without
// being suppressed as a duplicate completed run.
const secondFixture = await createBoundValidationFixture(noRerollsData.transcript, {
  issuedAt: SECOND_NOW - 1_000,
  payloadOverrides: {
    ticketId: '22222222-2222-4222-8222-222222222222',
  },
})
const secondResponse = await handleAuthoritativeSubmissionRequest(
  submissionRequest({
    ticket: secondFixture.ticket,
    transcript: secondFixture.transcript,
    identityCredential: claimedIdentity.identity.deviceCredential,
  }),
  submissionEnv(database),
  submissionSources(SECOND_NOW),
)
assert.equal(secondResponse.status, 201)
const secondReceipt = await secondResponse.json() as { result: { projectedWins: number, overallScore: number } }
assert.equal(secondReceipt.result.projectedWins, firstReceipt.result.projectedWins)
assert.equal(secondReceipt.result.overallScore, firstReceipt.result.overallScore)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 2)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 2)

// A supplied credential is authenticated independently of score fields.
const conflictingLabelFixture = await createBoundValidationFixture(noRerollsData.transcript, {
  issuedAt: SECOND_NOW,
  payloadOverrides: {
    ticketId: '33333333-3333-4333-8333-333333333333',
  },
})
const conflictingLabelResponse = await handleAuthoritativeSubmissionRequest(
  submissionRequest({
    ticket: conflictingLabelFixture.ticket,
    transcript: conflictingLabelFixture.transcript,
    identityCredential: `ppd1_${'x'.repeat(43)}`,
  }),
  submissionEnv(database),
  {
    ...submissionSources(SECOND_NOW + 1),
  },
)
assert.equal(conflictingLabelResponse.status, 401)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 2)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 2)

const leaderboardResponse = await handleLeaderboardRequest(
  new Request(LEADERBOARD_ENDPOINT),
  leaderboardEnv(database),
  () => SECOND_NOW + 1,
)
assert.equal(leaderboardResponse.status, 200)
const leaderboard = await leaderboardResponse.json() as {
  entries: Array<{
    rank: number
    playerLabel: string
    projectedWins: number
    overallScore: number
    submittedAt: string
  }>
}
assert.deepEqual(leaderboard.entries, [
  {
    rank: 1,
    playerLabel: 'Player Cedar',
    projectedWins: firstReceipt.result.projectedWins,
    overallScore: firstReceipt.result.overallScore,
    tier: firstReceipt.result.tier,
    submittedAt: new Date(FIRST_NOW).toISOString(),
    mode: 'classic',
  },
  {
    rank: 1,
    playerLabel: 'Player Cedar',
    projectedWins: firstReceipt.result.projectedWins,
    overallScore: firstReceipt.result.overallScore,
    tier: firstReceipt.result.tier,
    submittedAt: new Date(SECOND_NOW).toISOString(),
    mode: 'classic',
  },
])

const renameResponse = await handleLeaderboardIdentityRequest(
  new Request('https://preview.example.test/api/v1/leaderboard-identity-rename', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      deviceCredential: claimedIdentity.identity.deviceCredential,
      displayName: 'Player Sequoia',
    }),
  }),
  identityEnv,
  'rename',
  () => SECOND_NOW + 2,
)
assert.equal(renameResponse.status, 200)

const recoveryResponse = await handleLeaderboardIdentityRequest(
  new Request('https://preview.example.test/api/v1/leaderboard-identity-recover', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      recoveryCode: claimedIdentity.identity.recoveryCode,
      recoveryOperationId: `ppr1_${'R'.repeat(42)}Q`,
    }),
  }),
  identityEnv,
  'recover',
  () => SECOND_NOW + 3,
)
assert.equal(recoveryResponse.status, 200)
const recoveredIdentity = await recoveryResponse.json() as {
  identity: { deviceCredential: string, recoveryCode: string }
}
assert.notEqual(recoveredIdentity.identity.deviceCredential, claimedIdentity.identity.deviceCredential)
assert.notEqual(recoveredIdentity.identity.recoveryCode, claimedIdentity.identity.recoveryCode)

const cleanup = await cleanupRetainedDraftSubmissions(
  { DB: database as unknown as D1Database },
  {
    now: () => SECOND_NOW + DRAFT_SUBMISSION_RETENTION_MS,
    observe: () => undefined,
  },
)
assert.equal(cleanup.rowsDeleted, 2)
assert.equal(cleanup.claimsDeleted, 1)
assert.equal(cleanup.recoveryOperationsDeleted, 1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 2)

const afterCleanupResponse = await handleLeaderboardRequest(
  new Request(LEADERBOARD_ENDPOINT),
  leaderboardEnv(database),
  () => SECOND_NOW + DRAFT_SUBMISSION_RETENTION_MS + 1,
)
assert.equal(afterCleanupResponse.status, 200)
const afterCleanupText = await afterCleanupResponse.text()
assert.equal((JSON.parse(afterCleanupText) as { entries: unknown[] }).entries.length, 2)
assert.match(afterCleanupText, /Player Sequoia/)
assert.doesNotMatch(afterCleanupText, /Player Cedar|deviceCredential|recoveryCode|ppd1_|PP1-/)

sqlite.close()

// A failure after the receipt INSERT rolls the entire local D1 batch back.
class RollbackProbeDatabase extends SqliteD1Database {
  override async batch(statements: SqliteD1Statement[]) {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      await statements[0].run()
      throw new Error('injected failure after receipt insert')
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
}

const rollbackSqlite = migratedDatabase()
const rollbackDatabase = new RollbackProbeDatabase(rollbackSqlite)
const rollbackResponse = await handleAuthoritativeSubmissionRequest(
  submissionRequest(firstEnvelope),
  submissionEnv(rollbackDatabase),
  submissionSources(FIRST_NOW),
)
assert.equal(rollbackResponse.status, 503)
assert.equal(rollbackSqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 0)
assert.equal(rollbackSqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_players').get().count, 0)
assert.equal(rollbackSqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 0)
rollbackSqlite.close()

console.log('Leaderboard integration test passed: signed ticket, authoritative scoring, pending qualification, display-name claim, returning credential, top-three/shared ranking, rename, second-device recovery, idempotency, rollback, and retention survival are verified locally.')
