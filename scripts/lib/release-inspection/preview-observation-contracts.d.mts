import type { PreviewOperationName } from './remote-transport.mjs'

export type PreviewResourceOutcomeState =
  | 'complete'
  | 'missing'
  | 'unavailable'
  | 'partial'
  | 'malformed'
  | 'contradictory'

export interface PreviewResourcePlaceholder {
  readonly kind: 'preview-resource-observation-placeholder'
  readonly schemaVersion: 1
}

export interface PreviewPartialResourceObservation<
  Operation extends PreviewOperationName = PreviewOperationName,
> {
  readonly kind: 'preview-partial-resource-observation'
  readonly schemaVersion: 1
  readonly operation: Operation
  readonly collectedCount: number
}

export interface PreviewAccountObservation {
  readonly kind: 'preview-account-observation'
  readonly schemaVersion: 1
  readonly owned: true
}

export interface PreviewAccountZonesObservation {
  readonly kind: 'preview-account-zones-observation'
  readonly schemaVersion: 1
  readonly zones: ReadonlyArray<Readonly<{ ordinal: number; name: string }>>
}

export interface PreviewPagesProjectObservation {
  readonly kind: 'preview-pages-project-observation'
  readonly schemaVersion: 1
  readonly identity: 'approved-preview-pages-project'
  readonly compatibilityDate: string | null
  readonly compatibilityFlags: readonly string[]
  readonly wranglerConfigurationHash: string | null
  readonly variables: ReadonlyArray<Readonly<{
    name: PreviewPagesPlainTextBindingName
    value: 'disabled' | 'enabled' | 'preview'
  }>>
  readonly bindings: readonly PreviewPagesBindingObservation[]
}

export type PreviewPagesPlainTextBindingName =
  | 'DRAFT_VALIDATION_MODE'
  | 'DRAFT_TICKET_MODE'
  | 'LEADERBOARD_ENVIRONMENT'
  | 'LEADERBOARD_READ_MODE'
  | 'LEADERBOARD_IDENTITY_MODE'
  | 'LEADERBOARD_IDENTITY_CLAIM_MODE'
  | 'LEADERBOARD_IDENTITY_STATUS_MODE'
  | 'LEADERBOARD_IDENTITY_RENAME_MODE'
  | 'DRAFT_SUBMISSION_MODE'
  | 'LEADERBOARD_RECOVERY_MODE'

export type PreviewWorkerPlainTextBindingName =
  | 'DRAFT_VALIDATION_MODE'
  | 'DRAFT_TICKET_MODE'
  | 'LEADERBOARD_IDENTITY_MODE'
  | 'LEADERBOARD_IDENTITY_CLAIM_MODE'
  | 'LEADERBOARD_IDENTITY_STATUS_MODE'
  | 'LEADERBOARD_IDENTITY_RENAME_MODE'
  | 'DRAFT_SUBMISSION_MODE'
  | 'LEADERBOARD_RECOVERY_MODE'
  | 'RETENTION_CLEANUP_MODE'

type PreviewD1BindingObservation = Readonly<{
  category: 'd1'
  name: 'DB'
  target: 'approved-preview-d1'
}>

type PreviewServiceBindingObservation = Readonly<{
  category: 'service'
  name: 'VALIDATION_SERVICE'
  target: 'approved-preview-worker'
}>

export type PreviewPagesBindingObservation =
  | Readonly<{
      category: 'plain-text-gate'
      name: PreviewPagesPlainTextBindingName
      value: 'disabled' | 'enabled'
    }>
  | PreviewD1BindingObservation
  | PreviewServiceBindingObservation

export type PreviewWorkerBindingObservation =
  | Readonly<{
      category: 'plain-text-gate'
      name: PreviewWorkerPlainTextBindingName
      value: 'disabled' | 'enabled'
    }>
  | PreviewD1BindingObservation
  | PreviewServiceBindingObservation
  | Readonly<{
      category: 'rate-limit'
      name: 'RATE_LIMIT_BURST'
      target: 'preview-rate-limit-burst'
      limit: number
      periodSeconds: number
    }>
  | Readonly<{
      category: 'rate-limit'
      name: 'RATE_LIMIT_SUSTAINED'
      target: 'preview-rate-limit-sustained'
      limit: number
      periodSeconds: number
    }>

export type PreviewBindingObservation =
  | PreviewPagesBindingObservation
  | PreviewWorkerBindingObservation

export interface PreviewPagesDeploymentsObservation {
  readonly kind: 'preview-pages-deployments-observation'
  readonly schemaVersion: 1
  readonly latestIdentity: string
  readonly deployments: ReadonlyArray<Readonly<{
    identity: string
    environment: 'preview'
    targetBranch: 'develop'
    createdAtMs: number
    commitHash: string | null
    stage: Readonly<{ name: string; status: string }>
    previewOrigin: string
    aliases: readonly string[]
  }>>
}

export interface PreviewWorkerSettingsObservation {
  readonly kind: 'preview-worker-settings-observation'
  readonly schemaVersion: 1
  readonly compatibilityDate: string | null
  readonly compatibilityFlags: readonly string[]
  readonly secretPresence: 'unavailable'
  readonly bindings: readonly PreviewWorkerBindingObservation[]
}

export interface PreviewWorkerDeploymentsObservation {
  readonly kind: 'preview-worker-deployments-observation'
  readonly schemaVersion: 1
  readonly activeDeploymentIdentity: string
  readonly activeVersionIdentity: string
  readonly deployments: ReadonlyArray<Readonly<{
    identity: string
    createdAtMs: number
    activeVersionIdentity: string | null
    versions: ReadonlyArray<Readonly<{ identity: string; trafficPercentage: number }>>
  }>>
}

export interface PreviewWorkerPublicUrlsObservation {
  readonly kind: 'preview-worker-public-urls-observation'
  readonly schemaVersion: 1
  readonly workersDev: boolean
  readonly previewUrls: boolean
}

export interface PreviewWorkerSchedulesObservation {
  readonly kind: 'preview-worker-schedules-observation'
  readonly schemaVersion: 1
  readonly schedules: readonly string[]
}

export interface PreviewWorkerCustomDomainsObservation {
  readonly kind: 'preview-worker-custom-domains-observation'
  readonly schemaVersion: 1
  readonly domains: ReadonlyArray<Readonly<{
    identity: string
    hostname: string
    zoneName: string
    zoneOrdinal: number
    certificateIdentity: string | null
    environment: 'preview' | null
  }>>
}

export interface PreviewWorkerRoutesObservation {
  readonly kind: 'preview-worker-routes-observation'
  readonly schemaVersion: 1
  readonly routes: ReadonlyArray<Readonly<{
    identity: string
    pattern: string
    zoneOrdinal: number
    scriptIdentity: 'approved-preview-worker'
  }>>
}

export interface PreviewD1DatabaseObservation {
  readonly kind: 'preview-d1-database-observation'
  readonly schemaVersion: 1
  readonly identity: 'approved-preview-d1'
  readonly name: 'pennant-pursuit-preview'
}

export interface PreviewMigrationTablesObservation {
  readonly kind: 'preview-migration-tables-observation'
  readonly schemaVersion: 1
  readonly tables: readonly ('backend_schema' | 'd1_migrations')[]
}

export interface PreviewMigrationRowsObservation {
  readonly kind: 'preview-migration-rows-observation'
  readonly schemaVersion: 1
  readonly rows: ReadonlyArray<Readonly<{
    id: number
    name: string
    appliedAtMs: number
    sourceHash: 'unavailable'
  }>>
  readonly pendingRepositorySuffix: readonly string[]
  readonly appliedSourceHashes: 'unavailable'
}

export interface PreviewBackendSchemaObservation {
  readonly kind: 'preview-backend-schema-observation'
  readonly schemaVersion: 1
  readonly singletonIdentity: 'backend-schema-singleton'
  readonly version: number
}

export type PreviewResourceValue =
  | PreviewResourcePlaceholder
  | PreviewPartialResourceObservation
  | PreviewAccountObservation
  | PreviewAccountZonesObservation
  | PreviewPagesProjectObservation
  | PreviewPagesDeploymentsObservation
  | PreviewWorkerSettingsObservation
  | PreviewWorkerDeploymentsObservation
  | PreviewWorkerPublicUrlsObservation
  | PreviewWorkerSchedulesObservation
  | PreviewWorkerCustomDomainsObservation
  | PreviewWorkerRoutesObservation
  | PreviewD1DatabaseObservation
  | PreviewMigrationTablesObservation
  | PreviewMigrationRowsObservation
  | PreviewBackendSchemaObservation

export interface PreviewResourceValueByOperation {
  readonly account: PreviewAccountObservation
  readonly 'account-zones': PreviewAccountZonesObservation
  readonly 'pages-project': PreviewPagesProjectObservation
  readonly 'pages-preview-deployments': PreviewPagesDeploymentsObservation
  readonly 'worker-settings': PreviewWorkerSettingsObservation
  readonly 'worker-deployments': PreviewWorkerDeploymentsObservation
  readonly 'worker-subdomain': PreviewWorkerPublicUrlsObservation
  readonly 'worker-schedules': PreviewWorkerSchedulesObservation
  readonly 'worker-custom-domains': PreviewWorkerCustomDomainsObservation
  readonly 'worker-routes': PreviewWorkerRoutesObservation
  readonly 'd1-database': PreviewD1DatabaseObservation
  readonly 'migration-table-discovery': PreviewMigrationTablesObservation
  readonly 'migration-rows': PreviewMigrationRowsObservation
  readonly 'backend-schema-version': PreviewBackendSchemaObservation
}

interface PreviewResourceOutcomeBase<Operation extends PreviewOperationName> {
  readonly operation: Operation
  readonly capturedAtMs: number
}

type PreviewCompleteResourceOutcome = {
  [Operation in PreviewOperationName]: PreviewResourceOutcomeBase<Operation> & Readonly<{
      state: 'complete'
      issueCode: null
      value: PreviewResourcePlaceholder | PreviewResourceValueByOperation[Operation]
    }>
}[PreviewOperationName]

type PreviewPartialResourceOutcome = {
  [Operation in PreviewOperationName]: PreviewResourceOutcomeBase<Operation> & Readonly<{
      state: 'partial'
      issueCode: 'resource-partial'
      value:
        | PreviewResourcePlaceholder
        | PreviewPartialResourceObservation<Operation>
        | PreviewResourceValueByOperation[Operation]
    }>
}[PreviewOperationName]

type PreviewContradictoryResourceOutcome = {
  [Operation in PreviewOperationName]: PreviewResourceOutcomeBase<Operation> & Readonly<{
      state: 'contradictory'
      issueCode: 'resource-contradictory'
      value: PreviewResourcePlaceholder | PreviewResourceValueByOperation[Operation]
    }>
}[PreviewOperationName]

type PreviewNullResourceOutcome = PreviewResourceOutcomeBase<PreviewOperationName> & (
  | Readonly<{
      state: 'missing'
      issueCode: 'resource-missing'
      value: null
    }>
  | Readonly<{
      state: 'unavailable'
      issueCode: 'resource-unavailable'
      value: null
    }>
  | Readonly<{
      state: 'malformed'
      issueCode: 'resource-malformed'
      value: null
    }>
)

export type PreviewResourceOutcome =
  | PreviewCompleteResourceOutcome
  | PreviewPartialResourceOutcome
  | PreviewContradictoryResourceOutcome
  | PreviewNullResourceOutcome

export interface PreviewSingleReadSnapshot {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-single-read-observation'
  readonly environment: 'preview'
  readonly capturedAtMs: number
  readonly observationState: PreviewResourceOutcomeState
  readonly resourceOutcomes: readonly PreviewResourceOutcome[]
  readonly freshnessStatus: 'unknown'
  readonly releaseCurrentness: 'UNKNOWN'
  readonly executionAuthorization: 'prohibited'
  readonly noRemoteMutation: true
  readonly noSecretValues: true
  readonly productionContacted: false
}

export const PREVIEW_SINGLE_READ_SCHEMA_VERSION: 1
export const PREVIEW_SINGLE_READ_KIND: 'pennant-pursuit-preview-single-read-observation'
export const PREVIEW_RESOURCE_OUTCOME_STATES: readonly PreviewResourceOutcomeState[]

export function validatePreviewSingleReadSnapshot(input: unknown): PreviewSingleReadSnapshot
export function createPreviewSingleReadSnapshot(input: {
  capturedAtMs: number
  resourceOutcomes?: readonly PreviewResourceOutcome[]
}): PreviewSingleReadSnapshot
export function renderPreviewSingleReadJson(input: unknown): string
