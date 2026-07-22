import { readdirSync, readFileSync } from 'node:fs'
import { TextDecoder } from 'node:util'
import path from 'node:path'
import { sha256 } from './canonical.mjs'
import { remoteError } from './errors.mjs'

export const MIGRATION_TABLES_SQL = "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('backend_schema', 'd1_migrations') ORDER BY name ASC"
export const MIGRATION_ROWS_SQL = 'SELECT id, name, applied_at FROM d1_migrations ORDER BY id ASC'
export const BACKEND_VERSION_SQL = 'SELECT version FROM backend_schema WHERE id = 1'
const MIGRATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/
const APPLIED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

function leadingMigrationNumber(name) {
  const parsed = Number.parseInt(name.split('_')[0], 10)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

export function compareMigrationNames(left, right) {
  const leftNumber = leadingMigrationNumber(left)
  const rightNumber = leadingMigrationNumber(right)
  if (!Object.is(leftNumber, rightNumber)) {
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
    if (Number.isFinite(leftNumber)) return -1
    if (Number.isFinite(rightNumber)) return 1
  }
  return left < right ? -1 : left > right ? 1 : 0
}

function decodeMigration(bytes, name) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    throw remoteError(`Migration ${name} contains a UTF-8 BOM.`, 'ambiguous_migration_state', 'migration.repository')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw remoteError(`Migration ${name} is not valid UTF-8.`, 'ambiguous_migration_state', 'migration.repository')
  }
}

function validAppliedAt(value) {
  if (typeof value !== 'string') return false
  const match = value.match(APPLIED_AT_PATTERN)
  if (!match) return false
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour && parsed.getUTCMinutes() === minute && parsed.getUTCSeconds() === second
}

export function loadRepositoryMigrations(repositoryRoot, relativeDirectory = 'migrations') {
  const directory = path.join(repositoryRoot, relativeDirectory)
  const names = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
  if (names.some((name) => !MIGRATION_NAME_PATTERN.test(name))) {
    throw remoteError('Repository contains an unsupported Wrangler-applicable migration filename.', 'ambiguous_migration_state', 'migration.repository')
  }
  const normalizedNames = names.map((name) => name.normalize('NFC'))
  if (new Set(normalizedNames).size !== names.length) {
    throw remoteError('Repository migration identities are duplicated after Unicode normalization.', 'ambiguous_migration_state', 'migration.repository')
  }
  return Object.freeze(names
    .sort(compareMigrationNames)
    .map((name, index) => {
      const source = decodeMigration(readFileSync(path.join(directory, name)), name)
      return Object.freeze({ id: index + 1, name, sha256: sha256(source) })
    }))
}

function malformed(reason) {
  return Object.freeze({
    status: 'ambiguous',
    classification: 'ambiguous-malformed',
    applied: [],
    pending: [],
    repositoryIntegrity: 'not-evaluated',
    reason,
  })
}

export function classifyMigrationState({ knownMigrations, tables, rows, backendVersion }) {
  if (!Array.isArray(knownMigrations) || knownMigrations.length === 0) return malformed('Repository migrations are missing.')
  if (!Array.isArray(tables) || tables.some((entry) => typeof entry !== 'string')) return malformed('Migration table inventory is malformed.')
  const tableSet = new Set(tables)
  if (tableSet.size !== tables.length || [...tableSet].some((name) => !['backend_schema', 'd1_migrations'].includes(name))) {
    return malformed('Migration table inventory contains an unexpected value.')
  }
  if (!tableSet.has('d1_migrations')) {
    if (tableSet.has('backend_schema')) {
      return Object.freeze({ ...malformed('Migration metadata is absent while backend_schema exists.'), classification: 'unmanaged-schema' })
    }
    return Object.freeze({
      status: 'valid',
      classification: 'metadata-table-absent',
      applied: [],
      pending: knownMigrations.map(({ id, name, sha256: hash }) => ({ id, name, sha256: hash })),
      backendVersion: tableSet.has('backend_schema') && Number.isInteger(backendVersion) ? backendVersion : null,
      repositoryIntegrity: 'not-verifiable-without-applied-hashes',
      reason: 'The d1_migrations metadata table is absent; no table was created.',
    })
  }
  if (!Array.isArray(rows)) return malformed('Migration metadata rows are missing.')
  const normalized = []
  for (const row of rows) {
    const keys = row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row).sort() : []
    if (!row || typeof row !== 'object' || Array.isArray(row) || ![Object.prototype, null].includes(Object.getPrototypeOf(row))
      || JSON.stringify(keys) !== JSON.stringify(['applied_at', 'id', 'name'])
      || !Number.isInteger(row.id) || row.id < 1 || typeof row.name !== 'string' || !MIGRATION_NAME_PATTERN.test(row.name)) {
      return malformed('Migration metadata contains a malformed row.')
    }
    if (!validAppliedAt(row.applied_at)) {
      return malformed('Migration metadata contains a malformed applied_at value.')
    }
    normalized.push({ id: row.id, name: row.name })
  }
  if (normalized.some((row, index) => index > 0 && row.id <= normalized[index - 1].id)) return malformed('Applied migrations are out of order or duplicated.')
  if (new Set(normalized.map(({ name }) => name)).size !== normalized.length) return malformed('Applied migration names are duplicated.')
  if (normalized.some((row, index) => row.id !== index + 1)) return malformed('Applied migration IDs are not a contiguous prefix.')
  if (normalized.length === 0 && tableSet.has('backend_schema')) {
    return Object.freeze({ ...malformed('Migration metadata is empty while backend_schema exists.'), classification: 'version-mismatch' })
  }
  if (normalized.length > 0 && !tableSet.has('backend_schema')) {
    return Object.freeze({ ...malformed('Applied migrations exist while backend_schema is absent.'), classification: 'version-mismatch' })
  }

  const knownByName = new Map(knownMigrations.map((migration) => [migration.name, migration]))
  for (let index = 0; index < normalized.length; index += 1) {
    const applied = normalized[index]
    const expected = knownMigrations[index]
    if (!knownByName.has(applied.name)) {
      const futureId = leadingMigrationNumber(applied.name)
      const repositoryNumbers = knownMigrations.map(({ name }) => leadingMigrationNumber(name)).filter(Number.isFinite)
      const repositoryMax = repositoryNumbers.length > 0 ? Math.max(...repositoryNumbers) : Number.NaN
      return Object.freeze({
        ...malformed(Number.isFinite(futureId) && Number.isFinite(repositoryMax) && futureId > repositoryMax ? 'Database schema is ahead of the repository.' : `Unknown applied migration ${applied.name}.`),
        classification: Number.isFinite(futureId) && Number.isFinite(repositoryMax) && futureId > repositoryMax ? 'database-ahead' : 'unknown-applied-migration',
      })
    }
    if (!expected || applied.name !== expected.name || applied.id !== expected.id) {
      return Object.freeze({ ...malformed(`Applied migration ${applied.name} has an unexpected name or ordering.`), classification: 'unexpected-order' })
    }
  }

  const applied = normalized.map((row, index) => ({ ...row, sha256: knownMigrations[index].sha256 }))
  const pending = knownMigrations.slice(normalized.length).map(({ id, name, sha256: hash }) => ({ id, name, sha256: hash }))
  const expectedVersion = normalized.length
  if (backendVersion !== null && backendVersion !== undefined && (!Number.isInteger(backendVersion) || backendVersion < 1)) {
    return malformed('backend_schema version is malformed.')
  }
  if (Number.isInteger(backendVersion) && backendVersion > knownMigrations.length) {
    return Object.freeze({ ...malformed('Database schema version is ahead of the repository.'), classification: 'database-ahead' })
  }
  if (normalized.length > 0 && (!Number.isInteger(backendVersion) || backendVersion !== expectedVersion)) {
    return Object.freeze({ ...malformed('backend_schema version does not match applied migrations.'), classification: 'version-mismatch' })
  }
  return Object.freeze({
    status: 'valid',
    classification: normalized.length === 0 ? 'metadata-table-empty' : pending.length === 0 ? 'all-applied' : 'pending-suffix',
    applied,
    pending,
    backendVersion: Number.isInteger(backendVersion) ? backendVersion : null,
    repositoryIntegrity: 'not-verifiable-without-applied-hashes',
    reason: pending.length === 0 ? 'All known migrations are applied in order.' : `${pending.length} known migration(s) form a pending suffix.`,
  })
}

export function assertSelectOnlySql(sql) {
  if (![MIGRATION_TABLES_SQL, MIGRATION_ROWS_SQL, BACKEND_VERSION_SQL].includes(sql)) {
    throw remoteError('Only exact reviewed SELECT-only migration queries are allowed.', 'ambiguous_migration_state', 'migration.read-only-sql')
  }
  const normalized = sql.trim().replace(/\s+/g, ' ')
  if (!/^SELECT\b/i.test(normalized) || /;|\b(?:CREATE|INSERT|UPDATE|DELETE|ALTER|DROP|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(normalized)) {
    throw remoteError('Migration inspection query is not provably SELECT-only.', 'ambiguous_migration_state', 'migration.read-only-sql')
  }
  return normalized
}
