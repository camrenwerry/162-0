import type { Schema4Capability } from '../../../shared/schema4-capabilities.mjs'
import type { PreviewEndpointFamily, PreviewOperationName } from './remote-transport.mjs'

export type RemoteObservationComparison = 'MATCH' | 'DRIFT' | 'UNKNOWN' | 'UNAVAILABLE'
export type RemoteEvidenceAvailability = 'available' | 'unavailable' | 'not-applicable'
export type RemoteEvidenceCompleteness = 'complete' | 'partial' | 'not-attempted' | 'not-applicable'
export type RemoteEvidenceReason =
  | 'observed-match'
  | 'observed-drift'
  | 'unknown-observation'
  | 'offline-observation-not-attempted'
  | 'identity-grounding-required'
  | 'secret-presence-contract-unavailable'
  | 'not-applicable'
  | 'partial-response'
  | 'unstable-double-read'
  | 'prerequisite-unavailable'
  | 'malformed-response'
  | 'pagination-incomplete'
  | 'request-budget-exhausted'
  | 'response-limit-exceeded'
  | 'freshness-expired'

export type RemoteUnavailableEvidenceReason =
  | 'offline-observation-not-attempted'
  | 'identity-grounding-required'
  | 'secret-presence-contract-unavailable'
  | 'prerequisite-unavailable'

export type RemoteEvidenceValue =
  | string
  | number
  | boolean
  | null
  | readonly RemoteEvidenceValue[]

export interface RemoteEvidence {
  readonly availability: RemoteEvidenceAvailability
  readonly completeness: RemoteEvidenceCompleteness
  readonly comparison: RemoteObservationComparison
  readonly expected: RemoteEvidenceValue
  readonly observed: RemoteEvidenceValue
  readonly reason: RemoteEvidenceReason
  readonly endpointFamily: PreviewEndpointFamily | 'not-applicable'
  readonly operation: PreviewOperationName | 'not-applicable'
  readonly httpMethod: 'GET' | 'POST' | 'not-applicable'
  readonly readOrdinals: readonly (1 | 2)[]
  readonly capturedAtMs: Readonly<{
    firstRead: number | null
    secondRead: number | null
  }>
}

export type RemoteResourceKey =
  | 'account'
  | 'accountZones'
  | 'pagesProject'
  | 'pagesPreviewDeployments'
  | 'workerSettings'
  | 'workerDeployments'
  | 'workerPublicUrl'
  | 'workerSchedules'
  | 'workerCustomDomains'
  | 'workerRoutes'
  | 'd1Database'
  | 'secretPresence'

export type RemoteMigrationKey =
  | 'tableDiscovery'
  | 'migrationRows'
  | 'backendSchemaVersion'
  | 'appliedSourceHashes'

export interface RemoteObservationLocalExpectations {
  readonly authorityHash: string
  readonly manifestHash: string
  readonly expectationHash: string
  readonly protectedSourceHashes: ReadonlyArray<Readonly<{ path: string; sha256: string }>>
}

export interface RemotePaginationCapture {
  readonly completeness: 'not-attempted' | 'complete' | 'partial'
  readonly pagesRead: number
  readonly recordsRead: number
}

export interface RemoteCaptureMetadata {
  readonly mode: 'offline' | 'online-preview'
  readonly captureStartedAtMs: number | null
  readonly captureCompletedAtMs: number | null
  readonly expiresAtMs: number | null
  readonly freshnessStatus: 'not-applicable' | 'fresh' | 'stale' | 'unknown'
  readonly credentialScope: 'unverified'
  readonly reviewedRouteZoneCount: number
  readonly requestCounts: Readonly<{
    firstRead: number
    secondRead: number
    total: number
  }>
  readonly stableRead: Readonly<{
    status: 'not-attempted' | 'stable' | 'unstable' | 'incomplete'
    delayMs: 2000
    firstReadCompletedAtMs: number | null
    secondReadStartedAtMs: number | null
    secondReadCompletedAtMs: number | null
    firstSemanticHash: string | null
    secondSemanticHash: string | null
  }>
  readonly pagination: Readonly<{
    accountZones: RemotePaginationCapture
    pagesPreviewDeployments: RemotePaginationCapture
    workerCustomDomains: RemotePaginationCapture
  }>
  readonly responseCompleteness: 'not-attempted' | 'complete' | 'partial'
}

export interface RemoteObservationTimeContext {
  readonly nowMs: number
}

export interface RemoteObservationArtifact {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-release-inspection-remote-observation'
  readonly toolContractVersion: 'release-inspection-read-only-observation-v1'
  readonly localExpectations: Readonly<RemoteObservationLocalExpectations>
  readonly capture: Readonly<RemoteCaptureMetadata>
  readonly environments: Readonly<{
    preview: Readonly<{
      contactStatus: 'not-attempted' | 'attempted'
      comparison: RemoteObservationComparison
      completeness: 'not-attempted' | 'complete' | 'partial'
      reason: RemoteEvidenceReason
      resources: Readonly<Record<RemoteResourceKey, RemoteEvidence>>
      capabilities: Readonly<Record<Schema4Capability, Readonly<{
        comparison: RemoteObservationComparison
        surfaces: Readonly<Record<'frontend' | 'pages' | 'worker' | 'schedule', RemoteEvidence>>
      }>>>
      migrationObservation: Readonly<Record<RemoteMigrationKey, RemoteEvidence>>
    }>
    production: Readonly<{
      contactStatus: 'not-attempted'
      comparison: 'UNAVAILABLE'
      completeness: 'not-attempted'
      reason: 'production-remote-inspection-excluded'
      remoteEvidence: 'excluded'
    }>
  }>
  readonly releaseCurrentness: 'UNKNOWN'
  readonly executionAuthorization: 'prohibited'
  readonly noRemoteMutation: true
  readonly noFilesystemWrites: true
  readonly noSecretValues: true
  readonly productionContacted: false
}

export const REMOTE_OBSERVATION_SCHEMA_VERSION: 1
export const REMOTE_OBSERVATION_KIND: 'pennant-pursuit-release-inspection-remote-observation'
export const REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION: 'release-inspection-read-only-observation-v1'
export const REMOTE_OBSERVATION_COMPARISONS: readonly RemoteObservationComparison[]
export const REMOTE_EVIDENCE_AVAILABILITY: readonly RemoteEvidenceAvailability[]
export const REMOTE_EVIDENCE_COMPLETENESS: readonly RemoteEvidenceCompleteness[]
export const REMOTE_EVIDENCE_REASONS: readonly RemoteEvidenceReason[]
export const REMOTE_RESOURCE_KEYS: readonly RemoteResourceKey[]
export const REMOTE_MIGRATION_KEYS: readonly RemoteMigrationKey[]
export const REMOTE_OBSERVATION_LOCAL_EXPECTATIONS: Readonly<RemoteObservationLocalExpectations>

export function validateRemoteEvidence(input: unknown): RemoteEvidence
export function createUnavailableRemoteEvidence(reason?: RemoteUnavailableEvidenceReason): RemoteEvidence
export function validateRemoteObservationArtifact(input: unknown, timeContext?: RemoteObservationTimeContext): RemoteObservationArtifact
export function createOfflineRemoteObservation(): RemoteObservationArtifact
export function parseRemoteObservationArtifact(source: string, timeContext?: RemoteObservationTimeContext): RemoteObservationArtifact
export function renderRemoteObservationJson(input: unknown, timeContext?: RemoteObservationTimeContext): string
