import {
  SCHEMA4_RUNTIME_GATE_REGISTRY,
  type Schema4RuntimeGateRegistry,
  type Schema4RuntimeSurface,
} from '../../shared/schema4-capabilities.mjs'
import {
  immutableRuntimeConsumerRegistration,
  runtimeConsumerFeatureState,
} from '../../shared/schema4-runtime-consumers.mjs'
import registrationData from './leaderboard-identity-mode.registrations.json'

export type LeaderboardIdentityFeatureState = 'enabled' | 'disabled'
export const LEADERBOARD_IDENTITY_CAPABILITIES = Object.freeze([
  'availability',
  'claim',
  'recover',
  'rename',
  'status',
] as const)
export type LeaderboardIdentityCapability = typeof LEADERBOARD_IDENTITY_CAPABILITIES[number]

export interface LeaderboardIdentityModeEnv {
  readonly LEADERBOARD_IDENTITY_MODE?: unknown
  readonly LEADERBOARD_IDENTITY_CLAIM_MODE?: unknown
  readonly LEADERBOARD_IDENTITY_STATUS_MODE?: unknown
  readonly LEADERBOARD_IDENTITY_RENAME_MODE?: unknown
  readonly LEADERBOARD_RECOVERY_MODE?: unknown
  readonly LEADERBOARD_IDENTITY_SIGNING_KEY?: unknown
}

const MINIMUM_IDENTITY_KEY_LENGTH = 32
const MAXIMUM_IDENTITY_KEY_LENGTH = 4_096
type CanonicalIdentityCapability =
  | 'identityClaim'
  | 'identityStatus'
  | 'identityRename'
  | 'identityRecovery'

function immutableIdentityRegistrations(surface: 'pagesFunctions' | 'privateWorker') {
  return Object.freeze(Object.fromEntries(
    Object.entries(registrationData[surface]).map(([capability, registration]) => [
      capability,
      immutableRuntimeConsumerRegistration(registration),
    ]),
  )) as Readonly<Record<
    CanonicalIdentityCapability,
    ReturnType<typeof immutableRuntimeConsumerRegistration>
  >>
}

export const LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS = Object.freeze({
  pagesFunctions: immutableIdentityRegistrations('pagesFunctions'),
  privateWorker: immutableIdentityRegistrations('privateWorker'),
})

export function leaderboardIdentityFeatureState(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): LeaderboardIdentityFeatureState {
  return identityCompatibilityFeatureState(env, 'pagesFunctions', registry)
}

export function isLeaderboardIdentityEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return leaderboardIdentityFeatureState(env, registry) === 'enabled'
}

export function privateWorkerLeaderboardIdentityFeatureState(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): LeaderboardIdentityFeatureState {
  return identityCompatibilityFeatureState(env, 'privateWorker', registry)
}

export function isPrivateWorkerLeaderboardIdentityEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return privateWorkerLeaderboardIdentityFeatureState(env, registry) === 'enabled'
}

export function isLeaderboardIdentityCapability(
  value: unknown,
): value is LeaderboardIdentityCapability {
  return typeof value === 'string'
    && (LEADERBOARD_IDENTITY_CAPABILITIES as readonly string[]).includes(value)
}

function assertNeverCapability(value: never): never {
  throw new TypeError(`Unhandled leaderboard identity capability: ${String(value)}`)
}

function canonicalIdentityCapability(
  capability: Exclude<LeaderboardIdentityCapability, 'availability'>,
): CanonicalIdentityCapability {
  switch (capability) {
    case 'claim': return 'identityClaim'
    case 'status': return 'identityStatus'
    case 'rename': return 'identityRename'
    case 'recover': return 'identityRecovery'
    default: return assertNeverCapability(capability)
  }
}

function identityCompatibilityFeatureState(
  env: LeaderboardIdentityModeEnv,
  surface: Exclude<Schema4RuntimeSurface, 'frontendBuild'>,
  registry: Schema4RuntimeGateRegistry,
): LeaderboardIdentityFeatureState {
  const descriptor = registry.capabilities.identityClaim[surface]
  const ceiling = descriptor?.compatibilityCeiling
  if (!ceiling || !(ceiling in env)) return 'disabled'
  return Reflect.get(env, ceiling) === 'enabled' ? 'enabled' : 'disabled'
}

function identityConsumerFeatureState(
  env: LeaderboardIdentityModeEnv,
  capability: Exclude<LeaderboardIdentityCapability, 'availability'>,
  surface: Exclude<Schema4RuntimeSurface, 'frontendBuild'>,
  registry: Schema4RuntimeGateRegistry,
) {
  return runtimeConsumerFeatureState(
    env,
    LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS[surface][canonicalIdentityCapability(capability)],
    registry,
  )
}

function knownCapabilityFeatureState(
  env: LeaderboardIdentityModeEnv,
  capability: LeaderboardIdentityCapability,
  surface: Exclude<Schema4RuntimeSurface, 'frontendBuild'>,
  registry: Schema4RuntimeGateRegistry,
): LeaderboardIdentityFeatureState {
  switch (capability) {
    case 'availability':
      return identityConsumerFeatureState(env, 'claim', surface, registry) === 'enabled'
        || identityConsumerFeatureState(env, 'rename', surface, registry) === 'enabled'
        ? 'enabled'
        : 'disabled'
    case 'claim':
    case 'status':
    case 'rename':
    case 'recover':
      return identityConsumerFeatureState(env, capability, surface, registry)
    default:
      return assertNeverCapability(capability)
  }
}

export function leaderboardIdentityCapabilityFeatureState(
  env: LeaderboardIdentityModeEnv,
  capability: unknown,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): LeaderboardIdentityFeatureState {
  if (!isLeaderboardIdentityCapability(capability)) return 'disabled'
  return knownCapabilityFeatureState(env, capability, 'pagesFunctions', registry)
}

export function isLeaderboardIdentityCapabilityEnabled(
  env: LeaderboardIdentityModeEnv,
  capability: unknown,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return leaderboardIdentityCapabilityFeatureState(env, capability, registry) === 'enabled'
}

export function privateWorkerLeaderboardIdentityCapabilityFeatureState(
  env: LeaderboardIdentityModeEnv,
  capability: unknown,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): LeaderboardIdentityFeatureState {
  if (!isLeaderboardIdentityCapability(capability)) return 'disabled'
  return knownCapabilityFeatureState(env, capability, 'privateWorker', registry)
}

export function isPrivateWorkerLeaderboardIdentityCapabilityEnabled(
  env: LeaderboardIdentityModeEnv,
  capability: unknown,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return privateWorkerLeaderboardIdentityCapabilityFeatureState(env, capability, registry) === 'enabled'
}

export function isLeaderboardIdentityClaimEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'claim', registry)
}

export function isPrivateWorkerLeaderboardIdentityClaimEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isPrivateWorkerLeaderboardIdentityCapabilityEnabled(env, 'claim', registry)
}

export function isLeaderboardIdentityStatusEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'status', registry)
}

export function isPrivateWorkerLeaderboardIdentityStatusEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isPrivateWorkerLeaderboardIdentityCapabilityEnabled(env, 'status', registry)
}

export function isLeaderboardIdentityRenameEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'rename', registry)
}

export function isPrivateWorkerLeaderboardIdentityRenameEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isPrivateWorkerLeaderboardIdentityCapabilityEnabled(env, 'rename', registry)
}

export function isLeaderboardIdentityRecoveryEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'recover', registry)
}

export function isPrivateWorkerLeaderboardIdentityRecoveryEnabled(
  env: LeaderboardIdentityModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return isPrivateWorkerLeaderboardIdentityCapabilityEnabled(env, 'recover', registry)
}

export function isLeaderboardIdentitySigningKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= MINIMUM_IDENTITY_KEY_LENGTH
    && value.length <= MAXIMUM_IDENTITY_KEY_LENGTH
}
