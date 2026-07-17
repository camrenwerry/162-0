import type { BackendEnv } from './env'

export type DraftTicketFeatureState = 'enabled' | 'disabled'

export function draftTicketFeatureState(env: BackendEnv): DraftTicketFeatureState {
  return env.DRAFT_TICKET_MODE === 'enabled' ? 'enabled' : 'disabled'
}

export function isDraftTicketEnabled(env: BackendEnv) {
  return draftTicketFeatureState(env) === 'enabled'
}
