import {
  type Schema4Capability,
} from '../../../shared/schema4-capabilities.mjs'
import {
  immutableRuntimeConsumerRegistration,
  runtimeConsumerFeatureState,
} from '../../../shared/schema4-runtime-consumers.mjs'
import registrationData from './runtimeConfig.registrations.json'

export type LeaderboardRuntimeFeature =
  | 'draftTicket'
  | 'submission'
  | 'leaderboardRead'
  | 'identityClaim'
  | 'identityStatus'
  | 'identityRename'
  | 'recovery'

export type RuntimeFeatureState = 'enabled' | 'disabled'

export const FRONTEND_RUNTIME_CONSUMER_REGISTRATIONS = Object.freeze(
  Object.fromEntries(Object.entries(registrationData).map(([capability, registration]) => [
    capability,
    immutableRuntimeConsumerRegistration(registration),
  ])),
) as Readonly<Record<Schema4Capability, ReturnType<typeof immutableRuntimeConsumerRegistration>>>

function exactFeatureState(value: unknown): RuntimeFeatureState {
  return value === 'enabled' ? 'enabled' : 'disabled'
}

function protectedFrontendFeatureState(capability: Schema4Capability): RuntimeFeatureState {
  return runtimeConsumerFeatureState(
    import.meta.env,
    FRONTEND_RUNTIME_CONSUMER_REGISTRATIONS[capability],
  )
}

export const LEADERBOARD_RUNTIME_FEATURES = Object.freeze({
  draftTicket: exactFeatureState(import.meta.env.VITE_DRAFT_TICKET_MODE),
  submission: protectedFrontendFeatureState('draftSubmission'),
  leaderboardRead: protectedFrontendFeatureState('leaderboardRead'),
  identityClaim: protectedFrontendFeatureState('identityClaim'),
  identityStatus: protectedFrontendFeatureState('identityStatus'),
  identityRename: protectedFrontendFeatureState('identityRename'),
  recovery: protectedFrontendFeatureState('identityRecovery'),
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
