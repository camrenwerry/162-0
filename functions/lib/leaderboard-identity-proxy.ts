import { handleApiNotFoundRequest } from './api-response'
import {
  isLeaderboardIdentityEnabled,
  type LeaderboardIdentityModeEnv,
} from './leaderboard-identity-mode'
import {
  proxyPrivateLeaderboardIdentityRequest,
  type PrivateValidationProxyEnv,
} from './private-validation-proxy'

export type LeaderboardIdentityProxyEnv = PrivateValidationProxyEnv & LeaderboardIdentityModeEnv

export function handleLeaderboardIdentityProxyRequest(
  request: Request,
  env: LeaderboardIdentityProxyEnv,
  privatePath: string,
) {
  if (!isLeaderboardIdentityEnabled(env)) return handleApiNotFoundRequest(request)
  return proxyPrivateLeaderboardIdentityRequest(request, privatePath, env)
}
