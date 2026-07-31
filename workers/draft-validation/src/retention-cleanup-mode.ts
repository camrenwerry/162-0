import {
  SCHEMA4_RUNTIME_GATE_REGISTRY,
  type Schema4RuntimeGateRegistry,
} from '../../../shared/schema4-capabilities.mjs'
import {
  immutableRuntimeConsumerRegistration,
  runtimeConsumerFeatureState,
} from '../../../shared/schema4-runtime-consumers.mjs'
import registrationData from './retention-cleanup-mode.registrations.json'

export interface RetentionCleanupModeEnv {
  readonly RETENTION_CLEANUP_MODE?: unknown
}

export const RETENTION_CLEANUP_RUNTIME_CONSUMER_REGISTRATION =
  immutableRuntimeConsumerRegistration(registrationData.privateWorker)

export function isRetentionCleanupEnabled(
  env: RetentionCleanupModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return runtimeConsumerFeatureState(
    env,
    RETENTION_CLEANUP_RUNTIME_CONSUMER_REGISTRATION,
    registry,
  ) === 'enabled'
}
