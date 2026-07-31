import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertIndependentSchema4AuthorityModel,
  createDisabledSchema4Authority,
  evaluateSchema4ActivationAuthority,
  SCHEMA4_AUTHORITY_MAX_TTL_MS,
  SCHEMA4_CAPABILITIES,
} from './lib/schema4-activation-authority.mjs'

const NOW = Date.UTC(2026, 6, 31, 12)

function capabilities(mode = 'disabled') {
  return Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [capability, mode]))
}

function authority(overrides = {}) {
  return {
    schemaVersion: 1,
    environment: 'preview',
    reviewedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    emergencyStop: 'clear',
    identityCompatibilityMode: 'enabled',
    capabilities: capabilities(),
    ...overrides,
  }
}

const model = assertIndependentSchema4AuthorityModel(NOW)
assert.deepEqual(model.environments, ['preview', 'production'])
assert.deepEqual(model.capabilities, SCHEMA4_CAPABILITIES)

for (const environment of ['preview', 'production']) {
  const disabled = evaluateSchema4ActivationAuthority(
    createDisabledSchema4Authority(environment),
    { expectedEnvironment: environment, nowMs: NOW },
  )
  assert.equal(disabled.valid, true)
  assert.equal(disabled.reason, 'emergency_stop_engaged')
  assert.deepEqual(disabled.capabilities, capabilities())
}

const partial = authority({
  capabilities: {
    ...capabilities(),
    leaderboardRead: 'enabled',
    identityStatus: 'enabled',
    draftSubmission: 'enabled',
  },
})
const partialResult = evaluateSchema4ActivationAuthority(partial, {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(partialResult.valid, true)
assert.equal(partialResult.capabilities.leaderboardRead, 'enabled')
assert.equal(partialResult.capabilities.identityClaim, 'disabled')
assert.equal(partialResult.capabilities.identityStatus, 'enabled')
assert.equal(partialResult.capabilities.identityRename, 'disabled')
assert.equal(partialResult.capabilities.draftSubmission, 'enabled')
assert.equal(partialResult.capabilities.identityRecovery, 'disabled')
assert.equal(partialResult.capabilities.cleanupCron, 'disabled')

const broadOnly = evaluateSchema4ActivationAuthority(authority(), {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(broadOnly.valid, true)
assert.deepEqual(broadOnly.capabilities, capabilities())

const recoveryWithoutCompatibility = evaluateSchema4ActivationAuthority(authority({
  identityCompatibilityMode: 'disabled',
  capabilities: { ...capabilities(), identityRecovery: 'enabled' },
}), {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(recoveryWithoutCompatibility.valid, false)
assert.equal(recoveryWithoutCompatibility.reason, 'identity_compatibility_ceiling_disabled')
assert.deepEqual(recoveryWithoutCompatibility.capabilities, capabilities())

for (const [label, input, options, reason] of [
  ['missing', undefined, { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['partial object', { schemaVersion: 1 }, { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['unknown field', { ...authority(), unknown: true }, { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['unsupported version', authority({ schemaVersion: 2 }), { expectedEnvironment: 'preview', nowMs: NOW }, 'unsupported_schema_version'],
  ['unknown mode', authority({ capabilities: { ...capabilities(), identityClaim: 'yes' } }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['Preview to Production', authority(), { expectedEnvironment: 'production', nowMs: NOW }, 'environment_mismatch'],
  ['Production to Preview', authority({ environment: 'production' }), { expectedEnvironment: 'preview', nowMs: NOW }, 'environment_mismatch'],
  ['stale', authority({ expiresAtMs: NOW }), { expectedEnvironment: 'preview', nowMs: NOW }, 'stale_authority'],
  ['future review', authority({ reviewedAtMs: NOW + 1 }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_freshness_window'],
  ['oversized TTL', authority({ expiresAtMs: NOW - 1_000 + SCHEMA4_AUTHORITY_MAX_TTL_MS + 1 }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_freshness_window'],
  ['invalid expected environment', authority(), { expectedEnvironment: 'test', nowMs: NOW }, 'invalid_expected_environment'],
  ['invalid evaluation time', authority(), { expectedEnvironment: 'preview', nowMs: Number.NaN }, 'invalid_evaluation_time'],
]) {
  const evaluated = evaluateSchema4ActivationAuthority(input, options)
  assert.equal(evaluated.valid, false, label)
  assert.equal(evaluated.reason, reason, label)
  assert.deepEqual(evaluated.capabilities, capabilities(), label)
}

const contradictoryStop = evaluateSchema4ActivationAuthority({
  ...createDisabledSchema4Authority('preview'),
  capabilities: { ...capabilities(), cleanupCron: 'enabled' },
}, {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(contradictoryStop.valid, false)
assert.equal(contradictoryStop.reason, 'contradictory_emergency_state')
assert.deepEqual(contradictoryStop.capabilities, capabilities())

const authorityDocuments = [
  'README.md',
  'docs/BACKEND_OPERATIONS.md',
  'docs/D1C4_ACTIVATION.md',
  'docs/LEADERBOARD_BACKEND.md',
  'docs/MILESTONE_3C1_LOCAL_RUNTIME.md',
  'docs/MILESTONE_3C3_SCHEMA4_AUTHORITY.md',
]
for (const document of authorityDocuments) {
  const source = readFileSync(document, 'utf8')
  for (const capability of SCHEMA4_CAPABILITIES) {
    assert(
      source.includes(`\`${capability}\``),
      `${document} is missing canonical capability ${capability}`,
    )
  }
  assert.doesNotMatch(source, /\?capability=recovery\b/)
}
const healthSource = readFileSync('functions/api/v1/health.ts', 'utf8')
const privateWorkerSource = readFileSync('workers/draft-validation/src/index.ts', 'utf8')
assert.match(healthSource, /\?capability=\$\{capability\}/)
assert.match(healthSource, /'claim' \| 'recover' \| 'rename' \| 'status'/)
assert.match(privateWorkerSource, /\?\? 'status'/)
assert.match(privateWorkerSource, /requestedCapability === 'availability'/)
assert.match(
  readFileSync('docs/MILESTONE_3C1_LOCAL_RUNTIME.md', 'utf8'),
  /\?capability=recover/,
)

console.log('Schema-4 activation authority tests passed: all 256 environment/capability combinations remain independent, exact fail-closed parsing is enforced, stale and unsupported state is refused, and emergency rollback disables every capability.')
