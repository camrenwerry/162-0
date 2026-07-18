export type DraftSubmissionFeatureState = 'enabled' | 'disabled'

export interface DraftSubmissionModeEnv {
  readonly DRAFT_SUBMISSION_MODE?: unknown
}

export function draftSubmissionFeatureState(env: DraftSubmissionModeEnv): DraftSubmissionFeatureState {
  return env.DRAFT_SUBMISSION_MODE === 'enabled' ? 'enabled' : 'disabled'
}

export function isDraftSubmissionEnabled(env: DraftSubmissionModeEnv) {
  return draftSubmissionFeatureState(env) === 'enabled'
}
