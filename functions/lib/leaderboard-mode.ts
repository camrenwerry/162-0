export type LeaderboardReadFeatureState = 'enabled' | 'disabled'

export interface LeaderboardReadModeEnv {
  readonly LEADERBOARD_READ_MODE?: unknown
  readonly LEADERBOARD_ENVIRONMENT?: unknown
  readonly LEADERBOARD_CURSOR_SIGNING_KEY?: unknown
}

const MINIMUM_CURSOR_KEY_LENGTH = 32
const MAXIMUM_CURSOR_KEY_LENGTH = 4_096

export function leaderboardReadFeatureState(env: LeaderboardReadModeEnv): LeaderboardReadFeatureState {
  return env.LEADERBOARD_READ_MODE === 'enabled' ? 'enabled' : 'disabled'
}

export function isLeaderboardReadEnabled(env: LeaderboardReadModeEnv) {
  return leaderboardReadFeatureState(env) === 'enabled'
}

export function isLeaderboardCursorSigningKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= MINIMUM_CURSOR_KEY_LENGTH
    && value.length <= MAXIMUM_CURSOR_KEY_LENGTH
}

export function leaderboardReadRuntimeIsConfigured(env: LeaderboardReadModeEnv) {
  return (env.LEADERBOARD_ENVIRONMENT === 'preview' || env.LEADERBOARD_ENVIRONMENT === 'production')
    && isLeaderboardCursorSigningKey(env.LEADERBOARD_CURSOR_SIGNING_KEY)
}
