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
import {
  SCHEMA4_RUNTIME_GATE_REGISTRY,
  type Schema4RuntimeGateRegistry,
} from '../../shared/schema4-capabilities.mjs'

export type LeaderboardIdentityProxyEnv = PrivateValidationProxyEnv & LeaderboardIdentityModeEnv

export function handleLeaderboardIdentityProxyRequest(
  request: Request,
  env: LeaderboardIdentityProxyEnv,
  privatePath: string,
  capability: unknown,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  if (
    !isLeaderboardIdentityCapability(capability)
    || !isLeaderboardIdentityCapabilityEnabled(env, capability, registry)
  ) {
    return handleApiNotFoundRequest(request)
  }
  return proxyPrivateLeaderboardIdentityRequest(request, privatePath, env)
}
