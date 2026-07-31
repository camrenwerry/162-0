import {
  immutablePlain,
  parseStrictJson,
  STRICT_JSON_LIMITS,
} from './preview-release/canonical.mjs'
import { SCHEMA4_CAPABILITIES } from '../../shared/schema4-capabilities.mjs'

export const SCHEMA4_CAPABILITY_MODEL_VERSION = 2
export const SCHEMA4_AUTHORITY_SCHEMA_VERSION = 1
export const SCHEMA4_AUTHORITY_MAX_TTL_MS = 24 * 60 * 60 * 1000
export const SCHEMA4_ENVIRONMENTS = Object.freeze(['preview', 'production'])
export { SCHEMA4_CAPABILITIES }

const IDENTITY_CAPABILITIES = new Set([
  'identityClaim',
  'identityStatus',
  'identityRename',
  'identityRecovery',
])
const ENVIRONMENTS = new Set(SCHEMA4_ENVIRONMENTS)
const MODES = new Set(['enabled', 'disabled'])
const EMERGENCY_STATES = new Set(['clear', 'engaged'])

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return JSON.stringify(actual) === JSON.stringify(wanted)
}

function disabledCapabilities() {
  return Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [capability, 'disabled']))
}

function result(valid, reason, expectedEnvironment, capabilities = disabledCapabilities()) {
  return immutablePlain({
    valid,
    reason,
    environment: ENVIRONMENTS.has(expectedEnvironment) ? expectedEnvironment : null,
    capabilities,
  })
}

function safeTimestamp(value) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 8_640_000_000_000_000
}

export function createDisabledSchema4Authority(environment) {
  if (!ENVIRONMENTS.has(environment)) throw new TypeError('Schema-4 authority environment is invalid.')
  return immutablePlain({
    schemaVersion: SCHEMA4_AUTHORITY_SCHEMA_VERSION,
    environment,
    reviewedAtMs: null,
    expiresAtMs: null,
    emergencyStop: 'engaged',
    identityCompatibilityMode: 'disabled',
    capabilities: disabledCapabilities(),
  })
}

export function validateSchema4CapabilityModel(input, nowMs) {
  const model = immutablePlain(input)
  if (!safeTimestamp(nowMs)) throw new TypeError('Schema-4 capability-model evaluation time is invalid.')
  if (!exactKeys(model, [
    'modelVersion',
    'authoritySchemaVersion',
    'maximumReviewWindowMs',
    'canonicalState',
    'environments',
  ])) throw new TypeError('Schema-4 capability model has missing or extra fields.')
  if (model.modelVersion !== SCHEMA4_CAPABILITY_MODEL_VERSION) {
    throw new TypeError('Schema-4 capability model version is unsupported.')
  }
  if (
    model.authoritySchemaVersion !== SCHEMA4_AUTHORITY_SCHEMA_VERSION
    || model.maximumReviewWindowMs !== SCHEMA4_AUTHORITY_MAX_TTL_MS
    || model.canonicalState !== 'all-disabled'
    || !exactKeys(model.environments, SCHEMA4_ENVIRONMENTS)
  ) throw new TypeError('Schema-4 capability model contract is malformed.')

  for (const environment of SCHEMA4_ENVIRONMENTS) {
    const evaluated = evaluateSchema4ActivationAuthority(model.environments[environment], {
      expectedEnvironment: environment,
      nowMs,
    })
    if (
      !evaluated.valid
      || evaluated.reason !== 'emergency_stop_engaged'
      || SCHEMA4_CAPABILITIES.some((capability) => evaluated.capabilities[capability] !== 'disabled')
    ) throw new TypeError(`Schema-4 ${environment} checked-in authority must be emergency-stopped and all-disabled.`)
  }
  return model
}

export function parseSchema4CapabilityModel(source, nowMs) {
  const parsed = parseStrictJson(source, {
    label: 'Schema-4 capability model',
    error: (message) => new TypeError(message),
    limits: STRICT_JSON_LIMITS.authorityModel,
  })
  return validateSchema4CapabilityModel(parsed, nowMs)
}

export function evaluateSchema4ActivationAuthority(
  authority,
  { expectedEnvironment, nowMs } = {},
) {
  if (!ENVIRONMENTS.has(expectedEnvironment)) {
    return result(false, 'invalid_expected_environment', expectedEnvironment)
  }
  if (!safeTimestamp(nowMs)) return result(false, 'invalid_evaluation_time', expectedEnvironment)
  let snapshot
  try {
    snapshot = immutablePlain(authority)
  } catch {
    return result(false, 'malformed_authority', expectedEnvironment)
  }
  if (!exactKeys(snapshot, [
    'schemaVersion',
    'environment',
    'reviewedAtMs',
    'expiresAtMs',
    'emergencyStop',
    'identityCompatibilityMode',
    'capabilities',
  ])) return result(false, 'malformed_authority', expectedEnvironment)
  if (snapshot.schemaVersion !== SCHEMA4_AUTHORITY_SCHEMA_VERSION) {
    return result(false, 'unsupported_schema_version', expectedEnvironment)
  }
  if (snapshot.environment !== expectedEnvironment) {
    return result(false, 'environment_mismatch', expectedEnvironment)
  }
  if (!EMERGENCY_STATES.has(snapshot.emergencyStop)
    || !MODES.has(snapshot.identityCompatibilityMode)
    || !exactKeys(snapshot.capabilities, SCHEMA4_CAPABILITIES)
    || SCHEMA4_CAPABILITIES.some((capability) => !MODES.has(snapshot.capabilities[capability]))) {
    return result(false, 'malformed_authority', expectedEnvironment)
  }

  if (snapshot.emergencyStop === 'engaged') {
    if (
      snapshot.reviewedAtMs !== null
      || snapshot.expiresAtMs !== null
      || snapshot.identityCompatibilityMode !== 'disabled'
      || SCHEMA4_CAPABILITIES.some((capability) => snapshot.capabilities[capability] !== 'disabled')
    ) return result(false, 'contradictory_emergency_state', expectedEnvironment)
    return result(true, 'emergency_stop_engaged', expectedEnvironment)
  }

  if (
    !safeTimestamp(snapshot.reviewedAtMs)
    || !safeTimestamp(snapshot.expiresAtMs)
    || snapshot.reviewedAtMs > nowMs
    || snapshot.expiresAtMs <= snapshot.reviewedAtMs
    || snapshot.expiresAtMs - snapshot.reviewedAtMs > SCHEMA4_AUTHORITY_MAX_TTL_MS
  ) return result(false, 'malformed_freshness_window', expectedEnvironment)
  if (nowMs >= snapshot.expiresAtMs) return result(false, 'stale_authority', expectedEnvironment)

  const contradictoryIdentity = SCHEMA4_CAPABILITIES.some((capability) => (
    IDENTITY_CAPABILITIES.has(capability)
      && snapshot.capabilities[capability] === 'enabled'
      && snapshot.identityCompatibilityMode !== 'enabled'
  ))
  if (contradictoryIdentity) {
    return result(false, 'identity_compatibility_ceiling_disabled', expectedEnvironment)
  }
  return result(true, 'reviewed_authority', expectedEnvironment, snapshot.capabilities)
}

export function assertIndependentSchema4AuthorityModel(nowMs = Date.UTC(2026, 6, 31, 12)) {
  for (const environment of SCHEMA4_ENVIRONMENTS) {
    const disabled = evaluateSchema4ActivationAuthority(
      createDisabledSchema4Authority(environment),
      { expectedEnvironment: environment, nowMs },
    )
    if (!disabled.valid || SCHEMA4_CAPABILITIES.some((capability) => disabled.capabilities[capability] !== 'disabled')) {
      throw new Error(`Schema-4 ${environment} emergency-disabled authority is invalid.`)
    }
    for (let mask = 0; mask < 2 ** SCHEMA4_CAPABILITIES.length; mask += 1) {
      const capabilities = Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability, index) => [
        capability,
        mask & (1 << index) ? 'enabled' : 'disabled',
      ]))
      const authority = {
        schemaVersion: SCHEMA4_AUTHORITY_SCHEMA_VERSION,
        environment,
        reviewedAtMs: nowMs - 1_000,
        expiresAtMs: nowMs + 60_000,
        emergencyStop: 'clear',
        identityCompatibilityMode: 'enabled',
        capabilities,
      }
      const evaluated = evaluateSchema4ActivationAuthority(authority, {
        expectedEnvironment: environment,
        nowMs,
      })
      if (
        !evaluated.valid
        || SCHEMA4_CAPABILITIES.some((capability) => (
          evaluated.capabilities[capability] !== capabilities[capability]
        ))
      ) {
        throw new Error(`Schema-4 ${environment} capability combination ${mask} is not independent.`)
      }
    }
  }
  return Object.freeze({
    schemaVersion: SCHEMA4_AUTHORITY_SCHEMA_VERSION,
    environments: SCHEMA4_ENVIRONMENTS,
    capabilities: SCHEMA4_CAPABILITIES,
  })
}
