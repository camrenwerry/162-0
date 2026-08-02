import {
  allowedKeys,
  assertRecordBudget,
  boundedAscii,
  canonicalCalendarDate,
  canonicalCronExpression,
  canonicalHostname,
  compareText,
  exactKeys,
  normalizationFail,
  normalizedTimestamp,
  normalizedValue,
  providerPlain,
  safeIdentity,
} from './preview-normalization.mjs'
import { REMOTE_OBSERVATION_LIMITS } from './remote-transport.mjs'

const WORKER_VARIABLES = new Set([
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
const CERTIFICATE_IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function normalizeWorkerBinding(binding, identity) {
  const operation = 'worker-settings'
  allowedKeys(operation, binding, [
    'name', 'type', 'text', 'id', 'database_id', 'database_name', 'service', 'environment',
    'namespace_id', 'simple',
  ], ['name', 'type'], 'invalid-worker-binding')
  const name = safeIdentity(operation, binding.name, 'invalid-binding-name')
  switch (binding.type) {
    case 'plain_text': {
      exactKeys(operation, binding, ['name', 'text', 'type'], 'invalid-plain-text-binding')
      if (!WORKER_VARIABLES.has(name) || !['disabled', 'enabled'].includes(binding.text)) {
        normalizationFail(operation, 'malformed', 'unsupported-plain-text-binding')
      }
      return Object.freeze({ category: 'plain-text-gate', name, value: binding.text })
    }
    case 'd1': {
      allowedKeys(operation, binding, ['name', 'type', 'id', 'database_id', 'database_name'], [
        'name', 'type',
      ], 'invalid-d1-binding')
      const databaseId = binding.id ?? binding.database_id
      if (name !== 'DB' || databaseId !== (identity.observedDatabaseId ?? identity.databaseId)
        || (Object.hasOwn(binding, 'database_name')
          && binding.database_name !== 'pennant-pursuit-preview')) {
        normalizationFail(operation, 'contradictory', 'worker-d1-binding-mismatch')
      }
      return Object.freeze({ category: 'd1', name, target: 'approved-preview-d1' })
    }
    case 'service': {
      allowedKeys(operation, binding, ['name', 'type', 'service', 'environment'], [
        'name', 'type', 'service',
      ], 'invalid-service-binding')
      if (name !== 'VALIDATION_SERVICE' || binding.service !== identity.workerName
        || (Object.hasOwn(binding, 'environment') && binding.environment !== 'preview')) {
        normalizationFail(operation, 'contradictory', 'worker-service-binding-mismatch')
      }
      return Object.freeze({ category: 'service', name, target: 'approved-preview-worker' })
    }
    case 'ratelimit': {
      exactKeys(operation, binding, ['name', 'namespace_id', 'simple', 'type'], 'invalid-rate-limit-binding')
      const expectedNamespace = identity.observedRateLimitNamespaceIds?.[name]
        ?? identity.rateLimitNamespaceIds?.[name]
      if (expectedNamespace !== binding.namespace_id) {
        normalizationFail(operation, 'contradictory', 'worker-rate-limit-binding-mismatch')
      }
      exactKeys(operation, binding.simple, ['limit', 'period'], 'invalid-rate-limit-binding')
      if (!Number.isSafeInteger(binding.simple.limit) || binding.simple.limit < 1
        || !Number.isSafeInteger(binding.simple.period) || binding.simple.period < 1) {
        normalizationFail(operation, 'malformed', 'invalid-rate-limit-binding')
      }
      return Object.freeze({
        category: 'rate-limit',
        name,
        target: name === 'RATE_LIMIT_BURST' ? 'preview-rate-limit-burst' : 'preview-rate-limit-sustained',
        limit: binding.simple.limit,
        periodSeconds: binding.simple.period,
      })
    }
    default:
      normalizationFail(operation, 'malformed', 'unsupported-worker-binding-category')
  }
}

export function normalizeWorkerSettings(providerResult, identity) {
  const operation = 'worker-settings'
  const result = providerPlain(operation, providerResult)
  allowedKeys(operation, result, ['bindings', 'compatibility_date', 'compatibility_flags', 'usage_model'], [
    'bindings',
  ], 'invalid-worker-settings')
  if (!Array.isArray(result.bindings)) normalizationFail(operation, 'malformed', 'invalid-worker-bindings')
  if (result.bindings.length > WORKER_VARIABLES.size + 4) {
    normalizationFail(operation, 'malformed', 'worker-binding-inventory-exceeded')
  }
  const bindings = result.bindings.map((binding) => normalizeWorkerBinding(binding, identity))
  if (new Set(bindings.map(({ name }) => name)).size !== bindings.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-binding-name')
  }
  bindings.sort((left, right) => compareText(left.name, right.name))
  let compatibilityDate = null
  if (Object.hasOwn(result, 'compatibility_date')) {
    compatibilityDate = canonicalCalendarDate(
      operation,
      result.compatibility_date,
      'invalid-compatibility-date',
    )
  }
  if (Object.hasOwn(result, 'compatibility_flags') && !Array.isArray(result.compatibility_flags)) {
    normalizationFail(operation, 'malformed', 'invalid-compatibility-flags')
  }
  if (Object.hasOwn(result, 'compatibility_flags')) {
    assertRecordBudget(operation, result.compatibility_flags)
  }
  const compatibilityFlags = Object.hasOwn(result, 'compatibility_flags')
    ? [...result.compatibility_flags] : []
  if (compatibilityFlags.some((flag) => typeof flag !== 'string'
      || !/^[a-z0-9_-]{1,64}$/u.test(flag))
    || new Set(compatibilityFlags).size !== compatibilityFlags.length) {
    normalizationFail(operation, 'malformed', 'invalid-compatibility-flags')
  }
  compatibilityFlags.sort(compareText)
  return normalizedValue('preview-worker-settings-observation', {
    compatibilityDate,
    compatibilityFlags,
    secretPresence: 'unavailable',
    bindings,
  })
}

function normalizeWorkerVersion(input) {
  const operation = 'worker-deployments'
  const version = exactKeys(operation, input, ['percentage', 'version_id'], 'invalid-worker-version')
  const identity = safeIdentity(operation, version.version_id, 'invalid-version-identity')
  if (typeof version.percentage !== 'number' || !Number.isFinite(version.percentage)
    || version.percentage < 0 || version.percentage > 100) {
    normalizationFail(operation, 'malformed', 'invalid-traffic-percentage')
  }
  return Object.freeze({ identity, trafficPercentage: version.percentage })
}

function normalizeWorkerDeployment(input) {
  const operation = 'worker-deployments'
  const deployment = exactKeys(operation, input, ['created_on', 'id', 'versions'], 'invalid-worker-deployment')
  if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
    normalizationFail(operation, 'malformed', 'empty-version-inventory')
  }
  assertRecordBudget(operation, deployment.versions, 'version-record-budget-exceeded')
  const versions = deployment.versions.map(normalizeWorkerVersion)
  if (new Set(versions.map(({ identity }) => identity)).size !== versions.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-version-identity')
  }
  const total = versions.reduce((sum, version) => sum + version.trafficPercentage, 0)
  if (Math.abs(total - 100) > Number.EPSILON) {
    normalizationFail(operation, 'contradictory', 'invalid-traffic-allocation')
  }
  versions.sort((left, right) => compareText(left.identity, right.identity))
  const active = versions.filter(({ trafficPercentage }) => trafficPercentage === 100)
  return Object.freeze({
    identity: safeIdentity(operation, deployment.id, 'invalid-deployment-identity'),
    createdAtMs: normalizedTimestamp(operation, deployment.created_on),
    activeVersionIdentity: active.length === 1 ? active[0].identity : null,
    versions,
  })
}

export function normalizeWorkerDeployments(providerResult) {
  const operation = 'worker-deployments'
  const result = providerPlain(operation, providerResult)
  const container = Array.isArray(result)
    ? result
    : exactKeys(operation, result, ['deployments'], 'invalid-worker-deployment-result').deployments
  if (!Array.isArray(container) || container.length === 0) {
    normalizationFail(operation, 'missing', 'worker-deployment-missing')
  }
  assertRecordBudget(operation, container)
  let versionRecordCount = 0
  for (const rawDeployment of container) {
    const deployment = exactKeys(
      operation,
      rawDeployment,
      ['created_on', 'id', 'versions'],
      'invalid-worker-deployment',
    )
    if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
      normalizationFail(operation, 'malformed', 'empty-version-inventory')
    }
    assertRecordBudget(operation, deployment.versions, 'version-record-budget-exceeded')
    versionRecordCount += deployment.versions.length
    if (versionRecordCount > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      normalizationFail(operation, 'malformed', 'aggregate-version-record-budget-exceeded')
    }
  }
  const deployments = container.map(normalizeWorkerDeployment)
  if (new Set(deployments.map(({ identity }) => identity)).size !== deployments.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-deployment-identity')
  }
  deployments.sort((left, right) => right.createdAtMs - left.createdAtMs
    || compareText(left.identity, right.identity))
  if (deployments.length > 1 && deployments[0].createdAtMs === deployments[1].createdAtMs) {
    normalizationFail(operation, 'contradictory', 'ambiguous-latest-deployment')
  }
  const latest = deployments[0]
  if (latest.activeVersionIdentity === null) {
    normalizationFail(operation, 'contradictory', 'ambiguous-active-version')
  }
  return normalizedValue('preview-worker-deployments-observation', {
    activeDeploymentIdentity: latest.identity,
    activeVersionIdentity: latest.activeVersionIdentity,
    deployments,
  })
}

export function normalizeWorkerSubdomain(providerResult) {
  const operation = 'worker-subdomain'
  const result = providerPlain(operation, providerResult)
  exactKeys(operation, result, ['enabled', 'previews_enabled'], 'invalid-worker-public-url-settings')
  if (typeof result.enabled !== 'boolean' || typeof result.previews_enabled !== 'boolean') {
    normalizationFail(operation, 'malformed', 'invalid-worker-public-url-settings')
  }
  return normalizedValue('preview-worker-public-urls-observation', {
    workersDev: result.enabled,
    previewUrls: result.previews_enabled,
  })
}

export function normalizeWorkerSchedules(providerResult) {
  const operation = 'worker-schedules'
  const result = providerPlain(operation, providerResult)
  const container = exactKeys(operation, result, ['schedules'], 'invalid-schedule-container')
  if (!Array.isArray(container.schedules)) {
    normalizationFail(operation, 'malformed', 'invalid-schedule-list')
  }
  assertRecordBudget(operation, container.schedules)
  const schedules = container.schedules.map((entry) => {
    exactKeys(operation, entry, ['cron'], 'invalid-schedule-record')
    return canonicalCronExpression(operation, entry.cron)
  })
  if (new Set(schedules).size !== schedules.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-cron-expression')
  }
  schedules.sort(compareText)
  return normalizedValue('preview-worker-schedules-observation', { schedules })
}

export function normalizeWorkerCustomDomains(providerResult, resultInfo, identity) {
  const operation = 'worker-custom-domains'
  const result = providerPlain(operation, providerResult)
  if (!Array.isArray(result)) normalizationFail(operation, 'malformed', 'invalid-custom-domain-list')
  assertRecordBudget(operation, result)
  const domains = result.map((entry) => {
    allowedKeys(operation, entry, [
      'id', 'hostname', 'service', 'zone_id', 'zone_name', 'environment', 'cert_id',
    ], ['id', 'hostname', 'service', 'zone_id', 'zone_name'], 'invalid-custom-domain')
    if (entry.service !== identity.workerName) {
      normalizationFail(operation, 'contradictory', 'custom-domain-service-filter-contradiction')
    }
    const zoneOrdinal = identity.routeZoneIds.indexOf(entry.zone_id)
    if (zoneOrdinal < 0) normalizationFail(operation, 'contradictory', 'custom-domain-zone-ownership-mismatch')
    const hostname = canonicalHostname(operation, entry.hostname, 'invalid-custom-domain-hostname')
    const zoneName = canonicalHostname(operation, entry.zone_name, 'invalid-custom-domain-zone')
    if (hostname !== zoneName && !hostname.endsWith(`.${zoneName}`)) {
      normalizationFail(operation, 'contradictory', 'custom-domain-zone-ownership-mismatch')
    }
    if (Object.hasOwn(entry, 'environment') && entry.environment !== 'preview') {
      normalizationFail(operation, 'contradictory', 'custom-domain-environment-mismatch')
    }
    return Object.freeze({
      identity: safeIdentity(operation, entry.id, 'invalid-domain-identity'),
      hostname,
      zoneName,
      zoneOrdinal,
      certificateIdentity: Object.hasOwn(entry, 'cert_id')
        ? boundedAscii(
          operation,
          entry.cert_id,
          'invalid-certificate-identity',
          CERTIFICATE_IDENTITY,
          36,
        ) : null,
      environment: Object.hasOwn(entry, 'environment') ? 'preview' : null,
    })
  })
  if (resultInfo !== undefined) {
    const info = exactKeys(operation, providerPlain(operation, resultInfo), [
      'count', 'page', 'per_page', 'total_count', 'total_pages',
    ], 'invalid-custom-domain-pagination')
    if (info.page !== 1 || info.total_pages !== 1 || info.count !== domains.length
      || info.total_count !== domains.length || !Number.isSafeInteger(info.per_page)
      || info.per_page < Math.max(1, domains.length)
      || info.per_page > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      normalizationFail(operation, 'contradictory', 'invalid-custom-domain-pagination')
    }
  }
  if (new Set(domains.map(({ identity }) => identity)).size !== domains.length
    || new Set(domains.map(({ hostname }) => hostname)).size !== domains.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-custom-domain')
  }
  domains.sort((left, right) => compareText(left.hostname, right.hostname))
  return normalizedValue('preview-worker-custom-domains-observation', { domains })
}

function canonicalRoutePattern(input) {
  const operation = 'worker-routes'
  if (typeof input !== 'string' || input.length === 0 || input.length > 512
    || /[^\x21-\x7E]/u.test(input) || input.includes('://') || input.includes('@')
    || /[\\?#]/u.test(input)) normalizationFail(operation, 'malformed', 'invalid-route-pattern')
  const slash = input.indexOf('/')
  const rawHostname = slash < 0 ? input : input.slice(0, slash)
  const rawPath = slash < 0 ? '/*' : input.slice(slash)
  if (rawHostname.includes(':')) {
    normalizationFail(operation, 'malformed', 'invalid-route-pattern')
  }
  const hostname = canonicalHostname(operation, rawHostname.toLowerCase(), 'invalid-route-pattern')
  if (!rawPath.startsWith('/') || rawPath.includes('//')
    || (rawPath.includes('*') && !rawPath.endsWith('*'))
    || (rawPath.match(/\*/gu)?.length ?? 0) > 1) {
    normalizationFail(operation, 'malformed', 'invalid-route-pattern')
  }
  return `${hostname}${rawPath}`
}

export function normalizeWorkerRoutes(providerResult, identity, zoneOrdinal) {
  const operation = 'worker-routes'
  if (!Number.isSafeInteger(zoneOrdinal) || zoneOrdinal < 0
    || zoneOrdinal >= identity.routeZoneIds.length) {
    normalizationFail(operation, 'malformed', 'invalid-route-zone-ordinal')
  }
  const result = providerPlain(operation, providerResult)
  if (!Array.isArray(result)) normalizationFail(operation, 'malformed', 'invalid-route-list')
  assertRecordBudget(operation, result)
  const seenIds = new Set()
  const seenPatterns = new Set()
  const routes = []
  const inventory = []
  for (const entry of result) {
    exactKeys(operation, entry, ['id', 'pattern', 'script'], 'invalid-route-record')
    const routeIdentity = safeIdentity(operation, entry.id, 'invalid-route-identity')
    const pattern = canonicalRoutePattern(entry.pattern)
    if (seenIds.has(routeIdentity) || seenPatterns.has(pattern)) {
      normalizationFail(operation, 'contradictory', 'duplicate-route')
    }
    seenIds.add(routeIdentity)
    seenPatterns.add(pattern)
    inventory.push(Object.freeze({ identity: routeIdentity, pattern, zoneOrdinal }))
    if (entry.script === null) continue
    safeIdentity(operation, entry.script, 'invalid-route-script')
    if (entry.script !== identity.workerName) continue
    routes.push(Object.freeze({
      identity: routeIdentity,
      pattern,
      zoneOrdinal,
      scriptIdentity: 'approved-preview-worker',
    }))
  }
  routes.sort((left, right) => compareText(left.pattern, right.pattern))
  return Object.freeze({
    inventory: Object.freeze(inventory),
    routes: Object.freeze(routes),
  })
}

export function finalizeWorkerRoutes(zoneInventories) {
  const operation = 'worker-routes'
  if (!Array.isArray(zoneInventories) || zoneInventories.length === 0) {
    normalizationFail(operation, 'unavailable', 'route-zone-inventory-absent')
  }
  if (zoneInventories.length > REMOTE_OBSERVATION_LIMITS.maximumReviewedRouteZones) {
    normalizationFail(operation, 'malformed', 'route-zone-inventory-budget-exceeded')
  }
  let aggregateRecordCount = 0
  for (const entry of zoneInventories) {
    if (!entry || typeof entry !== 'object'
      || !Array.isArray(entry.inventory) || !Array.isArray(entry.routes)) {
      normalizationFail(operation, 'malformed', 'invalid-route-zone-inventory')
    }
    assertRecordBudget(operation, entry.inventory)
    assertRecordBudget(operation, entry.routes)
    aggregateRecordCount += entry.inventory.length
    if (aggregateRecordCount > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      normalizationFail(operation, 'malformed', 'aggregate-record-budget-exceeded')
    }
    if (entry.routes.length > entry.inventory.length) {
      normalizationFail(operation, 'contradictory', 'invalid-route-zone-inventory')
    }
  }
  const inventory = zoneInventories.flatMap((entry) => entry.inventory)
  const routes = zoneInventories.flatMap((entry) => entry.routes)
  const ids = new Map()
  const patterns = new Map()
  for (const route of inventory) {
    if ((ids.has(route.identity) && ids.get(route.identity) !== route.pattern)
      || (patterns.has(route.pattern) && patterns.get(route.pattern) !== route.identity)
      || ids.has(route.identity) || patterns.has(route.pattern)) {
      normalizationFail(operation, 'contradictory', 'conflicting-route-inventory')
    }
    ids.set(route.identity, route.pattern)
    patterns.set(route.pattern, route.identity)
  }
  routes.sort((left, right) => compareText(left.pattern, right.pattern)
    || compareText(left.identity, right.identity))
  return normalizedValue('preview-worker-routes-observation', { routes })
}
