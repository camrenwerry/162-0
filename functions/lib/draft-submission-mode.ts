import {
  SCHEMA4_RUNTIME_GATE_REGISTRY,
  type Schema4RuntimeGateRegistry,
} from '../../shared/schema4-capabilities.mjs'
import {
  immutableRuntimeConsumerRegistration,
  runtimeConsumerFeatureState,
} from '../../shared/schema4-runtime-consumers.mjs'
import registrationData from './draft-submission-mode.registrations.json'

export type DraftSubmissionFeatureState = 'enabled' | 'disabled'

export interface DraftSubmissionModeEnv {
  readonly DRAFT_SUBMISSION_MODE?: unknown
}

export const DRAFT_SUBMISSION_RUNTIME_CONSUMER_REGISTRATIONS = Object.freeze({
  pagesFunctions: immutableRuntimeConsumerRegistration(registrationData.pagesFunctions),
  privateWorker: immutableRuntimeConsumerRegistration(registrationData.privateWorker),
})

export function draftSubmissionFeatureState(
  env: DraftSubmissionModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): DraftSubmissionFeatureState {
  return runtimeConsumerFeatureState(
    env,
    DRAFT_SUBMISSION_RUNTIME_CONSUMER_REGISTRATIONS.pagesFunctions,
    registry,
  )
}

export function isDraftSubmissionEnabled(
  env: DraftSubmissionModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return draftSubmissionFeatureState(env, registry) === 'enabled'
}

export function privateWorkerDraftSubmissionFeatureState(
  env: DraftSubmissionModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
): DraftSubmissionFeatureState {
  return runtimeConsumerFeatureState(
    env,
    DRAFT_SUBMISSION_RUNTIME_CONSUMER_REGISTRATIONS.privateWorker,
    registry,
  )
}

export function isPrivateWorkerDraftSubmissionEnabled(
  env: DraftSubmissionModeEnv,
  registry: Schema4RuntimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  return privateWorkerDraftSubmissionFeatureState(env, registry) === 'enabled'
}
