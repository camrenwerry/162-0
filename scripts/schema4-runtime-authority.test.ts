import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDraftSubmissionEnabled } from '../functions/lib/draft-submission-mode'
import {
  isLeaderboardIdentityCapability,
  isLeaderboardIdentityCapabilityEnabled,
  LEADERBOARD_IDENTITY_CAPABILITIES,
  type LeaderboardIdentityCapability,
} from '../functions/lib/leaderboard-identity-mode'
import { handleLeaderboardIdentityRequest } from '../functions/lib/leaderboard-identity'
import { handleLeaderboardIdentityProxyRequest } from '../functions/lib/leaderboard-identity-proxy'
import { isLeaderboardReadEnabled } from '../functions/lib/leaderboard-mode'
import validationWorker from '../workers/draft-validation/src/index'
import { isRetentionCleanupEnabled } from '../workers/draft-validation/src/retention-cleanup-mode'

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

const modeSource = readFileSync('functions/lib/leaderboard-identity-mode.ts', 'utf8')
const dispatcherSource = readFileSync('functions/lib/leaderboard-identity.ts', 'utf8')
assert.match(modeSource, /switch \(capability\)/)
for (const capability of LEADERBOARD_IDENTITY_CAPABILITIES) {
  assert.match(modeSource, new RegExp(`case '${capability}':`))
}
assert.match(modeSource, /default:\s*\n\s*return assertNeverCapability\(capability\)/)
assert.match(dispatcherSource, /switch \(action\)/)
assert.match(dispatcherSource, /case 'status':/)
assert.match(dispatcherSource, /default:\s*\n\s*return assertNeverIdentityAction\(action\)/)
assert.doesNotMatch(dispatcherSource, /if \(action === 'rename'\)[\s\S]*return await identityStatus/)

console.log('Schema-4 runtime authority tests passed: read, claim, status, rename, submission, recovery, and cleanup gates are exact, independent, fail closed, and disabled paths do not inspect private services or D1.')
