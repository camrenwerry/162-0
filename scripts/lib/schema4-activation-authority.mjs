import { immutablePlain } from './preview-release/canonical.mjs'

export const SCHEMA4_AUTHORITY_SCHEMA_VERSION = 1
export const SCHEMA4_AUTHORITY_MAX_TTL_MS = 24 * 60 * 60 * 1000
export const SCHEMA4_CAPABILITIES = Object.freeze([
  'leaderboardRead',
  'identityClaim',
  'identityStatus',
  'identityRename',
  'draftSubmission',
  'identityRecovery',
  'cleanupCron',
])

const IDENTITY_CAPABILITIES = new Set([
  'identityClaim',
  'identityStatus',
  'identityRename',
  'identityRecovery',
])
const ENVIRONMENTS = new Set(['preview', 'production'])
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

export function evaluateSchema4ActivationAuthority(
  authority,
  { expectedEnvironment, nowMs } = {},
) {
  if (!ENVIRONMENTS.has(expectedEnvironment)) {
    return result(false, 'invalid_expected_environment', expectedEnvironment)
  }
  if (!safeTimestamp(nowMs)) return result(false, 'invalid_evaluation_time', expectedEnvironment)
  if (!exactKeys(authority, [
    'schemaVersion',
    'environment',
    'reviewedAtMs',
    'expiresAtMs',
    'emergencyStop',
    'identityCompatibilityMode',
    'capabilities',
  ])) return result(false, 'malformed_authority', expectedEnvironment)
  if (authority.schemaVersion !== SCHEMA4_AUTHORITY_SCHEMA_VERSION) {
    return result(false, 'unsupported_schema_version', expectedEnvironment)
  }
  if (authority.environment !== expectedEnvironment) {
    return result(false, 'environment_mismatch', expectedEnvironment)
  }
  if (!EMERGENCY_STATES.has(authority.emergencyStop)
    || !MODES.has(authority.identityCompatibilityMode)
    || !exactKeys(authority.capabilities, SCHEMA4_CAPABILITIES)
    || SCHEMA4_CAPABILITIES.some((capability) => !MODES.has(authority.capabilities[capability]))) {
    return result(false, 'malformed_authority', expectedEnvironment)
  }

  if (authority.emergencyStop === 'engaged') {
    if (
      authority.reviewedAtMs !== null
      || authority.expiresAtMs !== null
      || authority.identityCompatibilityMode !== 'disabled'
      || SCHEMA4_CAPABILITIES.some((capability) => authority.capabilities[capability] !== 'disabled')
    ) return result(false, 'contradictory_emergency_state', expectedEnvironment)
    return result(true, 'emergency_stop_engaged', expectedEnvironment)
  }

  if (
    !safeTimestamp(authority.reviewedAtMs)
    || !safeTimestamp(authority.expiresAtMs)
    || authority.reviewedAtMs > nowMs
    || authority.expiresAtMs <= authority.reviewedAtMs
    || authority.expiresAtMs - authority.reviewedAtMs > SCHEMA4_AUTHORITY_MAX_TTL_MS
  ) return result(false, 'malformed_freshness_window', expectedEnvironment)
  if (nowMs >= authority.expiresAtMs) return result(false, 'stale_authority', expectedEnvironment)

  const contradictoryIdentity = SCHEMA4_CAPABILITIES.some((capability) => (
    IDENTITY_CAPABILITIES.has(capability)
      && authority.capabilities[capability] === 'enabled'
      && authority.identityCompatibilityMode !== 'enabled'
  ))
  if (contradictoryIdentity) {
    return result(false, 'identity_compatibility_ceiling_disabled', expectedEnvironment)
  }
  return result(true, 'reviewed_authority', expectedEnvironment, authority.capabilities)
}

export function assertIndependentSchema4AuthorityModel(nowMs = Date.UTC(2026, 6, 31, 12)) {
  for (const environment of ENVIRONMENTS) {
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
    environments: Object.freeze([...ENVIRONMENTS]),
    capabilities: SCHEMA4_CAPABILITIES,
  })
}
