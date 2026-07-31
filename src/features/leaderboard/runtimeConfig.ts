export type LeaderboardRuntimeFeature =
  | 'draftTicket'
  | 'submission'
  | 'leaderboardRead'
  | 'identityClaim'
  | 'identityStatus'
  | 'identityRename'
  | 'recovery'

export type RuntimeFeatureState = 'enabled' | 'disabled'

function exactFeatureState(value: unknown): RuntimeFeatureState {
  return value === 'enabled' ? 'enabled' : 'disabled'
}

function identityCapabilityState(value: unknown): RuntimeFeatureState {
  return import.meta.env.VITE_LEADERBOARD_IDENTITY_MODE === 'enabled'
    && value === 'enabled'
    ? 'enabled'
    : 'disabled'
}

export const LEADERBOARD_RUNTIME_FEATURES = Object.freeze({
  draftTicket: exactFeatureState(import.meta.env.VITE_DRAFT_TICKET_MODE),
  submission: exactFeatureState(import.meta.env.VITE_DRAFT_SUBMISSION_MODE),
  leaderboardRead: exactFeatureState(import.meta.env.VITE_LEADERBOARD_READ_MODE),
  identityClaim: identityCapabilityState(import.meta.env.VITE_LEADERBOARD_IDENTITY_CLAIM_MODE),
  identityStatus: identityCapabilityState(import.meta.env.VITE_LEADERBOARD_IDENTITY_STATUS_MODE),
  identityRename: identityCapabilityState(import.meta.env.VITE_LEADERBOARD_IDENTITY_RENAME_MODE),
  recovery: identityCapabilityState(import.meta.env.VITE_LEADERBOARD_RECOVERY_MODE),
}) satisfies Readonly<Record<LeaderboardRuntimeFeature, RuntimeFeatureState>>

export function runtimeFeatureIsEnabled(feature: LeaderboardRuntimeFeature): boolean {
  return LEADERBOARD_RUNTIME_FEATURES[feature] === 'enabled'
}

/**
 * Development fixtures require a separate explicit build-time switch. Query
 * parameters and browser storage can select a scenario only after this gate is
 * enabled, and the complete branch is removed from production builds.
 */
export function localLeaderboardFixturesAreEnabled(): boolean {
  return import.meta.env.DEV
    && import.meta.env.VITE_LOCAL_LEADERBOARD_TEST_MODE === 'enabled'
}
