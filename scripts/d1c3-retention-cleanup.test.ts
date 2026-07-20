import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker, { type PrivateValidationWorkerEnv } from '../workers/draft-validation/src/index'
import {
  cleanupRetainedDraftSubmissions,
  RETENTION_CLEANUP_BATCH_SIZE,
  RETENTION_CLEANUP_DELETE_SQL,
  RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION,
  RETENTION_CLEANUP_MAX_BATCHES,
  RETENTION_CLEANUP_SCHEMA_SQL,
  RetentionCleanupFailure,
  type RetentionCleanupObservation,
} from '../workers/draft-validation/src/retention-cleanup'

const NOW = 1_800_000_000_000
const CRON = '17 * * * *'
const PROHIBITED_LOG_DATA = /ticket_id|draft_id|token|digest|receipt|stack|secret|binding|sql|private D1 failure/i

function successfulRun(changes: number) {
  return { success: true, meta: { changes }, results: [] }
}

class PlannedStatement {
  private bindings: unknown[] = []

  constructor(private readonly database: PlannedDatabase, private readonly query: string) {}

  bind(...values: unknown[]) {
    this.bindings = values
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.database.first(this.query) as T | null
  }

  async run() {
    return this.database.run(this.query, this.bindings)
  }
}

class PlannedDatabase {
  schemaRow: unknown = { version: RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION }
  schemaFailure: unknown = undefined
  readonly queries: string[] = []
  readonly deleteBindings: unknown[][] = []
  runCalls = 0

  constructor(readonly runPlan: Array<unknown | Error | (() => unknown | Promise<unknown>)> = []) {}

  prepare(query: string) {
    this.queries.push(query)
    return new PlannedStatement(this, query)
  }

  first(query: string) {
    assert.equal(query, RETENTION_CLEANUP_SCHEMA_SQL)
    if (this.schemaFailure !== undefined) throw this.schemaFailure
    return this.schemaRow
  }

  async run(query: string, bindings: unknown[]) {
    assert.equal(query, RETENTION_CLEANUP_DELETE_SQL)
    this.deleteBindings.push([...bindings])
    const step = this.runPlan[this.runCalls]
    this.runCalls += 1
    if (step instanceof Error) throw step
    if (typeof step === 'function') return step()
    return step ?? successfulRun(0)
  }
}

class SqliteStatement {
  private bindings: unknown[] = []

  constructor(private readonly database: SqliteD1Database, private readonly query: string) {}

  bind(...values: unknown[]) {
    this.bindings = values
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.sqlite.prepare(this.query).get(...this.bindings) ?? null) as T | null
  }

  async run() {
    assert.equal(this.query, RETENTION_CLEANUP_DELETE_SQL)
    const cutoff = this.bindings[0]
    assert.equal(typeof cutoff, 'number')
    const selected = this.database.sqlite.prepare(`
      SELECT ticket_id
      FROM draft_submissions
      WHERE retain_until_ms <= ?
      ORDER BY retain_until_ms, ticket_id
      LIMIT ${RETENTION_CLEANUP_BATCH_SIZE}
    `).all(cutoff) as Array<{ ticket_id: string }>
    this.database.selectedBatches.push(selected.map(({ ticket_id }) => ticket_id))
    this.database.deleteCalls += 1
    if (this.database.failOnDeleteCall === this.database.deleteCalls) {
      throw new Error('private D1 failure with ticket_id and SQL details')
    }
    const result = this.database.sqlite.prepare(this.query).run(...this.bindings)
    return successfulRun(Number(result.changes))
  }
}

class SqliteD1Database {
  readonly selectedBatches: string[][] = []
  deleteCalls = 0
  failOnDeleteCall: number | null = null

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string) {
    return new SqliteStatement(this, query)
  }
}

function bindings(database?: PlannedDatabase | SqliteD1Database) {
  return { DB: database as D1Database | undefined }
}

function observationSources(now: () => number = () => NOW) {
  const observations: RetentionCleanupObservation[] = []
  return {
    observations,
    sources: {
      now,
      observe(observation: RetentionCleanupObservation) {
        observations.push(structuredClone(observation))
      },
    },
  }
}

async function expectFailure(
  promise: Promise<unknown>,
  observations: RetentionCleanupObservation[],
  expected: Partial<RetentionCleanupObservation> = {},
) {
  await assert.rejects(promise, (error: unknown) => {
    assert(error instanceof RetentionCleanupFailure)
    assert.equal(error.message, 'Draft submission retention cleanup failed.')
    assert.equal(error.cause, undefined)
    assert.doesNotMatch(error.message, PROHIBITED_LOG_DATA)
    return true
  })
  assert.equal(observations.length, 1)
  assert.deepEqual(observations[0], {
    event: 'draft_submission',
    outcome: 'cleanup.failed',
    batchesCompleted: 0,
    rowsDeleted: 0,
    ...expected,
  })
  assert.doesNotMatch(JSON.stringify(observations), PROHIBITED_LOG_DATA)
}

function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync('migrations/0001_backend_foundation.sql', 'utf8'))
  sqlite.exec(readFileSync('migrations/0002_draft_submissions.sql', 'utf8'))
  sqlite.exec('CREATE TABLE unrelated_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
  sqlite.prepare('INSERT INTO unrelated_records (id, value) VALUES (?, ?)').run(1, 'preserve')
  return sqlite
}

function insertSubmission(
  sqlite: DatabaseSync,
  ticketId: string,
  submittedAtMs: number,
  retainUntilMs: number,
) {
  sqlite.prepare(`
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
    ticketId,
    'a'.repeat(64),
    'b'.repeat(64),
    submittedAtMs,
    retainUntilMs,
    'pennant-draft-submission-v1',
    '{}',
  )
}

function remainingTicketIds(sqlite: DatabaseSync) {
  return (sqlite.prepare('SELECT ticket_id FROM draft_submissions ORDER BY ticket_id').all() as Array<{ ticket_id: string }>)
    .map(({ ticket_id }) => ticket_id)
}

assert.equal(RETENTION_CLEANUP_BATCH_SIZE, 500)
assert.equal(RETENTION_CLEANUP_MAX_BATCHES, 10)
assert.equal(RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION, 2)
assert.match(RETENTION_CLEANUP_DELETE_SQL, /WHERE retain_until_ms <= \?/)
assert.match(RETENTION_CLEANUP_DELETE_SQL, /ORDER BY retain_until_ms, ticket_id/)
assert.match(RETENTION_CLEANUP_DELETE_SQL, new RegExp(`LIMIT ${RETENTION_CLEANUP_BATCH_SIZE}`))
const retentionCleanupSource = readFileSync('workers/draft-validation/src/retention-cleanup.ts', 'utf8')
assert.match(retentionCleanupSource, /LIMIT \$\{RETENTION_CLEANUP_BATCH_SIZE\}/)
assert.doesNotMatch(retentionCleanupSource, /LIMIT 500/)
assert.equal((RETENTION_CLEANUP_DELETE_SQL.match(/DELETE FROM/g) ?? []).length, 1)
assert.match(RETENTION_CLEANUP_DELETE_SQL, /DELETE FROM draft_submissions/)
assert.doesNotMatch(RETENTION_CLEANUP_DELETE_SQL, /submitted_at_ms|backend_schema|unrelated_records/)

// The real SQLite statement uses only the stored, inclusive retention cutoff.
{
  const sqlite = migratedDatabase()
  const database = new SqliteD1Database(sqlite)
  const oldest = '00000000-0000-4000-8000-000000000001'
  const equalA = '00000000-0000-4000-8000-00000000000a'
  const equalB = '00000000-0000-4000-8000-00000000000b'
  const future = '00000000-0000-4000-8000-00000000000c'
  const oldButRetained = '00000000-0000-4000-8000-00000000000d'
  insertSubmission(sqlite, equalB, NOW - 20, NOW)
  insertSubmission(sqlite, oldest, NOW - 30, NOW - 1)
  insertSubmission(sqlite, equalA, NOW - 20, NOW)
  insertSubmission(sqlite, future, NOW - 20, NOW + 1)
  insertSubmission(sqlite, oldButRetained, 1, NOW + 10_000)
  const { observations, sources } = observationSources()

  const result = await cleanupRetainedDraftSubmissions(bindings(database), sources)

  assert.deepEqual(result, {
    event: 'draft_submission',
    outcome: 'cleanup.completed',
    batchesCompleted: 1,
    rowsDeleted: 3,
  })
  assert.deepEqual(observations, [result])
  assert.deepEqual(database.selectedBatches, [[oldest, equalA, equalB]])
  assert.deepEqual(remainingTicketIds(sqlite), [future, oldButRetained])
  assert.deepEqual(
    sqlite.prepare('SELECT * FROM unrelated_records').all().map((row) => ({ ...row })),
    [{ id: 1, value: 'preserve' }],
  )
  assert.deepEqual(
    { ...sqlite.prepare('SELECT version FROM backend_schema WHERE id = 1').get() },
    { version: 2 },
  )
  sqlite.close()
}

// Bounded sequential batching, exact-500 continuation, one clock sample, and backlog.
for (const [plan, expected] of [
  [[successfulRun(0)], { outcome: 'cleanup.completed', batchesCompleted: 1, rowsDeleted: 0 }],
  [[successfulRun(73)], { outcome: 'cleanup.completed', batchesCompleted: 1, rowsDeleted: 73 }],
  [[successfulRun(500), successfulRun(0)], { outcome: 'cleanup.completed', batchesCompleted: 2, rowsDeleted: 500 }],
  [[successfulRun(500), successfulRun(17)], { outcome: 'cleanup.completed', batchesCompleted: 2, rowsDeleted: 517 }],
] as const) {
  const database = new PlannedDatabase([...plan])
  let clockCalls = 0
  const { observations, sources } = observationSources(() => {
    clockCalls += 1
    return NOW
  })
  const result = await cleanupRetainedDraftSubmissions(bindings(database), sources)
  assert.deepEqual(result, { event: 'draft_submission', ...expected })
  assert.deepEqual(observations, [result])
  assert.equal(database.runCalls, expected.batchesCompleted)
  assert.equal(clockCalls, 1)
  assert.deepEqual(database.deleteBindings, Array.from({ length: expected.batchesCompleted }, () => [NOW]))
}

// Both inclusive safe-integer boundaries are valid, sampled once, and bound exactly.
for (const cutoff of [0, Number.MAX_SAFE_INTEGER]) {
  const database = new PlannedDatabase([successfulRun(0)])
  let clockCalls = 0
  const { observations, sources } = observationSources(() => {
    clockCalls += 1
    return cutoff
  })
  const result = await cleanupRetainedDraftSubmissions(bindings(database), sources)
  assert.deepEqual(result, {
    event: 'draft_submission',
    outcome: 'cleanup.completed',
    batchesCompleted: 1,
    rowsDeleted: 0,
  })
  assert.deepEqual(observations, [result])
  assert.equal(clockCalls, 1)
  assert.equal(database.runCalls, 1)
  assert.deepEqual(database.deleteBindings, [[cutoff]])
}

{
  const database = new PlannedDatabase(Array.from({ length: 11 }, () => successfulRun(500)))
  let clockCalls = 0
  const { observations, sources } = observationSources(() => {
    clockCalls += 1
    return NOW
  })
  const result = await cleanupRetainedDraftSubmissions(bindings(database), sources)
  assert.deepEqual(result, {
    event: 'draft_submission',
    outcome: 'cleanup.backlog',
    batchesCompleted: 10,
    rowsDeleted: 5_000,
  })
  assert.deepEqual(observations, [result])
  assert.equal(database.runCalls, 10)
  assert.equal(clockCalls, 1)
  assert.deepEqual(database.deleteBindings, Array.from({ length: 10 }, () => [NOW]))
}

// Invalid time, missing bindings, and incompatible schemas fail before deletion.
for (const cutoff of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
  const database = new PlannedDatabase()
  const { observations, sources } = observationSources(() => cutoff)
  await expectFailure(cleanupRetainedDraftSubmissions(bindings(database), sources), observations)
  assert.equal(database.queries.length, 0)
}

{
  const { observations, sources } = observationSources()
  await expectFailure(cleanupRetainedDraftSubmissions({}, sources), observations)
}

for (const schemaRow of [null, {}, { version: 1 }, { version: 3 }, { version: '2' }]) {
  const database = new PlannedDatabase()
  database.schemaRow = schemaRow
  const { observations, sources } = observationSources()
  await expectFailure(cleanupRetainedDraftSubmissions(bindings(database), sources), observations)
  assert.equal(database.runCalls, 0)
}

{
  const database = new PlannedDatabase([successfulRun(0)])
  database.schemaFailure = Object.freeze({
    message: 'schema rejection sentinel',
    stack: 'schema stack sentinel',
    context: { ticket_id: 'private-schema-row' },
  })
  const { observations, sources } = observationSources()
  await expectFailure(cleanupRetainedDraftSubmissions(bindings(database), sources), observations)
  assert.deepEqual(database.queries, [RETENTION_CLEANUP_SCHEMA_SQL])
  assert.equal(database.runCalls, 0)
  assert.deepEqual(database.deleteBindings, [])
  assert.doesNotMatch(
    JSON.stringify(observations),
    /schema rejection sentinel|schema stack sentinel|private-schema-row/,
  )
}

// Rejections and every malformed D1 result stop immediately and fail closed.
for (const invalidResult of [
  { success: false, meta: { changes: 0 } },
  { success: true },
  { success: true, meta: null },
  { success: true, meta: {} },
  { success: true, meta: { changes: 0.5 } },
  { success: true, meta: { changes: -1 } },
  { success: true, meta: { changes: 501 } },
  { success: true, meta: { changes: '1' } },
] as const) {
  const database = new PlannedDatabase([invalidResult, successfulRun(0)])
  const { observations, sources } = observationSources()
  await expectFailure(cleanupRetainedDraftSubmissions(bindings(database), sources), observations)
  assert.equal(database.runCalls, 1)
}

{
  const database = new PlannedDatabase([new Error('private D1 failure with ticket_id and SQL details'), successfulRun(0)])
  const { observations, sources } = observationSources()
  await expectFailure(cleanupRetainedDraftSubmissions(bindings(database), sources), observations)
  assert.equal(database.runCalls, 1)
}

// A later failed DELETE preserves earlier commits, and the next run resumes.
{
  const sqlite = migratedDatabase()
  const database = new SqliteD1Database(sqlite)
  sqlite.exec('BEGIN')
  for (let index = 0; index < 501; index += 1) {
    insertSubmission(
      sqlite,
      `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      NOW - 10,
      NOW,
    )
  }
  sqlite.exec('COMMIT')
  database.failOnDeleteCall = 2
  const failed = observationSources()
  await expectFailure(
    cleanupRetainedDraftSubmissions(bindings(database), failed.sources),
    failed.observations,
    { batchesCompleted: 1, rowsDeleted: 500 },
  )
  assert.equal(remainingTicketIds(sqlite).length, 1)

  database.failOnDeleteCall = null
  database.deleteCalls = 0
  const resumed = observationSources()
  const result = await cleanupRetainedDraftSubmissions(bindings(database), resumed.sources)
  assert.deepEqual(result, {
    event: 'draft_submission',
    outcome: 'cleanup.completed',
    batchesCompleted: 1,
    rowsDeleted: 1,
  })
  assert.deepEqual(remainingTicketIds(sqlite), [])
  sqlite.close()
}

// The default scheduled handler awaits cleanup and leaves retry enabled on failure.
{
  let resolveRun: ((value: unknown) => void) | undefined
  let signalRunStarted: (() => void) | undefined
  const runStarted = new Promise<void>((resolve) => { signalRunStarted = resolve })
  const delayedResult = new Promise<unknown>((resolve) => { resolveRun = resolve })
  const database = new PlannedDatabase([() => {
    signalRunStarted?.()
    return delayedResult
  }])
  let noRetryCalls = 0
  const controller = {
    scheduledTime: 0,
    cron: CRON,
    noRetry() { noRetryCalls += 1 },
  } as ScheduledController
  const environment = {
    DB: database,
    DRAFT_VALIDATION_MODE: 'enabled',
    DRAFT_TICKET_MODE: 'enabled',
    DRAFT_SUBMISSION_MODE: 'disabled',
    RATE_LIMIT_BURST: { async limit() { return { success: true } } },
    RATE_LIMIT_SUSTAINED: { async limit() { return { success: true } } },
  } as PrivateValidationWorkerEnv
  const logged: string[] = []
  const originalLog = console.log
  console.log = (value?: unknown) => { logged.push(String(value)) }
  try {
    let settled = false
    const scheduled = worker.scheduled(controller, environment).finally(() => { settled = true })
    await runStarted
    await Promise.resolve()
    assert.equal(settled, false)
    resolveRun?.(successfulRun(0))
    await scheduled
    assert.equal(settled, true)
  } finally {
    console.log = originalLog
  }
  assert.equal(noRetryCalls, 0)
  assert.deepEqual(logged.map((value) => JSON.parse(value)), [{
    event: 'draft_submission',
    outcome: 'cleanup.completed',
    batchesCompleted: 1,
    rowsDeleted: 0,
  }])
  assert.doesNotMatch(logged.join('\n'), PROHIBITED_LOG_DATA)

  const failedDatabase = new PlannedDatabase([new Error('private D1 failure with ticket_id and SQL details')])
  const failedEnvironment = { ...environment, DB: failedDatabase } as PrivateValidationWorkerEnv
  const errors: string[] = []
  const originalError = console.error
  console.error = (value?: unknown) => { errors.push(String(value)) }
  try {
    await assert.rejects(worker.scheduled(controller, failedEnvironment), RetentionCleanupFailure)
  } finally {
    console.error = originalError
  }
  assert.equal(noRetryCalls, 0)
  assert.deepEqual(errors.map((value) => JSON.parse(value)), [{
    event: 'draft_submission',
    outcome: 'cleanup.failed',
    batchesCompleted: 0,
    rowsDeleted: 0,
  }])
  assert.doesNotMatch(errors.join('\n'), PROHIBITED_LOG_DATA)
}

// Repository configuration remains disabled, private, preview-only, and unscheduled by default.
{
  const workerConfig = readFileSync('workers/draft-validation/wrangler.toml', 'utf8')
  const pagesConfig = readFileSync('wrangler.toml', 'utf8')
  const indexSource = readFileSync('workers/draft-validation/src/index.ts', 'utf8')
  assert.equal((workerConfig.match(/^\[triggers\]$/gm) ?? []).length, 1)
  assert.equal((workerConfig.match(/^crons = \["17 \* \* \* \*"\]$/gm) ?? []).length, 0)
  assert.equal((workerConfig.match(/^\[env\.production\.triggers\]$/gm) ?? []).length, 1)
  assert.equal((workerConfig.match(/^crons = \[\]$/gm) ?? []).length, 2)
  assert.equal((workerConfig.match(/^DRAFT_SUBMISSION_MODE = "disabled"$/gm) ?? []).length, 2)
  assert.equal((workerConfig.match(/^DRAFT_SUBMISSION_MODE = "enabled"$/gm) ?? []).length, 0)
  assert.equal((workerConfig.match(/^DRAFT_TICKET_MODE = "enabled"$/gm) ?? []).length, 1)
  assert.equal((workerConfig.match(/^DRAFT_TICKET_MODE = "disabled"$/gm) ?? []).length, 1)
  assert.equal((workerConfig.match(/^\[\[d1_databases\]\]$/gm) ?? []).length, 1)
  assert.equal((workerConfig.match(/^\[\[env\.production\.d1_databases\]\]$/gm) ?? []).length, 0)
  assert.equal((workerConfig.match(/^workers_dev = false$/gm) ?? []).length, 2)
  assert.equal((workerConfig.match(/^preview_urls = false$/gm) ?? []).length, 2)
  assert.doesNotMatch(pagesConfig, /^\[triggers\]$|^crons\s*=/m)
  assert.doesNotMatch(indexSource, /cleanup[^\n]*(?:pathname|api\/v1)|(?:pathname|api\/v1)[^\n]*cleanup/i)

  const response = await worker.fetch(new Request('https://private.example.test/api/v1/retention-cleanup'), {} as PrivateValidationWorkerEnv)
  assert.equal(response.status, 404)
}

console.log('D1C.3 retention cleanup tests passed: inclusive eligibility, deterministic bounded batches, resumable failure, sanitized observability, awaited scheduling, and preview-only Cron isolation are verified.')
