export type PreviewEndpointFamily = 'account' | 'zones' | 'pages' | 'workers' | 'd1'
export type PreviewOperationName =
  | 'account'
  | 'account-zones'
  | 'pages-project'
  | 'pages-preview-deployments'
  | 'worker-settings'
  | 'worker-deployments'
  | 'worker-subdomain'
  | 'worker-schedules'
  | 'worker-custom-domains'
  | 'worker-routes'
  | 'd1-database'
  | 'migration-table-discovery'
  | 'migration-rows'
  | 'backend-schema-version'
export type D1SelectOperationName =
  | 'migration-table-discovery'
  | 'migration-rows'
  | 'backend-schema-version'

export interface RemoteObservationLimits {
  readonly maximumReviewedRouteZones: 32
  readonly maximumRequestsPerFullRead: 64
  readonly maximumRequestsPerDoubleRead: 128
  readonly maximumPaginationPages: 10
  readonly maximumRecordsPerFamily: 250
  readonly maximumResponseBytes: 1048576
  readonly maximumSerializedObservationBytes: 1048576
  readonly requestTimeoutMs: 10000
  readonly fullReadTimeoutMs: 120000
  readonly doubleReadTimeoutMs: 300000
  readonly stableReadDelayMs: 2000
  readonly freshnessWindowMs: 300000
  readonly maximumFutureClockSkewMs: 1000
  readonly concurrency: 1
  readonly automaticRetries: 0
  readonly redirectPolicy: 'reject-every-3xx'
}

export interface PreviewObservationIdentity {
  readonly accountId: string
  readonly pagesProject: 'diamond-draft'
  readonly workerName: 'pennant-pursuit-validation-preview'
  readonly databaseId: 'ba6255b4-9425-4863-b10f-79149180f75a'
  readonly routeZoneIds: readonly string[]
}

export interface PreviewObservationCredentialEnvironment {
  readonly PENNANT_PREVIEW_API_TOKEN: string
}

export interface PreviewOperationDefinition {
  readonly name: PreviewOperationName
  readonly endpointFamily: PreviewEndpointFamily
  readonly method: 'GET' | 'POST'
  readonly origin: 'https://api.cloudflare.com'
  readonly pathTemplate: string
  readonly parameterKeys: readonly string[]
  readonly pagination: Readonly<{
    kind: 'none' | 'page' | 'filtered-single-page'
    pageSize: 25 | null
    maximumPages: number
    maximumRecords: 250
  }>
  readonly responseLimitBytes: 1048576
  readonly requestBudgetWeight: 1
  readonly previewIdentityFields: readonly string[]
  readonly productionPoisoning: 'reject-raw-normalized-repeatedly-encoded'
  readonly operationClass: 'get' | 'exact-select-post'
  readonly sql: string | null
  readonly params: readonly [] | null
  readonly secretPresenceContract: 'unavailable'
}

export interface PreviewOperationRequest {
  readonly operation: PreviewOperationName
  readonly endpointFamily: PreviewEndpointFamily
  readonly method: 'GET' | 'POST'
  readonly origin: 'https://api.cloudflare.com'
  readonly path: string
  readonly query: ReadonlyArray<Readonly<{ name: string; value: string }>>
  readonly body: Readonly<{ sql: string; params: readonly [] }> | null
  readonly parameters: Readonly<Record<string, string | number>>
  readonly paginationPolicy: PreviewOperationDefinition['pagination']
  readonly redirectPolicy: 'reject-every-3xx'
  readonly timeoutMs: 10000
  readonly responseLimitBytes: 1048576
  readonly requestBudgetWeight: 1
  readonly previewOnly: true
  readonly productionPoisoning: 'reject-raw-normalized-repeatedly-encoded'
}

export interface RequestBudget {
  readonly kind: 'full-read' | 'double-read'
  readonly used: number
  readonly remaining: number
  readonly maximum: 64 | 128
}

export const REMOTE_OBSERVATION_ORIGIN: 'https://api.cloudflare.com'
export const REMOTE_OBSERVATION_LIMITS: RemoteObservationLimits
export const REMOTE_RESPONSE_JSON_LIMITS: Readonly<{ maxBytes: 1048576; maxDepth: 48; maxNodes: 50000 }>
export const MIGRATION_TABLE_DISCOVERY_SQL: string
export const MIGRATION_ROWS_SQL: string
export const BACKEND_SCHEMA_VERSION_SQL: string
export const PREVIEW_OPERATION_REGISTRY: Readonly<Record<PreviewOperationName, PreviewOperationDefinition>>
export const PREVIEW_OPERATION_NAMES: readonly PreviewOperationName[]
export const PREVIEW_ENDPOINT_FAMILIES: readonly PreviewEndpointFamily[]

export function validateD1SelectBody(operationName: D1SelectOperationName, input: unknown): Readonly<{ sql: string; params: readonly [] }>
export function createPreviewOperationRequest(operationName: PreviewOperationName, inputParameters: unknown, inputIdentity: PreviewObservationIdentity): PreviewOperationRequest
export function validatePreviewOperationRequest(input: unknown, identity: PreviewObservationIdentity): PreviewOperationRequest
export function parseStrictRemoteJson(bytes: Uint8Array): Readonly<Record<string, unknown>>
export function validateObservationCredentialEnvironment(environment: PreviewObservationCredentialEnvironment): Readonly<{
  credentialName: 'PENNANT_PREVIEW_API_TOKEN'
  available: true
  scope: 'unverified'
}>
export function validateRemoteObservationLimits(input: unknown): RemoteObservationLimits
export function createRequestBudget(kind: 'full-read' | 'double-read'): RequestBudget
export function consumeRequestBudget(inputBudget: RequestBudget, operationName: PreviewOperationName, count?: number): RequestBudget
export function assertPaginationBudget(input: unknown): Readonly<{ page: number; pages: number; records: number }>
export function assertReviewedRouteZoneBudget(routeZoneIds: unknown): readonly string[]
export function assertSerializedObservationBudget(serialized: string): string
