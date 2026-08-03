import type {
  PreviewPagesPlainTextBindingName,
  PreviewSingleReadSnapshot,
  PreviewWorkerPlainTextBindingName,
} from './preview-observation-contracts.mjs'

declare const previewSemanticHashBrand: unique symbol

declare class PreviewExactSemanticValueAuthority {
  private readonly previewExactSemanticValueAuthority: void
  private constructor()
}

/**
 * Semantic projection records are produced only by the validated projection
 * authority. The declaration-private class is nominal, cannot be constructed
 * by callers, and is discarded by ordinary object spread because its private
 * authority member is not a public enumerable field.
 */
type PreviewExactSemanticObject<Shape extends object> =
  Readonly<Shape> & PreviewExactSemanticValueAuthority

export type PreviewStabilityResourceState =
  | 'complete'
  | 'absent'
  | 'missing'
  | 'unavailable'
  | 'partial'
  | 'malformed'
  | 'contradictory'

/** Opaque lowercase hexadecimal SHA-256 digest emitted by the runtime. */
export type PreviewSemanticHash = string & Readonly<{
  [previewSemanticHashBrand]: 'lowercase-hex-sha256'
}>

export type PreviewStablePagesBinding =
  | PreviewExactSemanticObject<{
      category: 'plain-text-gate'
      name: PreviewPagesPlainTextBindingName
      value: 'disabled' | 'enabled'
    }>
  | PreviewExactSemanticObject<{ category: 'd1'; name: 'DB'; target: 'approved-preview-d1' }>
  | PreviewExactSemanticObject<{
      category: 'service'
      name: 'VALIDATION_SERVICE'
      target: 'approved-preview-worker'
    }>

export type PreviewStableWorkerBinding =
  | PreviewExactSemanticObject<{
      category: 'plain-text-gate'
      name: PreviewWorkerPlainTextBindingName
      value: 'disabled' | 'enabled'
    }>
  | PreviewExactSemanticObject<{ category: 'd1'; name: 'DB'; target: 'approved-preview-d1' }>
  | PreviewExactSemanticObject<{
      category: 'service'
      name: 'VALIDATION_SERVICE'
      target: 'approved-preview-worker'
    }>
  | PreviewExactSemanticObject<{
      category: 'rate-limit'
      name: 'RATE_LIMIT_BURST'
      target: 'preview-rate-limit-burst'
      limit: number
      periodSeconds: number
    }>
  | PreviewExactSemanticObject<{
      category: 'rate-limit'
      name: 'RATE_LIMIT_SUSTAINED'
      target: 'preview-rate-limit-sustained'
      limit: number
      periodSeconds: number
    }>

export type PreviewAccountStableValue = PreviewExactSemanticObject<{ owned: true }>
export type PreviewAccountZonesStableValue = PreviewExactSemanticObject<{
  zones: ReadonlyArray<PreviewExactSemanticObject<{ ordinal: number; name: string }>>
}>
export type PreviewPagesProjectStableValue = PreviewExactSemanticObject<{
  identity: 'approved-preview-pages-project'
  compatibilityDate: string | null
  compatibilityFlags: readonly string[]
  variables: ReadonlyArray<PreviewExactSemanticObject<{
    name: PreviewPagesPlainTextBindingName
    value: 'disabled' | 'enabled' | 'preview'
  }>>
  bindings: readonly PreviewStablePagesBinding[]
  wranglerConfigurationHash: string | null
}>
export type PreviewPagesDeploymentsStableValue = PreviewExactSemanticObject<{
  latestIdentity: string
  deployments: ReadonlyArray<PreviewExactSemanticObject<{
    identity: string
    environment: 'preview'
    targetBranch: 'develop'
    commitHash: string | null
    createdAtMs: number
    stage: PreviewExactSemanticObject<{ name: string; status: string }>
    previewOrigin: string
    aliases: readonly string[]
  }>>
}>
export type PreviewWorkerSettingsStableValue = PreviewExactSemanticObject<{
  compatibilityDate: string | null
  compatibilityFlags: readonly string[]
  bindings: readonly PreviewStableWorkerBinding[]
}>
export type PreviewWorkerDeploymentsStableValue = PreviewExactSemanticObject<{
  activeDeploymentIdentity: string
  activeVersionIdentity: string
  deployments: ReadonlyArray<PreviewExactSemanticObject<{
    identity: string
    createdAtMs: number
    activeVersionIdentity: string | null
    versions: ReadonlyArray<PreviewExactSemanticObject<{
      identity: string
      trafficPercentage: number
    }>>
  }>>
}>
export type PreviewWorkerSubdomainStableValue = PreviewExactSemanticObject<{
  workersDev: boolean
  previewUrls: boolean
}>
export type PreviewWorkerSchedulesStableValue = PreviewExactSemanticObject<{
  schedules: readonly string[]
}>
export type PreviewWorkerCustomDomainsStableValue = PreviewExactSemanticObject<{
  domains: ReadonlyArray<PreviewExactSemanticObject<{
    identity: string
    hostname: string
    zoneName: string
    zoneOrdinal: number
    environment: 'preview' | null
  }>>
}>
export type PreviewWorkerRoutesStableValue = PreviewExactSemanticObject<{
  routes: ReadonlyArray<PreviewExactSemanticObject<{
    identity: string
    zoneOrdinal: number
    pattern: string
    scriptIdentity: 'approved-preview-worker'
  }>>
}>
export type PreviewD1DatabaseStableValue = PreviewExactSemanticObject<{
  identity: 'approved-preview-d1'
  name: 'pennant-pursuit-preview'
}>
export type PreviewMigrationTableDiscoveryStableValue = PreviewExactSemanticObject<{
  tables: readonly ('backend_schema' | 'd1_migrations')[]
}>
export type PreviewMigrationRowsStableValue = PreviewExactSemanticObject<{
  rows: ReadonlyArray<PreviewExactSemanticObject<{
    id: number
    name: string
    appliedAtMs: number
  }>>
}>
export type PreviewBackendSchemaVersionStableValue = PreviewExactSemanticObject<{
  singletonIdentity: 'backend-schema-singleton'
  version: number
}>

export interface PreviewSemanticResourceValueByOperation {
  readonly account: PreviewAccountStableValue
  readonly 'account-zones': PreviewAccountZonesStableValue
  readonly 'pages-project': PreviewPagesProjectStableValue
  readonly 'pages-preview-deployments': PreviewPagesDeploymentsStableValue
  readonly 'worker-settings': PreviewWorkerSettingsStableValue
  readonly 'worker-deployments': PreviewWorkerDeploymentsStableValue
  readonly 'worker-subdomain': PreviewWorkerSubdomainStableValue
  readonly 'worker-schedules': PreviewWorkerSchedulesStableValue
  readonly 'worker-custom-domains': PreviewWorkerCustomDomainsStableValue
  readonly 'worker-routes': PreviewWorkerRoutesStableValue
  readonly 'd1-database': PreviewD1DatabaseStableValue
  readonly 'migration-table-discovery': PreviewMigrationTableDiscoveryStableValue
  readonly 'migration-rows': PreviewMigrationRowsStableValue
  readonly 'backend-schema-version': PreviewBackendSchemaVersionStableValue
}

export type PreviewSemanticResourceValue =
  PreviewSemanticResourceValueByOperation[keyof PreviewSemanticResourceValueByOperation]

export type PreviewStabilityResourceProjection<Value extends PreviewSemanticResourceValue> =
  | Readonly<{
      state: 'complete'
      semanticHash: PreviewSemanticHash
      value: Value
    }>
  | Readonly<{
      state: Exclude<PreviewStabilityResourceState, 'complete'>
      semanticHash: null
      value?: never
    }>

export interface PreviewSemanticStabilityProjection {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-semantic-stability-projection'
  readonly environment: 'preview'
  readonly resourceInventory: readonly [
    'account',
    'account-zones',
    'backend-schema-version',
    'd1-database',
    'migration-rows',
    'migration-table-discovery',
    'pages-preview-deployments',
    'pages-project',
    'worker-custom-domains',
    'worker-deployments',
    'worker-routes',
    'worker-schedules',
    'worker-settings',
    'worker-subdomain',
  ]
  readonly resources: Readonly<{
    [Operation in keyof PreviewSemanticResourceValueByOperation]:
      PreviewStabilityResourceProjection<PreviewSemanticResourceValueByOperation[Operation]>
  }>
}

export const PREVIEW_STABILITY_PROJECTION_SCHEMA_VERSION: 1
export const PREVIEW_STABILITY_PROJECTION_KIND:
  'pennant-pursuit-preview-semantic-stability-projection'
export const PREVIEW_STABILITY_PROJECTION_MAX_BYTES: 1048576
export function createPreviewStabilityProjection(
  validatedInput: PreviewSingleReadSnapshot,
): PreviewSemanticStabilityProjection
