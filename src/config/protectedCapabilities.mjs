import { SCHEMA4_CAPABILITIES } from '../../shared/schema4-capabilities.mjs'

export const PROTECTED_FRONTEND_CAPABILITY_SOURCE_SCHEMA_VERSION = 1
export const PROTECTED_FRONTEND_CAPABILITY_SOURCE_KIND =
  'pennant-pursuit-protected-frontend-capabilities'

const MODES = new Set(['disabled', 'enabled'])

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

function immutableCapabilities(capabilities) {
  return Object.freeze(Object.fromEntries(
    SCHEMA4_CAPABILITIES.map((capability) => [capability, capabilities[capability]]),
  ))
}

export function validateProtectedFrontendCapabilitySource(input, {
  enforceAllDisabledPolicy = true,
} = {}) {
  if (!exactKeys(input, ['capabilities', 'kind', 'policy', 'schemaVersion'])
    || input.schemaVersion !== PROTECTED_FRONTEND_CAPABILITY_SOURCE_SCHEMA_VERSION
    || input.kind !== PROTECTED_FRONTEND_CAPABILITY_SOURCE_KIND
    || input.policy !== 'all-disabled'
    || !exactKeys(input.capabilities, SCHEMA4_CAPABILITIES)
    || SCHEMA4_CAPABILITIES.some((capability) => !MODES.has(input.capabilities[capability]))) {
    throw new TypeError('Protected frontend capability source is malformed or unsupported.')
  }
  if (enforceAllDisabledPolicy
    && SCHEMA4_CAPABILITIES.some((capability) => input.capabilities[capability] !== 'disabled')) {
    throw new TypeError('Protected frontend capability policy accepts only the exact all-disabled state.')
  }
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    policy: input.policy,
    capabilities: immutableCapabilities(input.capabilities),
  })
}

export const PROTECTED_FRONTEND_CAPABILITY_SOURCE =
  validateProtectedFrontendCapabilitySource({
    schemaVersion: PROTECTED_FRONTEND_CAPABILITY_SOURCE_SCHEMA_VERSION,
    kind: PROTECTED_FRONTEND_CAPABILITY_SOURCE_KIND,
    policy: 'all-disabled',
    capabilities: {
      leaderboardRead: 'disabled',
      identityClaim: 'disabled',
      identityStatus: 'disabled',
      identityRename: 'disabled',
      draftSubmission: 'disabled',
      identityRecovery: 'disabled',
      cleanupCron: 'disabled',
    },
  })

export function protectedFrontendCapabilityState(capability) {
  return SCHEMA4_CAPABILITIES.includes(capability)
    && PROTECTED_FRONTEND_CAPABILITY_SOURCE.capabilities[capability] === 'enabled'
    ? 'enabled'
    : 'disabled'
}
