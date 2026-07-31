import {
  handleLeaderboardIdentityProxyRequest,
  type LeaderboardIdentityProxyEnv,
} from '../../lib/leaderboard-identity-proxy'
import { handleApiNotFoundRequest } from '../../lib/api-response'
import {
  isLeaderboardRecoveryEnabled,
  type LeaderboardRecoveryModeEnv,
} from '../../lib/leaderboard-recovery-mode'

const PRIVATE_PATH = '/api/v1/leaderboard-identity-recover'
type RecoveryEnv = LeaderboardIdentityProxyEnv & LeaderboardRecoveryModeEnv

export const onRequest: PagesFunction<RecoveryEnv> = ({ request, env }) => {
  if (!isLeaderboardRecoveryEnabled(env)) return handleApiNotFoundRequest(request)
  return handleLeaderboardIdentityProxyRequest(request, env, PRIVATE_PATH)
}
