export type LeaderboardRecoveryFeatureState = 'enabled' | 'disabled'

export interface LeaderboardRecoveryModeEnv {
  readonly LEADERBOARD_RECOVERY_MODE?: unknown
}

export function leaderboardRecoveryFeatureState(
  env: LeaderboardRecoveryModeEnv,
): LeaderboardRecoveryFeatureState {
  return env.LEADERBOARD_RECOVERY_MODE === 'enabled' ? 'enabled' : 'disabled'
}

export function isLeaderboardRecoveryEnabled(env: LeaderboardRecoveryModeEnv) {
  return leaderboardRecoveryFeatureState(env) === 'enabled'
}
