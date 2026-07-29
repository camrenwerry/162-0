import {
  handleLeaderboardRequest,
  type LeaderboardEnv,
} from '../../lib/leaderboard'

export { handleLeaderboardRequest } from '../../lib/leaderboard'

export const onRequest: PagesFunction<LeaderboardEnv> = ({ request, env }) => handleLeaderboardRequest(request, env)
