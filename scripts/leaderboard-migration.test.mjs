import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = [
  readFileSync('migrations/0001_backend_foundation.sql', 'utf8'),
  readFileSync('migrations/0002_draft_submissions.sql', 'utf8'),
  readFileSync('migrations/0003_leaderboard_foundation.sql', 'utf8'),
]

function applyThroughVersion3() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of migrations) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  return database
}

function schemaVersion(database) {
  return database.prepare('SELECT version FROM backend_schema WHERE id = 1').get().version
}

function schemaObjects(database) {
  return database
    .prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all()
    .map(({ type, name }) => `${type}:${name}`)
}

function insertPlayer(database, digest = 'a'.repeat(64), label = 'Player Cedar') {
  return database.prepare(`
    INSERT INTO leaderboard_players (
      identity_key_digest,
      public_label,
      status,
      created_at_ms
    ) VALUES (?, ?, 'active', ?)
  `).run(digest, label, 1_000)
}

function insertRun(database, overrides = {}) {
  const row = {
    sourceTicketId: '11111111-1111-4111-8111-111111111111',
    playerId: 1,
    mode: 'classic',
    environment: 'production',
    isSmoke: 0,
    submittedAtMs: 2_000,
    wins: 113,
    scoreTenths: 917,
    tier: 'Pennant Contender',
    eligibilityStatus: 'eligible',
    eligibilityReason: 'eligible',
    invalidatedAtMs: null,
    ...overrides,
  }
  return database.prepare(`
    INSERT INTO leaderboard_runs (
      source_ticket_id,
      player_id,
      game_mode,
      environment,
      is_smoke,
      submitted_at_ms,
      verified_wins,
      verified_overall_score_tenths,
      tier_label,
      eligibility_status,
      eligibility_reason,
      invalidated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.sourceTicketId,
    row.playerId,
    row.mode,
    row.environment,
    row.isSmoke,
    row.submittedAtMs,
    row.wins,
    row.scoreTenths,
    row.tier,
    row.eligibilityStatus,
    row.eligibilityReason,
    row.invalidatedAtMs,
  )
}

const database = applyThroughVersion3()
assert.equal(schemaVersion(database), 3)
assert.deepEqual(schemaObjects(database), [
  'index:idx_draft_submissions_retain_until',
  'index:idx_leaderboard_runs_best',
  'index:idx_leaderboard_runs_player_history',
  'table:backend_schema',
  'table:draft_submissions',
  'table:leaderboard_players',
  'table:leaderboard_runs',
])

assert.deepEqual(
  database.prepare('PRAGMA foreign_key_list(leaderboard_runs)').all().map((row) => ({
    table: row.table,
    from: row.from,
    to: row.to,
    onUpdate: row.on_update,
    onDelete: row.on_delete,
  })),
  [{
    table: 'leaderboard_players',
    from: 'player_id',
    to: 'player_id',
    onUpdate: 'RESTRICT',
    onDelete: 'RESTRICT',
  }],
)

insertPlayer(database)
insertRun(database)
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 1)
assert.throws(() => insertRun(database), /UNIQUE constraint failed/)
assert.throws(
  () => database.prepare('DELETE FROM leaderboard_players WHERE player_id = 1').run(),
  /FOREIGN KEY constraint failed/,
)

for (const [digest, label] of [
  ['A'.repeat(64), 'Player Birch'],
  ['b'.repeat(63), 'Player Birch'],
  ['b'.repeat(64), ' Player Birch'],
  ['c'.repeat(64), 'Player\nBirch'],
  ['d'.repeat(64), 'x'.repeat(33)],
]) {
  assert.throws(() => insertPlayer(database, digest, label), /CHECK constraint failed/)
}

const invalidRuns = [
  { sourceTicketId: 'short', playerId: 1 },
  { sourceTicketId: '22222222-2222-4222-8222-222222222222', playerId: 999 },
  { sourceTicketId: '33333333-3333-4333-8333-333333333333', mode: 'unsupported' },
  { sourceTicketId: '44444444-4444-4444-8444-444444444444', environment: 'unknown' },
  { sourceTicketId: '55555555-5555-4555-8555-555555555555', isSmoke: 2 },
  { sourceTicketId: '66666666-6666-4666-8666-666666666666', wins: 163 },
  { sourceTicketId: '77777777-7777-4777-8777-777777777777', scoreTenths: 1001 },
  {
    sourceTicketId: '88888888-8888-4888-8888-888888888888',
    playerId: null,
    eligibilityStatus: 'eligible',
    eligibilityReason: 'eligible',
  },
  {
    sourceTicketId: '99999999-9999-4999-8999-999999999999',
    playerId: null,
    eligibilityStatus: 'identity_pending',
    eligibilityReason: 'identity_unavailable',
    environment: 'test',
  },
]
for (const invalid of invalidRuns) {
  assert.throws(() => insertRun(database, invalid), /(?:CHECK|FOREIGN KEY) constraint failed/)
}

insertRun(database, {
  sourceTicketId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  playerId: null,
  environment: 'preview',
  eligibilityStatus: 'identity_pending',
  eligibilityReason: 'identity_unavailable',
})
insertRun(database, {
  sourceTicketId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  playerId: null,
  environment: 'test',
  isSmoke: 1,
  eligibilityStatus: 'excluded_test',
  eligibilityReason: 'test_or_smoke_data',
})

const bestPlan = database.prepare(`
  EXPLAIN QUERY PLAN
  SELECT player_id, verified_wins
  FROM leaderboard_runs
  WHERE environment = ?
    AND game_mode = ?
    AND eligibility_status = 'eligible'
    AND is_smoke = 0
    AND submitted_at_ms >= ?
    AND submitted_at_ms < ?
  ORDER BY submitted_at_ms
`).all('production', 'classic', 0, 10_000)
assert.match(
  bestPlan.map(({ detail }) => detail).join('\n'),
  /idx_leaderboard_runs_best/,
)
const historyPlan = database.prepare(`
  EXPLAIN QUERY PLAN
  SELECT run_id
  FROM leaderboard_runs
  WHERE player_id = ?
  ORDER BY submitted_at_ms DESC, run_id DESC
`).all(1)
assert.match(
  historyPlan.map(({ detail }) => detail).join('\n'),
  /idx_leaderboard_runs_player_history/,
)

// Raw submission retention is intentionally independent from durable rankings.
database.prepare(`
  INSERT INTO draft_submissions (
    ticket_id,
    ticket_token_digest,
    transcript_digest,
    submitted_at_ms,
    retain_until_ms,
    submission_schema_version,
    success_response_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  '11111111-1111-4111-8111-111111111111',
  'e'.repeat(64),
  'f'.repeat(64),
  1_000,
  2_000,
  'pennant-draft-submission-v1',
  '{}',
)
database.prepare('DELETE FROM draft_submissions WHERE retain_until_ms <= ?').run(2_000)
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM draft_submissions').get().count, 0)
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM leaderboard_runs').get().count, 3)

database.close()

for (const predecessor of [1, 3, 4]) {
  const rejected = new DatabaseSync(':memory:')
  rejected.exec(migrations[0])
  if (predecessor >= 2) rejected.exec(migrations[1])
  if (predecessor !== 2) rejected.prepare('UPDATE backend_schema SET version = ? WHERE id = 1').run(predecessor)
  assert.throws(() => rejected.exec(migrations[2]), /malformed JSON/)
  assert.equal(
    rejected.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN ('leaderboard_players', 'leaderboard_runs')").get().count,
    0,
  )
  rejected.close()
}

console.log('Leaderboard migration tests passed: guarded version-3 upgrade, constraints, uniqueness, foreign-key restrictions, query indexes, and retention independence are verified.')
