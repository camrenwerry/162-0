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

export function leaderboardIdentityFeatureState(
  env: LeaderboardIdentityModeEnv,
): LeaderboardIdentityFeatureState {
  return env.LEADERBOARD_IDENTITY_MODE === 'enabled' ? 'enabled' : 'disabled'
}

export function isLeaderboardIdentityEnabled(env: LeaderboardIdentityModeEnv) {
  return leaderboardIdentityFeatureState(env) === 'enabled'
}

function exactCapabilityEnabled(value: unknown) {
  return value === 'enabled'
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

function knownCapabilityFeatureState(
  env: LeaderboardIdentityModeEnv,
  capability: LeaderboardIdentityCapability,
): LeaderboardIdentityFeatureState {
  switch (capability) {
    case 'availability':
      return exactCapabilityEnabled(env.LEADERBOARD_IDENTITY_CLAIM_MODE)
        || exactCapabilityEnabled(env.LEADERBOARD_IDENTITY_RENAME_MODE)
        ? 'enabled'
        : 'disabled'
    case 'claim':
      return exactCapabilityEnabled(env.LEADERBOARD_IDENTITY_CLAIM_MODE)
        ? 'enabled'
        : 'disabled'
    case 'status':
      return exactCapabilityEnabled(env.LEADERBOARD_IDENTITY_STATUS_MODE)
        ? 'enabled'
        : 'disabled'
    case 'rename':
      return exactCapabilityEnabled(env.LEADERBOARD_IDENTITY_RENAME_MODE)
        ? 'enabled'
        : 'disabled'
    case 'recover':
      return exactCapabilityEnabled(env.LEADERBOARD_RECOVERY_MODE)
        ? 'enabled'
        : 'disabled'
    default:
      return assertNeverCapability(capability)
  }
}

export function leaderboardIdentityCapabilityFeatureState(
  env: LeaderboardIdentityModeEnv,
  capability: unknown,
): LeaderboardIdentityFeatureState {
  if (!isLeaderboardIdentityEnabled(env) || !isLeaderboardIdentityCapability(capability)) {
    return 'disabled'
  }
  return knownCapabilityFeatureState(env, capability)
}

export function isLeaderboardIdentityCapabilityEnabled(
  env: LeaderboardIdentityModeEnv,
  capability: unknown,
) {
  return leaderboardIdentityCapabilityFeatureState(env, capability) === 'enabled'
}

export function isLeaderboardIdentityClaimEnabled(env: LeaderboardIdentityModeEnv) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'claim')
}

export function isLeaderboardIdentityStatusEnabled(env: LeaderboardIdentityModeEnv) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'status')
}

export function isLeaderboardIdentityRenameEnabled(env: LeaderboardIdentityModeEnv) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'rename')
}

export function isLeaderboardIdentityRecoveryEnabled(env: LeaderboardIdentityModeEnv) {
  return isLeaderboardIdentityCapabilityEnabled(env, 'recover')
}

export function isLeaderboardIdentitySigningKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= MINIMUM_IDENTITY_KEY_LENGTH
    && value.length <= MAXIMUM_IDENTITY_KEY_LENGTH
}
