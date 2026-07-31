import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSchema4ActivationPlan,
  assertSchema4MigrationTarget,
  assertSchema4ProtectedConfigurationSupportsActivation,
  assertSchema4RepositoryReadiness,
  assertSchema4StateModelSupportsActivation,
  loadSchema4RuntimeConsumerRegistrations,
  parseSchema4ReadinessModel,
  validateSchema4RuntimeGateRegistry,
} from './lib/schema4-activation-readiness.mjs'
import { loadReleaseManifest } from './lib/preview-release/manifest.mjs'
import {
  runtimeGateFeatureState,
  SCHEMA4_RUNTIME_GATE_REGISTRY,
} from '../shared/schema4-capabilities.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { model, migrations, capabilityModel } = assertSchema4RepositoryReadiness(repositoryRoot)
assert.equal(model.modelVersion, 2)
assert.equal(capabilityModel.modelVersion, 2)
const EXPECTED_CAPABILITIES = [
  'cleanupCron',
  'draftSubmission',
  'identityClaim',
  'identityRecovery',
  'identityRename',
  'identityStatus',
  'leaderboardRead',
]
assert.equal(Object.keys(model.capabilityVariables).length, 7)
assert.deepEqual(Object.keys(model.capabilityVariables), [
  'cleanupCron',
  'draftSubmission',
  'identityClaim',
  'identityRecovery',
  'identityRename',
  'identityStatus',
  'leaderboardRead',
])
assert.deepEqual(Object.keys(model.capabilityVariables), EXPECTED_CAPABILITIES)
assert.deepEqual(model.frontendBuildTime, {
  effectiveState: 'all-disabled',
  integrationStatus: 'deferred-to-3D-2',
  protectedSource: null,
})
for (const capability of Object.keys(model.capabilityVariables)) {
  assert.equal(model.capabilityVariables[capability].frontendBuild, null)
}

const readinessSource = readFileSync('config/preview-schema4-readiness.json', 'utf8')
for (const source of [
  readinessSource.replace('"modelVersion": 2,', '"modelVersion": 3,'),
  readinessSource.replace('"cleanupCron": {', '"unknownCapability": {'),
  readinessSource.replace('"privateWorker": "RETENTION_CLEANUP_MODE"', '"privateWorker": "RETENTION_MODE"'),
  readinessSource.replace('"pagesFunctions": "LEADERBOARD_READ_MODE"', '"pagesFunctions": "LEADERBOARD_MODE"'),
  readinessSource.replace('"protectedSource": null', '"protectedSource": "wrangler.toml"'),
  readinessSource.replace('"checkedInState": "all-disabled",', ''),
  readinessSource.replace('"checkedInState": "all-disabled",', '"checkedInState": "all-disabled",\n  "extra": true,'),
]) assert.throws(() => parseSchema4ReadinessModel(source), /Schema-4 activation refused/)
assert.throws(
  () => parseSchema4ReadinessModel(readinessSource.replace('"modelVersion": 2,', '"modelVersion": 2,\n  "modelVersion": 2,')),
  /Schema-4 activation refused/,
)

assert.doesNotThrow(() => validateSchema4RuntimeGateRegistry())
const runtimeConsumerRegistrations = loadSchema4RuntimeConsumerRegistrations(repositoryRoot)
for (const registrations of [
  runtimeConsumerRegistrations,
  ...Object.values(runtimeConsumerRegistrations),
]) assert.equal(Object.isFrozen(registrations), true)
for (const registrations of Object.values(runtimeConsumerRegistrations)) {
  for (const registration of Object.values(registrations)) assert.equal(Object.isFrozen(registration), true)
}

const missingWorkerConsumer = structuredClone(runtimeConsumerRegistrations)
delete missingWorkerConsumer.privateWorker.draftSubmission
assert.throws(
  () => assertSchema4RepositoryReadiness(repositoryRoot, Date.UTC(2026, 6, 31, 12), {
    runtimeConsumerRegistrations: missingWorkerConsumer,
  }),
  /consumer registrations.*privateWorker|missing or extra capabilities/i,
)
const registrationMutations = [
  ['duplicate consumer', (registrations) => {
    registrations.privateWorker.identityStatus.consumerIdentity =
      registrations.privateWorker.identityClaim.consumerIdentity
  }],
  ['extra consumer', (registrations) => {
    registrations.pagesFunctions.unknownCapability = registrations.pagesFunctions.leaderboardRead
  }],
  ['cross-surface consumer', (registrations) => {
    registrations.pagesFunctions.draftSubmission = registrations.privateWorker.draftSubmission
  }],
  ['wrong capability consumer', (registrations) => {
    registrations.privateWorker.identityClaim.capability = 'identityRename'
  }],
  ['claim and rename swapped', (registrations) => {
    const claim = registrations.privateWorker.identityClaim
    registrations.privateWorker.identityClaim = registrations.privateWorker.identityRename
    registrations.privateWorker.identityRename = claim
  }],
  ['cleanup registered to Pages', (registrations) => {
    registrations.pagesFunctions.cleanupCron = {
      ...registrations.privateWorker.cleanupCron,
      surface: 'pagesFunctions',
      descriptorPath: 'capabilities.cleanupCron.pagesFunctions',
    }
  }],
  ['leaderboard read registered to Worker', (registrations) => {
    registrations.privateWorker.leaderboardRead = {
      ...registrations.pagesFunctions.leaderboardRead,
      surface: 'privateWorker',
      descriptorPath: 'capabilities.leaderboardRead.privateWorker',
    }
  }],
  ['nonexistent consumer', (registrations) => {
    registrations.privateWorker.draftSubmission.consumerIdentity =
      'workers/draft-validation/src/missing.ts#missingConsumer'
  }],
]
for (const [label, mutate] of registrationMutations) {
  const registrations = structuredClone(runtimeConsumerRegistrations)
  mutate(registrations)
  assert.throws(
    () => validateSchema4RuntimeGateRegistry(SCHEMA4_RUNTIME_GATE_REGISTRY, registrations),
    /runtime consumer|consumer registrations/i,
    label,
  )
}
for (const mutate of [
  (registry) => { delete registry.capabilities.cleanupCron.privateWorker },
  (registry) => { registry.capabilities.leaderboardRead.pagesFunctions.variable = 'LEADERBOARD_MODE' },
  (registry) => { registry.capabilities.identityClaim.frontendBuild.variable = 'VITE_LEADERBOARD_IDENTITY_CLAIM_MODE' },
]) {
  const disconnected = structuredClone(SCHEMA4_RUNTIME_GATE_REGISTRY)
  mutate(disconnected)
  assert.throws(
    () => assertSchema4RepositoryReadiness(repositoryRoot, Date.UTC(2026, 6, 31, 12), {
      runtimeGateRegistry: disconnected,
    }),
    /runtime gate|gate descriptor|frontend build-time|mapping/i,
  )
}
const missingCleanupRegistry = structuredClone(SCHEMA4_RUNTIME_GATE_REGISTRY)
missingCleanupRegistry.capabilities.cleanupCron.privateWorker = null
assert.throws(
  () => parseSchema4ReadinessModel(readinessSource, { runtimeGateRegistry: missingCleanupRegistry }),
  /mapping|runtime gate|runtime consumer/i,
)
const divergentSurfaceRegistry = structuredClone(SCHEMA4_RUNTIME_GATE_REGISTRY)
divergentSurfaceRegistry.capabilities.draftSubmission.pagesFunctions.variable = 'PAGES_SUBMISSION_TEST'
divergentSurfaceRegistry.capabilities.draftSubmission.privateWorker.variable = 'WORKER_SUBMISSION_TEST'
const divergentReadiness = JSON.parse(readinessSource)
divergentReadiness.capabilityVariables.draftSubmission.pagesFunctions = 'PAGES_SUBMISSION_TEST'
divergentReadiness.capabilityVariables.draftSubmission.privateWorker = 'WORKER_SUBMISSION_TEST'
assert.doesNotThrow(() => parseSchema4ReadinessModel(JSON.stringify(divergentReadiness), {
  runtimeGateRegistry: divergentSurfaceRegistry,
}))
const swappedSurfaceRegistry = structuredClone(divergentSurfaceRegistry)
const pagesSubmissionDescriptor = swappedSurfaceRegistry.capabilities.draftSubmission.pagesFunctions
swappedSurfaceRegistry.capabilities.draftSubmission.pagesFunctions = swappedSurfaceRegistry.capabilities.draftSubmission.privateWorker
swappedSurfaceRegistry.capabilities.draftSubmission.privateWorker = pagesSubmissionDescriptor
assert.throws(() => parseSchema4ReadinessModel(JSON.stringify(divergentReadiness), {
  runtimeGateRegistry: swappedSurfaceRegistry,
}), /mapping|runtime consumer/i)

const swappedIdentityRegistry = structuredClone(SCHEMA4_RUNTIME_GATE_REGISTRY)
const pagesClaimDescriptor = swappedIdentityRegistry.capabilities.identityClaim.pagesFunctions
swappedIdentityRegistry.capabilities.identityClaim.pagesFunctions = swappedIdentityRegistry.capabilities.identityRename.pagesFunctions
swappedIdentityRegistry.capabilities.identityRename.pagesFunctions = pagesClaimDescriptor
assert.throws(() => parseSchema4ReadinessModel(readinessSource, {
  runtimeGateRegistry: swappedIdentityRegistry,
}), /mapping|runtime consumer/i)

const crossMappedRegistry = structuredClone(SCHEMA4_RUNTIME_GATE_REGISTRY)
const pagesLeaderboardDescriptor = crossMappedRegistry.capabilities.leaderboardRead.pagesFunctions
crossMappedRegistry.capabilities.leaderboardRead.pagesFunctions = crossMappedRegistry.capabilities.cleanupCron.privateWorker
crossMappedRegistry.capabilities.cleanupCron.privateWorker = pagesLeaderboardDescriptor
assert.throws(() => parseSchema4ReadinessModel(readinessSource, {
  runtimeGateRegistry: crossMappedRegistry,
}), /mapping|runtime consumer/i)
const hypotheticalBuildEnvironment = {
  VITE_LEADERBOARD_READ_MODE: 'enabled',
  VITE_LEADERBOARD_IDENTITY_MODE: 'enabled',
  VITE_LEADERBOARD_IDENTITY_CLAIM_MODE: 'enabled',
  VITE_LEADERBOARD_IDENTITY_STATUS_MODE: 'enabled',
  VITE_LEADERBOARD_IDENTITY_RENAME_MODE: 'enabled',
  VITE_DRAFT_SUBMISSION_MODE: 'enabled',
  VITE_LEADERBOARD_RECOVERY_MODE: 'enabled',
}
for (const gates of Object.values(SCHEMA4_RUNTIME_GATE_REGISTRY.capabilities)) {
  assert.equal(runtimeGateFeatureState(hypotheticalBuildEnvironment, gates.frontendBuild), 'disabled')
}
const migration = (backendVersion, pending, status = 'valid') => ({
  status,
  backendVersion,
  pending,
})
const pending0004 = [{ ...migrations[3] }]

assert.doesNotThrow(() => assertSchema4MigrationTarget(
  migration(3, pending0004),
  migrations,
))
assert.doesNotThrow(() => assertSchema4MigrationTarget(
  migration(4, []),
  migrations,
))
for (const [label, observed, known = migrations] of [
  ['unknown schema', migration(null, [], 'ambiguous')],
  ['older schema', migration(2, pending0004)],
  ['newer schema', migration(5, [])],
  ['missing 0004', migration(3, []), migrations.slice(0, 3)],
  ['unexpected prefix', migration(3, pending0004), [
    ...migrations.slice(0, 2),
    { ...migrations[2], name: '0003_unreviewed.sql' },
    migrations[3],
  ]],
  ['more than 0004 pending', migration(3, [
    ...pending0004,
    { id: 5, name: '0005_unreviewed.sql', sha256: '0'.repeat(64) },
  ]), [
    ...migrations,
    { id: 5, name: '0005_unreviewed.sql', sha256: '0'.repeat(64) },
  ]],
]) {
  assert.throws(
    () => assertSchema4MigrationTarget(observed, known),
    /Schema-4 activation refused/,
    label,
  )
}

assert.doesNotThrow(() => assertSchema4StateModelSupportsActivation(repositoryRoot))
assert.throws(
  () => assertSchema4ProtectedConfigurationSupportsActivation(repositoryRoot),
  /disabled-only until Milestone 3D-2/,
)

const unresolved = loadReleaseManifest(repositoryRoot).manifest
assert.throws(
  () => assertSchema4ActivationPlan({
    repositoryRoot,
    targetState: 'submission-enabled',
    migration: migration(3, pending0004),
    manifest: unresolved,
  }),
  /disabled-only until Milestone 3D-2/,
)
assert.doesNotThrow(() => assertSchema4ActivationPlan({
  repositoryRoot,
  targetState: 'disabled',
  migration: migration(null, [], 'ambiguous'),
  manifest: unresolved,
}))

assert.throws(
  () => assertSchema4ActivationPlan({
    repositoryRoot,
    targetState: 'cron-enabled',
    migration: migration(3, pending0004),
    manifest: unresolved,
  }),
  /disabled-only until Milestone 3D-2/,
)

console.log('Schema-4 activation readiness tests passed: the exact protected model and variable mapping are versioned, all-disabled in both environments, and legacy release tooling cannot construct an enabled target.')
