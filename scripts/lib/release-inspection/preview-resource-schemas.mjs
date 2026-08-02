import { types as utilTypes } from 'node:util'
import { immutablePlain } from '../preview-release/canonical-data.mjs'
import { PREVIEW_OBSERVATION_LIMITS } from './preview-observation-limits.mjs'

const isProxy = utilTypes.isProxy
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const ORIGIN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const PAGES_PLAIN_TEXT_BINDING_NAMES = new Set([
  'DRAFT_VALIDATION_MODE',
  'DRAFT_TICKET_MODE',
  'LEADERBOARD_ENVIRONMENT',
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
])
const WORKER_PLAIN_TEXT_BINDING_NAMES = new Set([
  'DRAFT_VALIDATION_MODE',
  'DRAFT_TICKET_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
  'RETENTION_CLEANUP_MODE',
])
const EXPECTED_KIND = Object.freeze({
  account: 'preview-account-observation',
  'account-zones': 'preview-account-zones-observation',
  'pages-project': 'preview-pages-project-observation',
  'pages-preview-deployments': 'preview-pages-deployments-observation',
  'worker-settings': 'preview-worker-settings-observation',
  'worker-deployments': 'preview-worker-deployments-observation',
  'worker-subdomain': 'preview-worker-public-urls-observation',
  'worker-schedules': 'preview-worker-schedules-observation',
  'worker-custom-domains': 'preview-worker-custom-domains-observation',
  'worker-routes': 'preview-worker-routes-observation',
  'd1-database': 'preview-d1-database-observation',
  'migration-table-discovery': 'preview-migration-tables-observation',
  'migration-rows': 'preview-migration-rows-observation',
  'backend-schema-version': 'preview-backend-schema-observation',
})

function fail() {
  throw new TypeError('Preview single-read contract refused: normalized resource value is invalid.')
}

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)
    || Reflect.getPrototypeOf(value) !== Object.prototype) fail()
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail()
  return value
}

function array(value, validator, maximum = PREVIEW_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
  if (!Array.isArray(value)
    || value.length > maximum) fail()
  value.forEach(validator)
}

function text(value, pattern = SAFE, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || !pattern.test(value)) fail()
}

function nullableText(value, pattern = SAFE, maximum = 512) {
  if (value !== null) text(value, pattern, maximum)
}

function nullableCalendarDate(value) {
  if (value === null) return
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) fail()
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) fail()
}

function validCronField(field, minimum, maximum) {
  if (!/^[0-9*,/-]+$/u.test(field)) return false
  for (const segment of field.split(',')) {
    if (segment.length === 0) return false
    const stepParts = segment.split('/')
    if (stepParts.length > 2 || stepParts.some((part) => part.length === 0)) return false
    const [range, step] = stepParts
    if (step !== undefined) {
      const stepNumber = Number(step)
      if (!/^\d+$/u.test(step) || !Number.isSafeInteger(stepNumber) || stepNumber < 1) return false
    }
    if (range === '*') continue
    const parts = range.split('-')
    if (parts.length > 2 || parts.some((part) => !/^\d+$/u.test(part))) return false
    const numbers = parts.map(Number)
    if (numbers.some((number) => number < minimum || number > maximum)) return false
    if (numbers.length === 2 && numbers[0] > numbers[1]) return false
  }
  return true
}

function validCronExpression(value) {
  if (typeof value !== 'string' || /[^\x20-\x7E]/u.test(value) || value.startsWith('@')) return false
  const fields = value.split(' ')
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  return fields.length === 5 && fields.every((field, index) => validCronField(
    field,
    ranges[index][0],
    ranges[index][1],
  ))
}

function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail()
}

function base(value, kind, keys) {
  record(value, ['kind', 'schemaVersion', ...keys])
  if (value.kind !== kind || value.schemaVersion !== 1) fail()
}

function binding(value, surface) {
  if (!value || typeof value !== 'object') fail()
  const category = value.category
  if (category === 'plain-text-gate') {
    record(value, ['category', 'name', 'value'])
    const approvedNames = surface === 'pages'
      ? PAGES_PLAIN_TEXT_BINDING_NAMES
      : WORKER_PLAIN_TEXT_BINDING_NAMES
    if (!approvedNames.has(value.name)) fail()
    if (!['disabled', 'enabled'].includes(value.value)) fail()
  } else if (category === 'd1') {
    record(value, ['category', 'name', 'target'])
    if (value.name !== 'DB' || value.target !== 'approved-preview-d1') fail()
  } else if (category === 'service') {
    record(value, ['category', 'name', 'target'])
    if (value.name !== 'VALIDATION_SERVICE' || value.target !== 'approved-preview-worker') fail()
  } else if (category === 'rate-limit') {
    if (surface !== 'worker') fail()
    record(value, ['category', 'name', 'target', 'limit', 'periodSeconds'])
    const expectedTarget = value.name === 'RATE_LIMIT_BURST'
      ? 'preview-rate-limit-burst'
      : value.name === 'RATE_LIMIT_SUSTAINED'
        ? 'preview-rate-limit-sustained'
        : null
    if (expectedTarget === null || value.target !== expectedTarget) fail()
    integer(value.limit); integer(value.periodSeconds)
    if (value.limit < 1 || value.periodSeconds < 1) fail()
  } else fail()
}

function pagesProject(value) {
  base(value, EXPECTED_KIND['pages-project'], [
    'identity', 'compatibilityDate', 'compatibilityFlags', 'wranglerConfigurationHash',
    'variables', 'bindings',
  ])
  if (value.identity !== 'approved-preview-pages-project') fail()
  nullableCalendarDate(value.compatibilityDate)
  nullableText(value.wranglerConfigurationHash, /^[0-9a-f]{64}$/u, 64)
  array(value.compatibilityFlags, (flag) => text(flag, /^[a-z0-9_-]+$/u, 64))
  array(value.variables, (entry) => {
    record(entry, ['name', 'value'])
    if (!PAGES_PLAIN_TEXT_BINDING_NAMES.has(entry.name)
      || !['disabled', 'enabled', 'preview'].includes(entry.value)) fail()
  }, PAGES_PLAIN_TEXT_BINDING_NAMES.size)
  array(value.bindings, (entry) => binding(entry, 'pages'), 2)
  if (new Set(value.bindings.map(({ name }) => name)).size !== value.bindings.length) fail()
}

function pagesDeployments(value) {
  base(value, EXPECTED_KIND['pages-preview-deployments'], ['latestIdentity', 'deployments'])
  text(value.latestIdentity)
  let aliasRecordCount = 0
  array(value.deployments, (entry) => {
    record(entry, [
      'identity', 'environment', 'targetBranch', 'createdAtMs', 'commitHash', 'stage',
      'previewOrigin', 'aliases',
    ])
    text(entry.identity); integer(entry.createdAtMs)
    if (entry.environment !== 'preview' || entry.targetBranch !== 'develop') fail()
    nullableText(entry.commitHash, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u, 64)
    record(entry.stage, ['name', 'status']); text(entry.stage.name); text(entry.stage.status)
    text(entry.previewOrigin, ORIGIN, 261)
    array(entry.aliases, (alias) => text(alias, ORIGIN, 261))
    aliasRecordCount += entry.aliases.length
    if (aliasRecordCount > PREVIEW_OBSERVATION_LIMITS.maximumRecordsPerFamily) fail()
  })
}

function workerSettings(value) {
  base(value, EXPECTED_KIND['worker-settings'], [
    'compatibilityDate', 'compatibilityFlags', 'secretPresence', 'bindings',
  ])
  nullableCalendarDate(value.compatibilityDate)
  if (value.secretPresence !== 'unavailable') fail()
  array(value.compatibilityFlags, (flag) => text(flag, /^[a-z0-9_-]+$/u, 64))
  array(value.bindings, (entry) => binding(entry, 'worker'), WORKER_PLAIN_TEXT_BINDING_NAMES.size + 4)
  if (new Set(value.bindings.map(({ name }) => name)).size !== value.bindings.length) fail()
}

function workerDeployments(value) {
  base(value, EXPECTED_KIND['worker-deployments'], [
    'activeDeploymentIdentity', 'activeVersionIdentity', 'deployments',
  ])
  text(value.activeDeploymentIdentity); text(value.activeVersionIdentity)
  let versionRecordCount = 0
  array(value.deployments, (deployment) => {
    record(deployment, ['identity', 'createdAtMs', 'activeVersionIdentity', 'versions'])
    text(deployment.identity); integer(deployment.createdAtMs)
    nullableText(deployment.activeVersionIdentity)
    array(deployment.versions, (version) => {
      record(version, ['identity', 'trafficPercentage'])
      text(version.identity)
      if (typeof version.trafficPercentage !== 'number' || !Number.isFinite(version.trafficPercentage)
        || version.trafficPercentage < 0 || version.trafficPercentage > 100) fail()
    })
    versionRecordCount += deployment.versions.length
    if (versionRecordCount > PREVIEW_OBSERVATION_LIMITS.maximumRecordsPerFamily) fail()
  })
}

function domains(value) {
  base(value, EXPECTED_KIND['worker-custom-domains'], ['domains'])
  array(value.domains, (entry) => {
    record(entry, [
      'identity', 'hostname', 'zoneName', 'zoneOrdinal', 'certificateIdentity', 'environment',
    ])
    text(entry.identity); text(entry.hostname, HOST, 253); text(entry.zoneName, HOST, 253)
    integer(entry.zoneOrdinal); nullableText(entry.certificateIdentity)
    if (entry.environment !== null && entry.environment !== 'preview') fail()
  })
}

function routes(value) {
  base(value, EXPECTED_KIND['worker-routes'], ['routes'])
  array(value.routes, (entry) => {
    record(entry, ['identity', 'pattern', 'zoneOrdinal', 'scriptIdentity'])
    text(entry.identity); text(entry.pattern, /^[a-z0-9.-]+\/[^?#]*$/u)
    integer(entry.zoneOrdinal); if (entry.scriptIdentity !== 'approved-preview-worker') fail()
  })
}

function migrationRows(value) {
  base(value, EXPECTED_KIND['migration-rows'], [
    'rows', 'pendingRepositorySuffix', 'appliedSourceHashes',
  ])
  if (value.appliedSourceHashes !== 'unavailable') fail()
  array(value.rows, (entry) => {
    record(entry, ['id', 'name', 'appliedAtMs', 'sourceHash'])
    integer(entry.id); if (entry.id < 1) fail(); text(entry.name, /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/u)
    integer(entry.appliedAtMs); if (entry.sourceHash !== 'unavailable') fail()
  })
  array(value.pendingRepositorySuffix, (name) => text(name, /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/u))
  if (value.rows.length + value.pendingRepositorySuffix.length
    > PREVIEW_OBSERVATION_LIMITS.maximumRecordsPerFamily) fail()
}

export function validatePreviewNormalizedResourceValue(operation, input) {
  let value
  try { value = immutablePlain(input) } catch { fail() }
  if (value.kind === 'preview-resource-observation-placeholder') {
    base(value, value.kind, [])
    return value
  }
  if (value.kind === 'preview-partial-resource-observation') {
    base(value, value.kind, ['operation', 'collectedCount'])
    if (value.operation !== operation) fail()
    integer(value.collectedCount)
    return value
  }
  if (value.kind !== EXPECTED_KIND[operation]) fail()
  switch (operation) {
    case 'account':
      base(value, EXPECTED_KIND.account, ['owned']); if (value.owned !== true) fail(); break
    case 'account-zones':
      base(value, EXPECTED_KIND[operation], ['zones'])
      array(value.zones, (zone) => {
        record(zone, ['ordinal', 'name']); integer(zone.ordinal); text(zone.name, HOST, 253)
      }, PREVIEW_OBSERVATION_LIMITS.maximumReviewedRouteZones); break
    case 'pages-project': pagesProject(value); break
    case 'pages-preview-deployments': pagesDeployments(value); break
    case 'worker-settings': workerSettings(value); break
    case 'worker-deployments': workerDeployments(value); break
    case 'worker-subdomain':
      base(value, EXPECTED_KIND[operation], ['workersDev', 'previewUrls'])
      if (typeof value.workersDev !== 'boolean' || typeof value.previewUrls !== 'boolean') fail(); break
    case 'worker-schedules':
      base(value, EXPECTED_KIND[operation], ['schedules'])
      array(value.schedules, (cron) => { if (!validCronExpression(cron)) fail() }); break
    case 'worker-custom-domains': domains(value); break
    case 'worker-routes': routes(value); break
    case 'd1-database':
      base(value, EXPECTED_KIND[operation], ['identity', 'name'])
      if (value.identity !== 'approved-preview-d1' || value.name !== 'pennant-pursuit-preview') fail()
      break
    case 'migration-table-discovery':
      base(value, EXPECTED_KIND[operation], ['tables'])
      array(value.tables, (table) => text(table, /^(?:backend_schema|d1_migrations)$/u), 2)
      if (new Set(value.tables).size !== value.tables.length) fail()
      break
    case 'migration-rows': migrationRows(value); break
    case 'backend-schema-version':
      base(value, EXPECTED_KIND[operation], ['singletonIdentity', 'version'])
      if (value.singletonIdentity !== 'backend-schema-singleton') fail()
      integer(value.version); if (value.version < 1) fail(); break
    default: fail()
  }
  return value
}
