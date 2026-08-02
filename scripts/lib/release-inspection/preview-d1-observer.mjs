import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRepositoryMigrations } from '../preview-release/migrations.mjs'
import {
  allowedKeys,
  assertRecordBudget,
  boundedAscii,
  compareText,
  exactKeys,
  normalizationFail,
  normalizedValue,
  providerPlain,
} from './preview-normalization.mjs'

const MIGRATION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/u
const APPLIED_AT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function queryRows(operation, providerResult) {
  const result = providerPlain(operation, providerResult)
  if (!Array.isArray(result)) {
    normalizationFail(operation, 'malformed', 'invalid-query-result-container')
  }
  if (result.length !== 1) {
    normalizationFail(operation, result.length === 0 ? 'missing' : 'contradictory', 'invalid-query-result-count')
  }
  const statement = allowedKeys(operation, result[0], [
    'success', 'results', 'meta',
  ], ['success', 'results'], 'invalid-query-statement')
  if (statement.success !== true || !Array.isArray(statement.results)) {
    normalizationFail(operation, 'unavailable', 'query-statement-unavailable')
  }
  if (Object.hasOwn(statement, 'meta') && (
    !statement.meta || typeof statement.meta !== 'object' || Array.isArray(statement.meta)
  )) normalizationFail(operation, 'malformed', 'invalid-query-metadata')
  return statement.results
}

export function repositoryMigrationNamesForObservation() {
  const names = loadRepositoryMigrations(REPOSITORY_ROOT).map(({ name }) => name)
  assertRecordBudget('migration-rows', names, 'repository-migration-budget-exceeded')
  return Object.freeze(names)
}

export function normalizeD1Database(providerResult, identity) {
  const operation = 'd1-database'
  const result = providerPlain(operation, providerResult)
  allowedKeys(operation, result, ['uuid', 'name', 'version', 'created_at'], [
    'uuid', 'name',
  ], 'invalid-d1-database')
  if (result.uuid !== (identity.observedDatabaseId ?? identity.databaseId)
    || result.name !== 'pennant-pursuit-preview') {
    normalizationFail(operation, 'contradictory', 'd1-database-identity-mismatch')
  }
  return normalizedValue('preview-d1-database-observation', {
    identity: 'approved-preview-d1',
    name: 'pennant-pursuit-preview',
  })
}

export function normalizeMigrationTableDiscovery(providerResult) {
  const operation = 'migration-table-discovery'
  const rows = queryRows(operation, providerResult)
  if (rows.length > 2) {
    normalizationFail(operation, 'contradictory', 'migration-table-inventory-exceeded')
  }
  const tables = rows.map((row) => {
    exactKeys(operation, row, ['name'], 'invalid-migration-table-row')
    return boundedAscii(operation, row.name, 'invalid-migration-table-name', /^[a-z0-9_]+$/u, 64)
  })
  if (new Set(tables).size !== tables.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-migration-table')
  }
  if (tables.some((table) => !['backend_schema', 'd1_migrations'].includes(table))) {
    normalizationFail(operation, 'contradictory', 'unknown-migration-table')
  }
  tables.sort(compareText)
  return normalizedValue('preview-migration-tables-observation', { tables })
}

function appliedAtMs(operation, value) {
  if (typeof value !== 'string') normalizationFail(operation, 'malformed', 'invalid-migration-timestamp')
  const match = APPLIED_AT.exec(value)
  if (!match) normalizationFail(operation, 'malformed', 'invalid-migration-timestamp')
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    normalizationFail(operation, 'malformed', 'invalid-migration-timestamp')
  }
  const date = new Date(parsed)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    normalizationFail(operation, 'malformed', 'invalid-migration-timestamp')
  }
  return parsed
}

export function normalizeMigrationRows(providerResult, repositoryNames) {
  const operation = 'migration-rows'
  if (!Array.isArray(repositoryNames) || repositoryNames.length === 0
    || repositoryNames.some((name) => typeof name !== 'string' || !MIGRATION_NAME.test(name))) {
    normalizationFail(operation, 'malformed', 'invalid-repository-migration-inventory')
  }
  assertRecordBudget(operation, repositoryNames, 'repository-migration-budget-exceeded')
  const providerRows = queryRows(operation, providerResult)
  if (providerRows.length > repositoryNames.length) {
    normalizationFail(operation, 'contradictory', 'database-ahead-of-repository')
  }
  const rows = providerRows.map((row) => {
    exactKeys(operation, row, ['applied_at', 'id', 'name'], 'invalid-migration-row')
    if (!Number.isSafeInteger(row.id) || row.id < 1
      || typeof row.name !== 'string' || !MIGRATION_NAME.test(row.name)) {
      normalizationFail(operation, 'malformed', 'invalid-migration-row')
    }
    return Object.freeze({
      id: row.id,
      name: row.name.normalize('NFC'),
      appliedAtMs: appliedAtMs(operation, row.applied_at),
      sourceHash: 'unavailable',
    })
  })
  if (new Set(rows.map(({ id }) => id)).size !== rows.length
    || new Set(rows.map(({ name }) => name)).size !== rows.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-migration-row')
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].id !== index + 1) {
      normalizationFail(operation, 'contradictory', 'noncontiguous-migration-ids')
    }
    if (index >= repositoryNames.length) {
      normalizationFail(operation, 'contradictory', 'database-ahead-of-repository')
    }
    if (rows[index].name !== repositoryNames[index]) {
      normalizationFail(
        operation,
        'contradictory',
        repositoryNames.includes(rows[index].name)
          ? 'out-of-order-migration-row' : 'unknown-migration-row',
      )
    }
  }
  return normalizedValue('preview-migration-rows-observation', {
    rows,
    pendingRepositorySuffix: repositoryNames.slice(rows.length),
    appliedSourceHashes: 'unavailable',
  })
}

export function normalizeBackendSchemaVersion(providerResult) {
  const operation = 'backend-schema-version'
  const rows = queryRows(operation, providerResult)
  if (rows.length === 0) normalizationFail(operation, 'missing', 'backend-schema-row-missing')
  if (rows.length !== 1) normalizationFail(operation, 'contradictory', 'duplicate-backend-schema-row')
  const row = allowedKeys(operation, rows[0], ['id', 'version'], ['version'], 'invalid-backend-schema-row')
  if (Object.hasOwn(row, 'id') && row.id !== 1) {
    normalizationFail(operation, 'contradictory', 'backend-schema-singleton-mismatch')
  }
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    normalizationFail(operation, 'malformed', 'invalid-backend-schema-version')
  }
  return normalizedValue('preview-backend-schema-observation', {
    singletonIdentity: 'backend-schema-singleton',
    version: row.version,
  })
}

export function crossCheckD1Bindings(pagesProject, workerSettings, database) {
  const operation = 'd1-database'
  if (database?.identity !== 'approved-preview-d1') {
    normalizationFail(operation, 'contradictory', 'd1-database-cross-check-failed')
  }
  const pageBindings = pagesProject?.bindings?.filter(({ category }) => category === 'd1') ?? []
  const workerBindings = workerSettings?.bindings?.filter(({ category }) => category === 'd1') ?? []
  if (pageBindings.length !== 1 || workerBindings.length !== 1
    || pageBindings[0].target !== database.identity
    || workerBindings[0].target !== database.identity) {
    normalizationFail(operation, 'contradictory', 'required-d1-binding-missing-or-mismatched')
  }
  return true
}
