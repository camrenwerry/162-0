import { randomBytes } from 'node:crypto'
import {
  canonicalHash,
  immutablePlain,
} from './preview-release/canonical.mjs'
import {
  evaluateSchema4ActivationAuthority,
} from './schema4-activation-authority.mjs'

export const IDENTITY_RECOVERY_PLAN_SCHEMA_VERSION = 2
export const IDENTITY_RECOVERY_SNAPSHOT_SCHEMA_VERSION = 1
export const IDENTITY_RECOVERY_MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000
export const IDENTITY_RECOVERY_PLAN_TTL_MS = 5 * 60 * 1000
export const IDENTITY_RECOVERY_MAX_RECORDS = 1_000
export const IDENTITY_RECOVERY_AUTHORITY_MAX_FILE_BYTES = 32 * 1024
export const IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES = 512 * 1024

const HEX_HASH = /^[0-9a-f]{64}$/
const PLAN_REFERENCE = /^pprp1_[A-Za-z0-9_-]{43}$/
const ACTION = 'identity-credential-rotation'
const PLAYER_BINDING_DOMAIN = 'pennant-pursuit.identity-recovery.player-binding.v1'
const TARGET_STATE_COMMITMENT_DOMAIN = 'pennant-pursuit.identity-recovery.target-state.v2'
const PLAN_COMMITMENT_DOMAIN = 'pennant-pursuit.identity-recovery.plan.v2'

export class IdentityRecoveryPreparationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IdentityRecoveryPreparationError'
    this.code = code
  }
}

function refuse(code, message) {
  throw new IdentityRecoveryPreparationError(code, message)
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return JSON.stringify(actual) === JSON.stringify(wanted)
}

function safeInteger(value, minimum = 0) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= 8_640_000_000_000_000
}

function plainCandidate(value, code, message) {
  try {
    return immutablePlain(value)
  } catch {
    refuse(code, message)
  }
}

function validateAuthority(authority, nowMs) {
  const candidate = plainCandidate(
    authority,
    'authority_refused',
    'Recovery authority is malformed.',
  )
  const evaluated = evaluateSchema4ActivationAuthority(candidate, {
    expectedEnvironment: 'preview',
    nowMs,
  })
  if (!evaluated.valid) refuse('authority_refused', `Recovery authority refused: ${evaluated.reason}.`)
  if (evaluated.capabilities.identityRecovery !== 'enabled') {
    refuse('recovery_disabled', 'Preview identity recovery authority is disabled.')
  }
  return immutablePlain({
    authority: candidate,
    digest: canonicalHash(candidate),
  })
}

function validateRecord(record, observedAtMs) {
  const candidate = plainCandidate(
    record,
    'malformed_snapshot',
    'Identity snapshot record is malformed.',
  )
  if (!exactKeys(candidate, [
    'playerId',
    'identityState',
    'publicStatus',
    'recoveryVersion',
    'identityUpdatedAtMs',
    'identityContinuityHash',
    'credentialStateHash',
  ])) refuse('malformed_snapshot', 'Identity snapshot record is malformed.')
  if (
    !safeInteger(candidate.playerId, 1)
    || !['active', 'inactive', 'moderated', 'invalidated'].includes(candidate.identityState)
    || !['active', 'moderated', 'invalidated'].includes(candidate.publicStatus)
    || !safeInteger(candidate.recoveryVersion)
    || !safeInteger(candidate.identityUpdatedAtMs)
    || candidate.identityUpdatedAtMs > observedAtMs
    || !HEX_HASH.test(candidate.identityContinuityHash)
    || !HEX_HASH.test(candidate.credentialStateHash)
  ) refuse('malformed_snapshot', 'Identity snapshot record contains an invalid value.')
  return candidate
}

function validateSnapshot(snapshot, nowMs) {
  const candidate = plainCandidate(
    snapshot,
    'malformed_snapshot',
    'Identity snapshot is malformed.',
  )
  if (!exactKeys(candidate, [
    'schemaVersion',
    'source',
    'environment',
    'observedAtMs',
    'expiresAtMs',
    'records',
  ])) refuse('malformed_snapshot', 'Identity snapshot is malformed.')
  if (
    candidate.schemaVersion !== IDENTITY_RECOVERY_SNAPSHOT_SCHEMA_VERSION
    || candidate.source !== 'reviewed-local-snapshot'
    || candidate.environment !== 'preview'
    || !safeInteger(candidate.observedAtMs)
    || !safeInteger(candidate.expiresAtMs)
    || candidate.observedAtMs > nowMs
    || candidate.expiresAtMs <= candidate.observedAtMs
    || candidate.expiresAtMs - candidate.observedAtMs > IDENTITY_RECOVERY_MAX_SNAPSHOT_AGE_MS
    || !Array.isArray(candidate.records)
    || candidate.records.length > IDENTITY_RECOVERY_MAX_RECORDS
  ) refuse('malformed_snapshot', 'Identity snapshot does not match the reviewed Preview contract.')
  if (nowMs >= candidate.expiresAtMs) refuse('stale_snapshot', 'Identity snapshot is stale.')
  return immutablePlain({
    schemaVersion: candidate.schemaVersion,
    source: candidate.source,
    environment: candidate.environment,
    observedAtMs: candidate.observedAtMs,
    expiresAtMs: candidate.expiresAtMs,
    records: candidate.records.map((record) => validateRecord(record, candidate.observedAtMs)),
  })
}

function resolveTarget(snapshot, targetPlayerId) {
  if (!safeInteger(targetPlayerId, 1)) refuse('malformed_target', 'Target player ID is invalid.')
  const matches = snapshot.records.filter(({ playerId }) => playerId === targetPlayerId)
  if (matches.length === 0) refuse('target_not_found', 'No identity matches the exact target.')
  if (matches.length !== 1) refuse('ambiguous_target', 'More than one identity matches the exact target.')
  const target = matches[0]
  if (
    target.identityState !== 'active'
    || target.publicStatus !== 'active'
    || target.recoveryVersion < 1
  ) refuse('target_ineligible', 'The exact target is not an active recoverable identity.')
  return target
}

function createPlanReference() {
  try {
    return `pprp1_${randomBytes(32).toString('base64url')}`
  } catch {
    refuse('secure_random_unavailable', 'A secure opaque recovery plan reference could not be created.')
  }
}

function exactPlayerBinding(planRef, target) {
  return canonicalHash({
    domain: PLAYER_BINDING_DOMAIN,
    environment: 'preview',
    planRef,
    playerId: target.playerId,
  })
}

function targetStateCommitment(planRef, playerBinding, target) {
  return canonicalHash({
    domain: TARGET_STATE_COMMITMENT_DOMAIN,
    environment: 'preview',
    planRef,
    playerBinding,
    identityState: target.identityState,
    publicStatus: target.publicStatus,
    recoveryVersion: target.recoveryVersion,
    identityUpdatedAtMs: target.identityUpdatedAtMs,
    identityContinuityHash: target.identityContinuityHash,
    credentialStateHash: target.credentialStateHash,
  })
}

function recoveryPlanCommitment(body) {
  return canonicalHash({
    domain: PLAN_COMMITMENT_DOMAIN,
    plan: body,
  })
}

function planBody(target, snapshot, authority, nowMs) {
  const planRef = createPlanReference()
  const playerBinding = exactPlayerBinding(planRef, target)
  return immutablePlain({
    schemaVersion: IDENTITY_RECOVERY_PLAN_SCHEMA_VERSION,
    action: ACTION,
    environment: 'preview',
    planRef,
    authorityDigest: authority.digest,
    playerBinding,
    targetStateCommitment: targetStateCommitment(planRef, playerBinding, target),
    snapshotObservedAtMs: snapshot.observedAtMs,
    previewedAtMs: nowMs,
    expiresAtMs: Math.min(
      nowMs + IDENTITY_RECOVERY_PLAN_TTL_MS,
      snapshot.expiresAtMs,
      authority.authority.expiresAtMs,
    ),
  })
}

export function prepareIdentityRecoveryPreview({
  authority,
  snapshot,
  targetPlayerId,
  nowMs,
}) {
  if (!safeInteger(nowMs)) refuse('invalid_time', 'Operator evaluation time is invalid.')
  const validatedAuthority = validateAuthority(authority, nowMs)
  const validatedSnapshot = validateSnapshot(snapshot, nowMs)
  const target = resolveTarget(validatedSnapshot, targetPlayerId)
  const body = planBody(target, validatedSnapshot, validatedAuthority, nowMs)
  const plan = immutablePlain({ ...body, planHash: recoveryPlanCommitment(body) })
  return immutablePlain({
    status: 'preview-only',
    evidence: {
      action: plan.action,
      environment: plan.environment,
      planRef: plan.planRef,
      authorityDigest: plan.authorityDigest,
      previewedAtMs: plan.previewedAtMs,
      expiresAtMs: plan.expiresAtMs,
      planHash: plan.planHash,
    },
    plan,
  })
}

function validatePlan(plan, nowMs) {
  const candidate = plainCandidate(
    plan,
    'malformed_plan',
    'Identity recovery plan is malformed.',
  )
  if (!exactKeys(candidate, [
    'schemaVersion',
    'action',
    'environment',
    'planRef',
    'authorityDigest',
    'playerBinding',
    'targetStateCommitment',
    'snapshotObservedAtMs',
    'previewedAtMs',
    'expiresAtMs',
    'planHash',
  ])) refuse('malformed_plan', 'Identity recovery plan is malformed.')
  const { planHash, ...body } = candidate
  if (
    candidate.schemaVersion !== IDENTITY_RECOVERY_PLAN_SCHEMA_VERSION
    || candidate.action !== ACTION
    || candidate.environment !== 'preview'
    || !PLAN_REFERENCE.test(candidate.planRef)
    || !HEX_HASH.test(candidate.authorityDigest)
    || !HEX_HASH.test(candidate.playerBinding)
    || !HEX_HASH.test(candidate.targetStateCommitment)
    || !safeInteger(candidate.snapshotObservedAtMs)
    || !safeInteger(candidate.previewedAtMs)
    || candidate.snapshotObservedAtMs > candidate.previewedAtMs
    || candidate.previewedAtMs > nowMs
    || !safeInteger(candidate.expiresAtMs)
    || candidate.expiresAtMs <= candidate.previewedAtMs
    || candidate.expiresAtMs - candidate.previewedAtMs > IDENTITY_RECOVERY_PLAN_TTL_MS
    || !HEX_HASH.test(planHash)
    || recoveryPlanCommitment(body) !== planHash
  ) refuse('malformed_plan', 'Identity recovery plan failed integrity validation.')
  if (nowMs >= candidate.expiresAtMs) refuse('stale_plan', 'Identity recovery plan is stale.')
  return candidate
}

/**
 * Read-only verification deliberately performs no consumption and provides no
 * replay claim. A future mutation implementation must bind planRef to private
 * target state and atomically persist single-use consumption with the target
 * compare-and-swap in one trusted transaction.
 */
export function verifyIdentityRecoveryPlan({
  authority,
  plan,
  freshSnapshot,
  targetPlayerId,
  nowMs,
}) {
  if (!safeInteger(nowMs)) refuse('invalid_time', 'Operator evaluation time is invalid.')
  const validatedPlan = validatePlan(plan, nowMs)
  const validatedAuthority = validateAuthority(authority, nowMs)
  if (validatedAuthority.digest !== validatedPlan.authorityDigest) {
    refuse('authority_changed', 'Recovery authority changed after the plan was created.')
  }
  const snapshot = validateSnapshot(freshSnapshot, nowMs)
  if (snapshot.environment !== validatedPlan.environment) {
    refuse('environment_mismatch', 'Recovery evidence environment does not match the plan.')
  }
  if (snapshot.observedAtMs < validatedPlan.previewedAtMs) {
    refuse('stale_target_state', 'Fresh identity evidence predates the recovery preview.')
  }
  const target = resolveTarget(snapshot, targetPlayerId)
  const freshPlayerBinding = exactPlayerBinding(validatedPlan.planRef, target)
  if (freshPlayerBinding !== validatedPlan.playerBinding) {
    refuse('target_mismatch', 'Recovery plan is bound to a different exact target.')
  }
  if (
    targetStateCommitment(validatedPlan.planRef, freshPlayerBinding, target)
    !== validatedPlan.targetStateCommitment
  ) refuse('stale_target_state', 'Target identity state changed after preview.')

  return immutablePlain({
    status: 'verified-read-only',
    environment: validatedPlan.environment,
    action: validatedPlan.action,
    planRef: validatedPlan.planRef,
    authorityDigest: validatedPlan.authorityDigest,
    planHash: validatedPlan.planHash,
    expiresAtMs: validatedPlan.expiresAtMs,
    consumption: 'not-performed',
  })
}
