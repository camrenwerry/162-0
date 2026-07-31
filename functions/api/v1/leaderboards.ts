import {
  handleLeaderboardRequest,
  type LeaderboardEnv,
} from '../../lib/leaderboard'
import { observePreviewOperation } from '../../lib/preview-observability'

export { handleLeaderboardRequest } from '../../lib/leaderboard'

export const onRequest: PagesFunction<LeaderboardEnv> = async (context) => {
  const { request, env } = context
  const startedAt = Date.now()
  const response = await handleLeaderboardRequest(request, env)
  return observePreviewOperation(
    'leaderboard-read',
    response,
    startedAt,
    () => Date.now(),
    (task) => context.waitUntil(task),
  )
}
