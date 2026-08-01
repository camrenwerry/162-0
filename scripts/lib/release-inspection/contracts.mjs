import {
  canonicalHash,
  canonicalJson,
  immutablePlain,
  parseStrictJson,
  STRICT_JSON_LIMITS,
} from '../preview-release/canonical.mjs'
import { SCHEMA4_CAPABILITIES } from '../../../shared/schema4-capabilities.mjs'
import { SCHEMA4_ENVIRONMENTS } from '../schema4-activation-authority.mjs'
import { PROTECTED_CONFIGURATION_PATHS } from '../preview-release/protected-paths.mjs'
import {
  assertNoReleaseInspectionArtifactForLegacyExecution,
  RELEASE_INSPECTION_KINDS,
  RELEASE_INSPECTION_TOOL_CONTRACT_VERSION,
} from './markers.mjs'

export {
  assertNoReleaseInspectionArtifactForLegacyExecution,
  RELEASE_INSPECTION_KINDS,
  RELEASE_INSPECTION_TOOL_CONTRACT_VERSION,
}

export const RELEASE_INSPECTION_SCHEMA_VERSION = 1
export const RELEASE_INSPECTION_ENVIRONMENTS = SCHEMA4_ENVIRONMENTS
export const RELEASE_INSPECTION_CAPABILITIES = SCHEMA4_CAPABILITIES
export const RELEASE_INSPECTION_SURFACES = Object.freeze([
  'frontend',
  'pages',
  'worker',
  'schedule',
])
export const RELEASE_INSPECTION_SECRET_NAMES = Object.freeze([
  'DRAFT_TICKET_SIGNING_KEY',
  'LEADERBOARD_CURSOR_SIGNING_KEY',
  'LEADERBOARD_IDENTITY_SIGNING_KEY',
])

export const RELEASE_INSPECTION_MANIFEST_SOURCES = immutablePlain({
  authority: 'workers/draft-validation/d1c4-activation-states.json',
  frontendCapabilities: 'src/config/protectedCapabilities.mjs',
  legacyResourceIdentity: 'config/preview-release.json',
  migrationsDirectory: 'migrations',
  pagesConfiguration: 'wrangler.toml',
  readiness: 'config/preview-schema4-readiness.json',
  redirects: 'public/_redirects',
  registry: 'shared/schema4-capabilities.mjs',
  routes: 'public/_routes.json',
  workerConfiguration: 'workers/draft-validation/wrangler.toml',
})

export const RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS = Object.freeze([...new Set([
  ...PROTECTED_CONFIGURATION_PATHS,
  'src/config/protectedCapabilities.d.mts',
  'public/_redirects',
  'public/_routes.json',
  'migrations/0001_backend_foundation.sql',
  'migrations/0002_draft_submissions.sql',
  'migrations/0003_leaderboard_foundation.sql',
  'migrations/0004_leaderboard_identity_ranking.sql',
])].sort())

export const RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES = immutablePlain({
  'config/preview-release.json': '6f2fa50826559fb031292229d010b3c44ff0007f977738f34e8a60646209b8de',
  'config/preview-schema4-readiness.json': '7a738fd754c8581f2cad6e9cc1c1a5358256ec3f65b47e7120b24f9ec43b0ae4',
  'config/release-inspection-manifest.json': '4aea6b112840e6879a57923fdd98d58064068b8e280ff69662a3122cb26e1051',
  'functions/lib/draft-submission-mode.registrations.json': '5ad7d00c74906f0f24c791d9595bb2569fd7cf7058d5a1721ce3c6076d9b596b',
  'functions/lib/leaderboard-identity-mode.registrations.json': '20ce2b653850298090faaa564eb0d5c24a44eae0452a27f94d65b89c8ca757c8',
  'functions/lib/leaderboard-mode.registrations.json': '444d479401eb9f0f4148289a6b3459d67312ff05f1530011dd2dc92bf64d462d',
  'migrations/0001_backend_foundation.sql': '5362bdd8ea5c271aee3dbf544adae4d4036c4dfe27e44a3284f088bded5888ae',
  'migrations/0002_draft_submissions.sql': '9eba9232c8806676bd0a32dfbb7da8fca97f8d381a126a723fe2189d27721b7a',
  'migrations/0003_leaderboard_foundation.sql': '344b803c7e2111c4151c7010fd4e0c15217b1d2fc7522af5c2a260d19450b5fa',
  'migrations/0004_leaderboard_identity_ranking.sql': 'c87e555483d321e4b4ac2bcfbb7702bd6a38293ae593658cec13d48398c25346',
  'public/_redirects': '32a91e4d018194555c7f64f23faf2512270c3a248844b0c107f5f480366483eb',
  'public/_routes.json': '875208beeb02398614dd2f6dc8779c9261719bbf4f786a4464028dc2a191b29d',
  'scripts/lib/preview-release/wrangler-topology.mjs': 'ba4447b30bd8ae9568830e8a78fde041d62c5bc4ce887df9bf38877a5ad97e2a',
  'shared/schema4-capabilities.mjs': 'cee0c6ab8f62a67ff51b6da7215dbf5bfcf07f70db01a783217258c9b463ce97',
  'shared/schema4-runtime-consumers.mjs': 'cef6af9bace31a86c3e045a3cce19ca32e55ed40c017bd4f1650111858e7d5d6',
  'src/config/protectedCapabilities.d.mts': 'f5f9c0202d5af6b474ccd54c898e7348c3cdb1fa34ee95e3a61228b2db58b807',
  'src/config/protectedCapabilities.mjs': 'b49db6f6d246ffb1d984fe856d57554b5ee1ea30c144bd62a5dada0e63781d0e',
  'src/features/leaderboard/runtimeConfig.registrations.json': '06f802ac61aa55315c8ee072cbffb9ff730c3496149c9db0f537877c5b3f0e5d',
  'workers/draft-validation/d1c4-activation-states.json': '768e29612688aeb3d0b3325a58468a4cccd4865bb2bae51c306e6f47958815f3',
  'workers/draft-validation/src/retention-cleanup-mode.registrations.json': 'ca961c5a822b4af6261484d00b685157595444ebcad42fff1167c4beeb2a3890',
  'workers/draft-validation/wrangler.toml': '862952756bfc0fc2b4cbd256cb5914f40e13376580fddd50a85584ef51927d83',
  'wrangler.toml': 'e1c6602a297a4bbcf82e376a6085ba8e0056faf9b8cd38a010c1b39966ba7f3e',
})

const EXPECTED_CAPABILITY_SURFACES = immutablePlain({
  leaderboardRead: ['frontend', 'pages'],
  identityClaim: ['frontend', 'pages', 'worker'],
  identityStatus: ['frontend', 'pages', 'worker'],
  identityRename: ['frontend', 'pages', 'worker'],
  draftSubmission: ['frontend', 'pages', 'worker'],
  identityRecovery: ['frontend', 'pages', 'worker'],
  cleanupCron: ['worker', 'schedule'],
})

const MODES = new Set(['disabled', 'enabled'])
const PROJECTED_STATES = new Set(['disabled', 'enabled', 'unknown', 'not-applicable'])
const APPLICABILITY = new Set(['applicable', 'not-applicable'])
const EVIDENCE_AVAILABILITY = new Set(['available', 'unavailable', 'not-applicable'])
export const RELEASE_INSPECTION_SECRET_POLICY_STATES = Object.freeze([
  'required',
  'allowed',
  'forbidden',
  'not-applicable',
  'unresolved',
])
const SECRET_POLICIES = new Set(RELEASE_INSPECTION_SECRET_POLICY_STATES)
const PROTECTED_BINDING_NAMES = new Set([
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_RECOVERY_MODE',
  'RETENTION_CLEANUP_MODE',
])
const SHA256_PATTERN = /^[0-9a-f]{64}$/

const EXPECTED_SECRET_POLICIES = immutablePlain({
  preview: {
    frontend: {
      DRAFT_TICKET_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'not-applicable',
    },
    pages: {
      DRAFT_TICKET_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'forbidden',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'not-applicable',
    },
    worker: {
      DRAFT_TICKET_SIGNING_KEY: 'required',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'forbidden',
    },
    schedule: {
      DRAFT_TICKET_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'not-applicable',
    },
  },
  production: {
    frontend: {
      DRAFT_TICKET_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'not-applicable',
    },
    pages: {
      DRAFT_TICKET_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'forbidden',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'not-applicable',
    },
    worker: {
      DRAFT_TICKET_SIGNING_KEY: 'forbidden',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'forbidden',
    },
    schedule: {
      DRAFT_TICKET_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_CURSOR_SIGNING_KEY: 'not-applicable',
      LEADERBOARD_IDENTITY_SIGNING_KEY: 'not-applicable',
    },
  },
})

const EXPECTED_BINDINGS = immutablePlain({
  preview: {
    frontend: [],
    pages: [
      { name: 'DB', type: 'd1', value: 'pennant-pursuit-preview:ba6255b4-9425-4863-b10f-79149180f75a' },
      { name: 'DRAFT_SUBMISSION_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'DRAFT_TICKET_MODE', type: 'plain-text', value: 'enabled' },
      { name: 'DRAFT_VALIDATION_MODE', type: 'plain-text', value: 'enabled' },
      { name: 'LEADERBOARD_ENVIRONMENT', type: 'plain-text', value: 'preview' },
      { name: 'LEADERBOARD_IDENTITY_CLAIM_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_RENAME_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_STATUS_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_READ_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_RECOVERY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'VALIDATION_SERVICE', type: 'service', value: 'pennant-pursuit-validation-preview' },
    ],
    schedule: [],
    worker: [
      { name: 'DB', type: 'd1', value: 'pennant-pursuit-preview:ba6255b4-9425-4863-b10f-79149180f75a' },
      { name: 'DRAFT_SUBMISSION_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'DRAFT_TICKET_MODE', type: 'plain-text', value: 'enabled' },
      { name: 'DRAFT_VALIDATION_MODE', type: 'plain-text', value: 'enabled' },
      { name: 'LEADERBOARD_IDENTITY_CLAIM_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_RENAME_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_STATUS_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_RECOVERY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'RATE_LIMIT_BURST', type: 'rate-limit', value: '16204011' },
      { name: 'RATE_LIMIT_SUSTAINED', type: 'rate-limit', value: '16204012' },
      { name: 'RETENTION_CLEANUP_MODE', type: 'plain-text', value: 'disabled' },
    ],
  },
  production: {
    frontend: [],
    pages: [
      { name: 'DB', type: 'd1', value: 'pennant-pursuit-production:4b821c17-b88b-462d-a2ed-c6a2113cc362' },
      { name: 'DRAFT_SUBMISSION_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'DRAFT_TICKET_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'DRAFT_VALIDATION_MODE', type: 'plain-text', value: 'enabled' },
      { name: 'LEADERBOARD_ENVIRONMENT', type: 'plain-text', value: 'production' },
      { name: 'LEADERBOARD_IDENTITY_CLAIM_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_RENAME_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_STATUS_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_READ_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_RECOVERY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'VALIDATION_SERVICE', type: 'service', value: 'pennant-pursuit-validation-production' },
    ],
    schedule: [],
    worker: [
      { name: 'DRAFT_SUBMISSION_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'DRAFT_TICKET_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'DRAFT_VALIDATION_MODE', type: 'plain-text', value: 'enabled' },
      { name: 'LEADERBOARD_IDENTITY_CLAIM_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_RENAME_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_IDENTITY_STATUS_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'LEADERBOARD_RECOVERY_MODE', type: 'plain-text', value: 'disabled' },
      { name: 'RATE_LIMIT_BURST', type: 'rate-limit', value: '16204021' },
      { name: 'RATE_LIMIT_SUSTAINED', type: 'rate-limit', value: '16204022' },
      { name: 'RETENTION_CLEANUP_MODE', type: 'plain-text', value: 'disabled' },
    ],
  },
})

const EXPECTED_PROVIDER_LOCAL_CONFIGURATION = immutablePlain({
  preview: {
    pagesBuildOutputDirectory: 'dist',
    pagesCompatibilityDate: '2026-07-14',
    pagesD1Configuration: {
      migrationsDirectory: 'migrations',
      previewDatabaseId: 'DB',
    },
    pagesProjectName: 'diamond-draft',
    protectedFrontendSource: 'src/config/protectedCapabilities.mjs',
    workerCompatibilityDate: '2026-07-14',
    workerD1Configuration: {
      migrationsDirectory: '../../migrations',
      previewDatabaseId: 'DB',
    },
    workerMain: 'src/index.ts',
    workerName: 'pennant-pursuit-validation-preview',
    workerRateLimits: [
      { limit: 5, name: 'RATE_LIMIT_BURST', namespaceId: '16204011', period: 10 },
      { limit: 20, name: 'RATE_LIMIT_SUSTAINED', namespaceId: '16204012', period: 60 },
    ],
  },
  production: {
    pagesBuildOutputDirectory: 'dist',
    pagesCompatibilityDate: '2026-07-14',
    pagesD1Configuration: {
      migrationsDirectory: 'migrations',
      previewDatabaseId: null,
    },
    pagesProjectName: 'diamond-draft',
    protectedFrontendSource: 'src/config/protectedCapabilities.mjs',
    workerCompatibilityDate: '2026-07-14',
    workerD1Configuration: null,
    workerMain: 'src/index.ts',
    workerName: 'pennant-pursuit-validation-production',
    workerRateLimits: [
      { limit: 5, name: 'RATE_LIMIT_BURST', namespaceId: '16204021', period: 10 },
      { limit: 20, name: 'RATE_LIMIT_SUSTAINED', namespaceId: '16204022', period: 60 },
    ],
  },
})

const EXPECTED_PLATFORM_PREREQUISITES = immutablePlain({
  preview: {
    pages: { DRAFT_TICKET_MODE: 'enabled', DRAFT_VALIDATION_MODE: 'enabled' },
    worker: { DRAFT_TICKET_MODE: 'enabled', DRAFT_VALIDATION_MODE: 'enabled' },
  },
  production: {
    pages: { DRAFT_TICKET_MODE: 'disabled', DRAFT_VALIDATION_MODE: 'enabled' },
    worker: { DRAFT_TICKET_MODE: 'disabled', DRAFT_VALIDATION_MODE: 'enabled' },
  },
})

function fail(message) {
  throw new TypeError(`Release-inspection contract refused: ${message}`)
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort())
}

function relativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.split('/').includes('..')
    && !/[\u0000-\u001F\u007F]/u.test(value)
}

function exactString(value) {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001F\u007F]/u.test(value)
}

function validateCapabilityStates(value, label) {
  if (!exactKeys(value, RELEASE_INSPECTION_CAPABILITIES)) {
    fail(`${label} must contain the exact seven-capability vocabulary.`)
  }
  for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
    if (!MODES.has(value[capability])) fail(`${label}.${capability} has an unsupported state.`)
  }
  return immutablePlain(Object.fromEntries(
    RELEASE_INSPECTION_CAPABILITIES.map((capability) => [capability, value[capability]]),
  ))
}

export function createAllDisabledCapabilityTarget() {
  const capabilities = Object.fromEntries(
    RELEASE_INSPECTION_CAPABILITIES.map((capability) => [capability, 'disabled']),
  )
  return immutablePlain(Object.fromEntries(
    RELEASE_INSPECTION_ENVIRONMENTS.map((environment) => [environment, capabilities]),
  ))
}

export function validateCapabilityTarget(input, { enforceAllDisabledPolicy = true } = {}) {
  const snapshot = immutablePlain(input)
  if (!exactKeys(snapshot, RELEASE_INSPECTION_ENVIRONMENTS)) {
    fail('capability target must contain exactly preview and production.')
  }
  const environments = Object.fromEntries(RELEASE_INSPECTION_ENVIRONMENTS.map((environment) => [
    environment,
    validateCapabilityStates(snapshot[environment], `capability target ${environment}`),
  ]))
  if (enforceAllDisabledPolicy && RELEASE_INSPECTION_ENVIRONMENTS.some((environment) => (
    RELEASE_INSPECTION_CAPABILITIES.some((capability) => environments[environment][capability] !== 'disabled')
  ))) fail('3D-2A accepts only the exact all-disabled capability target.')
  return immutablePlain(environments)
}

export function parseCapabilityTarget(source, options = {}) {
  return validateCapabilityTarget(parseStrictJson(source, {
    label: 'Release-inspection capability target',
    limits: STRICT_JSON_LIMITS.readinessModel,
    error: (message) => new TypeError(message),
  }), options)
}

function validateSecretPolicies(input) {
  if (!exactKeys(input, RELEASE_INSPECTION_ENVIRONMENTS)) {
    fail('secret policies must contain exactly preview and production.')
  }
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    if (!exactKeys(input[environment], RELEASE_INSPECTION_SURFACES)) {
      fail(`${environment} secret policies must contain the exact surfaces.`)
    }
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const policies = input[environment][surface]
      if (!exactKeys(policies, RELEASE_INSPECTION_SECRET_NAMES)) {
        fail(`${environment}.${surface} secret policy must contain the exact secret-name inventory.`)
      }
      for (const secret of RELEASE_INSPECTION_SECRET_NAMES) {
        if (!SECRET_POLICIES.has(policies[secret])) {
          fail(`${environment}.${surface}.${secret} has an unsupported presence policy.`)
        }
      }
    }
  }
  return immutablePlain(input)
}

export function validateSecretPresencePolicy(input) {
  if (!SECRET_POLICIES.has(input)) fail('secret presence policy is unsupported.')
  return input
}

export function validateReleaseInspectionManifest(input) {
  const manifest = immutablePlain(input)
  if (!exactKeys(manifest, [
    'kind', 'localTopologyPolicy', 'policy', 'providerBuildPolicy', 'schemaVersion',
    'secretPolicies', 'sources', 'toolContractVersion',
  ])
    || manifest.schemaVersion !== RELEASE_INSPECTION_SCHEMA_VERSION
    || manifest.kind !== RELEASE_INSPECTION_KINDS.manifest
    || manifest.toolContractVersion !== RELEASE_INSPECTION_TOOL_CONTRACT_VERSION) {
    fail('manifest kind, version, or top-level shape is unsupported.')
  }
  if (!exactKeys(manifest.policy, [
    'capabilityTarget', 'currentnessWithoutIndependentProof', 'executionAuthorization',
    'filesystemWritesByDefault', 'previewRemoteEvidence', 'productionRemoteEvidence',
    'remoteInspection',
  ])
    || canonicalJson(manifest.policy) !== canonicalJson({
      capabilityTarget: 'all-disabled',
      currentnessWithoutIndependentProof: 'unknown',
      executionAuthorization: 'prohibited',
      filesystemWritesByDefault: 'prohibited',
      previewRemoteEvidence: 'unavailable',
      productionRemoteEvidence: 'excluded',
      remoteInspection: 'prohibited-in-3D-2A',
    })) fail('manifest policy must preserve the exact local-only all-disabled boundary.')
  if (canonicalJson(manifest.sources) !== canonicalJson(RELEASE_INSPECTION_MANIFEST_SOURCES)) {
    fail('manifest sources must equal the exact reviewed source identity map.')
  }
  if (!exactKeys(manifest.localTopologyPolicy, [
    'previewWorkerPublicExposure', 'productionWorkerD1', 'schedules',
  ])
    || canonicalJson(manifest.localTopologyPolicy) !== canonicalJson({
      previewWorkerPublicExposure: 'forbidden',
      productionWorkerD1: 'forbidden',
      schedules: 'exact-empty',
    })) fail('manifest topology policy is unsupported.')
  if (!exactKeys(manifest.providerBuildPolicy, [
    'pagesBuildOutputDirectory', 'protectedFrontendSource', 'remoteProviderSettings',
  ])
    || manifest.providerBuildPolicy.pagesBuildOutputDirectory !== 'dist'
    || manifest.providerBuildPolicy.protectedFrontendSource !== manifest.sources.frontendCapabilities
    || manifest.providerBuildPolicy.remoteProviderSettings !== 'unavailable') {
    fail('manifest provider build policy is unsupported.')
  }
  const secretPolicies = validateSecretPolicies(manifest.secretPolicies)
  if (canonicalJson(secretPolicies) !== canonicalJson(EXPECTED_SECRET_POLICIES)) {
    fail('manifest secret policies differ from the exact reviewed local policy.')
  }
  return manifest
}

export function parseReleaseInspectionManifest(source) {
  return validateReleaseInspectionManifest(parseStrictJson(source, {
    label: 'Release-inspection manifest',
    limits: STRICT_JSON_LIMITS.releaseManifest,
    exactIntegerTokens: {
      schemaVersion: String(RELEASE_INSPECTION_SCHEMA_VERSION),
    },
    error: (message) => new TypeError(message),
  }))
}

function validateTrustedProtectedSourceContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('standalone artifact requires an explicit trusted protected-source inventory.')
  }
  const context = immutablePlain(input)
  if (!exactKeys(context, ['protectedSourceHashes'])
    || !Array.isArray(context.protectedSourceHashes)
    || context.protectedSourceHashes.length !== RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS.length) {
    fail('standalone artifact requires an explicit trusted protected-source inventory.')
  }
  for (const entry of context.protectedSourceHashes) {
    if (!exactKeys(entry, ['path', 'sha256'])
      || !relativePath(entry.path)
      || !SHA256_PATTERN.test(entry.sha256)) {
      fail('trusted protected-source inventory is malformed.')
    }
  }
  const paths = context.protectedSourceHashes.map(({ path: sourcePath }) => sourcePath)
  if (new Set(paths).size !== paths.length) {
    fail('trusted protected-source inventory contains duplicate provenance.')
  }
  if (canonicalJson(paths) !== canonicalJson([...paths].sort())) {
    fail('trusted protected-source inventory must use deterministic path ordering.')
  }
  if (canonicalJson(paths) !== canonicalJson(RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS)) {
    fail('trusted protected-source inventory differs from the exact reviewed source inventory.')
  }
  const sourceHashes = new Map(
    context.protectedSourceHashes.map(({ path: sourcePath, sha256 }) => [sourcePath, sha256]),
  )
  if (canonicalJson(Object.fromEntries(sourceHashes))
    !== canonicalJson(RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES)) {
    fail('trusted protected-source hashes differ from the exact reviewed raw-file hash inventory.')
  }
  return sourceHashes
}

function validateEvidence(input, label) {
  if (!exactKeys(input, ['availability', 'provenance', 'sourceHash', 'sourcePath'])
    || !EVIDENCE_AVAILABILITY.has(input.availability)
    || !['local-authority', 'local-configuration', 'protected-frontend', 'not-applicable'].includes(input.provenance)
    || (input.availability === 'available' && (!relativePath(input.sourcePath) || !SHA256_PATTERN.test(input.sourceHash)))
    || (input.availability !== 'available' && (input.sourcePath !== null || input.sourceHash !== null))) {
    fail(`${label} evidence is malformed.`)
  }
}

function validateExactAvailableEvidence(input, label, provenance, sourcePath, sourceHashes) {
  validateEvidence(input, label)
  if (input.availability !== 'available'
    || input.provenance !== provenance
    || input.sourcePath !== sourcePath
    || input.sourceHash !== sourceHashes.get(sourcePath)) {
    fail(`${label} evidence must identify the exact reviewed source.`)
  }
}

function validateExactNotApplicableEvidence(input, label) {
  validateEvidence(input, label)
  if (canonicalJson(input) !== canonicalJson({
    availability: 'not-applicable',
    provenance: 'not-applicable',
    sourceHash: null,
    sourcePath: null,
  })) fail(`${label} evidence must be exactly not applicable.`)
}

function validateSurfaceState(input, label) {
  if (!exactKeys(input, ['applicability', 'configuredState', 'effectiveState', 'evidence'])
    || !APPLICABILITY.has(input.applicability)
    || !PROJECTED_STATES.has(input.configuredState)
    || !PROJECTED_STATES.has(input.effectiveState)) fail(`${label} surface state is malformed.`)
  validateEvidence(input.evidence, label)
  if (input.applicability === 'not-applicable'
    && (input.configuredState !== 'not-applicable'
      || input.effectiveState !== 'not-applicable'
      || input.evidence.availability !== 'not-applicable')) {
    fail(`${label} not-applicable state is contradictory.`)
  }
  if (input.applicability === 'applicable' && input.evidence.availability === 'available'
    && !MODES.has(input.configuredState)) fail(`${label} available configured state is malformed.`)
}

export function validateCapabilityMatrix(input, trustedContext) {
  const sourceHashes = validateTrustedProtectedSourceContext(trustedContext)
  const matrix = immutablePlain(input)
  if (!exactKeys(matrix, ['environments', 'kind', 'schemaVersion'])
    || matrix.schemaVersion !== RELEASE_INSPECTION_SCHEMA_VERSION
    || matrix.kind !== RELEASE_INSPECTION_KINDS.capabilityMatrix
    || !exactKeys(matrix.environments, RELEASE_INSPECTION_ENVIRONMENTS)) {
    fail('capability matrix shape or version is unsupported.')
  }
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    const environmentRecord = matrix.environments[environment]
    if (!exactKeys(environmentRecord, ['authorityContext', 'capabilities'])
      || !exactKeys(environmentRecord.authorityContext, [
        'emergencyStop', 'environment', 'evidence', 'expiresAtMs',
        'identityCompatibilityCeiling', 'reviewedAtMs',
      ])
      || environmentRecord.authorityContext.environment !== environment
      || environmentRecord.authorityContext.emergencyStop !== 'engaged'
      || environmentRecord.authorityContext.identityCompatibilityCeiling !== 'disabled'
      || environmentRecord.authorityContext.reviewedAtMs !== null
      || environmentRecord.authorityContext.expiresAtMs !== null) {
      fail(`${environment} authority context must remain emergency-stopped, unfresh, and all-disabled.`)
    }
    validateExactAvailableEvidence(
      environmentRecord.authorityContext.evidence,
      `${environment}.authorityContext`,
      'local-authority',
      RELEASE_INSPECTION_MANIFEST_SOURCES.authority,
      sourceHashes,
    )
    const capabilities = environmentRecord.capabilities
    if (!exactKeys(capabilities, RELEASE_INSPECTION_CAPABILITIES)) {
      fail(`${environment} capability matrix must contain exactly seven capabilities.`)
    }
    for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
      const record = capabilities[capability]
      if (!exactKeys(record, [
        'authority', 'compatibilityCeiling', 'effectiveState', 'emergencyStopInfluence',
        'surfaces',
      ])
        || !exactKeys(record.authority, ['configuredState', 'evidence'])
        || record.authority.configuredState !== 'disabled'
        || record.compatibilityCeiling !== (
          ['identityClaim', 'identityStatus', 'identityRename', 'identityRecovery'].includes(capability)
            ? 'disabled'
            : 'not-applicable'
        )
        || record.effectiveState !== 'disabled'
        || record.emergencyStopInfluence !== 'forced-disabled'
        || !exactKeys(record.surfaces, RELEASE_INSPECTION_SURFACES)) {
        fail(`${environment}.${capability} capability record is malformed or not all-disabled.`)
      }
      validateExactAvailableEvidence(
        record.authority.evidence,
        `${environment}.${capability}.authority`,
        'local-authority',
        RELEASE_INSPECTION_MANIFEST_SOURCES.authority,
        sourceHashes,
      )
      for (const surface of RELEASE_INSPECTION_SURFACES) {
        const label = `${environment}.${capability}.${surface}`
        const surfaceRecord = record.surfaces[surface]
        validateSurfaceState(surfaceRecord, label)
        const applicable = EXPECTED_CAPABILITY_SURFACES[capability].includes(surface)
        if (!applicable) {
          if (surfaceRecord.applicability !== 'not-applicable'
            || surfaceRecord.configuredState !== 'not-applicable'
            || surfaceRecord.effectiveState !== 'not-applicable') {
            fail(`${label} must be exactly not applicable.`)
          }
          validateExactNotApplicableEvidence(surfaceRecord.evidence, label)
          continue
        }
        const source = surface === 'frontend'
          ? ['protected-frontend', RELEASE_INSPECTION_MANIFEST_SOURCES.frontendCapabilities]
          : ['local-configuration', surface === 'pages'
            ? RELEASE_INSPECTION_MANIFEST_SOURCES.pagesConfiguration
            : RELEASE_INSPECTION_MANIFEST_SOURCES.workerConfiguration]
        if (surfaceRecord.applicability !== 'applicable'
          || surfaceRecord.configuredState !== 'disabled'
          || surfaceRecord.effectiveState !== 'disabled') {
          fail(`${label} must be exactly applicable and disabled.`)
        }
        validateExactAvailableEvidence(surfaceRecord.evidence, label, source[0], source[1], sourceHashes)
      }
    }
  }
  return matrix
}

function uniqueBindings(bindings, label) {
  if (!Array.isArray(bindings)) fail(`${label} bindings must be an array.`)
  const seen = new Set()
  for (const binding of bindings) {
    if (!exactKeys(binding, ['name', 'type', 'value'])
      || !exactString(binding.name)
      || !['d1', 'plain-text', 'rate-limit', 'service'].includes(binding.type)
      || (binding.value !== null && !exactString(binding.value))) fail(`${label} contains a malformed binding.`)
    if (RELEASE_INSPECTION_SECRET_NAMES.includes(binding.name)) {
      fail(`${label} must represent ${binding.name} only as a secret-name presence policy.`)
    }
    if (seen.has(binding.name)) fail(`${label} contains duplicate binding name ${binding.name}.`)
    seen.add(binding.name)
  }
}

function exactBindingInventory(bindings, expectedBindings, label) {
  uniqueBindings(bindings, label)
  const names = bindings.map(({ name }) => name)
  if (canonicalJson(names) !== canonicalJson([...names].sort())) {
    fail(`${label} bindings must use deterministic name ordering.`)
  }
  if (canonicalJson(bindings) !== canonicalJson(expectedBindings)) {
    fail(`${label} binding names, types, or identities differ from the exact reviewed inventory.`)
  }
}

function bindingValue(bindings, name, label) {
  const binding = bindings.find((candidate) => candidate.name === name)
  if (!binding || !exactString(binding.value)) fail(`${label} is missing exact binding ${name}.`)
  return binding.value
}

function validatePublicExposure(input, surface, environment) {
  const label = `${environment}.${surface}`
  if (!exactKeys(input, [
    'customDomains', 'evidenceStatus', 'previewUrls', 'routes', 'workersDev',
  ]) || !['local-configuration', 'not-applicable', 'unavailable'].includes(input.evidenceStatus)) {
    fail(`${label} public-exposure evidence is malformed.`)
  }
  if (surface === 'worker') {
    if (input.evidenceStatus !== 'local-configuration'
      || input.workersDev !== false
      || input.previewUrls !== false
      || !Array.isArray(input.routes)
      || input.routes.length !== 0
      || !Array.isArray(input.customDomains)
      || input.customDomains.length !== 0) fail(`${environment} Worker public exposure is forbidden.`)
    return
  }
  if (surface === 'pages') {
    if (input.evidenceStatus !== 'unavailable'
      || input.workersDev !== 'not-applicable'
      || input.previewUrls !== 'not-applicable'
      || input.routes !== null
      || input.customDomains !== null) {
      fail(`${environment} Pages provider exposure must remain explicitly unavailable.`)
    }
    return
  }
  if (input.evidenceStatus !== 'not-applicable'
    || input.workersDev !== 'not-applicable'
    || input.previewUrls !== 'not-applicable'
    || input.routes !== null
    || input.customDomains !== null) {
    fail(`${label} public exposure must be not applicable.`)
  }
}

export function validateBindingPolicy(input, trustedContext) {
  const sourceHashes = validateTrustedProtectedSourceContext(trustedContext)
  const policy = immutablePlain(input)
  if (!exactKeys(policy, ['environments', 'kind', 'schemaVersion'])
    || policy.schemaVersion !== RELEASE_INSPECTION_SCHEMA_VERSION
    || policy.kind !== RELEASE_INSPECTION_KINDS.bindingPolicy
    || !exactKeys(policy.environments, RELEASE_INSPECTION_ENVIRONMENTS)) {
    fail('binding policy shape or version is unsupported.')
  }
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    const record = policy.environments[environment]
    if (!exactKeys(record, [
      'frontend', 'pages', 'platformPrerequisites', 'providerBuildSettings', 'schedule', 'worker',
    ])
      || !exactKeys(record.platformPrerequisites, ['pages', 'worker'])
      || !exactKeys(record.platformPrerequisites.pages, ['DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE'])
      || !exactKeys(record.platformPrerequisites.worker, ['DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE'])
      || !MODES.has(record.platformPrerequisites.pages.DRAFT_TICKET_MODE)
      || !MODES.has(record.platformPrerequisites.pages.DRAFT_VALIDATION_MODE)
      || !MODES.has(record.platformPrerequisites.worker.DRAFT_TICKET_MODE)
      || !MODES.has(record.platformPrerequisites.worker.DRAFT_VALIDATION_MODE)
      || canonicalJson(record.platformPrerequisites) !== canonicalJson(EXPECTED_PLATFORM_PREREQUISITES[environment])
      || !exactKeys(record.providerBuildSettings, ['localEvidence', 'remoteEvidence'])
      || !exactKeys(record.providerBuildSettings.localEvidence, [
        'pagesBuildOutputDirectory', 'pagesCompatibilityDate', 'pagesD1Configuration',
        'pagesProjectName', 'protectedFrontendSource', 'redirectsHash', 'routesHash',
        'workerCompatibilityDate', 'workerD1Configuration', 'workerMain', 'workerName',
        'workerRateLimits',
      ])
      || !SHA256_PATTERN.test(record.providerBuildSettings.localEvidence.redirectsHash)
      || !SHA256_PATTERN.test(record.providerBuildSettings.localEvidence.routesHash)
      || record.providerBuildSettings.remoteEvidence !== 'unavailable') {
      fail(`${environment} binding policy is malformed.`)
    }
    if (record.providerBuildSettings.localEvidence.redirectsHash
      !== sourceHashes.get(RELEASE_INSPECTION_MANIFEST_SOURCES.redirects)
      || record.providerBuildSettings.localEvidence.routesHash
        !== sourceHashes.get(RELEASE_INSPECTION_MANIFEST_SOURCES.routes)) {
      fail(`${environment} provider hashes differ from trusted protected-source provenance.`)
    }
    const {
      redirectsHash: _redirectsHash,
      routesHash: _routesHash,
      ...localConfiguration
    } = record.providerBuildSettings.localEvidence
    if (canonicalJson(localConfiguration)
      !== canonicalJson(EXPECTED_PROVIDER_LOCAL_CONFIGURATION[environment])) {
      fail(`${environment} provider configuration differs from the exact reviewed local topology.`)
    }
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const inventory = record[surface]
      if (!exactKeys(inventory, [
        'bindings', 'publicExposure', 'schedules', 'secretPolicies',
      ])
        || !exactKeys(inventory.schedules, ['policy', 'values'])
        || inventory.schedules.policy !== (
          surface === 'worker' || surface === 'schedule' ? 'exact-empty' : 'not-applicable'
        )
        || !Array.isArray(inventory.schedules.values)
        || !exactKeys(inventory.secretPolicies, RELEASE_INSPECTION_SECRET_NAMES)) {
        fail(`${environment}.${surface} binding inventory is malformed.`)
      }
      exactBindingInventory(
        inventory.bindings,
        EXPECTED_BINDINGS[environment][surface],
        `${environment}.${surface}`,
      )
      if (inventory.bindings.some((binding) => (
        PROTECTED_BINDING_NAMES.has(binding.name) && binding.value !== 'disabled'
      ))) fail(`${environment}.${surface} protected bindings must remain exactly disabled.`)
      if (inventory.schedules.values.length !== 0) {
        fail(`${environment}.${surface} schedules must remain empty in 3D-2A.`)
      }
      validatePublicExposure(inventory.publicExposure, surface, environment)
      if (environment === 'production' && surface === 'worker'
        && inventory.bindings.some(({ type }) => type === 'd1')) {
        fail('Production Worker D1 binding is forbidden.')
      }
      for (const secret of RELEASE_INSPECTION_SECRET_NAMES) {
        if (!SECRET_POLICIES.has(inventory.secretPolicies[secret])
          || inventory.secretPolicies[secret] !== EXPECTED_SECRET_POLICIES[environment][surface][secret]) {
          fail(`${environment}.${surface}.${secret} secret policy is unsupported.`)
        }
      }
    }
    for (const surface of ['pages', 'worker']) {
      const bindings = record[surface].bindings
      for (const prerequisite of ['DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE']) {
        if (bindingValue(bindings, prerequisite, `${environment}.${surface}`)
          !== record.platformPrerequisites[surface][prerequisite]) {
          fail(`${environment}.${surface}.${prerequisite} differs from its platform-prerequisite record.`)
        }
      }
    }
    if (bindingValue(record.pages.bindings, 'LEADERBOARD_ENVIRONMENT', `${environment}.pages`) !== environment) {
      fail(`${environment} Pages environment marker is inconsistent.`)
    }
  }
  const preview = policy.environments.preview
  const production = policy.environments.production
  const previewPagesD1 = bindingValue(preview.pages.bindings, 'DB', 'preview.pages')
  const previewWorkerD1 = bindingValue(preview.worker.bindings, 'DB', 'preview.worker')
  const productionPagesD1 = bindingValue(production.pages.bindings, 'DB', 'production.pages')
  if (previewPagesD1 !== previewWorkerD1 || previewPagesD1 === productionPagesD1) {
    fail('Preview D1 identity must be shared only by Preview Pages and Worker and isolated from Production.')
  }
  if (bindingValue(preview.pages.bindings, 'VALIDATION_SERVICE', 'preview.pages')
    === bindingValue(production.pages.bindings, 'VALIDATION_SERVICE', 'production.pages')) {
    fail('Preview and Production Service Binding targets must remain distinct.')
  }
  const rateLimitValues = RELEASE_INSPECTION_ENVIRONMENTS.flatMap((environment) => [
    bindingValue(policy.environments[environment].worker.bindings, 'RATE_LIMIT_BURST', `${environment}.worker`),
    bindingValue(policy.environments[environment].worker.bindings, 'RATE_LIMIT_SUSTAINED', `${environment}.worker`),
  ])
  if (new Set(rateLimitValues).size !== rateLimitValues.length) {
    fail('Preview and Production rate-limit namespaces must remain distinct.')
  }
  return policy
}

export function validateObservationPlaceholder(input) {
  const observation = immutablePlain(input)
  if (!exactKeys(observation, ['environments', 'kind', 'schemaVersion'])
    || observation.schemaVersion !== RELEASE_INSPECTION_SCHEMA_VERSION
    || observation.kind !== RELEASE_INSPECTION_KINDS.observationPlaceholder
    || !exactKeys(observation.environments, RELEASE_INSPECTION_ENVIRONMENTS)) {
    fail('observation placeholder shape or version is unsupported.')
  }
  const expected = {
    preview: {
      currentness: 'unknown',
      reason: 'identity-grounding-required',
      status: 'unavailable',
    },
    production: {
      currentness: 'unknown',
      reason: 'production-remote-inspection-excluded',
      status: 'unavailable',
    },
  }
  if (canonicalJson(observation.environments) !== canonicalJson(expected)) {
    fail('3D-2A remote observation must remain explicitly unavailable and currentness unknown.')
  }
  return observation
}

export function validateLocalProjection(input) {
  const projection = immutablePlain(input)
  if (!exactKeys(projection, [
    'authorityHash', 'bindingPolicy', 'capabilityMatrix', 'executionAuthorization',
    'kind', 'manifestHash', 'noFilesystemWrites', 'noNetworkAccess', 'policy',
    'protectedSourceHashes', 'remoteObservation', 'result', 'schemaVersion',
    'toolContractVersion',
  ])
    || projection.schemaVersion !== RELEASE_INSPECTION_SCHEMA_VERSION
    || projection.kind !== RELEASE_INSPECTION_KINDS.localProjection
    || projection.toolContractVersion !== RELEASE_INSPECTION_TOOL_CONTRACT_VERSION
    || !SHA256_PATTERN.test(projection.authorityHash)
    || !SHA256_PATTERN.test(projection.manifestHash)
    || projection.policy !== 'all-disabled'
    || projection.result !== 'UNKNOWN'
    || projection.executionAuthorization !== 'prohibited'
    || projection.noFilesystemWrites !== true
    || projection.noNetworkAccess !== true
    || !Array.isArray(projection.protectedSourceHashes)
    || projection.protectedSourceHashes.length === 0) {
    fail('local projection envelope is malformed or exceeds the 3D-2A authority boundary.')
  }
  for (const entry of projection.protectedSourceHashes) {
    if (!exactKeys(entry, ['path', 'sha256']) || !relativePath(entry.path) || !SHA256_PATTERN.test(entry.sha256)) {
      fail('local projection source provenance is malformed.')
    }
  }
  if (new Set(projection.protectedSourceHashes.map(({ path }) => path)).size
    !== projection.protectedSourceHashes.length) {
    fail('local projection source provenance contains duplicate paths.')
  }
  const sourcePaths = projection.protectedSourceHashes.map(({ path }) => path)
  if (canonicalJson(sourcePaths) !== canonicalJson([...sourcePaths].sort())) {
    fail('local projection source provenance must use deterministic path ordering.')
  }
  if (canonicalJson(sourcePaths) !== canonicalJson(RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS)) {
    fail('local projection source provenance must equal the exact reviewed source inventory.')
  }
  const sourceHashes = new Map(
    projection.protectedSourceHashes.map(({ path, sha256 }) => [path, sha256]),
  )
  if (canonicalJson(Object.fromEntries(sourceHashes))
    !== canonicalJson(RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES)) {
    fail('local projection source hashes must equal the exact reviewed raw-file hash inventory.')
  }
  if (projection.authorityHash !== sourceHashes.get(RELEASE_INSPECTION_MANIFEST_SOURCES.authority)
    || projection.manifestHash !== sourceHashes.get('config/release-inspection-manifest.json')) {
    fail('local projection authority or manifest hash differs from raw protected-source provenance.')
  }
  const trustedContext = { protectedSourceHashes: projection.protectedSourceHashes }
  validateCapabilityMatrix(projection.capabilityMatrix, trustedContext)
  validateBindingPolicy(projection.bindingPolicy, trustedContext)
  validateObservationPlaceholder(projection.remoteObservation)
  const assertEvidenceHash = (evidence, label) => {
    if (evidence.availability === 'available'
      && sourceHashes.get(evidence.sourcePath) !== evidence.sourceHash) {
      fail(`${label} evidence hash differs from protected-source provenance.`)
    }
  }
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    const environmentRecord = projection.capabilityMatrix.environments[environment]
    assertEvidenceHash(environmentRecord.authorityContext.evidence, `${environment}.authorityContext`)
    for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
      const capabilityRecord = environmentRecord.capabilities[capability]
      assertEvidenceHash(capabilityRecord.authority.evidence, `${environment}.${capability}.authority`)
      for (const surface of RELEASE_INSPECTION_SURFACES) {
        assertEvidenceHash(
          capabilityRecord.surfaces[surface].evidence,
          `${environment}.${capability}.${surface}`,
        )
      }
    }
    const localEvidence = projection.bindingPolicy.environments[environment]
      .providerBuildSettings.localEvidence
    if (localEvidence.redirectsHash !== sourceHashes.get(RELEASE_INSPECTION_MANIFEST_SOURCES.redirects)
      || localEvidence.routesHash !== sourceHashes.get(RELEASE_INSPECTION_MANIFEST_SOURCES.routes)) {
      fail(`${environment} provider hashes differ from protected-source provenance.`)
    }
  }
  return projection
}

export function canonicalReleaseInspectionJson(value, trustedContext) {
  const snapshot = immutablePlain(value)
  const validated = snapshot.kind === RELEASE_INSPECTION_KINDS.manifest
    ? validateReleaseInspectionManifest(snapshot)
    : snapshot.kind === RELEASE_INSPECTION_KINDS.capabilityMatrix
      ? validateCapabilityMatrix(snapshot, trustedContext)
      : snapshot.kind === RELEASE_INSPECTION_KINDS.bindingPolicy
        ? validateBindingPolicy(snapshot, trustedContext)
        : snapshot.kind === RELEASE_INSPECTION_KINDS.observationPlaceholder
          ? validateObservationPlaceholder(snapshot)
          : snapshot.kind === RELEASE_INSPECTION_KINDS.localProjection
            ? validateLocalProjection(snapshot)
            : fail('artifact kind is unsupported.')
  return `${canonicalJson(validated)}\n`
}

export function releaseInspectionHash(value) {
  return canonicalHash(immutablePlain(value))
}
