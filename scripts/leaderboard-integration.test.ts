import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import { handleLeaderboardRequest } from '../functions/lib/leaderboard'
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
    resolveLeaderboardIdentity: () => ({
      identityKeyDigest: 'a'.repeat(64),
      publicLabel: 'Player Cedar',
    }),
    classifyLeaderboardRun: () => ({ environment: 'production' as const, isSmoke: false }),
  }
}

function submissionEnv(database: SqliteD1Database) {
  return {
    DRAFT_SUBMISSION_MODE: 'enabled',
    DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY,
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
}
assert.equal(firstReceipt.submittedAt, new Date(FIRST_NOW).toISOString())
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_players').get().count, 1)
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
    eligibility_status: 'eligible',
    eligibility_reason: 'eligible',
  },
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
  submissionRequest({ ticket: secondFixture.ticket, transcript: secondFixture.transcript }),
  submissionEnv(database),
  submissionSources(SECOND_NOW),
)
assert.equal(secondResponse.status, 201)
const secondReceipt = await secondResponse.json() as { result: { projectedWins: number, overallScore: number } }
assert.equal(secondReceipt.result.projectedWins, firstReceipt.result.projectedWins)
assert.equal(secondReceipt.result.overallScore, firstReceipt.result.overallScore)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 2)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 2)

// A conflicting label for an existing identity digest fails the atomic batch
// until a deliberate rename policy is implemented.
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
  }),
  submissionEnv(database),
  {
    ...submissionSources(SECOND_NOW + 1),
    resolveLeaderboardIdentity: () => ({
      identityKeyDigest: 'a'.repeat(64),
      publicLabel: 'Player Renamed',
    }),
  },
)
assert.equal(conflictingLabelResponse.status, 503)
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
assert.deepEqual(leaderboard.entries, [{
  rank: 1,
  playerLabel: 'Player Cedar',
  projectedWins: firstReceipt.result.projectedWins,
  overallScore: firstReceipt.result.overallScore,
  tier: firstReceipt.result.tier,
  submittedAt: new Date(FIRST_NOW).toISOString(),
  mode: 'classic',
}])

const cleanup = await cleanupRetainedDraftSubmissions(
  { DB: database as unknown as D1Database },
  {
    now: () => SECOND_NOW + DRAFT_SUBMISSION_RETENTION_MS,
    observe: () => undefined,
  },
)
assert.equal(cleanup.rowsDeleted, 2)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 2)

const afterCleanupResponse = await handleLeaderboardRequest(
  new Request(LEADERBOARD_ENDPOINT),
  leaderboardEnv(database),
  () => SECOND_NOW + DRAFT_SUBMISSION_RETENTION_MS + 1,
)
assert.equal(afterCleanupResponse.status, 200)
assert.equal((await afterCleanupResponse.json() as { entries: unknown[] }).entries.length, 1)

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

console.log('Leaderboard integration test passed: signed ticket, replay, authoritative scoring, atomic persistence, idempotent retry, independent identical runs, ranking, and retention survival are verified locally.')
