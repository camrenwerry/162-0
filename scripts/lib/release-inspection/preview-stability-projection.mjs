import { createHash } from 'node:crypto'
import { TextEncoder } from 'node:util'
import { canonicalJson, immutablePlain } from '../preview-release/canonical-data.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import { resolveValidatedPreviewCapabilityProjectionInput } from './preview-capability-projection-authority.mjs'
import { PREVIEW_OPERATION_INVENTORY } from './preview-observation-limits.mjs'

export const PREVIEW_STABILITY_PROJECTION_SCHEMA_VERSION = 1
export const PREVIEW_STABILITY_PROJECTION_KIND =
  'pennant-pursuit-preview-semantic-stability-projection'
export const PREVIEW_STABILITY_PROJECTION_MAX_BYTES = 1_048_576

const textEncoder = new TextEncoder()

function fail(reason) {
  throw new TypeError(`Preview stability projection refused: ${reason}.`)
}

function semanticHash(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function sortedInventory(values, { set = false } = {}) {
  const keyed = values.map((value) => [canonicalJson(value), value])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  if (!set) return keyed.map(([, value]) => value)
  return keyed.filter(([key], index) => index === 0 || keyed[index - 1][0] !== key)
    .map(([, value]) => value)
}

function projectBinding(binding) {
  switch (binding.category) {
    case 'plain-text-gate':
      return { category: binding.category, name: binding.name, value: binding.value }
    case 'd1':
    case 'service':
      return { category: binding.category, name: binding.name, target: binding.target }
    case 'rate-limit':
      return {
        category: binding.category,
        name: binding.name,
        target: binding.target,
        limit: binding.limit,
        periodSeconds: binding.periodSeconds,
      }
    default:
      fail('validated input contains an unsupported binding category')
  }
}

function projectCompleteValue(operation, value) {
  switch (operation) {
    case 'account':
      return { owned: value.owned }
    case 'account-zones':
      return {
        zones: sortedInventory(value.zones.map(({ ordinal, name }) => ({ ordinal, name })), { set: true }),
      }
    case 'pages-project':
      return {
        identity: value.identity,
        compatibilityDate: value.compatibilityDate,
        compatibilityFlags: sortedInventory(value.compatibilityFlags, { set: true }),
        variables: sortedInventory(value.variables.map(({ name, value: gateValue }) => ({
          name,
          value: gateValue,
        }))),
        bindings: sortedInventory(value.bindings.map(projectBinding)),
        wranglerConfigurationHash: value.wranglerConfigurationHash,
      }
    case 'pages-preview-deployments':
      return {
        latestIdentity: value.latestIdentity,
        deployments: sortedInventory(value.deployments.map((deployment) => ({
          identity: deployment.identity,
          environment: deployment.environment,
          targetBranch: deployment.targetBranch,
          commitHash: deployment.commitHash,
          createdAtMs: deployment.createdAtMs,
          stage: { name: deployment.stage.name, status: deployment.stage.status },
          previewOrigin: deployment.previewOrigin,
          aliases: sortedInventory(deployment.aliases, { set: true }),
        }))),
      }
    case 'worker-settings':
      return {
        compatibilityDate: value.compatibilityDate,
        compatibilityFlags: sortedInventory(value.compatibilityFlags, { set: true }),
        bindings: sortedInventory(value.bindings.map(projectBinding)),
      }
    case 'worker-deployments':
      return {
        activeDeploymentIdentity: value.activeDeploymentIdentity,
        activeVersionIdentity: value.activeVersionIdentity,
        deployments: sortedInventory(value.deployments.map((deployment) => ({
          identity: deployment.identity,
          createdAtMs: deployment.createdAtMs,
          activeVersionIdentity: deployment.activeVersionIdentity,
          versions: sortedInventory(deployment.versions.map((version) => ({
            identity: version.identity,
            trafficPercentage: version.trafficPercentage,
          }))),
        }))),
      }
    case 'worker-subdomain':
      return { workersDev: value.workersDev, previewUrls: value.previewUrls }
    case 'worker-schedules':
      return { schedules: sortedInventory(value.schedules, { set: true }) }
    case 'worker-custom-domains':
      return {
        domains: sortedInventory(value.domains.map((domain) => ({
          identity: domain.identity,
          hostname: domain.hostname,
          zoneName: domain.zoneName,
          zoneOrdinal: domain.zoneOrdinal,
          environment: domain.environment,
        })), { set: true }),
      }
    case 'worker-routes':
      return {
        routes: sortedInventory(value.routes.map((route) => ({
          identity: route.identity,
          zoneOrdinal: route.zoneOrdinal,
          pattern: route.pattern,
          scriptIdentity: route.scriptIdentity,
        })), { set: true }),
      }
    case 'd1-database':
      return { identity: value.identity, name: value.name }
    case 'migration-table-discovery':
      return { tables: sortedInventory(value.tables, { set: true }) }
    case 'migration-rows':
      return {
        rows: value.rows.map((row) => ({
          id: row.id,
          name: row.name,
          appliedAtMs: row.appliedAtMs,
        })),
      }
    case 'backend-schema-version':
      return { singletonIdentity: value.singletonIdentity, version: value.version }
    default:
      fail('validated input contains an unsupported resource operation')
  }
}

function projectResource(outcome) {
  if (outcome === null) return { state: 'absent', semanticHash: null }
  if (outcome.state !== 'complete') return { state: outcome.state, semanticHash: null }
  const value = projectCompleteValue(outcome.operation, outcome.value)
  return { state: 'complete', semanticHash: semanticHash(value), value }
}

export function createPreviewStabilityProjection(validatedInput) {
  assertReleaseInspectionIntrinsicIntegrity()
  const snapshot = resolveValidatedPreviewCapabilityProjectionInput(validatedInput)
  const outcomes = new Map(snapshot.resourceOutcomes.map((outcome) => [outcome.operation, outcome]))
  const resources = Object.fromEntries(PREVIEW_OPERATION_INVENTORY.map((operation) => [
    operation,
    projectResource(outcomes.get(operation) ?? null),
  ]))
  const projection = immutablePlain({
    schemaVersion: PREVIEW_STABILITY_PROJECTION_SCHEMA_VERSION,
    kind: PREVIEW_STABILITY_PROJECTION_KIND,
    environment: 'preview',
    resourceInventory: PREVIEW_OPERATION_INVENTORY,
    resources,
  })
  if (textEncoder.encode(canonicalJson(projection)).byteLength > PREVIEW_STABILITY_PROJECTION_MAX_BYTES) {
    fail('canonical projection exceeds the fixed byte limit')
  }
  return projection
}
