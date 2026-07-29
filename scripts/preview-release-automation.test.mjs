import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createReleasePackage,
  loadReleasePackage,
  serializeReleaseArtifact,
  validateReleasePackage,
} from './lib/preview-release/artifacts.mjs'
import { canonicalHash, canonicalJson } from './lib/preview-release/canonical.mjs'
import { compilePreviewState, validateConfigurationModel } from './lib/preview-release/configuration.mjs'
import { buildExecutionContract } from './lib/preview-release/execution-contract.mjs'
import { EXIT_CODES } from './lib/preview-release/errors.mjs'
import { executeReleasePackage, validateExecutionEnvironment } from './lib/preview-release/release-execution.mjs'
import { loadReleaseManifest, validateReleaseManifest } from './lib/preview-release/manifest.mjs'
import { classifyMigrationState, loadRepositoryMigrations } from './lib/preview-release/migrations.mjs'
import { buildReleasePlan, derivePlanId } from './lib/preview-release/plan.mjs'
import { redactValue } from './lib/preview-release/redaction.mjs'
import { parsePreviewReadinessArguments } from './preview-readiness.mjs'
import { parsePreviewReleaseArguments } from './preview-release.mjs'

const REPOSITORY_ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const canonicalManifest = loadReleaseManifest(REPOSITORY_ROOT).manifest
const ACCOUNT_ID = 'a'.repeat(32)
const ZONE_ID = 'b'.repeat(32)
const HEAD = 'c'.repeat(40)
const CREATED_MS = Date.parse('2026-07-29T18:00:00.000Z')
const READ_TOKEN = 'read-preview-fixture-token-value'
const DEPLOY_TOKEN = 'deploy-preview-fixture-token-value'

function resolvedManifest() {
  const value = structuredClone(canonicalManifest)
  value.cloudflare.account = { status: 'resolved', id: ACCOUNT_ID, reason: '' }
  value.cloudflare.preview.worker.routeZoneIds = { status: 'resolved', values: [ZONE_ID], reason: '' }
  value.cloudflare.production.pages.branch = { status: 'resolved', value: 'main', reason: '' }
  value.cloudflare.production.pages.domains = { status: 'resolved', values: ['pennant-pursuit.example'], reason: '' }
  return validateReleaseManifest(value)
}

function migrations(count) {
  const known = loadRepositoryMigrations(REPOSITORY_ROOT)
  const appliedCount = count ?? known.length
  return classifyMigrationState({
    knownMigrations: known,
    tables: appliedCount === 0 ? ['d1_migrations'] : ['backend_schema', 'd1_migrations'],
    rows: known.slice(0, appliedCount).map(({ id, name }) => ({
      id,
      name,
      applied_at: `2026-07-${String(id).padStart(2, '0')} 12:00:00`,
    })),
    backendVersion: appliedCount === 0 ? null : appliedCount,
  })
}

function bindings(state) {
  const reviewed = resolvedManifest()
  const submissionMode = state === 'disabled' ? 'disabled' : 'enabled'
  const sort = (values) => values.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
  return {
    pages: sort([
      { name: 'DB', type: 'd1', id: reviewed.cloudflare.preview.d1.id },
      { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: submissionMode },
      { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
      { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
      {
        name: 'VALIDATION_SERVICE',
        type: 'service',
        service: reviewed.cloudflare.preview.worker.name,
        environment: '',
      },
    ]),
    worker: sort([
      { name: 'DB', type: 'd1', id: reviewed.cloudflare.preview.d1.id },
      { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: submissionMode },
      { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
      { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
      { name: 'RATE_LIMIT_BURST', type: 'ratelimit', namespaceId: '16204011' },
      { name: 'RATE_LIMIT_SUSTAINED', type: 'ratelimit', namespaceId: '16204012' },
    ]),
  }
}

function remoteState(state = 'disabled', {
  deploymentId = 'pages-before',
  workerDeploymentId = '11111111-1111-4111-8111-111111111111',
} = {}) {
  const reviewed = resolvedManifest()
  const inventory = bindings(state)
  const known = loadRepositoryMigrations(REPOSITORY_ROOT)
  return {
    schemaVersion: 2,
    accountId: ACCOUNT_ID,
    pages: {
      project: reviewed.cloudflare.preview.pages.project,
      previewBranch: 'develop',
      productionBranch: 'main',
      deployment: {
        id: deploymentId,
        createdOn: '2026-07-29T17:00:00.000Z',
        branch: 'develop',
        commitHash: HEAD,
        status: 'success',
        previewOrigin: 'https://develop.diamond-draft.pages.dev',
      },
      artifactHash: null,
      configHash: null,
      submissionMode: state === 'disabled' ? 'disabled' : 'enabled',
      validationMode: 'enabled',
      ticketMode: 'enabled',
      bindings: inventory.pages,
    },
    worker: {
      name: reviewed.cloudflare.preview.worker.name,
      workersDev: false,
      previewUrls: false,
      routes: [],
      customDomains: [],
      schedules: state === 'cron-enabled' ? [reviewed.activation.cleanupCron] : [],
      bindings: inventory.worker,
      artifactHash: null,
      artifactProvenance: 'unproven',
      deploymentId: workerDeploymentId,
      versionId: '22222222-2222-4222-8222-222222222222',
    },
    d1: { ...reviewed.cloudflare.preview.d1 },
    migrationObservation: {
      tables: ['backend_schema', 'd1_migrations'],
      rows: known.map(({ id, name }) => ({
        id,
        name,
        applied_at: `2026-07-${String(id).padStart(2, '0')} 12:00:00`,
      })),
      backendVersion: known.length,
    },
  }
}

function applySuccessfulStage(before, stage, postState) {
  const after = structuredClone(before)
  if (['cron.disable', 'worker.deploy', 'cron.deploy'].includes(stage.id)) {
    const state = stage.configurationState === 'disabled'
      ? 'disabled'
      : stage.configurationState === 'cron-enabled'
        ? 'cron-enabled'
        : 'submission-enabled'
    const inventory = bindings(state)
    after.worker = {
      ...after.worker,
      bindings: inventory.worker,
      deploymentId: postState.worker.deploymentId,
      versionId: postState.worker.versionId,
      schedules: state === 'cron-enabled' ? postState.worker.schedules : [],
    }
  } else if (['pages.disable', 'pages.deploy'].includes(stage.id)) {
    const state = stage.configurationState === 'disabled' ? 'disabled' : 'submission-enabled'
    const inventory = bindings(state)
    after.pages = {
      ...after.pages,
      bindings: inventory.pages,
      deployment: structuredClone(postState.pages.deployment),
      submissionMode: state === 'disabled' ? 'disabled' : 'enabled',
    }
  } else if (stage.id === 'migration.apply') {
    after.migrationObservation = structuredClone(postState.migrationObservation)
  }
  return after
}

function successfulInspectionSequence(plan, postState) {
  let current = {
    ...structuredClone(plan.remoteBefore),
    migrationObservation: structuredClone(postState.migrationObservation),
  }
  const sequence = []
  for (const stage of plan.executionContract.orderedStages) {
    sequence.push(structuredClone(current))
    if (stage.kind === 'command') {
      current = applySuccessfulStage(current, stage, postState)
      sequence.push(structuredClone(current))
    }
  }
  sequence.push(structuredClone(current))
  return sequence
}

function planFor(targetState = 'disabled', initialState = 'disabled') {
  const manifest = resolvedManifest()
  const compiled = compilePreviewState(REPOSITORY_ROOT, manifest, targetState)
  const remote = remoteState(initialState)
  const hashes = {
    source: '1'.repeat(64),
    repositoryTree: '2'.repeat(64),
    package: '3'.repeat(64),
    lockfile: '4'.repeat(64),
    manifest: canonicalHash(manifest),
    configuration: compiled.hashes.combined,
    toolchain: '5'.repeat(64),
    workerSourceArtifact: '6'.repeat(64),
    pagesSourceArtifact: '7'.repeat(64),
    appBuildArtifact: '8'.repeat(64),
    workerBuildArtifact: '9'.repeat(64),
    pagesFunctionsBuildArtifact: 'a'.repeat(64),
    submissionSmokeBuildArtifact: 'b'.repeat(64),
    retentionSmokeBuildArtifact: 'd'.repeat(64),
    protectedConfiguration: {
      'config/preview-release.json': 'e'.repeat(64),
      'wrangler.toml': 'f'.repeat(64),
      'workers/draft-validation/wrangler.toml': '0'.repeat(64),
      'workers/draft-validation/d1c4-activation-states.json': 'a'.repeat(64),
    },
  }
  return buildReleasePlan({
    manifest,
    manifestHash: canonicalHash(manifest),
    local: {
      repositoryRoot: REPOSITORY_ROOT,
      branch: 'develop',
      upstream: 'origin/develop',
      head: HEAD,
      divergence: { ahead: 0, behind: 0 },
      remoteUrl: canonicalManifest.repository.remoteUrl,
    },
    serverHead: HEAD,
    targetState,
    compiled,
    hashes,
    remote,
    migration: migrations(),
  })
}

function executionOptions(plan, postState, {
  spawn,
  approve = async (challenge) => challenge,
  createPlan = async () => plan,
  now = () => CREATED_MS + 1_000,
} = {}) {
  let inspections = 0
  const inspectionSequence = successfulInspectionSequence(plan, postState)
  return {
    repositoryRoot: REPOSITORY_ROOT,
    environment: {
      PATH: process.env.PATH,
      PENNANT_PREVIEW_API_TOKEN: READ_TOKEN,
      PENNANT_PREVIEW_DEPLOY_API_TOKEN: DEPLOY_TOKEN,
    },
    stdinIsTTY: true,
    stdoutIsTTY: true,
    approve,
    createPlan,
    loadManifest: () => ({ manifest: resolvedManifest() }),
    compileConfiguration: (root, manifest) => validateConfigurationModel(root, manifest),
    inspectRemote: async () => {
      const result = inspectionSequence[Math.min(inspections, inspectionSequence.length - 1)]
      inspections += 1
      return result
    },
    client: {},
    runQualityStages: false,
    spawn: spawn ?? (() => ({ status: 0, stdout: 'ok', stderr: '' })),
    now,
    output: { log() {}, error() {} },
  }
}

test('CLI contracts require explicit targets and package paths without accepting arbitrary execution flags', () => {
  const packageJson = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'))
  assert.equal('preview:readiness' in packageJson.scripts, false)
  assert.equal('preview:release' in packageJson.scripts, false)
  assert.deepEqual(parsePreviewReadinessArguments(['--target-state', 'disabled']), {
    targetState: 'disabled',
    json: false,
    color: true,
  })
  assert.deepEqual(parsePreviewReleaseArguments(['--plan', '.preview-release/plan.json', '--json']), {
    planPath: '.preview-release/plan.json',
    json: true,
    color: true,
  })
  for (const argv of [[], ['--target-state', 'production'], ['--target-state', 'disabled', '--output', '/tmp/x']]) {
    assert.throws(() => parsePreviewReadinessArguments(argv))
  }
  for (const argv of [[], ['--plan', 'x', '--approve', 'yes'], ['--plan', 'x', '--execute', 'wrangler deploy']]) {
    assert.throws(() => parsePreviewReleaseArguments(argv))
  }
})

test('release packages are canonical, deterministic with an injected clock, expiring, and recursively bound', () => {
  const plan = planFor()
  const first = createReleasePackage(plan, { nowMs: CREATED_MS })
  const second = createReleasePackage(plan, { nowMs: CREATED_MS })
  assert.equal(canonicalJson(first), canonicalJson(second))
  assert.equal(first.planHash, canonicalHash(plan))
  assert.match(first.approval.challenge, new RegExp(`^APPROVE ${plan.planId} [0-9a-f]{24} disabled$`))
  assert.equal(first.expirationPolicy.regenerationDoesNotConferApproval, true)
  assert.doesNotThrow(() => validateReleasePackage(first, { nowMs: CREATED_MS + 1, requireUnexpired: true }))
  assert.throws(
    () => validateReleasePackage(first, { nowMs: Date.parse(first.expiresAt), requireUnexpired: true }),
    /stale or expired/,
  )
})

test('canonical artifact loading rejects byte edits, duplicate-like formatting, writable files, and plan tampering', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pp-release-artifact-'))
  try {
    const releasePackage = createReleasePackage(planFor(), { nowMs: CREATED_MS })
    const goodPath = path.join(directory, 'good.json')
    writeFileSync(goodPath, serializeReleaseArtifact(releasePackage), { mode: 0o600 })
    assert.equal(loadReleasePackage(goodPath).artifactHash, releasePackage.artifactHash)

    const spacedPath = path.join(directory, 'spaced.json')
    writeFileSync(spacedPath, `${JSON.stringify(releasePackage, null, 2)}\n`, { mode: 0o600 })
    assert.throws(() => loadReleasePackage(spacedPath), /canonical JSON/)

    const writablePath = path.join(directory, 'writable.json')
    writeFileSync(writablePath, serializeReleaseArtifact(releasePackage), { mode: 0o622 })
    chmodSync(writablePath, 0o622)
    assert.throws(() => loadReleasePackage(writablePath), /non-writable/)

    const tampered = structuredClone(releasePackage)
    tampered.plan.gitHead = 'f'.repeat(40)
    assert.throws(() => validateReleasePackage(tampered), /plan ID|plan hash|edited/)

    const forgedEvidence = structuredClone(releasePackage)
    forgedEvidence.evidence.statement = 'Edited evidence fixture.'
    const { artifactHash: _artifactHash, ...withoutArtifactHash } = forgedEvidence
    forgedEvidence.artifactHash = canonicalHash(withoutArtifactHash)
    assert.throws(() => validateReleasePackage(forgedEvidence), /canonical generator/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('exact command contracts bind Preview targets, immutable order, validation, and Production prohibition', () => {
  const plan = planFor('cron-enabled')
  assert.deepEqual(
    plan.executionContract.orderedStages.map(({ id }) => id),
    ['worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
  )
  const text = canonicalJson(plan.executionContract)
  assert.match(text, /pennant-pursuit-validation-preview/)
  assert.match(text, /pennant-pursuit-preview/)
  assert.match(text, /https:\/\/develop\.diamond-draft\.pages\.dev/)
  assert.doesNotMatch(text, /pennant-pursuit-validation-production|pennant-pursuit-production|--env","production/)
  assert.equal(plan.executionContract.mutationBoundary.productionOperationsProhibited, true)
  assert.deepEqual(
    plan.executionContract,
    buildExecutionContract({
      futureStages: plan.futureStages,
      targetState: plan.targetState,
      manifest: resolvedManifest(),
      gitHead: plan.gitHead,
      previewOrigin: plan.remoteBefore.pages.deployment.previewOrigin,
    }),
  )
})

test('edited or Production-target command manifests refuse before approval or subprocess execution', async () => {
  const plan = structuredClone(planFor())
  plan.executionContract.orderedStages[0].args.push(resolvedManifest().cloudflare.production.worker.name)
  delete plan.planId
  plan.planId = derivePlanId(plan)
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  let approvals = 0
  let spawns = 0
  const result = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState(), {
    approve: async () => { approvals += 1; return '' },
    spawn: () => { spawns += 1; return { status: 0 } },
  }))
  assert.equal(result.report.status, 'REFUSED')
  assert.equal(approvals, 0)
  assert.equal(spawns, 0)
  assert.match(result.report.error.message, /command list differs/)
})

test('execution credentials are dedicated, distinct, TTY-gated, and reject generic or Production-capable aliases', () => {
  const valid = {
    PENNANT_PREVIEW_API_TOKEN: READ_TOKEN,
    PENNANT_PREVIEW_DEPLOY_API_TOKEN: DEPLOY_TOKEN,
  }
  assert.deepEqual(validateExecutionEnvironment(valid, { stdinIsTTY: true, stdoutIsTTY: true }), {
    readToken: READ_TOKEN,
    deployToken: DEPLOY_TOKEN,
  })
  assert.throws(() => validateExecutionEnvironment({}, { stdinIsTTY: true, stdoutIsTTY: true }), /PENNANT_PREVIEW_API_TOKEN/)
  assert.throws(() => validateExecutionEnvironment({
    ...valid,
    PENNANT_PREVIEW_DEPLOY_API_TOKEN: READ_TOKEN,
  }, { stdinIsTTY: true, stdoutIsTTY: true }), /must be distinct/)
  assert.throws(() => validateExecutionEnvironment({
    ...valid,
    CLOUDFLARE_API_TOKEN: 'production-capable-fixture',
  }, { stdinIsTTY: true, stdoutIsTTY: true }), /prohibited/)
  assert.throws(() => validateExecutionEnvironment(valid, { stdinIsTTY: false, stdoutIsTTY: true }), /interactive/)
  assert.throws(() => validateExecutionEnvironment({ ...valid, CI: 'true' }, { stdinIsTTY: true, stdoutIsTTY: true }), /CI/)
})

test('fresh-plan drift, protected hash drift, stale approval, and an incorrect challenge fail before mutation', async () => {
  const plan = planFor()
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  for (const createPlan of [
    async () => ({ ...plan, gitHead: 'f'.repeat(40) }),
    async () => ({
      ...plan,
      hashes: {
        ...plan.hashes,
        protectedConfiguration: {
          ...plan.hashes.protectedConfiguration,
          'wrangler.toml': '0'.repeat(64),
        },
      },
    }),
  ]) {
    let spawns = 0
    const result = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState(), {
      createPlan,
      spawn: () => { spawns += 1; return { status: 0 } },
    }))
    assert.equal(result.report.status, 'REFUSED')
    assert.equal(spawns, 0)
    assert.match(result.report.error.message, /stale/)
  }

  let spawns = 0
  const badApproval = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState(), {
    approve: async () => 'APPROVE SOMETHING ELSE',
    spawn: () => { spawns += 1; return { status: 0 } },
  }))
  assert.equal(badApproval.report.status, 'REFUSED')
  assert.equal(spawns, 0)
  assert.match(badApproval.report.error.message, /did not match/)

  const expired = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState(), {
    now: () => Date.parse(releasePackage.expiresAt),
  }))
  assert.equal(expired.report.status, 'REFUSED')
  assert.equal(expired.report.mutationAttempted, false)

  let planCalls = 0
  const changedDuringApproval = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState(), {
    createPlan: async () => {
      planCalls += 1
      return planCalls === 1 ? plan : { ...plan, gitHead: 'e'.repeat(40) }
    },
    spawn: () => { throw new Error('Mutation must not run after post-approval drift.') },
  }))
  assert.equal(planCalls, 2)
  assert.equal(changedDuringApproval.report.status, 'REFUSED')
  assert.equal(changedDuringApproval.report.mutationAttempted, false)
  assert.match(changedDuringApproval.report.error.message, /changed while approval was pending/)
})

test('remote drift immediately before a stage refuses before the first mutation', async () => {
  const plan = planFor()
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  let spawns = 0
  const drifted = remoteState('disabled', { deploymentId: 'unexpected-concurrent-deployment' })
  const result = await executeReleasePackage(releasePackage, {
    ...executionOptions(plan, drifted, {
      spawn: () => { spawns += 1; return { status: 0 } },
    }),
    inspectRemote: async () => drifted,
  })
  assert.equal(result.report.status, 'REFUSED')
  assert.equal(result.report.mutationAttempted, false)
  assert.equal(spawns, 0)
  assert.match(result.report.error.message, /changed before stage worker\.deploy/)
})

test('a stage changing a second remote resource stops the remaining mutation boundary', async () => {
  const plan = planFor()
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  const initial = successfulInspectionSequence(plan, remoteState())[0]
  const crossResourceMutation = remoteState('disabled', {
    deploymentId: 'unexpected-pages-change',
    workerDeploymentId: '33333333-3333-4333-8333-333333333333',
  })
  let inspections = 0
  let spawns = 0
  const result = await executeReleasePackage(releasePackage, {
    ...executionOptions(plan, crossResourceMutation),
    inspectRemote: async () => {
      inspections += 1
      return inspections === 1 ? initial : crossResourceMutation
    },
    spawn: () => {
      spawns += 1
      return { status: 0, stdout: 'ok', stderr: '' }
    },
  })
  assert.equal(result.report.status, 'PARTIAL')
  assert.equal(spawns, 1)
  assert.match(result.report.error.message, /outside its exact approved mutation boundary/)
  assert.equal(result.report.stages.slice(1).every(({ status }) => status === 'NOT-RUN'), true)
})

test('successful disabled execution uses only fixed commands, isolated child environments, and final validation', async () => {
  const plan = planFor()
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  const calls = []
  const post = remoteState('disabled', { deploymentId: 'pages-after', workerDeploymentId: '33333333-3333-4333-8333-333333333333' })
  const result = await executeReleasePackage(releasePackage, executionOptions(plan, post, {
    spawn(executable, args, options) {
      calls.push({ executable, args, options })
      return { status: 0, stdout: `deployed ${DEPLOY_TOKEN}`, stderr: '' }
    },
  }))
  assert.equal(result.exitCode, EXIT_CODES.SUCCESS)
  assert.equal(result.report.status, 'PASS')
  assert.equal(result.report.validation.status, 'PASS')
  assert.deepEqual(result.report.stages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
  assert.equal(result.report.productionMutationAttempted, false)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.options.shell, false)
    assert.equal(call.options.env.CLOUDFLARE_API_TOKEN, DEPLOY_TOKEN)
    assert.equal(call.options.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT_ID)
    assert.equal(call.options.env.PENNANT_PREVIEW_API_TOKEN, undefined)
    assert.equal(call.options.env.PENNANT_PREVIEW_DEPLOY_API_TOKEN, undefined)
    assert.equal(call.options.env.CLOUDFLARE_API_KEY, undefined)
  }
  assert.equal(JSON.stringify(result.report).includes(DEPLOY_TOKEN), false)
  assert.match(JSON.stringify(result.report), /\[REDACTED\]/)
})

test('enabled execution cannot pass without the required post-deployment submission smoke stage', async () => {
  const plan = planFor('submission-enabled')
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  const post = remoteState('submission-enabled', {
    deploymentId: 'pages-enabled',
    workerDeploymentId: '33333333-3333-4333-8333-333333333333',
  })
  const passed = await executeReleasePackage(releasePackage, executionOptions(plan, post))
  assert.equal(passed.report.status, 'PASS')
  assert.deepEqual(passed.report.stages.map(({ id }) => id), ['worker.deploy', 'pages.deploy', 'submission.smoke'])
  assert.equal(passed.report.validation.checks.find(({ id }) => id === 'validation.required-smoke').status, 'PASS')

  let calls = 0
  const failed = await executeReleasePackage(releasePackage, executionOptions(plan, post, {
    spawn(executable, args) {
      calls += 1
      const smoke = args.includes('/tmp/pennant-pursuit-d1c4-submission-smoke/d1c4-submission-smoke.js')
      return smoke ? { status: 1, stdout: '', stderr: 'smoke failed' } : { status: 0, stdout: 'ok', stderr: '' }
    },
  }))
  assert.equal(calls, 3)
  assert.equal(failed.report.status, 'PARTIAL')
  assert.equal(failed.report.stages.find(({ id }) => id === 'submission.smoke').status, 'FAIL')
  assert.equal(failed.report.rollback.publicGateMayBeEnabled, true)
})

test('the first command failure stops every later command and produces deterministic partial recovery evidence', async () => {
  const plan = planFor('cron-enabled', 'submission-enabled')
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  let calls = 0
  const spawn = () => {
    calls += 1
    return { status: 1, stdout: '', stderr: `Authorization: Bearer ${DEPLOY_TOKEN}` }
  }
  const first = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState('cron-enabled'), { spawn }))
  calls = 0
  const second = await executeReleasePackage(releasePackage, executionOptions(plan, remoteState('cron-enabled'), { spawn }))
  assert.equal(calls, 1)
  assert.equal(first.report.status, 'PARTIAL')
  assert.equal(first.report.stages[0].status, 'FAIL')
  assert.equal(first.report.stages.slice(1).every(({ status }) => status === 'NOT-RUN'), true)
  assert.equal(first.report.rollback.automaticRollbackPerformed, false)
  assert.equal(first.report.rollback.publicGateMayBeEnabled, true)
  assert.equal(first.report.rollback.urgency, 'disable-public-gate')
  assert.equal(JSON.stringify(first.report).includes(DEPLOY_TOKEN), false)
  assert.equal(canonicalJson(first.report), canonicalJson(second.report))
})

test('nested values, URL credentials, headers, stacks, and thrown non-Error values redact without leaking fixtures', () => {
  const secret = 'nested-secret-fixture'
  const redacted = redactValue({
    url: `https://user:${secret}@example.invalid/path`,
    headers: { Authorization: `Bearer ${secret}`, 'x-value': secret },
    nested: [{ token: secret }, new Error(secret).stack],
  }, [secret])
  const output = JSON.stringify(redacted)
  assert.equal(output.includes(secret), false)
  assert.match(output, /\[REDACTED\]/)
})

test('automation tests use only local fakes; no live fetch or deployment implementation is reachable', async () => {
  const plan = planFor()
  const releasePackage = createReleasePackage(plan, { nowMs: CREATED_MS })
  let fakeCommands = 0
  let fakeInspections = 0
  const post = remoteState('disabled', {
    deploymentId: 'pages-after',
    workerDeploymentId: '33333333-3333-4333-8333-333333333333',
  })
  const inspections = successfulInspectionSequence(plan, post)
  const result = await executeReleasePackage(releasePackage, {
    ...executionOptions(plan, remoteState(), {
      spawn: () => { fakeCommands += 1; return { status: 0, stdout: 'fake', stderr: '' } },
    }),
    inspectRemote: async () => {
      const value = inspections[Math.min(fakeInspections, inspections.length - 1)]
      fakeInspections += 1
      return value
    },
    fetchImplementation: () => { throw new Error('Network must not run') },
  })
  assert.equal(result.report.status, 'PASS')
  assert.equal(fakeCommands, 2)
  assert.equal(fakeInspections, 5)
})
