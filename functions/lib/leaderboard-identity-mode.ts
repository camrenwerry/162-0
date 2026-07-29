export type LeaderboardIdentityFeatureState = 'enabled' | 'disabled'

export interface LeaderboardIdentityModeEnv {
  readonly LEADERBOARD_IDENTITY_MODE?: unknown
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

export function isLeaderboardIdentitySigningKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= MINIMUM_IDENTITY_KEY_LENGTH
    && value.length <= MAXIMUM_IDENTITY_KEY_LENGTH
}
