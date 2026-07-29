import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = [
  readFileSync('migrations/0001_backend_foundation.sql', 'utf8'),
  readFileSync('migrations/0002_draft_submissions.sql', 'utf8'),
  readFileSync('migrations/0003_leaderboard_foundation.sql', 'utf8'),
  readFileSync('migrations/0004_leaderboard_identity_ranking.sql', 'utf8'),
]

function applyThroughVersion4() {
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
  const nameKey = label.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC')
  return database.prepare(`
    INSERT INTO leaderboard_players (
      identity_key_digest,
      public_label,
      status,
      created_at_ms,
      public_name_key,
      device_credential_digest,
      recovery_code_digest,
      recovery_version,
      credential_rotated_at_ms,
      identity_updated_at_ms,
      identity_state
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, 1, ?, ?, 'active')
  `).run(digest, label, 1_000, nameKey, digest, digest, 1_000, 1_000)
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

const database = applyThroughVersion4()
assert.equal(schemaVersion(database), 4)
assert.deepEqual(schemaObjects(database), [
  'index:idx_draft_submissions_retain_until',
  'index:idx_leaderboard_identity_claims_expiry',
  'index:idx_leaderboard_identity_events_player',
  'index:idx_leaderboard_players_device_credential',
  'index:idx_leaderboard_players_public_name_key',
  'index:idx_leaderboard_players_recovery_code',
  'index:idx_leaderboard_recovery_operations_expiry',
  'index:idx_leaderboard_runs_best',
  'index:idx_leaderboard_runs_player_history',
  'index:idx_leaderboard_runs_qualification',
  'table:backend_schema',
  'table:draft_submissions',
  'table:leaderboard_identity_claims',
  'table:leaderboard_identity_events',
  'table:leaderboard_players',
  'table:leaderboard_recovery_operations',
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

assert.throws(
  () => insertPlayer(database, 'f'.repeat(64), 'PLAYER CEDAR'),
  /UNIQUE constraint failed: leaderboard_players.public_name_key/,
)
assert.throws(
  () => database.prepare(`
    UPDATE leaderboard_players
    SET device_credential_digest = ?
    WHERE player_id = 1
  `).run('short'),
  /CHECK constraint failed/,
)
assert.throws(
  () => database.prepare(`
    UPDATE leaderboard_players
    SET recovery_code_digest = NULL
    WHERE player_id = 1
  `).run(),
  /CHECK constraint failed/,
)
database.prepare(`
  INSERT INTO leaderboard_recovery_operations (
    operation_digest,
    request_binding_digest,
    player_id,
    source_recovery_version,
    replacement_recovery_version,
    replacement_device_digest,
    replacement_recovery_digest,
    derivation_version,
    created_at_ms,
    expires_at_ms
  ) VALUES (?, ?, 1, 1, 2, ?, ?, 1, 1_100, 2_000)
`).run('1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64))
assert.throws(
  () => database.prepare(`
    INSERT INTO leaderboard_recovery_operations (
      operation_digest,
      request_binding_digest,
      player_id,
      source_recovery_version,
      replacement_recovery_version,
      replacement_device_digest,
      replacement_recovery_digest,
      derivation_version,
      created_at_ms,
      expires_at_ms
    ) VALUES (?, ?, 1, 1, 2, ?, ?, 1, 1_100, 2_000)
  `).run('5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64)),
  /UNIQUE constraint failed/,
)
assert.throws(
  () => database.prepare(`
    INSERT INTO leaderboard_recovery_operations (
      operation_digest,
      request_binding_digest,
      player_id,
      source_recovery_version,
      replacement_recovery_version,
      replacement_device_digest,
      replacement_recovery_digest,
      derivation_version,
      created_at_ms,
      expires_at_ms
    ) VALUES (?, ?, 1, 2, 4, ?, ?, 1, 2_000, 3_000)
  `).run('9'.repeat(64), 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)),
  /CHECK constraint failed/,
)

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

const pendingRunId = database.prepare(`
  SELECT run_id
  FROM leaderboard_runs
  WHERE source_ticket_id = ?
`).get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').run_id
database.prepare(`
  INSERT INTO leaderboard_identity_claims (
    run_id,
    claim_token_digest,
    created_at_ms,
    expires_at_ms
  ) VALUES (?, ?, ?, ?)
`).run(pendingRunId, '9'.repeat(64), 2_000, 3_000)
assert.throws(
  () => database.prepare(`
    UPDATE leaderboard_identity_claims
    SET
      used_at_ms = ?,
      claimed_player_id = ?,
      claimed_name_key = ?
    WHERE run_id = ?
  `).run(3_000, 1, 'player cedar', pendingRunId),
  /CHECK constraint failed/,
)
assert.throws(
  () => database.prepare(`
    INSERT INTO leaderboard_identity_claims (
      run_id,
      claim_token_digest,
      created_at_ms,
      expires_at_ms
    ) VALUES (?, ?, ?, ?)
  `).run(pendingRunId, '8'.repeat(64), 2_000, 3_000),
  /UNIQUE constraint failed/,
)
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
for (const [query, value, expectedIndex] of [
  [
    'SELECT player_id FROM leaderboard_players WHERE public_name_key = ?',
    'player cedar',
    'idx_leaderboard_players_public_name_key',
  ],
  [
    'SELECT player_id FROM leaderboard_players WHERE device_credential_digest = ?',
    'a'.repeat(64),
    'idx_leaderboard_players_device_credential',
  ],
  [
    'SELECT player_id FROM leaderboard_players WHERE recovery_code_digest = ?',
    'a'.repeat(64),
    'idx_leaderboard_players_recovery_code',
  ],
  [
    'SELECT claim_id FROM leaderboard_identity_claims WHERE expires_at_ms <= ? ORDER BY expires_at_ms, claim_id',
    3_000,
    'idx_leaderboard_identity_claims_expiry',
  ],
]) {
  const plan = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all(value)
  assert.match(plan.map(({ detail }) => detail).join('\n'), new RegExp(expectedIndex))
}
const recoveryExpiryPlan = database.prepare(`
  EXPLAIN QUERY PLAN
  SELECT operation_digest
  FROM leaderboard_recovery_operations
  WHERE expires_at_ms <= ?
  ORDER BY expires_at_ms, operation_digest
`).all(3_000)
assert.match(
  recoveryExpiryPlan.map(({ detail }) => detail).join('\n'),
  /idx_leaderboard_recovery_operations_expiry/,
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

function populatedVersion3Database() {
  const populated = new DatabaseSync(':memory:')
  populated.exec('PRAGMA foreign_keys = ON')
  populated.exec(migrations[0])
  populated.exec(migrations[1])
  populated.exec(migrations[2])
  populated.prepare(`
    INSERT INTO leaderboard_players (
      identity_key_digest,
      public_label,
      status,
      created_at_ms
    ) VALUES (?, ?, ?, ?)
  `).run('1'.repeat(64), 'Legacy Cedar', 'active', 10_000)
  populated.prepare(`
    INSERT INTO leaderboard_players (
      identity_key_digest,
      public_label,
      status,
      created_at_ms
    ) VALUES (?, ?, ?, ?)
  `).run('2'.repeat(64), 'Legacy Birch', 'disabled', 10_001)
  insertRun(populated, {
    sourceTicketId: '30000000-0000-4000-8000-000000000001',
    submittedAtMs: 11_000,
  })
  insertRun(populated, {
    sourceTicketId: '30000000-0000-4000-8000-000000000002',
    playerId: null,
    environment: 'preview',
    submittedAtMs: 11_001,
    eligibilityStatus: 'identity_pending',
    eligibilityReason: 'identity_unavailable',
  })
  insertRun(populated, {
    sourceTicketId: '30000000-0000-4000-8000-000000000003',
    playerId: null,
    environment: 'test',
    isSmoke: 1,
    submittedAtMs: 11_002,
    eligibilityStatus: 'excluded_test',
    eligibilityReason: 'test_or_smoke_data',
  })
  insertRun(populated, {
    sourceTicketId: '30000000-0000-4000-8000-000000000004',
    submittedAtMs: 11_003,
    eligibilityStatus: 'moderated',
    eligibilityReason: 'moderated',
    invalidatedAtMs: 12_000,
  })
  insertRun(populated, {
    sourceTicketId: '30000000-0000-4000-8000-000000000005',
    playerId: 2,
    submittedAtMs: 11_004,
    eligibilityStatus: 'invalidated',
    eligibilityReason: 'invalidated',
    invalidatedAtMs: 12_001,
  })
  for (const [ticketId, tokenCharacter, transcriptCharacter, submittedAtMs] of [
    ['40000000-0000-4000-8000-000000000001', '3', '4', 13_000],
    ['40000000-0000-4000-8000-000000000002', '5', '6', 13_001],
  ]) {
    populated.prepare(`
      INSERT INTO draft_submissions (
        ticket_id,
        ticket_token_digest,
        transcript_digest,
        submitted_at_ms,
        retain_until_ms,
        submission_schema_version,
        success_response_json
      ) VALUES (?, ?, ?, ?, ?, 'pennant-draft-submission-v1', ?)
    `).run(
      ticketId,
      tokenCharacter.repeat(64),
      transcriptCharacter.repeat(64),
      submittedAtMs,
      submittedAtMs + 86_400_000,
      JSON.stringify({
        ok: true,
        schemaVersion: 'pennant-draft-submission-v1',
        submittedAt: new Date(submittedAtMs).toISOString(),
      }),
    )
  }
  return populated
}

function predecessorData(databaseToSnapshot) {
  return {
    players: databaseToSnapshot.prepare(`
      SELECT player_id, identity_key_digest, public_label, status, created_at_ms
      FROM leaderboard_players
      ORDER BY player_id
    `).all().map((row) => ({ ...row })),
    runs: databaseToSnapshot.prepare(`
      SELECT *
      FROM leaderboard_runs
      ORDER BY run_id
    `).all().map((row) => ({ ...row })),
    receipts: databaseToSnapshot.prepare(`
      SELECT *
      FROM draft_submissions
      ORDER BY ticket_id
    `).all().map((row) => ({ ...row })),
  }
}

const populated = populatedVersion3Database()
const populatedBefore = predecessorData(populated)
assert.equal(schemaVersion(populated), 3)
assert.equal(populatedBefore.players.length, 2)
assert.equal(populatedBefore.runs.length, 5)
assert.equal(populatedBefore.receipts.length, 2)
assert.deepEqual(
  populated.prepare('PRAGMA foreign_key_check').all().map((row) => ({ ...row })),
  [],
)
populated.exec('BEGIN IMMEDIATE')
try {
  populated.exec(migrations[3])
  populated.exec('COMMIT')
} catch (error) {
  populated.exec('ROLLBACK')
  throw error
}
assert.equal(schemaVersion(populated), 4)
assert.deepEqual(predecessorData(populated), populatedBefore)
assert.deepEqual(
  populated.prepare(`
    SELECT
      player_id,
      public_name_key,
      device_credential_digest,
      recovery_code_digest,
      recovery_version,
      credential_rotated_at_ms,
      identity_updated_at_ms,
      identity_state
    FROM leaderboard_players
    ORDER BY player_id
  `).all().map((row) => ({ ...row })),
  [
    {
      player_id: 1,
      public_name_key: null,
      device_credential_digest: null,
      recovery_code_digest: null,
      recovery_version: 0,
      credential_rotated_at_ms: null,
      identity_updated_at_ms: null,
      identity_state: 'inactive',
    },
    {
      player_id: 2,
      public_name_key: null,
      device_credential_digest: null,
      recovery_code_digest: null,
      recovery_version: 0,
      credential_rotated_at_ms: null,
      identity_updated_at_ms: null,
      identity_state: 'inactive',
    },
  ],
)
assert.equal(
  populated.prepare(`
    SELECT COUNT(*) AS count
    FROM leaderboard_runs AS r
    JOIN leaderboard_players AS p ON p.player_id = r.player_id
    WHERE r.eligibility_status = 'eligible'
      AND p.status = 'active'
      AND p.identity_state = 'active'
      AND p.public_name_key IS NOT NULL
      AND p.device_credential_digest IS NOT NULL
      AND p.recovery_code_digest IS NOT NULL
  `).get().count,
  0,
)
assert.deepEqual(
  populated.prepare('PRAGMA foreign_key_check').all().map((row) => ({ ...row })),
  [],
)
for (const objectName of [
  'leaderboard_identity_claims',
  'leaderboard_recovery_operations',
  'leaderboard_identity_events',
  'idx_leaderboard_recovery_operations_expiry',
]) {
  assert.equal(
    populated.prepare('SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = ?').get(objectName).count,
    1,
  )
}
populated.close()

const rollbackDatabase = populatedVersion3Database()
const rollbackBefore = predecessorData(rollbackDatabase)
const failingMigration = migrations[3].replace(
  'UPDATE backend_schema\nSET version = 4',
  "SELECT json('forced populated migration rollback');\n\nUPDATE backend_schema\nSET version = 4",
)
assert.notEqual(failingMigration, migrations[3])
rollbackDatabase.exec('BEGIN IMMEDIATE')
assert.throws(() => rollbackDatabase.exec(failingMigration), /malformed JSON/)
rollbackDatabase.exec('ROLLBACK')
assert.equal(schemaVersion(rollbackDatabase), 3)
assert.deepEqual(predecessorData(rollbackDatabase), rollbackBefore)
assert.equal(
  rollbackDatabase.prepare(`
    SELECT COUNT(*) AS count
    FROM pragma_table_info('leaderboard_players')
    WHERE name = 'identity_state'
  `).get().count,
  0,
)
assert.equal(
  rollbackDatabase.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_schema
    WHERE name IN (
      'leaderboard_identity_claims',
      'leaderboard_recovery_operations',
      'leaderboard_identity_events',
      'idx_leaderboard_recovery_operations_expiry'
    )
  `).get().count,
  0,
)
assert.deepEqual(
  rollbackDatabase.prepare('PRAGMA foreign_key_check').all().map((row) => ({ ...row })),
  [],
)
rollbackDatabase.close()

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

for (const predecessor of [1, 2, 4]) {
  const rejected = new DatabaseSync(':memory:')
  rejected.exec('PRAGMA foreign_keys = ON')
  rejected.exec(migrations[0])
  rejected.exec(migrations[1])
  rejected.exec(migrations[2])
  rejected.prepare('UPDATE backend_schema SET version = ? WHERE id = 1').run(predecessor)
  assert.throws(() => rejected.exec(migrations[3]), /malformed JSON/)
  assert.equal(
    rejected.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'leaderboard_identity_claims'").get().count,
    0,
  )
  rejected.close()
}

console.log('Leaderboard migration tests passed: exact populated 3-to-4 upgrade, legacy privacy, receipt/history preservation, credential/name and recovery-operation constraints, query indexes, induced rollback, and retention independence are verified.')
