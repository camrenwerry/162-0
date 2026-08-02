import { sha256 } from '../preview-release/canonical.mjs'
import {
  normalizeBackendSchemaVersion,
  normalizeD1Database,
  normalizeMigrationRows,
  normalizeMigrationTableDiscovery,
} from './preview-d1-observer.mjs'
import {
  normalizePagesDeploymentPage,
  normalizePagesProject,
} from './preview-pages-observer.mjs'
import {
  normalizeWorkerCustomDomains,
  normalizeWorkerDeployments,
  normalizeWorkerRoutes,
  normalizeWorkerSchedules,
  normalizeWorkerSettings,
  normalizeWorkerSubdomain,
} from './preview-worker-observer.mjs'
import {
  allowedKeys,
  assertRecordBudget,
  canonicalHostname,
  normalizationFail,
  normalizedValue,
  paginationInfo,
  PreviewResourceNormalizationError,
  providerPlain,
} from './preview-normalization.mjs'

function normalizeAccount(result, identity) {
  const operation = 'account'
  const account = providerPlain(operation, result)
  allowedKeys(operation, account, ['id', 'name', 'settings', 'created_on'], ['id'], 'invalid-account')
  if (account.id !== identity.accountId) {
    normalizationFail(operation, 'contradictory', 'account-ownership-mismatch')
  }
  return normalizedValue('preview-account-observation', { owned: true })
}

function normalizeZonePage(result, resultInfo, identity, page) {
  const operation = 'account-zones'
  const zones = providerPlain(operation, result)
  if (!Array.isArray(zones)) normalizationFail(operation, 'malformed', 'invalid-zone-list')
  assertRecordBudget(operation, zones)
  const records = zones.map((entry) => {
    allowedKeys(operation, entry, ['id', 'name', 'account', 'status', 'type'], [
      'id', 'name',
    ], 'invalid-zone-record')
    if (typeof entry.id !== 'string' || !/^[0-9a-f]{32}$/u.test(entry.id)) {
      normalizationFail(operation, 'malformed', 'invalid-zone-identity')
    }
    return Object.freeze({
      providerIdentity: `zone-${sha256(entry.id).slice(0, 24)}`,
      reviewedOrdinal: identity.routeZoneIds.indexOf(entry.id),
      name: canonicalHostname(operation, entry.name, 'invalid-zone-name'),
    })
  })
  return Object.freeze({
    records: Object.freeze(records),
    pageInfo: paginationInfo(operation, providerPlain(operation, resultInfo), page, records.length),
  })
}

export function normalizePreviewProviderEnvelope(request, envelope, identity, repositoryMigrationNames) {
  let operation = 'provider-envelope'
  try {
    operation = request.operation
    switch (operation) {
      case 'account': return normalizeAccount(envelope.result, identity)
      case 'account-zones': return normalizeZonePage(
        envelope.result,
        envelope.result_info,
        identity,
        request.parameters.page,
      )
      case 'pages-project': return normalizePagesProject(envelope.result, identity)
      case 'pages-preview-deployments': return normalizePagesDeploymentPage(
        envelope.result,
        envelope.result_info,
        request.parameters.page,
      )
      case 'worker-settings': return normalizeWorkerSettings(envelope.result, identity)
      case 'worker-deployments': return normalizeWorkerDeployments(envelope.result)
      case 'worker-subdomain': return normalizeWorkerSubdomain(envelope.result)
      case 'worker-schedules': return normalizeWorkerSchedules(envelope.result)
      case 'worker-custom-domains': return normalizeWorkerCustomDomains(
        envelope.result,
        envelope.result_info,
        identity,
      )
      case 'worker-routes': return normalizeWorkerRoutes(
        envelope.result,
        identity,
        identity.routeZoneIds.indexOf(request.parameters.zoneId),
      )
      case 'd1-database': return normalizeD1Database(envelope.result, identity)
      case 'migration-table-discovery': return normalizeMigrationTableDiscovery(envelope.result)
      case 'migration-rows': return normalizeMigrationRows(envelope.result, repositoryMigrationNames)
      case 'backend-schema-version': return normalizeBackendSchemaVersion(envelope.result)
      default: normalizationFail(operation, 'malformed', 'unsupported-normalization-operation')
    }
  } catch (error) {
    if (error instanceof PreviewResourceNormalizationError) throw error
    normalizationFail(
      typeof operation === 'string' ? operation : 'provider-envelope',
      'malformed',
      'provider-normalization-failure',
    )
  }
}
