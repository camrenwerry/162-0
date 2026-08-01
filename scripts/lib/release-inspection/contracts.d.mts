import type { Schema4Capability } from '../../../shared/schema4-capabilities.mjs'

export type ReleaseInspectionEnvironment = 'preview' | 'production'
export type ReleaseInspectionSurface = 'frontend' | 'pages' | 'worker' | 'schedule'
export type ReleaseInspectionMode = 'disabled' | 'enabled'
export type ReleaseInspectionProjectedState = ReleaseInspectionMode | 'unknown' | 'not-applicable'
export type ReleaseInspectionSecretPolicy = 'required' | 'allowed' | 'forbidden' | 'not-applicable' | 'unresolved'

export type ReleaseInspectionCapabilityTarget = Readonly<Record<
  ReleaseInspectionEnvironment,
  Readonly<Record<Schema4Capability, ReleaseInspectionMode>>
>>

export interface ReleaseInspectionEvidence {
  readonly availability: 'available' | 'unavailable' | 'not-applicable'
  readonly provenance: 'local-authority' | 'local-configuration' | 'protected-frontend' | 'not-applicable'
  readonly sourceHash: string | null
  readonly sourcePath: string | null
}

export interface ReleaseInspectionSurfaceState {
  readonly applicability: 'applicable' | 'not-applicable'
  readonly configuredState: ReleaseInspectionProjectedState
  readonly effectiveState: ReleaseInspectionProjectedState
  readonly evidence: ReleaseInspectionEvidence
}

export interface ReleaseInspectionCapabilityRecord {
  readonly authority: Readonly<{
    configuredState: ReleaseInspectionMode
    evidence: ReleaseInspectionEvidence
  }>
  readonly compatibilityCeiling: 'disabled' | 'not-applicable'
  readonly emergencyStopInfluence: 'forced-disabled'
  readonly effectiveState: 'disabled'
  readonly surfaces: Readonly<Record<ReleaseInspectionSurface, ReleaseInspectionSurfaceState>>
}

export interface ReleaseInspectionCapabilityMatrix {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-release-inspection-capability-matrix'
  readonly environments: Readonly<Record<ReleaseInspectionEnvironment, Readonly<{
    authorityContext: Readonly<{
      environment: ReleaseInspectionEnvironment
      reviewedAtMs: null
      expiresAtMs: null
      emergencyStop: 'engaged'
      identityCompatibilityCeiling: 'disabled'
      evidence: ReleaseInspectionEvidence
    }>
    capabilities: Readonly<Record<Schema4Capability, ReleaseInspectionCapabilityRecord>>
  }>>>
}

export interface ReleaseInspectionManifest {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-release-inspection-manifest'
  readonly toolContractVersion: 'release-inspection-local-only-v1'
  readonly policy: Readonly<Record<string, string>>
  readonly sources: Readonly<Record<string, string>>
  readonly localTopologyPolicy: Readonly<Record<string, string>>
  readonly providerBuildPolicy: Readonly<Record<string, string>>
  readonly secretPolicies: Readonly<Record<
    ReleaseInspectionEnvironment,
    Readonly<Record<ReleaseInspectionSurface, Readonly<Record<string, ReleaseInspectionSecretPolicy>>>>
  >>
}

export interface ReleaseInspectionBinding {
  readonly name: string
  readonly type: 'd1' | 'plain-text' | 'rate-limit' | 'service'
  readonly value: string
}

export interface ReleaseInspectionPublicExposure {
  readonly evidenceStatus: 'local-configuration' | 'not-applicable' | 'unavailable'
  readonly customDomains: readonly string[] | null
  readonly routes: readonly string[] | null
  readonly previewUrls: boolean | 'not-applicable'
  readonly workersDev: boolean | 'not-applicable'
}

export interface ReleaseInspectionBindingSurface {
  readonly bindings: readonly ReleaseInspectionBinding[]
  readonly publicExposure: ReleaseInspectionPublicExposure
  readonly schedules: Readonly<{
    policy: 'exact-empty' | 'not-applicable'
    values: readonly string[]
  }>
  readonly secretPolicies: Readonly<Record<string, ReleaseInspectionSecretPolicy>>
}

export interface ReleaseInspectionBindingPolicy {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-release-inspection-binding-policy'
  readonly environments: Readonly<Record<ReleaseInspectionEnvironment, Readonly<
    Record<ReleaseInspectionSurface, ReleaseInspectionBindingSurface> & {
      readonly platformPrerequisites: Readonly<Record<'pages' | 'worker', Readonly<{
        DRAFT_TICKET_MODE: ReleaseInspectionMode
        DRAFT_VALIDATION_MODE: ReleaseInspectionMode
      }>>>
      readonly providerBuildSettings: Readonly<{
        localEvidence: Readonly<{
          pagesBuildOutputDirectory: 'dist'
          pagesCompatibilityDate: string
          pagesD1Configuration: Readonly<{
            migrationsDirectory: string
            previewDatabaseId: string | null
          }>
          pagesProjectName: 'diamond-draft'
          protectedFrontendSource: string
          redirectsHash: string
          routesHash: string
          workerCompatibilityDate: string
          workerD1Configuration: Readonly<{
            migrationsDirectory: string
            previewDatabaseId: string | null
          }> | null
          workerMain: string
          workerName: string
          workerRateLimits: readonly Readonly<{
            limit: number
            name: string
            namespaceId: string
            period: number
          }>[]
        }>
        remoteEvidence: 'unavailable'
      }>
    }
  >>>
}

export interface ReleaseInspectionLocalProjection {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-release-inspection-local-projection'
  readonly toolContractVersion: 'release-inspection-local-only-v1'
  readonly policy: 'all-disabled'
  readonly manifestHash: string
  readonly authorityHash: string
  readonly protectedSourceHashes: readonly Readonly<{ path: string; sha256: string }>[]
  readonly capabilityMatrix: ReleaseInspectionCapabilityMatrix
  readonly bindingPolicy: ReleaseInspectionBindingPolicy
  readonly remoteObservation: Readonly<Record<string, unknown>>
  readonly result: 'UNKNOWN'
  readonly executionAuthorization: 'prohibited'
  readonly noNetworkAccess: true
  readonly noFilesystemWrites: true
}

export interface ReleaseInspectionTrustedSourceContext {
  readonly protectedSourceHashes: readonly Readonly<{ path: string; sha256: string }>[]
}

export const RELEASE_INSPECTION_SCHEMA_VERSION: 1
export const RELEASE_INSPECTION_TOOL_CONTRACT_VERSION: 'release-inspection-local-only-v1'
export const RELEASE_INSPECTION_ENVIRONMENTS: readonly ReleaseInspectionEnvironment[]
export const RELEASE_INSPECTION_CAPABILITIES: readonly Schema4Capability[]
export const RELEASE_INSPECTION_SURFACES: readonly ReleaseInspectionSurface[]
export const RELEASE_INSPECTION_SECRET_NAMES: readonly string[]
export const RELEASE_INSPECTION_SECRET_POLICY_STATES: readonly ReleaseInspectionSecretPolicy[]
export const RELEASE_INSPECTION_KINDS: Readonly<Record<string, string>>
export const RELEASE_INSPECTION_MANIFEST_SOURCES: Readonly<Record<string, string>>
export const RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS: readonly string[]
export const RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES: Readonly<Record<string, string>>

export function createAllDisabledCapabilityTarget(): ReleaseInspectionCapabilityTarget
export function validateCapabilityTarget(input: unknown, options?: Readonly<{ enforceAllDisabledPolicy?: boolean }>): ReleaseInspectionCapabilityTarget
export function parseCapabilityTarget(source: string, options?: Readonly<{ enforceAllDisabledPolicy?: boolean }>): ReleaseInspectionCapabilityTarget
export function validateReleaseInspectionManifest(input: unknown): ReleaseInspectionManifest
export function parseReleaseInspectionManifest(source: string): ReleaseInspectionManifest
export function validateCapabilityMatrix(input: unknown, trustedContext: ReleaseInspectionTrustedSourceContext): ReleaseInspectionCapabilityMatrix
export function validateBindingPolicy(input: unknown, trustedContext: ReleaseInspectionTrustedSourceContext): ReleaseInspectionBindingPolicy
export function validateSecretPresencePolicy(input: unknown): ReleaseInspectionSecretPolicy
export function validateObservationPlaceholder(input: unknown): Readonly<Record<string, unknown>>
export function validateLocalProjection(input: unknown): ReleaseInspectionLocalProjection
export function canonicalReleaseInspectionJson(value: unknown, trustedContext?: ReleaseInspectionTrustedSourceContext): string
export function assertNoReleaseInspectionArtifactForLegacyExecution<T>(input: T): T
export function releaseInspectionHash(value: unknown): string
