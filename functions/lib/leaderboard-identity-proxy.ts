import { handleApiNotFoundRequest } from './api-response'
import {
  isLeaderboardIdentityCapability,
  isLeaderboardIdentityCapabilityEnabled,
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
  capability: unknown,
) {
  if (
    !isLeaderboardIdentityCapability(capability)
    || !isLeaderboardIdentityCapabilityEnabled(env, capability)
  ) {
    return handleApiNotFoundRequest(request)
  }
  return proxyPrivateLeaderboardIdentityRequest(request, privatePath, env)
}
