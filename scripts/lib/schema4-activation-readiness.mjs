import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  immutablePlain,
  parseStrictJson,
  readStrictJsonFile,
  STRICT_JSON_LIMITS,
} from './preview-release/canonical.mjs'
import { loadRepositoryMigrations } from './preview-release/migrations.mjs'
import { SCHEMA4_RUNTIME_GATE_REGISTRY } from '../../shared/schema4-capabilities.mjs'
import {
  assertIndependentSchema4AuthorityModel,
  parseSchema4CapabilityModel,
  SCHEMA4_AUTHORITY_MAX_TTL_MS,
  SCHEMA4_AUTHORITY_SCHEMA_VERSION,
  SCHEMA4_CAPABILITIES,
  SCHEMA4_CAPABILITY_MODEL_VERSION,
} from './schema4-activation-authority.mjs'

const MODEL_PATH = 'config/preview-schema4-readiness.json'
const TARGET_SCHEMA = 4
const REQUIRED_MIGRATION = '0004_leaderboard_identity_ranking.sql'
const EXPECTED_PREFIX = Object.freeze([
  '0001_backend_foundation.sql',
  '0002_draft_submissions.sql',
  '0003_leaderboard_foundation.sql',
  REQUIRED_MIGRATION,
])
const RUNTIME_SURFACES = Object.freeze(['frontendBuild', 'pagesFunctions', 'privateWorker'])
const DEFAULT_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CONSUMER_REGISTRATION_PATHS = Object.freeze({
  frontendBuild: 'src/features/leaderboard/runtimeConfig.registrations.json',
  leaderboardRead: 'functions/lib/leaderboard-mode.registrations.json',
  identity: 'functions/lib/leaderboard-identity-mode.registrations.json',
  draftSubmission: 'functions/lib/draft-submission-mode.registrations.json',
  cleanupCron: 'workers/draft-validation/src/retention-cleanup-mode.registrations.json',
})
const IDENTITY_CAPABILITIES = Object.freeze([
  'identityClaim',
  'identityStatus',
  'identityRename',
  'identityRecovery',
])
const EXPECTED_ACTIVE_CONSUMERS = Object.freeze({
  frontendBuild: Object.freeze({
    leaderboardRead: 'src/features/leaderboard/runtimeConfig.ts#protectedFrontendFeatureState:leaderboardRead',
    identityClaim: 'src/features/leaderboard/runtimeConfig.ts#protectedFrontendFeatureState:identityClaim',
    identityStatus: 'src/features/leaderboard/runtimeConfig.ts#protectedFrontendFeatureState:identityStatus',
    identityRename: 'src/features/leaderboard/runtimeConfig.ts#protectedFrontendFeatureState:identityRename',
    draftSubmission: 'src/features/leaderboard/runtimeConfig.ts#protectedFrontendFeatureState:draftSubmission',
    identityRecovery: 'src/features/leaderboard/runtimeConfig.ts#protectedFrontendFeatureState:identityRecovery',
  }),
  pagesFunctions: Object.freeze({
    leaderboardRead: 'functions/lib/leaderboard-mode.ts#leaderboardReadFeatureState',
    identityClaim: 'functions/lib/leaderboard-identity-mode.ts#leaderboardIdentityCapabilityFeatureState:claim',
    identityStatus: 'functions/lib/leaderboard-identity-mode.ts#leaderboardIdentityCapabilityFeatureState:status',
    identityRename: 'functions/lib/leaderboard-identity-mode.ts#leaderboardIdentityCapabilityFeatureState:rename',
    draftSubmission: 'functions/lib/draft-submission-mode.ts#draftSubmissionFeatureState',
    identityRecovery: 'functions/lib/leaderboard-identity-mode.ts#leaderboardIdentityCapabilityFeatureState:recover',
  }),
  privateWorker: Object.freeze({
    identityClaim: 'functions/lib/leaderboard-identity-mode.ts#privateWorkerLeaderboardIdentityCapabilityFeatureState:claim',
    identityStatus: 'functions/lib/leaderboard-identity-mode.ts#privateWorkerLeaderboardIdentityCapabilityFeatureState:status',
    identityRename: 'functions/lib/leaderboard-identity-mode.ts#privateWorkerLeaderboardIdentityCapabilityFeatureState:rename',
    draftSubmission: 'functions/lib/draft-submission-mode.ts#privateWorkerDraftSubmissionFeatureState',
    identityRecovery: 'functions/lib/leaderboard-identity-mode.ts#privateWorkerLeaderboardIdentityCapabilityFeatureState:recover',
    cleanupCron: 'workers/draft-validation/src/retention-cleanup-mode.ts#isRetentionCleanupEnabled',
  }),
})
const FRONTEND_FEATURES = Object.freeze({
  leaderboardRead: 'leaderboardRead',
  identityClaim: 'identityClaim',
  identityStatus: 'identityStatus',
  identityRename: 'identityRename',
  draftSubmission: 'submission',
  identityRecovery: 'recovery',
  cleanupCron: null,
})

function refuse(message) {
  throw new Error(`Schema-4 activation refused: ${message}`)
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

function exactJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function descriptorVariable(descriptor) {
  return descriptor === null ? null : descriptor.variable
}

function readConsumerRegistrationFile(repositoryRoot, relativePath) {
  try {
    return readStrictJsonFile(path.join(repositoryRoot, relativePath), {
      label: `Schema-4 runtime consumer registration ${relativePath}`,
      limits: STRICT_JSON_LIMITS.readinessModel,
      error: (message) => new TypeError(message),
    }).value
  } catch {
    refuse(`runtime consumer registration ${relativePath} is missing or malformed.`)
  }
}

export function loadSchema4RuntimeConsumerRegistrations(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const frontend = readConsumerRegistrationFile(repositoryRoot, CONSUMER_REGISTRATION_PATHS.frontendBuild)
  const leaderboardRead = readConsumerRegistrationFile(repositoryRoot, CONSUMER_REGISTRATION_PATHS.leaderboardRead)
  const identity = readConsumerRegistrationFile(repositoryRoot, CONSUMER_REGISTRATION_PATHS.identity)
  const draftSubmission = readConsumerRegistrationFile(repositoryRoot, CONSUMER_REGISTRATION_PATHS.draftSubmission)
  const cleanupCron = readConsumerRegistrationFile(repositoryRoot, CONSUMER_REGISTRATION_PATHS.cleanupCron)
  if (!exactKeys(frontend, SCHEMA4_CAPABILITIES)
    || !exactKeys(leaderboardRead, ['pagesFunctions', 'privateWorker'])
    || !exactKeys(draftSubmission, ['pagesFunctions', 'privateWorker'])
    || !exactKeys(cleanupCron, ['pagesFunctions', 'privateWorker'])
    || !exactKeys(identity, ['pagesFunctions', 'privateWorker'])
    || !exactKeys(identity.pagesFunctions, IDENTITY_CAPABILITIES)
    || !exactKeys(identity.privateWorker, IDENTITY_CAPABILITIES)) {
    refuse('consumer-owned runtime registration files have missing or extra records.')
  }
  return immutablePlain({
    frontendBuild: frontend,
    pagesFunctions: {
      leaderboardRead: leaderboardRead.pagesFunctions,
      identityClaim: identity.pagesFunctions.identityClaim,
      identityStatus: identity.pagesFunctions.identityStatus,
      identityRename: identity.pagesFunctions.identityRename,
      draftSubmission: draftSubmission.pagesFunctions,
      identityRecovery: identity.pagesFunctions.identityRecovery,
      cleanupCron: cleanupCron.pagesFunctions,
    },
    privateWorker: {
      leaderboardRead: leaderboardRead.privateWorker,
      identityClaim: identity.privateWorker.identityClaim,
      identityStatus: identity.privateWorker.identityStatus,
      identityRename: identity.privateWorker.identityRename,
      draftSubmission: draftSubmission.privateWorker,
      identityRecovery: identity.privateWorker.identityRecovery,
      cleanupCron: cleanupCron.privateWorker,
    },
  })
}

export function validateSchema4RuntimeGateRegistry(
  input = SCHEMA4_RUNTIME_GATE_REGISTRY,
  runtimeConsumerRegistrations = loadSchema4RuntimeConsumerRegistrations(),
) {
  let registry
  let registrations
  try {
    registry = immutablePlain(input)
    registrations = immutablePlain(runtimeConsumerRegistrations)
  } catch {
    refuse('the runtime gate registry or consumer registrations are not immutable plain data.')
  }
  if (!exactKeys(registry, ['capabilities', 'frontendBuildTime'])
    || !exactJson(registry.frontendBuildTime, {
      effectiveState: 'all-disabled',
      integrationStatus: 'protected-local-source',
      protectedSource: 'src/config/protectedCapabilities.mjs',
    })
    || !exactKeys(registry.capabilities, SCHEMA4_CAPABILITIES)) {
    refuse('the runtime gate registry is incomplete or does not preserve the protected frontend boundary.')
  }
  const variables = {}
  for (const capability of SCHEMA4_CAPABILITIES) {
    const gates = registry.capabilities[capability]
    if (!exactKeys(gates, RUNTIME_SURFACES)) refuse(`runtime gates for ${capability} are incomplete.`)
    variables[capability] = {}
    for (const surface of RUNTIME_SURFACES) {
      const descriptor = gates[surface]
      if (descriptor !== null) {
        if (!exactKeys(descriptor, ['compatibilityCeiling', 'feature', 'variable'])
          || typeof descriptor.feature !== 'string' || descriptor.feature.length === 0
          || (descriptor.variable !== null && (typeof descriptor.variable !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(descriptor.variable)))
          || (descriptor.compatibilityCeiling !== null
            && (typeof descriptor.compatibilityCeiling !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(descriptor.compatibilityCeiling)))) {
          refuse(`runtime gate descriptor ${capability}.${surface} is malformed.`)
        }
      }
      variables[capability][surface] = descriptorVariable(descriptor)
    }
    const frontend = gates.frontendBuild
    const expectedFrontendFeature = FRONTEND_FEATURES[capability]
    if ((expectedFrontendFeature === null && frontend !== null)
      || (expectedFrontendFeature !== null && (
        frontend === null
        || frontend.feature !== expectedFrontendFeature
        || frontend.variable !== null
        || frontend.compatibilityCeiling !== null
      ))) {
      refuse(`frontend build-time gate ${capability} must remain explicitly unconfigured and disabled.`)
    }
  }
  const identityCapabilities = ['identityClaim', 'identityStatus', 'identityRename', 'identityRecovery']
  const ceilings = {
    frontendBuild: null,
    pagesFunctions: 'LEADERBOARD_IDENTITY_MODE',
    privateWorker: 'LEADERBOARD_IDENTITY_MODE',
  }
  for (const capability of identityCapabilities) {
    for (const surface of ['pagesFunctions', 'privateWorker']) {
      if (registry.capabilities[capability][surface]?.compatibilityCeiling !== ceilings[surface]) {
        refuse(`identity compatibility ceiling wiring is incorrect for ${capability}.${surface}.`)
      }
    }
  }
  for (const capability of ['leaderboardRead', 'draftSubmission', 'cleanupCron']) {
    for (const surface of RUNTIME_SURFACES) {
      if (registry.capabilities[capability][surface]?.compatibilityCeiling !== null
        && registry.capabilities[capability][surface] !== null) {
        refuse(`non-identity capability ${capability} has an invalid compatibility ceiling.`)
      }
    }
  }
  if (!exactKeys(registrations, RUNTIME_SURFACES)) refuse('runtime consumer registrations do not cover the exact runtime surfaces.')
  const observedConsumerIdentities = new Set()
  for (const surface of RUNTIME_SURFACES) {
    if (!exactKeys(registrations[surface], SCHEMA4_CAPABILITIES)) {
      refuse(`runtime consumer registrations for ${surface} have missing or extra capabilities.`)
    }
    for (const capability of SCHEMA4_CAPABILITIES) {
      const registration = registrations[surface][capability]
      const descriptor = registry.capabilities[capability][surface]
      const expectedConsumerIdentity = EXPECTED_ACTIVE_CONSUMERS[surface][capability] ?? null
      if (!exactKeys(registration, [
        'capability',
        'surface',
        'descriptorPath',
        'consumerIdentity',
        'consumerStatus',
        'compatibilityCeiling',
      ]) || registration.capability !== capability || registration.surface !== surface) {
        refuse(`runtime consumer registration ${capability}.${surface} is malformed or cross-surface.`)
      }
      if (expectedConsumerIdentity === null) {
        if (descriptor !== null
          || registration.descriptorPath !== null
          || registration.consumerIdentity !== null
          || registration.consumerStatus !== 'deliberately-absent'
          || registration.compatibilityCeiling !== null) {
          refuse(`runtime consumer ${capability}.${surface} must remain deliberately absent.`)
        }
        continue
      }
      if (typeof registration.consumerIdentity === 'string') {
        if (observedConsumerIdentities.has(registration.consumerIdentity)) {
          refuse(`runtime consumer registration ${capability}.${surface} duplicates a consumer identity.`)
        }
        observedConsumerIdentities.add(registration.consumerIdentity)
      }
      if (descriptor === null
        || registration.descriptorPath !== `capabilities.${capability}.${surface}`
        || registration.consumerIdentity !== expectedConsumerIdentity
        || registration.consumerStatus !== 'active'
        || registration.compatibilityCeiling !== descriptor.compatibilityCeiling) {
        refuse(`runtime consumer registration ${capability}.${surface} does not identify the expected active consumer.`)
      }
    }
  }
  return immutablePlain({ registry, variables, ceilings, registrations })
}

export function parseSchema4ReadinessModel(source, {
  runtimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
  runtimeConsumerRegistrations = loadSchema4RuntimeConsumerRegistrations(),
} = {}) {
  let model
  try {
    model = immutablePlain(parseStrictJson(source, {
      label: 'Schema-4 readiness model',
      error: (message) => new TypeError(message),
      limits: STRICT_JSON_LIMITS.readinessModel,
    }))
  } catch {
    refuse('the local readiness model is missing or malformed.')
  }
  if (!exactKeys(model, [
    'modelVersion',
    'targetDatabaseSchema',
    'requiredMigration',
    'expectedMigrationPrefix',
    'authorityContract',
    'frontendBuildTime',
    'capabilityVariables',
    'identityCompatibilityCeilingVariables',
    'environmentMarkers',
    'expectedHealth',
    'checkedInState',
    'identityPolicy',
    'rollbackPolicy',
  ])) refuse('the local readiness model has missing or extra fields.')
  if (
    model.modelVersion !== 2
    || model.targetDatabaseSchema !== TARGET_SCHEMA
    || model.requiredMigration !== REQUIRED_MIGRATION
    || !exactJson(model.expectedMigrationPrefix, EXPECTED_PREFIX)
    || model.checkedInState !== 'all-disabled'
    || typeof model.identityPolicy !== 'string'
    || model.identityPolicy.length === 0
    || typeof model.rollbackPolicy !== 'string'
    || model.rollbackPolicy.length === 0
  ) refuse('the local readiness model is not the reviewed schema-4 contract.')
  if (
    !exactKeys(model.authorityContract, [
      'path', 'modelVersion', 'schemaVersion', 'maximumReviewWindowMs',
    ])
    || model.authorityContract.path !== 'workers/draft-validation/d1c4-activation-states.json'
    || model.authorityContract.modelVersion !== SCHEMA4_CAPABILITY_MODEL_VERSION
    || model.authorityContract.schemaVersion !== SCHEMA4_AUTHORITY_SCHEMA_VERSION
    || model.authorityContract.maximumReviewWindowMs !== SCHEMA4_AUTHORITY_MAX_TTL_MS
  ) refuse('the readiness authority contract is malformed or unsupported.')
  const runtimeWiring = validateSchema4RuntimeGateRegistry(
    runtimeGateRegistry,
    runtimeConsumerRegistrations,
  )
  if (
    !exactKeys(model.capabilityVariables, SCHEMA4_CAPABILITIES)
    || !exactJson(model.frontendBuildTime, runtimeWiring.registry.frontendBuildTime)
    || !exactJson(model.capabilityVariables, runtimeWiring.variables)
    || !exactJson(model.identityCompatibilityCeilingVariables, runtimeWiring.ceilings)
    || !exactJson(model.environmentMarkers, { pages: 'LEADERBOARD_ENVIRONMENT' })
  ) refuse('the canonical capability-to-variable mapping is incomplete or inconsistent.')
  if (
    !exactKeys(model.expectedHealth, [
      'databaseSchemaVersion', 'submissionSchema', 'leaderboardIdentity', 'leaderboardRecovery',
    ])
    || model.expectedHealth.databaseSchemaVersion !== TARGET_SCHEMA
    || model.expectedHealth.submissionSchema !== 'pennant-draft-submission-v1'
    || model.expectedHealth.leaderboardIdentity !== 'schema-ready'
    || model.expectedHealth.leaderboardRecovery !== 'schema-ready'
  ) refuse('the expected schema-4 health contract is malformed.')
  return model
}

export function loadSchema4ReadinessModel(repositoryRoot, {
  runtimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
  runtimeConsumerRegistrations = loadSchema4RuntimeConsumerRegistrations(repositoryRoot),
} = {}) {
  let loaded
  try {
    loaded = readStrictJsonFile(path.join(repositoryRoot, MODEL_PATH), {
      label: 'Schema-4 readiness model',
      limits: STRICT_JSON_LIMITS.readinessModel,
      error: (message) => new TypeError(message),
    })
  } catch {
    refuse('the local readiness model is missing or malformed.')
  }
  return parseSchema4ReadinessModel(loaded.source, {
    runtimeGateRegistry,
    runtimeConsumerRegistrations,
  })
}

export function assertSchema4RepositoryReadiness(repositoryRoot, nowMs = Date.now(), {
  runtimeGateRegistry = SCHEMA4_RUNTIME_GATE_REGISTRY,
  runtimeConsumerRegistrations = loadSchema4RuntimeConsumerRegistrations(repositoryRoot),
} = {}) {
  const loadedReadiness = readStrictJsonFile(path.join(repositoryRoot, MODEL_PATH), {
    label: 'Schema-4 readiness model',
    limits: STRICT_JSON_LIMITS.readinessModel,
    error: (message) => new TypeError(message),
  })
  const model = parseSchema4ReadinessModel(loadedReadiness.source, {
    runtimeGateRegistry,
    runtimeConsumerRegistrations,
  })
  const migrations = loadRepositoryMigrations(repositoryRoot)
  const names = migrations.map(({ name }) => name)
  if (!exactJson(names, model.expectedMigrationPrefix)) {
    refuse('the repository migration prefix is unexpected or migration 0004 is missing.')
  }
  let capabilityModel
  try {
    const loadedAuthority = readStrictJsonFile(path.join(repositoryRoot, model.authorityContract.path), {
      label: 'Schema-4 capability model',
      limits: STRICT_JSON_LIMITS.authorityModel,
      error: (message) => new TypeError(message),
    })
    capabilityModel = parseSchema4CapabilityModel(loadedAuthority.source, nowMs)
  } catch (error) {
    refuse(error instanceof Error ? error.message : 'the protected capability model is malformed.')
  }
  return Object.freeze({
    model,
    migrations,
    capabilityModel,
    runtimeWiring: validateSchema4RuntimeGateRegistry(
      runtimeGateRegistry,
      runtimeConsumerRegistrations,
    ),
  })
}

export function assertSchema4MigrationTarget(migration, knownMigrations) {
  const names = knownMigrations.map(({ name }) => name)
  if (!exactJson(names, EXPECTED_PREFIX)) {
    refuse('migration 0004 is missing or the migration prefix is unexpected.')
  }
  if (!migration || migration.status !== 'valid') refuse('the database schema or migration state is unknown.')
  if (migration.backendVersion === 3) {
    if (
      migration.pending.length !== 1
      || migration.pending[0]?.name !== REQUIRED_MIGRATION
    ) refuse('exact schema 3 must have only migration 0004 pending.')
    return migration
  }
  if (migration.backendVersion === TARGET_SCHEMA && migration.pending.length === 0) return migration
  refuse(`expected exact schema 3 with one pending migration or exact schema ${TARGET_SCHEMA} with none pending.`)
}

export function assertSchema4StateModelSupportsActivation(repositoryRoot) {
  assertSchema4RepositoryReadiness(repositoryRoot)
  return assertIndependentSchema4AuthorityModel()
}

export function assertSchema4ProtectedConfigurationSupportsActivation(repositoryRoot) {
  assertSchema4RepositoryReadiness(repositoryRoot)
  refuse('legacy protected release tooling remains disabled-only; release-inspection evidence grants no execution authority.')
}

export function assertSchema4ActivationPlan({ repositoryRoot, targetState }) {
  assertSchema4RepositoryReadiness(repositoryRoot)
  if (targetState === 'disabled') return
  refuse('legacy protected release tooling remains disabled-only; release-inspection evidence grants no execution authority.')
}
