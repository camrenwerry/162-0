export const RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION = 2
export const RETENTION_CLEANUP_BATCH_SIZE = 500
export const RETENTION_CLEANUP_MAX_BATCHES = 10

export const RETENTION_CLEANUP_SCHEMA_SQL = 'SELECT version FROM backend_schema WHERE id = 1'
export const RETENTION_CLEANUP_DELETE_SQL = `
  DELETE FROM draft_submissions
  WHERE ticket_id IN (
    SELECT ticket_id
    FROM draft_submissions
    WHERE retain_until_ms <= ?
    ORDER BY retain_until_ms, ticket_id
    LIMIT 500
  )
`

export type RetentionCleanupOutcome = 'cleanup.completed' | 'cleanup.backlog' | 'cleanup.failed'

export interface RetentionCleanupObservation {
  readonly event: 'draft_submission'
  readonly outcome: RetentionCleanupOutcome
  readonly batchesCompleted: number
  readonly rowsDeleted: number
}

interface RetentionCleanupBindings {
  readonly DB?: D1Database
}

interface RetentionCleanupSources {
  readonly now: () => number
  readonly observe: (observation: RetentionCleanupObservation) => void
}

export class RetentionCleanupFailure extends Error {
  constructor() {
    super('Draft submission retention cleanup failed.')
    this.name = 'RetentionCleanupFailure'
  }
}

function defaultObserve(observation: RetentionCleanupObservation) {
  const serialized = JSON.stringify(observation)
  if (observation.outcome === 'cleanup.failed') console.error(serialized)
  else console.log(serialized)
}

const defaultSources: RetentionCleanupSources = Object.freeze({
  now: () => Date.now(),
  observe: defaultObserve,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanupObservation(
  outcome: RetentionCleanupOutcome,
  batchesCompleted: number,
  rowsDeleted: number,
): RetentionCleanupObservation {
  return Object.freeze({ event: 'draft_submission', outcome, batchesCompleted, rowsDeleted })
}

function resultChanges(value: unknown) {
  if (!isRecord(value) || value.success !== true || !isRecord(value.meta)) return null
  const changes = value.meta.changes
  if (
    typeof changes !== 'number'
    || !Number.isInteger(changes)
    || changes < 0
    || changes > RETENTION_CLEANUP_BATCH_SIZE
  ) return null
  return changes
}

async function databaseSchemaIsReady(database: D1Database) {
  const row: unknown = await database.prepare(RETENTION_CLEANUP_SCHEMA_SQL).first()
  return isRecord(row) && row.version === RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION
}

/**
 * Deletes only rows whose stored retention deadline has elapsed. Each DELETE is
 * committed independently so a later failure can resume from prior progress.
 */
export async function cleanupRetainedDraftSubmissions(
  bindings: RetentionCleanupBindings,
  sourceOverrides: Partial<RetentionCleanupSources> = {},
) {
  const sources: RetentionCleanupSources = { ...defaultSources, ...sourceOverrides }
  let batchesCompleted = 0
  let rowsDeleted = 0

  try {
    const cutoffMs = sources.now()
    if (!Number.isSafeInteger(cutoffMs) || cutoffMs < 0) throw new RetentionCleanupFailure()

    const database = bindings.DB
    if (!database || !await databaseSchemaIsReady(database)) throw new RetentionCleanupFailure()

    for (let batch = 0; batch < RETENTION_CLEANUP_MAX_BATCHES; batch += 1) {
      const result: unknown = await database
        .prepare(RETENTION_CLEANUP_DELETE_SQL)
        .bind(cutoffMs)
        .run()
      const changes = resultChanges(result)
      if (changes === null) throw new RetentionCleanupFailure()

      batchesCompleted += 1
      rowsDeleted += changes
      if (changes < RETENTION_CLEANUP_BATCH_SIZE) {
        const observation = cleanupObservation('cleanup.completed', batchesCompleted, rowsDeleted)
        sources.observe(observation)
        return observation
      }
    }

    const observation = cleanupObservation('cleanup.backlog', batchesCompleted, rowsDeleted)
    sources.observe(observation)
    return observation
  } catch {
    const observation = cleanupObservation('cleanup.failed', batchesCompleted, rowsDeleted)
    try {
      sources.observe(observation)
    } catch {
      // The cleanup failure below remains authoritative and preserves retry.
    }
    throw new RetentionCleanupFailure()
  }
}
