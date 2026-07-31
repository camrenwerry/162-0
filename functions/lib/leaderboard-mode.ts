import {
  SCHEMA4_RUNTIME_GATE_REGISTRY,
  type Schema4RuntimeGateRegistry,
} from '../../shared/schema4-capabilities.mjs'
import {
  immutableRuntimeConsumerRegistration,
  runtimeConsumerFeatureState,
} from '../../shared/schema4-runtime-consumers.mjs'
import registrationData from './leaderboard-mode.registrations.json'

export type LeaderboardReadFeatureState = 'enabled' | 'disabled'

export interface LeaderboardReadModeEnv {
  readonly LEADERBOARD_READ_MODE?: unknown
  readonly LEADERBOARD_ENVIRONMENT?: unknown
  readonly LEADERBOARD_CURSOR_SIGNING_KEY?: unknown
}

const MINIMUM_CURSOR_KEY_LENGTH = 32
const MAXIMUM_CURSOR_KEY_LENGTH = 4_096

export const LEADERBOARD_READ_RUNTIME_CONSUMER_REGISTRATION =
  immutableRuntimeConsumerRegistration(registrationData.pagesFunctions)

export function leaderboardReadFeatureState(
  env: LeaderboardReadModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): LeaderboardReadFeatureState {
  return runtimeConsumerFeatureState(
    env,
    LEADERBOARD_READ_RUNTIME_CONSUMER_REGISTRATION,
    registry,
  )
}

export function isLeaderboardReadEnabled(
  env: LeaderboardReadModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return leaderboardReadFeatureState(env, registry) === 'enabled'
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
