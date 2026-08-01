export type Schema4Capability =
  | 'leaderboardRead'
  | 'identityClaim'
  | 'identityStatus'
  | 'identityRename'
  | 'draftSubmission'
  | 'identityRecovery'
  | 'cleanupCron'

export interface Schema4RuntimeGateDescriptor {
  readonly feature: string
  readonly variable: string | null
  readonly compatibilityCeiling: string | null
}

export type Schema4RuntimeSurface = 'frontendBuild' | 'pagesFunctions' | 'privateWorker'
export type Schema4RuntimeGateRegistry = Readonly<{
  frontendBuildTime: Readonly<{
    protectedSource: 'src/config/protectedCapabilities.mjs'
    effectiveState: 'all-disabled'
    integrationStatus: 'protected-local-source'
  }>
  capabilities: Readonly<Record<Schema4Capability, Readonly<{
    frontendBuild: Schema4RuntimeGateDescriptor | null
    pagesFunctions: Schema4RuntimeGateDescriptor | null
    privateWorker: Schema4RuntimeGateDescriptor | null
  }>>>
}>

export const SCHEMA4_CAPABILITIES: readonly Schema4Capability[]
export const SCHEMA4_RUNTIME_GATE_REGISTRY: Schema4RuntimeGateRegistry
export function runtimeGateFeatureState(
  environment: object | null | undefined,
  descriptor: Schema4RuntimeGateDescriptor | null,
): 'enabled' | 'disabled'
