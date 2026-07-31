import {
  handleLeaderboardIdentityProxyRequest,
  type LeaderboardIdentityProxyEnv,
} from '../../lib/leaderboard-identity-proxy'

const PRIVATE_PATH = '/api/v1/leaderboard-identity-recover'

export const onRequest: PagesFunction<LeaderboardIdentityProxyEnv> = ({ request, env }) => (
  handleLeaderboardIdentityProxyRequest(request, env, PRIVATE_PATH, 'recover')
)
