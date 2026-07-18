import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const foundationMigration = readFileSync('migrations/0001_backend_foundation.sql', 'utf8')
const submissionMigration = readFileSync('migrations/0002_draft_submissions.sql', 'utf8')

function schemaVersion(database) {
  return database.prepare('SELECT version FROM backend_schema WHERE id = 1').get().version
}

function tableNames(database) {
  return database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map(({ name }) => name)
}

function schemaObjectExists(database, type, name) {
  return database
    .prepare('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?')
    .get(type, name) !== undefined
}

function assertNoSubmissionSchemaObjects(database) {
  assert.equal(schemaObjectExists(database, 'table', 'draft_submissions'), false)
  assert.equal(schemaObjectExists(database, 'index', 'idx_draft_submissions_retain_until'), false)
}

function assertRejectedPredecessor(database, expectedSchemaRows) {
  assert.throws(() => database.exec(submissionMigration), /malformed JSON/)
  assert.deepEqual(
    database
      .prepare('SELECT id, version FROM backend_schema ORDER BY id, version')
      .all()
      .map(({ id, version }) => ({ id, version })),
    expectedSchemaRows,
  )
  assertNoSubmissionSchemaObjects(database)
}

function applyFreshSchema() {
  const database = new DatabaseSync(':memory:')
  database.exec(foundationMigration)
  database.exec(submissionMigration)
  return database
}

const fresh = applyFreshSchema()
assert.equal(schemaVersion(fresh), 2)
assert.deepEqual(tableNames(fresh), ['backend_schema', 'draft_submissions'])

const columns = fresh.prepare('PRAGMA table_info(draft_submissions)').all()
assert.deepEqual(columns.map(({ name }) => name), [
  'ticket_id',
  'ticket_token_digest',
  'transcript_digest',
  'submitted_at_ms',
  'retain_until_ms',
  'submission_schema_version',
  'success_response_json',
])
assert.equal(columns.find(({ name }) => name === 'ticket_id')?.pk, 1)
assert.equal(columns.every(({ notnull, pk }) => notnull === 1 || pk === 1), true)

const indexes = fresh.prepare('PRAGMA index_list(draft_submissions)').all()
assert.equal(indexes.some(({ name }) => name === 'idx_draft_submissions_retain_until'), true)
const cleanupPlan = fresh
  .prepare('EXPLAIN QUERY PLAN SELECT ticket_id FROM draft_submissions WHERE retain_until_ms <= ? ORDER BY retain_until_ms LIMIT 500')
  .all(86_400_000)
assert.match(cleanupPlan.map(({ detail }) => detail).join('\n'), /idx_draft_submissions_retain_until/)

const insert = fresh.prepare(`
  INSERT INTO draft_submissions (
    ticket_id,
    ticket_token_digest,
    transcript_digest,
    submitted_at_ms,
    retain_until_ms,
    submission_schema_version,
    success_response_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const validRow = [
  '11111111-1111-4111-8111-111111111111',
  'a'.repeat(64),
  'b'.repeat(64),
  1_000,
  86_401_000,
  'pennant-draft-submission-v1',
  '{"ok":true}',
]
insert.run(...validRow)
assert.equal(fresh.prepare('SELECT count(*) AS count FROM draft_submissions').get().count, 1)
const validTimestampTypes = fresh.prepare(`
  SELECT
    typeof(submitted_at_ms) AS submitted_type,
    typeof(retain_until_ms) AS retain_type
  FROM draft_submissions
  WHERE ticket_id = ?
`).get(validRow[0])
assert.equal(validTimestampTypes.submitted_type, 'integer')
assert.equal(validTimestampTypes.retain_type, 'integer')
assert.throws(() => insert.run(...validRow), /UNIQUE constraint failed/)

const invalidRows = [
  ['short-ticket-id', 'a'.repeat(64), 'b'.repeat(64), 1_000, 86_401_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['22222222-2222-4222-8222-222222222222', 'A'.repeat(64), 'b'.repeat(64), 1_000, 86_401_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['33333333-3333-4333-8333-333333333333', 'a'.repeat(64), 'b'.repeat(63), 1_000, 86_401_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['44444444-4444-4444-8444-444444444444', 'a'.repeat(64), 'b'.repeat(64), -1, 86_401_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['55555555-5555-4555-8555-555555555555', 'a'.repeat(64), 'b'.repeat(64), 1_000, 1_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['66666666-6666-4666-8666-666666666666', 'a'.repeat(64), 'b'.repeat(64), 1_000, 86_401_000, 'unsupported', '{"ok":true}'],
  ['77777777-7777-4777-8777-777777777777', 'a'.repeat(64), 'b'.repeat(64), 1_000, 86_401_000, 'pennant-draft-submission-v1', 'x'],
  ['88888888-8888-4888-8888-888888888888', 'a'.repeat(64), 'b'.repeat(64), 1_000, 86_401_000, 'pennant-draft-submission-v1', 'x'.repeat(8_193)],
  ['99999999-9999-4999-8999-999999999999', 'a'.repeat(64), 'b'.repeat(64), 1_000.5, 86_401_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a'.repeat(64), 'b'.repeat(64), 1_000, 86_401_000.5, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a'.repeat(64), 'b'.repeat(64), 'not-a-timestamp', 86_401_000, 'pennant-draft-submission-v1', '{"ok":true}'],
  ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'a'.repeat(64), 'b'.repeat(64), 1_000, 'not-a-timestamp', 'pennant-draft-submission-v1', '{"ok":true}'],
]
for (const row of invalidRows) assert.throws(() => insert.run(...row), /CHECK constraint failed/)
assert.equal(fresh.prepare('SELECT count(*) AS count FROM draft_submissions').get().count, 1)
fresh.close()

const upgrade = new DatabaseSync(':memory:')
upgrade.exec(foundationMigration)
assert.equal(schemaVersion(upgrade), 1)
assert.deepEqual(tableNames(upgrade), ['backend_schema'])
upgrade.exec(submissionMigration)
assert.equal(schemaVersion(upgrade), 2)
assert.deepEqual(tableNames(upgrade), ['backend_schema', 'draft_submissions'])
upgrade.close()

const unexpected = new DatabaseSync(':memory:')
unexpected.exec(foundationMigration)
unexpected.prepare('UPDATE backend_schema SET version = 3 WHERE id = 1').run()
assertRejectedPredecessor(unexpected, [{ id: 1, version: 3 }])
unexpected.close()

const missing = new DatabaseSync(':memory:')
missing.exec(foundationMigration)
missing.prepare('DELETE FROM backend_schema WHERE id = 1').run()
assertRejectedPredecessor(missing, [])
missing.close()

const duplicate = new DatabaseSync(':memory:')
duplicate.exec(`
  CREATE TABLE backend_schema (id INTEGER, version INTEGER);
  INSERT INTO backend_schema (id, version) VALUES (1, 1), (1, 1);
`)
assertRejectedPredecessor(duplicate, [{ id: 1, version: 1 }, { id: 1, version: 1 }])
duplicate.close()

const incompatible = new DatabaseSync(':memory:')
incompatible.exec(`
  CREATE TABLE backend_schema (id INTEGER);
  INSERT INTO backend_schema (id) VALUES (1);
`)
assert.throws(() => incompatible.exec(submissionMigration), /no such column: version/)
assert.deepEqual(incompatible.prepare('SELECT id FROM backend_schema').all().map(({ id }) => id), [1])
assertNoSubmissionSchemaObjects(incompatible)
incompatible.close()

console.log('D1C.1 foundation tests passed: guarded fresh/version-1 upgrades, rejected corrupt predecessors, integer constraints, ticket uniqueness, and retention indexing are verified.')
