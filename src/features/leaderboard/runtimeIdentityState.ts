import type {
  IdentityStorageReadResult,
  StoredLeaderboardIdentity,
} from './identityStorage'
import type { PublicIdentityStatus } from './pennantApi'

export type RuntimeIdentityState =
  | Readonly<{ kind: 'disabled' | 'missing' | 'corrupt' | 'outdated' | 'unavailable' | 'invalid' }>
  | Readonly<{ kind: 'local', identity: StoredLeaderboardIdentity }>
  | Readonly<{ kind: 'checking', identity: StoredLeaderboardIdentity }>
  | Readonly<{
    kind: 'ready'
    identity: StoredLeaderboardIdentity
    status: PublicIdentityStatus
  }>

export interface RuntimeIdentityFeatureSnapshot {
  readonly submission: boolean
  readonly identityClaim: boolean
  readonly identityStatus: boolean
  readonly identityRename: boolean
  readonly recovery: boolean
}

export type RuntimeSubmissionIdentityDecision =
  | Readonly<{ kind: 'anonymous' }>
  | Readonly<{ kind: 'checking' }>
  | Readonly<{ kind: 'credential', credential: string }>
  | Readonly<{
    kind: 'blocked'
    reason: 'disabled' | 'corrupt' | 'outdated' | 'unavailable' | 'invalid'
  }>

export function deriveRuntimeIdentityState(
  stored: IdentityStorageReadResult,
  features: RuntimeIdentityFeatureSnapshot,
): RuntimeIdentityState {
  if (features.identityStatus) {
    return stored.kind === 'ready'
      ? Object.freeze({ kind: 'checking', identity: stored.identity })
      : Object.freeze({ kind: stored.kind })
  }
  const continuityCanAffectRuntime = features.submission
    || features.identityClaim
    || features.identityRename
    || features.recovery
  if (!continuityCanAffectRuntime) return Object.freeze({ kind: 'disabled' })
  return stored.kind === 'ready'
    ? Object.freeze({ kind: 'local', identity: stored.identity })
    : Object.freeze({ kind: stored.kind })
}

export function resolveRuntimeSubmissionIdentity(
  state: RuntimeIdentityState,
): RuntimeSubmissionIdentityDecision {
  switch (state.kind) {
    case 'ready':
    case 'local':
      return Object.freeze({
        kind: 'credential',
        credential: state.identity.deviceCredential,
      })
    case 'missing':
      return Object.freeze({ kind: 'anonymous' })
    case 'checking':
      return Object.freeze({ kind: 'checking' })
    case 'disabled':
    case 'corrupt':
    case 'outdated':
    case 'unavailable':
    case 'invalid':
      return Object.freeze({ kind: 'blocked', reason: state.kind })
    default:
      return assertNeverRuntimeIdentity(state)
  }
}

function assertNeverRuntimeIdentity(state: never): never {
  throw new TypeError(`Unhandled runtime identity state: ${String(state)}`)
}
