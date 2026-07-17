import type { BackendEnv } from './env'

export type DraftValidationFeatureState = 'enabled' | 'disabled'

export function draftValidationFeatureState(env: BackendEnv): DraftValidationFeatureState {
  return env.DRAFT_VALIDATION_MODE === 'enabled' ? 'enabled' : 'disabled'
}

export function isDraftValidationEnabled(env: BackendEnv) {
  return draftValidationFeatureState(env) === 'enabled'
}
