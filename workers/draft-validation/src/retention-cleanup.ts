import {
  RETENTION_CLEANUP_BATCH_SIZE,
  RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION,
  RETENTION_CLEANUP_MAX_BATCHES,
} from './retention-cleanup-config'

export {
  RETENTION_CLEANUP_BATCH_SIZE,
  RETENTION_CLEANUP_EXPECTED_SCHEMA_VERSION,
  RETENTION_CLEANUP_MAX_BATCHES,
} from './retention-cleanup-config'

export const RETENTION_CLEANUP_SCHEMA_SQL = 'SELECT version FROM backend_schema WHERE id = 1'
export const RETENTION_CLEANUP_DELETE_SQL = `
  DELETE FROM draft_submissions
  WHERE ticket_id IN (
    SELECT ticket_id
    FROM draft_submissions
    WHERE retain_until_ms <= ?
    ORDER BY retain_until_ms, ticket_id
    LIMIT ${RETENTION_CLEANUP_BATCH_SIZE}
  )
`
export const RETENTION_CLAIM_CLEANUP_DELETE_SQL = `
  DELETE FROM leaderboard_identity_claims
  WHERE claim_id IN (
    SELECT claim_id
    FROM leaderboard_identity_claims
    WHERE expires_at_ms <= ?
    ORDER BY expires_at_ms, claim_id
    LIMIT ${RETENTION_CLEANUP_BATCH_SIZE}
  )
`
export const RETENTION_RECOVERY_OPERATION_CLEANUP_DELETE_SQL = `
  DELETE FROM leaderboard_recovery_operations
  WHERE operation_digest IN (
    SELECT operation_digest
    FROM leaderboard_recovery_operations
    WHERE expires_at_ms <= ?
    ORDER BY expires_at_ms, operation_digest
    LIMIT ${RETENTION_CLEANUP_BATCH_SIZE}
  )
`

export type RetentionCleanupOutcome = 'cleanup.completed' | 'cleanup.backlog' | 'cleanup.failed'

export interface RetentionCleanupObservation {
  readonly event: 'draft_submission'
  readonly outcome: RetentionCleanupOutcome
  readonly batchesCompleted: number
  readonly rowsDeleted: number
  readonly claimsDeleted: number
  readonly recoveryOperationsDeleted: number
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
  claimsDeleted: number,
  recoveryOperationsDeleted: number,
): RetentionCleanupObservation {
  return Object.freeze({
    event: 'draft_submission',
    outcome,
    batchesCompleted,
    rowsDeleted,
    claimsDeleted,
    recoveryOperationsDeleted,
  })
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
  let claimsDeleted = 0
  let recoveryOperationsDeleted = 0

  try {
    const cutoffMs = sources.now()
    if (!Number.isSafeInteger(cutoffMs) || cutoffMs < 0) throw new RetentionCleanupFailure()

    const database = bindings.DB
    if (!database || !await databaseSchemaIsReady(database)) throw new RetentionCleanupFailure()

    let receiptsComplete = false
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
        receiptsComplete = true
        break
      }
    }

    let claimsComplete = false
    for (let batch = 0; batch < RETENTION_CLEANUP_MAX_BATCHES; batch += 1) {
      const result: unknown = await database
        .prepare(RETENTION_CLAIM_CLEANUP_DELETE_SQL)
        .bind(cutoffMs)
        .run()
      const changes = resultChanges(result)
      if (changes === null) throw new RetentionCleanupFailure()

      batchesCompleted += 1
      claimsDeleted += changes
      if (changes < RETENTION_CLEANUP_BATCH_SIZE) {
        claimsComplete = true
        break
      }
    }

    let recoveryOperationsComplete = false
    for (let batch = 0; batch < RETENTION_CLEANUP_MAX_BATCHES; batch += 1) {
      const result: unknown = await database
        .prepare(RETENTION_RECOVERY_OPERATION_CLEANUP_DELETE_SQL)
        .bind(cutoffMs)
        .run()
      const changes = resultChanges(result)
      if (changes === null) throw new RetentionCleanupFailure()

      batchesCompleted += 1
      recoveryOperationsDeleted += changes
      if (changes < RETENTION_CLEANUP_BATCH_SIZE) {
        recoveryOperationsComplete = true
        break
      }
    }

    const outcome = receiptsComplete && claimsComplete && recoveryOperationsComplete
      ? 'cleanup.completed'
      : 'cleanup.backlog'
    const observation = cleanupObservation(
      outcome,
      batchesCompleted,
      rowsDeleted,
      claimsDeleted,
      recoveryOperationsDeleted,
    )
    sources.observe(observation)
    return observation
  } catch {
    const observation = cleanupObservation(
      'cleanup.failed',
      batchesCompleted,
      rowsDeleted,
      claimsDeleted,
      recoveryOperationsDeleted,
    )
    try {
      sources.observe(observation)
    } catch {
      // The cleanup failure below remains authoritative and preserves retry.
    }
    throw new RetentionCleanupFailure()
  }
}
