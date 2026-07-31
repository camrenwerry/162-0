import assert from 'node:assert/strict'
import {
  DRAFT_SUBMISSION_RUNTIME_CONSUMER_REGISTRATIONS,
  isDraftSubmissionEnabled,
  isPrivateWorkerDraftSubmissionEnabled,
} from '../functions/lib/draft-submission-mode'
import {
  isLeaderboardIdentityCapability,
  isLeaderboardIdentityCapabilityEnabled,
  isPrivateWorkerLeaderboardIdentityCapabilityEnabled,
  LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS,
  LEADERBOARD_IDENTITY_CAPABILITIES,
  type LeaderboardIdentityCapability,
} from '../functions/lib/leaderboard-identity-mode'
import { handleLeaderboardIdentityRequest } from '../functions/lib/leaderboard-identity'
import { handleLeaderboardIdentityProxyRequest } from '../functions/lib/leaderboard-identity-proxy'
import { handleLeaderboardRequest } from '../functions/lib/leaderboard'
import {
  isLeaderboardReadEnabled,
  LEADERBOARD_READ_RUNTIME_CONSUMER_REGISTRATION,
} from '../functions/lib/leaderboard-mode'
import { handleSubmitDraftRequest } from '../functions/api/v1/submit-draft'
import validationWorker, {
  handlePrivateLeaderboardIdentityRequest,
  handlePrivateSubmissionRequest,
  type PrivateValidationWorkerEnv,
} from '../workers/draft-validation/src/index'
import { isSubmissionEnabled } from '../workers/draft-validation/src/authoritative-submission'
import {
  isRetentionCleanupEnabled,
  RETENTION_CLEANUP_RUNTIME_CONSUMER_REGISTRATION,
} from '../workers/draft-validation/src/retention-cleanup-mode'
import { FRONTEND_RUNTIME_CONSUMER_REGISTRATIONS } from '../src/features/leaderboard/runtimeConfig'
import {
  SCHEMA4_RUNTIME_GATE_REGISTRY,
  type Schema4Capability,
  type Schema4RuntimeGateRegistry,
  type Schema4RuntimeSurface,
} from '../shared/schema4-capabilities.mjs'
import { runtimeConsumerFeatureState } from '../shared/schema4-runtime-consumers.mjs'

const identityCapabilities = [
  'claim',
  'status',
  'rename',
  'recover',
] as const satisfies readonly LeaderboardIdentityCapability[]
assert.deepEqual(
  LEADERBOARD_IDENTITY_CAPABILITIES,
  ['availability', 'claim', 'recover', 'rename', 'status'],
)
const flagFor = Object.freeze({
  claim: 'LEADERBOARD_IDENTITY_CLAIM_MODE',
  status: 'LEADERBOARD_IDENTITY_STATUS_MODE',
  rename: 'LEADERBOARD_IDENTITY_RENAME_MODE',
  recover: 'LEADERBOARD_RECOVERY_MODE',
})

const broadOnly = { LEADERBOARD_IDENTITY_MODE: 'enabled' }
for (const capability of identityCapabilities) {
  assert.equal(isLeaderboardIdentityCapabilityEnabled(broadOnly, capability), false)
}
assert.equal(isLeaderboardIdentityCapabilityEnabled(broadOnly, 'availability'), false)

for (const enabledCapability of identityCapabilities) {
  const narrowOnly = { [flagFor[enabledCapability]]: 'enabled' }
  const ceilingDisabled = {
    LEADERBOARD_IDENTITY_MODE: 'disabled',
    [flagFor[enabledCapability]]: 'enabled',
  }
  assert.equal(isLeaderboardIdentityCapabilityEnabled(narrowOnly, enabledCapability), false)
  assert.equal(isLeaderboardIdentityCapabilityEnabled(ceilingDisabled, enabledCapability), false)
}

for (const enabledCapability of identityCapabilities) {
  const environment = {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    [flagFor[enabledCapability]]: 'enabled',
  }
  for (const capability of identityCapabilities) {
    assert.equal(
      isLeaderboardIdentityCapabilityEnabled(environment, capability),
      capability === enabledCapability,
      `${enabledCapability} must not activate ${capability}`,
    )
  }
  assert.equal(
    isLeaderboardIdentityCapabilityEnabled(environment, 'availability'),
    enabledCapability === 'claim' || enabledCapability === 'rename',
  )
}

for (const malformed of [undefined, null, true, false, 1, 'ENABLED', ' enabled', 'enabled ']) {
  assert.equal(isLeaderboardReadEnabled({ LEADERBOARD_READ_MODE: malformed }), false)
  assert.equal(isDraftSubmissionEnabled({ DRAFT_SUBMISSION_MODE: malformed }), false)
  assert.equal(isRetentionCleanupEnabled({ RETENTION_CLEANUP_MODE: malformed }), false)
  assert.equal(isLeaderboardIdentityCapabilityEnabled({
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    LEADERBOARD_IDENTITY_CLAIM_MODE: malformed,
  }, 'claim'), false)
}

for (const malformedCapability of [
  undefined,
  null,
  true,
  false,
  1,
  {},
  [],
  '',
  ' ',
  'Claim',
  'claims',
  'recovery',
  'future-capability',
]) {
  assert.equal(isLeaderboardIdentityCapability(malformedCapability), false)
  assert.equal(isLeaderboardIdentityCapabilityEnabled({
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    LEADERBOARD_IDENTITY_CLAIM_MODE: 'enabled',
    LEADERBOARD_IDENTITY_STATUS_MODE: 'enabled',
    LEADERBOARD_IDENTITY_RENAME_MODE: 'enabled',
    LEADERBOARD_RECOVERY_MODE: 'enabled',
  }, malformedCapability), false)
}
for (const capability of LEADERBOARD_IDENTITY_CAPABILITIES) {
  assert.equal(isLeaderboardIdentityCapability(capability), true)
}

assert.equal(isLeaderboardReadEnabled({ LEADERBOARD_READ_MODE: 'enabled' }), true)
assert.equal(isDraftSubmissionEnabled({ DRAFT_SUBMISSION_MODE: 'enabled' }), true)
assert.equal(isRetentionCleanupEnabled({ RETENTION_CLEANUP_MODE: 'enabled' }), true)
assert.equal(isDraftSubmissionEnabled({
  DRAFT_SUBMISSION_MODE: 'enabled',
  LEADERBOARD_IDENTITY_MODE: 'disabled',
  LEADERBOARD_RECOVERY_MODE: 'disabled',
}), true)
assert.equal(isLeaderboardIdentityCapabilityEnabled({
  LEADERBOARD_IDENTITY_MODE: 'enabled',
  LEADERBOARD_RECOVERY_MODE: 'enabled',
  DRAFT_SUBMISSION_MODE: 'disabled',
}, 'recover'), true)

const divergentRegistry = structuredClone(SCHEMA4_RUNTIME_GATE_REGISTRY)
function setGateVariable(
  capability: Schema4Capability,
  surface: Schema4RuntimeSurface,
  variable: string,
  compatibilityCeiling: string | null = null,
) {
  const descriptor = divergentRegistry.capabilities[capability][surface]
  assert.notEqual(descriptor, null, `${capability}.${surface} must have a descriptor`)
  Reflect.set(descriptor as object, 'variable', variable)
  Reflect.set(descriptor as object, 'compatibilityCeiling', compatibilityCeiling)
}
setGateVariable('leaderboardRead', 'pagesFunctions', 'PAGES_LEADERBOARD_READ_TEST')
setGateVariable('draftSubmission', 'pagesFunctions', 'PAGES_SUBMISSION_TEST')
setGateVariable('draftSubmission', 'privateWorker', 'WORKER_SUBMISSION_TEST')
setGateVariable('cleanupCron', 'privateWorker', 'WORKER_CLEANUP_TEST')
const identityTestVariables = Object.freeze({
  claim: Object.freeze({ capability: 'identityClaim', pages: 'PAGES_CLAIM_TEST', worker: 'WORKER_CLAIM_TEST' }),
  status: Object.freeze({ capability: 'identityStatus', pages: 'PAGES_STATUS_TEST', worker: 'WORKER_STATUS_TEST' }),
  rename: Object.freeze({ capability: 'identityRename', pages: 'PAGES_RENAME_TEST', worker: 'WORKER_RENAME_TEST' }),
  recover: Object.freeze({ capability: 'identityRecovery', pages: 'PAGES_RECOVERY_TEST', worker: 'WORKER_RECOVERY_TEST' }),
} as const)
for (const mapping of Object.values(identityTestVariables)) {
  setGateVariable(mapping.capability, 'pagesFunctions', mapping.pages, 'LEADERBOARD_IDENTITY_MODE')
  setGateVariable(mapping.capability, 'privateWorker', mapping.worker, 'LEADERBOARD_IDENTITY_MODE')
}
const injectedRegistry = divergentRegistry as Schema4RuntimeGateRegistry
for (const registration of [
  ...Object.values(FRONTEND_RUNTIME_CONSUMER_REGISTRATIONS),
  ...Object.values(DRAFT_SUBMISSION_RUNTIME_CONSUMER_REGISTRATIONS),
  ...Object.values(LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS.pagesFunctions),
  ...Object.values(LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS.privateWorker),
  LEADERBOARD_READ_RUNTIME_CONSUMER_REGISTRATION,
  RETENTION_CLEANUP_RUNTIME_CONSUMER_REGISTRATION,
]) assert.equal(Object.isFrozen(registration), true)
for (const registrations of [
  FRONTEND_RUNTIME_CONSUMER_REGISTRATIONS,
  DRAFT_SUBMISSION_RUNTIME_CONSUMER_REGISTRATIONS,
  LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS,
  LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS.pagesFunctions,
  LEADERBOARD_IDENTITY_RUNTIME_CONSUMER_REGISTRATIONS.privateWorker,
]) assert.equal(Object.isFrozen(registrations), true)

const pagesSubmissionOnly = { PAGES_SUBMISSION_TEST: 'enabled' }
const workerSubmissionOnly = { WORKER_SUBMISSION_TEST: 'enabled' }
assert.equal(isDraftSubmissionEnabled(pagesSubmissionOnly, injectedRegistry), true)
assert.equal(isPrivateWorkerDraftSubmissionEnabled(pagesSubmissionOnly, injectedRegistry), false)
assert.equal(isDraftSubmissionEnabled(workerSubmissionOnly, injectedRegistry), false)
assert.equal(isPrivateWorkerDraftSubmissionEnabled(workerSubmissionOnly, injectedRegistry), true)
assert.equal(isSubmissionEnabled(pagesSubmissionOnly, injectedRegistry), false)
assert.equal(isSubmissionEnabled(workerSubmissionOnly, injectedRegistry), true)

for (const [enabledAction, enabledMapping] of Object.entries(identityTestVariables)) {
  const pagesEnvironment = {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    [enabledMapping.pages]: 'enabled',
  }
  const workerEnvironment = {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    [enabledMapping.worker]: 'enabled',
  }
  for (const action of identityCapabilities) {
    assert.equal(
      isLeaderboardIdentityCapabilityEnabled(pagesEnvironment, action, injectedRegistry),
      action === enabledAction,
      `Pages ${enabledAction} descriptor must not activate ${action}`,
    )
    assert.equal(
      isPrivateWorkerLeaderboardIdentityCapabilityEnabled(workerEnvironment, action, injectedRegistry),
      action === enabledAction,
      `Worker ${enabledAction} descriptor must not activate ${action}`,
    )
  }
  assert.equal(
    isPrivateWorkerLeaderboardIdentityCapabilityEnabled(pagesEnvironment, enabledAction, injectedRegistry),
    false,
  )
  assert.equal(
    isLeaderboardIdentityCapabilityEnabled(workerEnvironment, enabledAction, injectedRegistry),
    false,
  )
}
assert.equal(
  isLeaderboardReadEnabled({ PAGES_LEADERBOARD_READ_TEST: 'enabled' }, injectedRegistry),
  true,
)
assert.equal(
  isRetentionCleanupEnabled({ WORKER_CLEANUP_TEST: 'enabled' }, injectedRegistry),
  true,
)
assert.equal(
  isRetentionCleanupEnabled({ PAGES_LEADERBOARD_READ_TEST: 'enabled' }, injectedRegistry),
  false,
)
assert.equal(
  isLeaderboardReadEnabled({ WORKER_CLEANUP_TEST: 'enabled' }, injectedRegistry),
  false,
)
for (const capability of Object.keys(divergentRegistry.capabilities) as Schema4Capability[]) {
  assert.equal(
    runtimeConsumerFeatureState(
      { EVERYTHING: 'enabled' },
      FRONTEND_RUNTIME_CONSUMER_REGISTRATIONS[capability],
      injectedRegistry,
    ),
    'disabled',
  )
}

const identityRequest = () => new Request('https://example.test/api/v1/leaderboard-identity', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
const submissionRequest = () => new Request('https://example.test/api/v1/submit-draft', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
const unusedRateLimit = {
  async limit() {
    throw new Error('Gate-selection probes must stop before rate-limit bindings.')
  },
}
function privateWorkerEnvironment(values: Readonly<Record<string, unknown>>): PrivateValidationWorkerEnv {
  return {
    ...values,
    RATE_LIMIT_BURST: unusedRateLimit,
    RATE_LIMIT_SUSTAINED: unusedRateLimit,
  } as PrivateValidationWorkerEnv
}

type PagesSubmissionDispatch = typeof handleSubmitDraftRequest
type WorkerSubmissionDispatch = typeof handlePrivateSubmissionRequest
async function assertExportedSubmissionDispatchBehavior(
  pagesDispatch: PagesSubmissionDispatch = handleSubmitDraftRequest,
  workerDispatch: WorkerSubmissionDispatch = handlePrivateSubmissionRequest,
) {
  assert.notEqual((await pagesDispatch(
    submissionRequest(),
    pagesSubmissionOnly,
    injectedRegistry,
  )).status, 404)
  assert.equal((await pagesDispatch(
    submissionRequest(),
    workerSubmissionOnly,
    injectedRegistry,
  )).status, 404)
  assert.notEqual((await workerDispatch(
    submissionRequest(),
    privateWorkerEnvironment(workerSubmissionOnly),
    injectedRegistry,
  )).status, 404)
  assert.equal((await workerDispatch(
    submissionRequest(),
    privateWorkerEnvironment(pagesSubmissionOnly),
    injectedRegistry,
  )).status, 404)
}
await assertExportedSubmissionDispatchBehavior()
await assert.rejects(
  () => assertExportedSubmissionDispatchBehavior(
    async () => new Response(null, { status: 204 }),
    handlePrivateSubmissionRequest,
  ),
  /Expected values to be strictly equal/,
)
await assert.rejects(
  () => assertExportedSubmissionDispatchBehavior(
    handleSubmitDraftRequest,
    ((request, env, registry) => handleSubmitDraftRequest(request, env, registry)) as WorkerSubmissionDispatch,
  ),
  /Expected "actual" to be strictly unequal to: 404/,
)

for (const [action, mapping] of Object.entries(identityTestVariables)) {
  const pagesEnvironment = {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    [mapping.pages]: 'enabled',
  }
  const workerEnvironment = {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    [mapping.worker]: 'enabled',
  }
  assert.notEqual((await handleLeaderboardIdentityProxyRequest(
    identityRequest(),
    pagesEnvironment,
    `/api/v1/leaderboard-identity-${action}`,
    action,
    injectedRegistry,
  )).status, 404)
  assert.equal((await handleLeaderboardIdentityProxyRequest(
    identityRequest(),
    workerEnvironment,
    `/api/v1/leaderboard-identity-${action}`,
    action,
    injectedRegistry,
  )).status, 404)
  assert.notEqual((await handleLeaderboardIdentityRequest(
    identityRequest(),
    pagesEnvironment,
    action,
    () => Date.UTC(2026, 6, 31, 12),
    injectedRegistry,
  )).status, 404)
  assert.equal((await handleLeaderboardIdentityRequest(
    identityRequest(),
    workerEnvironment,
    action,
    () => Date.UTC(2026, 6, 31, 12),
    injectedRegistry,
  )).status, 404)
  assert.notEqual((await handlePrivateLeaderboardIdentityRequest(
    identityRequest(),
    privateWorkerEnvironment(workerEnvironment),
    action,
    injectedRegistry,
  )).status, 404)
  assert.equal((await handlePrivateLeaderboardIdentityRequest(
    identityRequest(),
    privateWorkerEnvironment(pagesEnvironment),
    action,
    injectedRegistry,
  )).status, 404)
}

assert.notEqual((await handleLeaderboardRequest(
  new Request('https://example.test/api/v1/leaderboards'),
  { PAGES_LEADERBOARD_READ_TEST: 'enabled' },
  () => Date.UTC(2026, 6, 31, 12),
  injectedRegistry,
)).status, 404)
assert.equal((await handleLeaderboardRequest(
  new Request('https://example.test/api/v1/leaderboards'),
  { WORKER_CLEANUP_TEST: 'enabled' },
  () => Date.UTC(2026, 6, 31, 12),
  injectedRegistry,
)).status, 404)

let serviceCalls = 0
const unavailable = await handleLeaderboardIdentityProxyRequest(
  new Request('https://example.test/api/v1/leaderboard-identity-claim', { method: 'POST' }),
  {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    LEADERBOARD_IDENTITY_CLAIM_MODE: 'disabled',
    VALIDATION_SERVICE: {
      async fetch() {
        serviceCalls += 1
        return new Response(null, { status: 204 })
      },
    },
  },
  '/api/v1/leaderboard-identity-claim',
  'claim',
)
assert.equal(unavailable.status, 404)
assert.equal(serviceCalls, 0)

const unknownProxy = await handleLeaderboardIdentityProxyRequest(
  new Request('https://example.test/api/v1/leaderboard-identity-claim', { method: 'POST' }),
  {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    LEADERBOARD_IDENTITY_CLAIM_MODE: 'enabled',
    VALIDATION_SERVICE: {
      async fetch() {
        serviceCalls += 1
        return new Response(null, { status: 204 })
      },
    },
  },
  '/api/v1/leaderboard-identity-claim',
  'future-capability',
)
assert.equal(unknownProxy.status, 404)
assert.equal(serviceCalls, 0)

let databaseInspections = 0
const unknownAction = await handleLeaderboardIdentityRequest(
  new Request('https://example.test/api/v1/leaderboard-identity-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }),
  {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    LEADERBOARD_IDENTITY_STATUS_MODE: 'enabled',
    LEADERBOARD_IDENTITY_SIGNING_KEY: 'x'.repeat(32),
    DB: new Proxy({}, {
      get() {
        databaseInspections += 1
        throw new Error('Unknown actions must refuse before D1 inspection.')
      },
    }),
  },
  'future-capability',
)
assert.equal(unknownAction.status, 404)
assert.equal(databaseInspections, 0)

const forbiddenDatabase = new Proxy({}, {
  get() {
    throw new Error('Disabled cleanup authority must not inspect D1.')
  },
}) as D1Database
await validationWorker.scheduled(
  {} as ScheduledController,
  {
    RETENTION_CLEANUP_MODE: 'disabled',
    DB: forbiddenDatabase,
  } as Parameters<typeof validationWorker.scheduled>[1],
)

console.log('Schema-4 runtime authority tests passed: read, claim, status, rename, submission, recovery, and cleanup gates are exact, independent, fail closed, and disabled paths do not inspect private services or D1.')
