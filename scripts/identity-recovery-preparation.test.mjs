import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as recoveryPreparation from './lib/identity-recovery-preparation.mjs'
import {
  IDENTITY_RECOVERY_AUTHORITY_MAX_FILE_BYTES,
  IDENTITY_RECOVERY_MAX_RECORDS,
  IDENTITY_RECOVERY_PLAN_TTL_MS,
  IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES,
  IdentityRecoveryPreparationError,
  prepareIdentityRecoveryPreview,
  verifyIdentityRecoveryPlan,
} from './lib/identity-recovery-preparation.mjs'
import { canonicalHash } from './lib/preview-release/canonical.mjs'
import { SCHEMA4_CAPABILITIES } from './lib/schema4-activation-authority.mjs'

const NOW = Date.UTC(2026, 6, 31, 13)
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const PLAYER_BINDING_DOMAIN = 'pennant-pursuit.identity-recovery.player-binding.v1'
const PLAN_COMMITMENT_DOMAIN = 'pennant-pursuit.identity-recovery.plan.v2'
const REPOSITORY_ROOT = path.resolve(new URL('../', import.meta.url).pathname)
const CLI_PATH = path.join(REPOSITORY_ROOT, 'scripts/prepare-identity-recovery.mjs')

function capabilities(overrides = {}) {
  return {
    ...Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [capability, 'disabled'])),
    identityRecovery: 'enabled',
    ...overrides,
  }
}

function authority(overrides = {}) {
  return {
    schemaVersion: 1,
    environment: 'preview',
    reviewedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 10 * 60_000,
    emergencyStop: 'clear',
    identityCompatibilityMode: 'enabled',
    capabilities: capabilities(),
    ...overrides,
  }
}

function record(overrides = {}) {
  return {
    playerId: 42,
    identityState: 'active',
    publicStatus: 'active',
    recoveryVersion: 3,
    identityUpdatedAtMs: NOW - 5_000,
    identityContinuityHash: HASH_A,
    credentialStateHash: HASH_B,
    ...overrides,
  }
}

function snapshot(records = [record()], overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'reviewed-local-snapshot',
    environment: 'preview',
    observedAtMs: NOW - 2_000,
    expiresAtMs: NOW + 10 * 60_000,
    records,
    ...overrides,
  }
}

function freshSnapshot(records = [record()], overrides = {}) {
  return snapshot(records, {
    observedAtMs: NOW + 1,
    expiresAtMs: NOW + 10 * 60_000,
    ...overrides,
  })
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => (
    error instanceof IdentityRecoveryPreparationError && error.code === code
  ))
}

function planBody(plan) {
  const { planHash, ...body } = plan
  return body
}

function expectedPlayerBinding(planRef, playerId) {
  return canonicalHash({
    domain: PLAYER_BINDING_DOMAIN,
    environment: 'preview',
    planRef,
    playerId,
  })
}

function recoveryPlanCommitment(body) {
  return canonicalHash({
    domain: PLAN_COMMITMENT_DOMAIN,
    plan: body,
  })
}

function containsRawPlayerId(value, playerId) {
  if (value === playerId) return true
  if (Array.isArray(value)) return value.some((entry) => containsRawPlayerId(entry, playerId))
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => containsRawPlayerId(entry, playerId))
  }
  return false
}

const expectedExports = [
  'IDENTITY_RECOVERY_AUTHORITY_MAX_FILE_BYTES',
  'IDENTITY_RECOVERY_MAX_RECORDS',
  'IDENTITY_RECOVERY_MAX_SNAPSHOT_AGE_MS',
  'IDENTITY_RECOVERY_PLAN_SCHEMA_VERSION',
  'IDENTITY_RECOVERY_PLAN_TTL_MS',
  'IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES',
  'IDENTITY_RECOVERY_SNAPSHOT_SCHEMA_VERSION',
  'IdentityRecoveryPreparationError',
  'prepareIdentityRecoveryPreview',
  'verifyIdentityRecoveryPlan',
].sort()
assert.deepEqual(Object.keys(recoveryPreparation).sort(), expectedExports)
assert.equal(Object.keys(recoveryPreparation).some((name) => /adapter|execute|confirm|consume/i.test(name)), false)

let networkContacts = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  networkContacts += 1
  throw new Error('Identity recovery preparation tests must not contact a network.')
}

const preview = prepareIdentityRecoveryPreview({
  authority: authority(),
  snapshot: snapshot(),
  targetPlayerId: 42,
  nowMs: NOW,
})
const sameTargetSecondPlan = prepareIdentityRecoveryPreview({
  authority: authority(),
  snapshot: snapshot(),
  targetPlayerId: 42,
  nowMs: NOW,
})
assert.equal(preview.status, 'preview-only')
assert.match(preview.evidence.planRef, /^pprp1_[A-Za-z0-9_-]{43}$/)
assert.match(preview.evidence.planHash, /^[0-9a-f]{64}$/)
assert.match(preview.evidence.authorityDigest, /^[0-9a-f]{64}$/)
assert.equal(preview.plan.schemaVersion, 2)
assert.equal(preview.plan.authorityDigest, canonicalHash(authority()))
assert.equal(preview.plan.playerBinding, expectedPlayerBinding(preview.plan.planRef, 42))
assert.equal(preview.plan.planHash, recoveryPlanCommitment(planBody(preview.plan)))
assert.equal(
  recoveryPlanCommitment(planBody(JSON.parse(JSON.stringify(preview.plan)))),
  preview.plan.planHash,
)
assert.equal(
  recoveryPlanCommitment({
    expiresAtMs: preview.plan.expiresAtMs,
    previewedAtMs: preview.plan.previewedAtMs,
    snapshotObservedAtMs: preview.plan.snapshotObservedAtMs,
    targetStateCommitment: preview.plan.targetStateCommitment,
    playerBinding: preview.plan.playerBinding,
    authorityDigest: preview.plan.authorityDigest,
    planRef: preview.plan.planRef,
    environment: preview.plan.environment,
    action: preview.plan.action,
    schemaVersion: preview.plan.schemaVersion,
  }),
  preview.plan.planHash,
)
assert.equal(
  expectedPlayerBinding(preview.plan.planRef, 42),
  expectedPlayerBinding(preview.plan.planRef, 42),
)
assert.notEqual(
  expectedPlayerBinding(preview.plan.planRef, 42),
  expectedPlayerBinding(preview.plan.planRef, 43),
)
assert.notEqual(sameTargetSecondPlan.plan.planRef, preview.plan.planRef)
assert.notEqual(sameTargetSecondPlan.plan.playerBinding, preview.plan.playerBinding)
assert.notEqual(sameTargetSecondPlan.plan.targetStateCommitment, preview.plan.targetStateCommitment)
assert.notEqual(sameTargetSecondPlan.plan.planHash, preview.plan.planHash)

const serializedPreview = JSON.stringify(preview)
assert.equal(containsRawPlayerId(preview, 42), false)
for (const prohibited of [
  '"playerId"',
  '"targetPlayerId"',
  '"identityContinuityHash"',
  '"credentialStateHash"',
  '"expectedRecoveryVersion"',
  '"expectedIdentityUpdatedAtMs"',
  HASH_A,
  HASH_B,
  'deviceCredential',
  'displayName',
  'playerName',
  'recoveryCode',
  'token',
]) assert.equal(serializedPreview.includes(prohibited), false, prohibited)
const recoveryDocumentation = readFileSync(
  path.join(REPOSITORY_ROOT, 'docs/MILESTONE_3C3_SCHEMA4_AUTHORITY.md'),
  'utf8',
)
assert.equal((recoveryDocumentation.match(/--player-id 42/g) ?? []).length, 1)
assert.equal(recoveryDocumentation.replace('--player-id 42', '').includes('42'), false)

const legacyLowIdReferences = new Set(Array.from({ length: 10_000 }, (_, index) => canonicalHash({
  environment: 'preview',
  playerId: index + 1,
  purpose: 'identity-credential-rotation',
})))
assert.equal(legacyLowIdReferences.has(preview.plan.planRef), false)

const verified = verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
})
assert.deepEqual(verified, {
  status: 'verified-read-only',
  environment: 'preview',
  action: 'identity-credential-rotation',
  planRef: preview.plan.planRef,
  authorityDigest: preview.plan.authorityDigest,
  planHash: preview.plan.planHash,
  expiresAtMs: preview.plan.expiresAtMs,
  consumption: 'not-performed',
})

// Read-only checks are intentionally repeatable. They make no replay claim and
// there is no shipped side-effect boundary for a copied plan to cross.
assert.deepEqual(verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), verified)

// Exact adversarial reproduction: the substituted player has every admissible
// state field copied byte-for-byte from player 42.
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 43,
  freshSnapshot: freshSnapshot([record({ playerId: 43 })]),
  nowMs: NOW + 1,
}), 'target_mismatch')
const concurrentVerifications = await Promise.all(Array.from({ length: 8 }, async () => (
  verifyIdentityRecoveryPlan({
    authority: authority(),
    plan: JSON.parse(JSON.stringify(preview.plan)),
    targetPlayerId: 42,
    freshSnapshot: freshSnapshot(),
    nowMs: NOW + 1,
  })
)))
assert(concurrentVerifications.every((result) => result.planHash === preview.plan.planHash))

const crossProcessBundle = Buffer.from(JSON.stringify({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
})).toString('base64')
const moduleUrl = pathToFileURL(path.join(
  REPOSITORY_ROOT,
  'scripts/lib/identity-recovery-preparation.mjs',
)).href
const copiedProcess = spawnSync(process.execPath, [
  '--input-type=module',
  '--eval',
  `import { verifyIdentityRecoveryPlan } from ${JSON.stringify(moduleUrl)};
const input = JSON.parse(Buffer.from(process.env.PP_RECOVERY_TEST_BUNDLE, 'base64').toString('utf8'));
process.stdout.write(JSON.stringify(verifyIdentityRecoveryPlan(input)));`,
], {
  cwd: REPOSITORY_ROOT,
  encoding: 'utf8',
  env: { ...process.env, PP_RECOVERY_TEST_BUNDLE: crossProcessBundle },
  timeout: 5_000,
})
assert.equal(copiedProcess.status, 0, copiedProcess.stderr)
assert.equal(JSON.parse(copiedProcess.stdout).status, 'verified-read-only')

const reorderedAuthority = {
  capabilities: capabilities(),
  identityCompatibilityMode: 'enabled',
  emergencyStop: 'clear',
  expiresAtMs: NOW + 10 * 60_000,
  reviewedAtMs: NOW - 1_000,
  environment: 'preview',
  schemaVersion: 1,
}
assert.equal(canonicalHash(reorderedAuthority), preview.plan.authorityDigest)
assert.equal(verifyIdentityRecoveryPlan({
  authority: reorderedAuthority,
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}).status, 'verified-read-only')

for (const changedAuthority of [
  authority({ reviewedAtMs: NOW - 2_000 }),
  authority({ expiresAtMs: NOW + 11 * 60_000 }),
  authority({ capabilities: capabilities({ identityClaim: 'enabled' }) }),
]) {
  expectCode(() => verifyIdentityRecoveryPlan({
    authority: changedAuthority,
    plan: preview.plan,
    targetPlayerId: 42,
    freshSnapshot: freshSnapshot(),
    nowMs: NOW + 1,
  }), 'authority_changed')
}
expectCode(() => verifyIdentityRecoveryPlan({
  authority: {
    schemaVersion: 1,
    environment: 'preview',
    reviewedAtMs: null,
    expiresAtMs: null,
    emergencyStop: 'engaged',
    identityCompatibilityMode: 'disabled',
    capabilities: Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [capability, 'disabled'])),
  },
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'recovery_disabled')
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority({ environment: 'production' }),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'authority_refused')

assert.equal(verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot([], {
    records: [record()],
    expiresAtMs: preview.plan.expiresAtMs + 1,
  }),
  nowMs: preview.plan.expiresAtMs - 1,
}).status, 'verified-read-only')
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot([], {
    records: [record()],
    expiresAtMs: preview.plan.expiresAtMs + 1,
  }),
  nowMs: preview.plan.expiresAtMs,
}), 'stale_plan')

for (const changedRecord of [
  record({ credentialStateHash: HASH_C }),
  record({ recoveryVersion: 4 }),
  record({ identityContinuityHash: HASH_D }),
  record({ identityUpdatedAtMs: NOW - 4_999 }),
  record({ publicStatus: 'moderated' }),
]) {
  expectCode(() => verifyIdentityRecoveryPlan({
    authority: authority(),
    plan: preview.plan,
    targetPlayerId: 42,
    freshSnapshot: freshSnapshot([changedRecord]),
    nowMs: NOW + 1,
  }), changedRecord.publicStatus === 'moderated' ? 'target_ineligible' : 'stale_target_state')
}
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 43,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'target_not_found')
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: preview.plan,
  targetPlayerId: 42,
  freshSnapshot: snapshot(),
  nowMs: NOW + 1,
}), 'stale_target_state')

const tampered = { ...preview.plan, expiresAtMs: preview.plan.expiresAtMs + 1 }
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: tampered,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'malformed_plan')
const missingPlayerBinding = { ...preview.plan }
delete missingPlayerBinding.playerBinding
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: missingPlayerBinding,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'malformed_plan')
const malformedBindingBody = {
  ...planBody(preview.plan),
  playerBinding: 'not-a-sha256-binding',
}
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: {
    ...malformedBindingBody,
    planHash: recoveryPlanCommitment(malformedBindingBody),
  },
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'malformed_plan')
const legacyUnboundBody = {
  schemaVersion: 1,
  action: preview.plan.action,
  environment: preview.plan.environment,
  planRef: preview.plan.planRef,
  authorityDigest: preview.plan.authorityDigest,
  targetStateCommitment: canonicalHash({
    environment: 'preview',
    purpose: 'identity-recovery-target-state-v1',
    planRef: preview.plan.planRef,
    identityState: record().identityState,
    publicStatus: record().publicStatus,
    recoveryVersion: record().recoveryVersion,
    identityUpdatedAtMs: record().identityUpdatedAtMs,
    identityContinuityHash: record().identityContinuityHash,
    credentialStateHash: record().credentialStateHash,
  }),
  snapshotObservedAtMs: preview.plan.snapshotObservedAtMs,
  previewedAtMs: preview.plan.previewedAtMs,
  expiresAtMs: preview.plan.expiresAtMs,
}
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: { ...legacyUnboundBody, planHash: canonicalHash(legacyUnboundBody) },
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'malformed_plan')
const copiedBindingBody = {
  ...planBody(preview.plan),
  playerBinding: sameTargetSecondPlan.plan.playerBinding,
}
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: {
    ...copiedBindingBody,
    planHash: recoveryPlanCommitment(copiedBindingBody),
  },
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'target_mismatch')
const futurePlanBody = {
  ...planBody(preview.plan),
  previewedAtMs: NOW + 2,
}
const futurePlan = {
  ...futurePlanBody,
  planHash: recoveryPlanCommitment(futurePlanBody),
}
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: futurePlan,
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
}), 'malformed_plan')
expectCode(() => prepareIdentityRecoveryPreview({
  authority: authority(),
  snapshot: snapshot([record({ identityUpdatedAtMs: NOW - 1_999 })]),
  targetPlayerId: 42,
  nowMs: NOW,
}), 'malformed_snapshot')
assert.equal(prepareIdentityRecoveryPreview({
  authority: authority(),
  snapshot: snapshot([record({ identityUpdatedAtMs: NOW - 2_000 })]),
  targetPlayerId: 42,
  nowMs: NOW,
}).status, 'preview-only')
for (const malformedTarget of ['42', ' 42', '42 ', 42n]) {
  expectCode(() => prepareIdentityRecoveryPreview({
    authority: authority(),
    snapshot: snapshot(),
    targetPlayerId: malformedTarget,
    nowMs: NOW,
  }), 'malformed_target')
}

let injectedCallbacks = 0
const callback = () => { injectedCallbacks += 1 }
expectCode(() => verifyIdentityRecoveryPlan({
  authority: authority(),
  plan: { ...preview.plan, adapter: callback },
  targetPlayerId: 42,
  freshSnapshot: freshSnapshot(),
  nowMs: NOW + 1,
  execute: callback,
  confirmation: callback,
}), 'malformed_plan')
const getterAuthority = authority()
Object.defineProperty(getterAuthority, 'execute', {
  enumerable: true,
  get: callback,
})
expectCode(() => prepareIdentityRecoveryPreview({
  authority: getterAuthority,
  snapshot: snapshot(),
  targetPlayerId: 42,
  nowMs: NOW,
}), 'authority_refused')
const getterSnapshot = snapshot()
Object.defineProperty(getterSnapshot, 'records', {
  enumerable: true,
  get: callback,
})
expectCode(() => prepareIdentityRecoveryPreview({
  authority: authority(),
  snapshot: getterSnapshot,
  targetPlayerId: 42,
  nowMs: NOW,
}), 'malformed_snapshot')
expectCode(() => prepareIdentityRecoveryPreview({
  authority: authority(),
  snapshot: {
    ...snapshot(),
    records: [{ ...record(), sqlClient: callback }],
  },
  targetPlayerId: 42,
  nowMs: NOW,
}), 'malformed_snapshot')
assert.equal(injectedCallbacks, 0)

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'pennant-recovery-test-'))
try {
  function currentFixtures(recordCount = 1) {
    const now = Date.now()
    const currentAuthority = {
      ...authority(),
      reviewedAtMs: now - 1_000,
      expiresAtMs: now + 10 * 60_000,
    }
    const records = Array.from({ length: recordCount }, (_, index) => record({
      playerId: index + 1,
      identityUpdatedAtMs: now - 1_000,
    }))
    const currentSnapshot = {
      ...snapshot(records),
      observedAtMs: now - 500,
      expiresAtMs: now + 10 * 60_000,
    }
    return { currentAuthority, currentSnapshot }
  }

  function writeFixtures(prefix, fixtures = currentFixtures()) {
    const authorityFile = path.join(fixtureRoot, `${prefix}-authority.json`)
    const snapshotFile = path.join(fixtureRoot, `${prefix}-snapshot.json`)
    writeFileSync(authorityFile, JSON.stringify(fixtures.currentAuthority))
    writeFileSync(snapshotFile, JSON.stringify(fixtures.currentSnapshot))
    return { authorityFile, snapshotFile, ...fixtures }
  }

  function runCli(authorityFile, snapshotFile, extra = []) {
    return spawnSync(process.execPath, [
      CLI_PATH,
      '--authority-file', authorityFile,
      '--snapshot-file', snapshotFile,
      '--player-id', '42',
      ...extra,
    ], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      timeout: 3_000,
    })
  }

  const ordinary = writeFixtures('ordinary', currentFixtures(42))
  const ordinaryResult = runCli(ordinary.authorityFile, ordinary.snapshotFile)
  assert.equal(ordinaryResult.status, 0, ordinaryResult.stderr)
  assert.equal(JSON.parse(ordinaryResult.stdout).status, 'preview-only')

  const executionRefusal = spawnSync(process.execPath, [
    CLI_PATH,
    '--execute',
    '--authority-file', path.join(fixtureRoot, 'does-not-exist'),
    '--snapshot-file', path.join(fixtureRoot, 'also-does-not-exist'),
    '--player-id', '42',
    '--plan-file', path.join(fixtureRoot, 'plan'),
    '--confirm', 'prohibited',
  ], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    timeout: 3_000,
  })
  assert.equal(executionRefusal.status, 1)
  assert.equal(JSON.parse(executionRefusal.stderr).error.code, 'remote_execution_blocked')

  for (const ambiguousId of ['042', '42.0', ' 42', '42 ']) {
    const ambiguousIdResult = spawnSync(process.execPath, [
      CLI_PATH,
      '--authority-file', path.join(fixtureRoot, 'does-not-exist'),
      '--snapshot-file', path.join(fixtureRoot, 'also-does-not-exist'),
      '--player-id', ambiguousId,
    ], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      timeout: 3_000,
    })
    assert.equal(ambiguousIdResult.status, 1)
    assert.equal(JSON.parse(ambiguousIdResult.stderr).error.code, 'malformed_target')
  }

  const symlink = path.join(fixtureRoot, 'authority-link.json')
  symlinkSync(ordinary.authorityFile, symlink)
  const symlinkResult = runCli(symlink, ordinary.snapshotFile)
  assert.equal(symlinkResult.status, 1)
  assert.equal(JSON.parse(symlinkResult.stderr).error.code, 'unsafe_input_file')

  const directoryResult = runCli(fixtureRoot, ordinary.snapshotFile)
  assert.equal(directoryResult.status, 1)
  assert.equal(JSON.parse(directoryResult.stderr).error.code, 'unsafe_input_file')

  const specialResult = runCli('/dev/null', ordinary.snapshotFile)
  assert.equal(specialResult.status, 1)
  assert.equal(JSON.parse(specialResult.stderr).error.code, 'unsafe_input_file')

  const fifo = path.join(fixtureRoot, 'snapshot.fifo')
  const fifoCreated = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
  assert.equal(fifoCreated.status, 0, fifoCreated.stderr)
  const fifoStartedAt = Date.now()
  const fifoResult = runCli(ordinary.authorityFile, fifo)
  assert.equal(fifoResult.status, 1)
  assert.equal(JSON.parse(fifoResult.stderr).error.code, 'unsafe_input_file')
  assert(Date.now() - fifoStartedAt < 2_000, 'FIFO refusal must not wait for a writer.')

  const exactAuthority = JSON.stringify(ordinary.currentAuthority)
    .padEnd(IDENTITY_RECOVERY_AUTHORITY_MAX_FILE_BYTES, ' ')
  const exactAuthorityFile = path.join(fixtureRoot, 'authority-exact.json')
  writeFileSync(exactAuthorityFile, exactAuthority)
  assert.equal(runCli(exactAuthorityFile, ordinary.snapshotFile).status, 0)
  writeFileSync(exactAuthorityFile, `${exactAuthority} `)
  const oversizedAuthority = runCli(exactAuthorityFile, ordinary.snapshotFile)
  assert.equal(JSON.parse(oversizedAuthority.stderr).error.code, 'input_too_large')

  const exactSnapshot = JSON.stringify(ordinary.currentSnapshot)
    .padEnd(IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES, ' ')
  const exactSnapshotFile = path.join(fixtureRoot, 'snapshot-exact.json')
  writeFileSync(exactSnapshotFile, exactSnapshot)
  assert.equal(runCli(ordinary.authorityFile, exactSnapshotFile).status, 0)
  writeFileSync(exactSnapshotFile, `${exactSnapshot} `)
  const oversizedSnapshot = runCli(ordinary.authorityFile, exactSnapshotFile)
  assert.equal(JSON.parse(oversizedSnapshot.stderr).error.code, 'input_too_large')

  const countBoundary = writeFixtures('count-boundary', currentFixtures(IDENTITY_RECOVERY_MAX_RECORDS))
  assert(
    readFileSync(countBoundary.snapshotFile).byteLength
      <= IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES,
  )
  assert.equal(runCli(countBoundary.authorityFile, countBoundary.snapshotFile).status, 0)
  const overCount = writeFixtures('over-count', currentFixtures(IDENTITY_RECOVERY_MAX_RECORDS + 1))
  const overCountResult = runCli(overCount.authorityFile, overCount.snapshotFile)
  assert.equal(JSON.parse(overCountResult.stderr).error.code, 'malformed_snapshot')

  const duplicateTopFile = path.join(fixtureRoot, 'duplicate-top.json')
  writeFileSync(
    duplicateTopFile,
    JSON.stringify(ordinary.currentAuthority).replace(
      '{"schemaVersion":1,',
      '{"schemaVersion":1,"schemaVersion":1,',
    ),
  )
  const duplicateTop = runCli(duplicateTopFile, ordinary.snapshotFile)
  assert.equal(JSON.parse(duplicateTop.stderr).error.code, 'duplicate_json_key')

  const duplicateNestedFile = path.join(fixtureRoot, 'duplicate-nested.json')
  writeFileSync(
    duplicateNestedFile,
    JSON.stringify(ordinary.currentAuthority).replace(
      '"identityRecovery":"enabled"',
      '"identityRecovery":"enabled","identityRecovery":"enabled"',
    ),
  )
  const duplicateNested = runCli(duplicateNestedFile, ordinary.snapshotFile)
  assert.equal(JSON.parse(duplicateNested.stderr).error.code, 'duplicate_json_key')

  const invalidUtf8 = path.join(fixtureRoot, 'invalid-utf8.json')
  writeFileSync(invalidUtf8, Buffer.from([0x7B, 0x22, 0x78, 0x22, 0x3A, 0xFF, 0x7D]))
  assert.equal(JSON.parse(runCli(invalidUtf8, ordinary.snapshotFile).stderr).error.code, 'malformed_unicode')

  const malformedUnicode = path.join(fixtureRoot, 'malformed-unicode.json')
  writeFileSync(
    malformedUnicode,
    JSON.stringify(ordinary.currentAuthority).replace('"preview"', '"\\ud800"'),
  )
  assert.equal(JSON.parse(runCli(malformedUnicode, ordinary.snapshotFile).stderr).error.code, 'malformed_unicode')

  const nonCanonicalUnicode = path.join(fixtureRoot, 'noncanonical-unicode.json')
  writeFileSync(
    nonCanonicalUnicode,
    JSON.stringify({ ...ordinary.currentAuthority, environment: 'pre\u0301view' }),
  )
  assert.equal(JSON.parse(runCli(nonCanonicalUnicode, ordinary.snapshotFile).stderr).error.code, 'malformed_unicode')

  const overlongField = path.join(fixtureRoot, 'overlong-field.json')
  writeFileSync(
    overlongField,
    JSON.stringify({ ...ordinary.currentAuthority, environment: 'p'.repeat(129) }),
  )
  assert.equal(JSON.parse(runCli(overlongField, ordinary.snapshotFile).stderr).error.code, 'malformed_unicode')

  const shortHashSnapshot = writeFixtures('short-hash', {
    currentAuthority: ordinary.currentAuthority,
    currentSnapshot: {
      ...ordinary.currentSnapshot,
      records: ordinary.currentSnapshot.records.map((entry) => ({
        ...entry,
        credentialStateHash: 'a'.repeat(63),
      })),
    },
  })
  assert.equal(
    JSON.parse(runCli(shortHashSnapshot.authorityFile, shortHashSnapshot.snapshotFile).stderr).error.code,
    'malformed_snapshot',
  )

  const recordAfterObservation = {
    ...ordinary.currentSnapshot,
    records: ordinary.currentSnapshot.records.map((entry) => ({
      ...entry,
      identityUpdatedAtMs: ordinary.currentSnapshot.observedAtMs + 1,
    })),
  }
  const badTime = writeFixtures('bad-time', {
    currentAuthority: ordinary.currentAuthority,
    currentSnapshot: recordAfterObservation,
  })
  assert.equal(JSON.parse(runCli(badTime.authorityFile, badTime.snapshotFile).stderr).error.code, 'malformed_snapshot')

  const normalizedDirectory = path.join(fixtureRoot, 'nested')
  mkdirSync(normalizedDirectory)
  const normalizedAuthorityPath = path.join(normalizedDirectory, '..', path.basename(ordinary.authorityFile))
  assert.equal(runCli(normalizedAuthorityPath, ordinary.snapshotFile).status, 0)

  const sensitiveName = path.join(fixtureRoot, 'raw-credential-player-42.json')
  writeFileSync(sensitiveName, '{"deviceCredential":"ppd1_sensitive"}')
  const safeError = runCli(sensitiveName, ordinary.snapshotFile)
  assert.equal(safeError.status, 1)
  assert.doesNotMatch(safeError.stderr, /raw-credential|player-42|ppd1_sensitive|pennant-recovery-test/)
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
  globalThis.fetch = originalFetch
}

const shippedRoots = [
  'scripts/lib/identity-recovery-preparation.mjs',
  'scripts/prepare-identity-recovery.mjs',
]
const reviewedReadOnlyBuiltins = new Set([
  'node:crypto',
  'node:fs',
  'node:path',
  'node:url',
])
const shippedGraph = new Map()
const pendingGraphFiles = [...shippedRoots]
while (pendingGraphFiles.length > 0) {
  const relativePath = pendingGraphFiles.pop()
  if (shippedGraph.has(relativePath)) continue
  const source = readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8')
  shippedGraph.set(relativePath, source)
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.')) {
      pendingGraphFiles.push(path.posix.normalize(path.posix.join(
        path.posix.dirname(relativePath),
        specifier,
      )))
    } else {
      assert(
        reviewedReadOnlyBuiltins.has(specifier),
        `Shipped recovery graph imported unreviewed dependency ${specifier} from ${relativePath}.`,
      )
    }
  }
}
assert.deepEqual(
  [...shippedGraph.keys()].sort(),
  [
    'scripts/lib/identity-recovery-preparation.mjs',
    'scripts/lib/preview-release/canonical.mjs',
    'scripts/lib/schema4-activation-authority.mjs',
    'scripts/prepare-identity-recovery.mjs',
  ],
)
const shippedSource = [...shippedGraph.entries()]
  .map(([relativePath, source]) => `// ${relativePath}\n${source}`)
  .join('\n')
assert.doesNotMatch(shippedSource, /node:(?:child_process|http|https|net|tls|dgram|worker_threads)/)
assert.doesNotMatch(shippedSource, /\b(?:spawn|exec|execFile|fork|writeFile|appendFile|unlink|rmSync|renameSync|mkdirSync)\b/)
assert.doesNotMatch(shippedSource, /\bfetch\s*\(|https?:\/\/|wrangler|cloudflare|d1_databases/i)
assert.doesNotMatch(shippedSource, /(?:INSERT|UPDATE|DELETE|DROP|ALTER)\s+(?:INTO|FROM|TABLE)/i)
assert.doesNotMatch(shippedSource, /createInMemoryIdentityRecoveryTestAdapter|TEST_ADAPTERS|\.rotate\s*\(/)
assert.doesNotMatch(shippedSource, /await\s+adapter|adapter\.[A-Za-z_$]/)
assert.match(shippedSource, /randomBytes\(32\)/)
assert.match(shippedSource, /consumption:\s*'not-performed'/)
assert.equal(networkContacts, 0)

console.log('Identity recovery preparation tests passed: exact-player substitution is rejected by a domain-separated opaque binding, legacy or malformed unbound plans fail closed, the shipped graph is structurally read-only, execution is refused before file access, authority-bound plans use unlinkable random references and canonical per-plan commitments, repeat verification is explicitly non-consuming, strict bounded regular-file JSON input rejects filesystem and canonicalization attacks, and no network, subprocess, SQL, or mutation adapter is reachable.')
