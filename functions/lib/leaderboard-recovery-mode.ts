import {
  isLeaderboardIdentityRecoveryEnabled,
  type LeaderboardIdentityModeEnv,
} from './leaderboard-identity-mode'

export type LeaderboardRecoveryFeatureState = 'enabled' | 'disabled'

export type LeaderboardRecoveryModeEnv = LeaderboardIdentityModeEnv

export function leaderboardRecoveryFeatureState(
  env: LeaderboardRecoveryModeEnv,
): LeaderboardRecoveryFeatureState {
  return isLeaderboardIdentityRecoveryEnabled(env) ? 'enabled' : 'disabled'
}

export function isLeaderboardRecoveryEnabled(env: LeaderboardRecoveryModeEnv) {
  return leaderboardRecoveryFeatureState(env) === 'enabled'
}
