import {
  canonicalHash,
  canonicalJson,
  immutablePlain,
  PREVIEW_RELEASE_PLAN_SCHEMA_VERSION,
  PREVIEW_RELEASE_TOOL_CONTRACT_VERSION,
} from './canonical.mjs'
import {
  assertExactBindings,
  expectedPagesBindings,
  expectedWorkerBindings,
} from './binding-inventory.mjs'
import {
  assertCurrentDisabledExecutionContract,
  assertExecutionContract,
  buildExecutionContract,
} from './execution-contract.mjs'
import { refusalError, remoteError } from './errors.mjs'
import { assertNoReleaseInspectionArtifactForLegacyExecution } from '../release-inspection/markers.mjs'

export const PLAN_SCHEMA_VERSION = PREVIEW_RELEASE_PLAN_SCHEMA_VERSION
const DEPLOYMENT_STAGE_IDS = new Set(['worker.deploy', 'pages.deploy'])
const CURRENT_STAGE_DESCRIPTIONS = Object.freeze({
  'worker.deploy': 'Deploy the Preview-only Worker all-disabled configuration.',
  'pages.deploy': 'Deploy the Preview-only Pages Functions all-disabled configuration.',
})
const PAGES_PLAIN_TEXT_BINDINGS = Object.freeze({
  DRAFT_TICKET_MODE: 'enabled',
  DRAFT_VALIDATION_MODE: 'enabled',
  LEADERBOARD_ENVIRONMENT: 'preview',
  LEADERBOARD_READ_MODE: 'disabled',
  LEADERBOARD_IDENTITY_MODE: 'disabled',
  LEADERBOARD_IDENTITY_CLAIM_MODE: 'disabled',
  LEADERBOARD_IDENTITY_STATUS_MODE: 'disabled',
  LEADERBOARD_IDENTITY_RENAME_MODE: 'disabled',
  DRAFT_SUBMISSION_MODE: 'disabled',
  LEADERBOARD_RECOVERY_MODE: 'disabled',
})
const WORKER_PLAIN_TEXT_BINDINGS = Object.freeze({
  DRAFT_TICKET_MODE: 'enabled',
  DRAFT_VALIDATION_MODE: 'enabled',
  LEADERBOARD_IDENTITY_MODE: 'disabled',
  LEADERBOARD_IDENTITY_CLAIM_MODE: 'disabled',
  LEADERBOARD_IDENTITY_STATUS_MODE: 'disabled',
  LEADERBOARD_IDENTITY_RENAME_MODE: 'disabled',
  DRAFT_SUBMISSION_MODE: 'disabled',
  LEADERBOARD_RECOVERY_MODE: 'disabled',
  RETENTION_CLEANUP_MODE: 'disabled',
})

function assertRemoteTopology(manifest, remote) {
  const preview = manifest.cloudflare.preview
  if (remote.accountId !== manifest.cloudflare.account.id) throw refusalError('Remote account does not match the immutable Preview identity.', 'plan.remote-topology')
  if (remote.pages.project !== preview.pages.project || remote.pages.previewBranch !== preview.pages.branch) throw refusalError('Remote Pages identity differs from the immutable Preview identity.', 'plan.remote-topology')
  if (remote.pages.productionBranch === preview.pages.branch) throw refusalError('Preview branch is configured as the Pages production branch.', 'plan.remote-topology')
  if (remote.worker.name !== preview.worker.name || remote.worker.workersDev !== false || remote.worker.previewUrls !== false
    || !Array.isArray(remote.worker.routes) || remote.worker.routes.length !== 0
    || !Array.isArray(remote.worker.customDomains) || remote.worker.customDomains.length !== 0) {
    throw refusalError('Remote Worker identity or public exposure differs from the immutable Preview topology.', 'plan.remote-topology')
  }
  assertExactBindings(remote.pages.bindings, expectedPagesBindings(preview, remote.pages.submissionMode), 'Pages Preview')
  assertExactBindings(remote.worker.bindings, expectedWorkerBindings(preview, workerFlag(remote, 'DRAFT_SUBMISSION_MODE')), 'Worker Preview')
  if (remote.d1.id !== preview.d1.id || remote.d1.name !== preview.d1.name) throw refusalError('Remote D1 identity differs from the immutable Preview identity.', 'plan.remote-topology')
}

function workerFlag(remote, name) {
  return remote.worker.bindings.find((binding) => binding.type === 'plain_text' && binding.name === name)?.text ?? ''
}

function currentState(remote) {
  const pageMode = remote.pages.submissionMode
  const workerMode = workerFlag(remote, 'DRAFT_SUBMISSION_MODE')
  if (!['enabled', 'disabled'].includes(pageMode) || !['enabled', 'disabled'].includes(workerMode)) throw remoteError('Remote submission gates are missing or malformed.', 'ambiguous_remote_state', 'plan.current-state')
  if (pageMode !== workerMode) throw remoteError('Remote Pages and Worker submission gates disagree.', 'ambiguous_remote_state', 'plan.current-state')
  if (remote.pages.validationMode !== 'enabled' || remote.pages.ticketMode !== 'enabled') throw remoteError('Remote Pages fail-closed gate values are unexpected.', 'ambiguous_remote_state', 'plan.current-state')
  if (workerFlag(remote, 'DRAFT_VALIDATION_MODE') !== 'enabled' || workerFlag(remote, 'DRAFT_TICKET_MODE') !== 'enabled') throw remoteError('Remote Worker fail-closed gate values are unexpected.', 'ambiguous_remote_state', 'plan.current-state')
  if (!Array.isArray(remote.worker.schedules) || remote.worker.schedules.length !== 0) throw remoteError('Remote Worker Cron must remain empty under disabled-only release tooling.', 'ambiguous_remote_state', 'plan.current-state')
  if (pageMode === 'disabled' && remote.worker.schedules.length === 0) return 'disabled'
  throw remoteError('Remote activation state is ambiguous.', 'ambiguous_remote_state', 'plan.current-state')
}

function stage(id, description, approvalRequired = true) {
  return { id, description, approvalRequired }
}

function requiredStages(observedState, { workerArtifactCurrent, pagesArtifactCurrent }) {
  const stages = []
  if (observedState !== 'disabled' || !workerArtifactCurrent) {
    stages.push(stage('worker.deploy', 'Deploy the Preview-only Worker all-disabled configuration.'))
  }
  if (observedState !== 'disabled' || !pagesArtifactCurrent) {
    stages.push(stage('pages.deploy', 'Deploy the Preview-only Pages Functions all-disabled configuration.'))
  }
  return stages
}

export function derivePlanId(planWithoutId) {
  return `pp-preview-${canonicalHash(planWithoutId).slice(0, 24)}`
}

export function buildReleasePlan(input) {
  assertNoReleaseInspectionArtifactForLegacyExecution(input)
  const { manifest, manifestHash, local, serverHead, targetState, compiled, hashes, remote, migration } = immutablePlain(input)
  if (manifest.activation.releaseTooling !== 'disabled-only' || targetState !== 'disabled') {
    throw remoteError('Legacy Preview release planning remains disabled-only; release-inspection evidence grants no execution authority.', 'invalid_target_state', 'plan.target-state')
  }
  if (manifest.toolContractVersion !== PREVIEW_RELEASE_TOOL_CONTRACT_VERSION
    || manifest.activation.canonicalCheckedInState !== 'all-disabled') {
    throw remoteError('Preview release manifest is not the current disabled-only contract.', 'invalid_target_state', 'plan.manifest-contract')
  }
  if (local.head !== serverHead) throw remoteError('Current HEAD differs from server-side develop.', 'server_git_mismatch', 'plan.git-head')
  if (migration.status !== 'valid') throw remoteError(`Migration state is ambiguous: ${migration.reason}`, 'ambiguous_migration_state', 'plan.migrations')
  if (migration.pending.length !== 0) {
    throw remoteError('Pending migrations cannot be planned or packaged by Milestone 3D-1 disabled-only tooling.', 'ambiguous_migration_state', 'plan.migrations')
  }
  assertRemoteTopology(manifest, remote)
  const observedState = currentState(remote)
  const { migrationObservation: _migrationObservation, ...safeRemoteBefore } = remote
  const artifactBasis = {
    repositoryTree: hashes.repositoryTree ?? hashes.source,
    package: hashes.package ?? null,
    lockfile: hashes.lockfile,
    toolchain: hashes.toolchain ?? null,
  }
  const intendedPagesArtifact = canonicalHash({
    ...artifactBasis,
    configuration: compiled.hashes.pages,
    source: hashes.pagesSourceArtifact ?? hashes.source,
    applicationBundle: hashes.appBuildArtifact ?? null,
    functionsBundle: hashes.pagesFunctionsBuildArtifact ?? null,
  })
  const intendedWorkerArtifact = canonicalHash({
    ...artifactBasis,
    configuration: compiled.hashes.worker,
    source: hashes.workerSourceArtifact ?? hashes.source,
    workerBundle: hashes.workerBuildArtifact ?? null,
  })
  const workerArtifactCurrent = false
  const pagesArtifactCurrent = false
  const futureStages = requiredStages(observedState, { workerArtifactCurrent, pagesArtifactCurrent })
  const deploymentChangesRequired = futureStages.some(({ id }) => DEPLOYMENT_STAGE_IDS.has(id))
  const operationalVerificationRequired = false
  const satisfiedStages = [
    stage('checks.offline', 'All local Preview release-readiness checks are satisfied.', false),
    stage('checks.online', 'Server Git and allowlisted Cloudflare Preview reads are satisfied.', false),
    ...(migration.pending.length === 0 ? [stage('migration.current', 'All known Preview migrations are already applied.', false)] : []),
    ...(observedState === targetState ? [stage('topology.target-state', `Remote Preview configuration is already ${targetState}.`, false)] : []),
  ]
  const rollbackImplications = 'No remote rollback is implemented. Milestone 3D-1 cannot plan or apply migrations or enabled state.'
  const executionContract = buildExecutionContract({
    futureStages,
    targetState,
    manifest,
    gitHead: local.head,
    previewOrigin: remote.pages.deployment?.previewOrigin,
  })
  const withoutId = immutablePlain({
    planSchemaVersion: PLAN_SCHEMA_VERSION,
    toolContractVersion: manifest.toolContractVersion,
    manifestContract: {
      schemaVersion: manifest.schemaVersion,
      toolContractVersion: manifest.toolContractVersion,
      capabilityModelVersion: manifest.activation.capabilityModelVersion,
      authoritySchemaVersion: manifest.activation.authoritySchemaVersion,
      maximumReviewWindowMs: manifest.activation.maximumReviewWindowMs,
      canonicalCheckedInState: manifest.activation.canonicalCheckedInState,
      releaseTooling: manifest.activation.releaseTooling,
    },
    repository: {
      root: local.repositoryRoot,
      branch: local.branch,
      upstream: local.upstream,
      divergence: local.divergence,
      remoteUrl: local.remoteUrl,
      cleanWorktreeRequired: true,
      stagedFilesRequired: 0,
    },
    gitHead: local.head,
    serverDevelopHead: serverHead,
    targetState,
    observedState,
    hashes: { ...hashes, manifest: manifestHash, intendedPagesArtifact, intendedWorkerArtifact },
    artifactEvidence: {
      pages: {
        sourceCommitMatches: remote.pages.deployment?.commitHash === local.head,
        intendedHash: intendedPagesArtifact,
        intendedProvenance: 'local-intended-only',
        remoteHash: null,
        provenance: 'unproven',
        provenCurrent: false,
      },
      worker: {
        activeDeploymentId: remote.worker.deploymentId,
        activeVersionId: remote.worker.versionId,
        intendedHash: intendedWorkerArtifact,
        intendedProvenance: 'local-intended-only',
        remoteHash: null,
        provenance: 'unproven',
        provenCurrent: false,
      },
    },
    remoteBefore: safeRemoteBefore,
    migration,
    futureStages,
    satisfiedStages,
    approvalCheckpoints: futureStages.filter(({ approvalRequired }) => approvalRequired).map(({ id }) => id),
    executionContract,
    deploymentOutcome: deploymentChangesRequired ? 'CHANGES-REQUIRED' : 'NO-OP',
    operationalVerificationRequired,
    expectedFinalTopology: {
      accountId: manifest.cloudflare.account.id,
      pagesProject: manifest.cloudflare.preview.pages.project,
      pagesBranch: manifest.cloudflare.preview.pages.branch,
      worker: manifest.cloudflare.preview.worker.name,
      d1: manifest.cloudflare.preview.d1,
      service: manifest.cloudflare.preview.worker.serviceBinding.service,
      pagesBindings: expectedPagesBindings(manifest.cloudflare.preview, 'disabled'),
      workerBindings: expectedWorkerBindings(manifest.cloudflare.preview, 'disabled'),
      workersDev: false, previewUrls: false, routes: [], customDomains: [], targetState,
      cleanupCron: null,
      fingerprints: { pages: intendedPagesArtifact, worker: intendedWorkerArtifact },
    },
    rollbackImplications,
    unresolvedItems: [
      'Applied migration source hashes are not stored by d1_migrations and therefore cannot be compared after application.',
      'Cloudflare does not expose a trusted remote artifact hash matching the local intended artifact fingerprint.',
      'Rollback remains a separately planned disabled-state release; D1 migrations are forward-only.',
    ],
    noRemoteMutation: true,
    phase: 2,
    outcome: futureStages.length === 0 ? 'NO-OP' : 'PLAN',
    statement: 'Planning performed no remote mutation. Execution requires a fresh exact re-plan and interactive approval.',
  })
  return assertCurrentDisabledReleasePlan({ ...withoutId, planId: derivePlanId(withoutId) })
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort())
}

function assertExactDisabledBindingInventory(bindings, label, topology, surface) {
  if (!Array.isArray(bindings)) throw refusalError(`${label} bindings are malformed.`, 'plan.disabled-boundary')
  const plainText = surface === 'pages' ? PAGES_PLAIN_TEXT_BINDINGS : WORKER_PLAIN_TEXT_BINDINGS
  const expectedIdentities = [
    `d1:${topology.d1.binding}`,
    ...Object.keys(plainText).map((name) => `plain_text:${name}`),
    ...(surface === 'pages'
      ? ['service:VALIDATION_SERVICE']
      : ['ratelimit:RATE_LIMIT_BURST', 'ratelimit:RATE_LIMIT_SUSTAINED']),
  ].sort()
  const actualIdentities = bindings.map((binding) => `${binding?.type}:${binding?.name}`).sort()
  if (canonicalJson(actualIdentities) !== canonicalJson(expectedIdentities)) {
    throw refusalError(`${label} bindings differ from the exact disabled-only inventory.`, 'plan.disabled-boundary')
  }
  const seen = new Set()
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || typeof binding.name !== 'string' || typeof binding.type !== 'string') {
      throw refusalError(`${label} bindings are malformed.`, 'plan.disabled-boundary')
    }
    const identity = `${binding.type}:${binding.name}`
    if (seen.has(identity)) throw refusalError(`${label} bindings contain a duplicate.`, 'plan.disabled-boundary')
    seen.add(identity)
    if (binding.type === 'plain_text') {
      if (!exactKeys(binding, ['name', 'text', 'type']) || binding.text !== plainText[binding.name]) {
        throw refusalError(`${label} variable ${binding.name} differs from the exact disabled-only value.`, 'plan.disabled-boundary')
      }
    } else if (binding.type === 'd1') {
      if (!exactKeys(binding, ['id', 'name', 'type'])
        || binding.name !== topology.d1.binding || binding.id !== topology.d1.id) {
        throw refusalError(`${label} D1 binding differs from the exact Preview identity.`, 'plan.disabled-boundary')
      }
    } else if (binding.type === 'service') {
      if (surface !== 'pages' || !exactKeys(binding, ['environment', 'name', 'service', 'type'])
        || binding.name !== 'VALIDATION_SERVICE' || binding.service !== topology.service
        || binding.environment !== '') {
        throw refusalError(`${label} Service Binding differs from the exact Preview identity.`, 'plan.disabled-boundary')
      }
    } else if (binding.type === 'ratelimit') {
      if (surface !== 'worker' || !exactKeys(binding, ['name', 'namespaceId', 'type'])
        || !/^\d{1,20}$/.test(binding.namespaceId)) {
        throw refusalError(`${label} rate-limit binding is malformed.`, 'plan.disabled-boundary')
      }
    } else {
      throw refusalError(`${label} contains an unsupported binding type.`, 'plan.disabled-boundary')
    }
  }
}

function assertNoHiddenEnabledConfiguration(value, trail = '$') {
  if (value === 'enabled') {
    if (trail === '$.remoteBefore.pages.validationMode' || trail === '$.remoteBefore.pages.ticketMode') return
    throw refusalError(`Release plan contains hidden enabled configuration at ${trail}.`, 'plan.disabled-boundary')
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoHiddenEnabledConfiguration(entry, `${trail}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  const isAllowedCompatibilityBinding = /bindings\[\d+\]$/i.test(trail)
    && value.type === 'plain_text'
    && ['DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE'].includes(value.name)
  for (const [key, entry] of Object.entries(value)) {
    if (isAllowedCompatibilityBinding && key === 'text' && entry === 'enabled') continue
    assertNoHiddenEnabledConfiguration(entry, `${trail}.${key}`)
  }
}

export function assertCurrentDisabledReleasePlan(input) {
  assertNoReleaseInspectionArtifactForLegacyExecution(input)
  let plan
  try {
    plan = immutablePlain(input)
  } catch (error) {
    throw refusalError(
      `Release plan must be immutable plain data: ${error instanceof Error ? error.message : 'unknown value'}.`,
      'plan.schema',
    )
  }
  const topLevelKeys = [
    'approvalCheckpoints', 'artifactEvidence', 'deploymentOutcome', 'executionContract',
    'expectedFinalTopology', 'futureStages', 'gitHead', 'hashes', 'manifestContract', 'migration',
    'noRemoteMutation', 'observedState', 'operationalVerificationRequired', 'outcome', 'phase',
    'planId', 'planSchemaVersion', 'remoteBefore', 'repository', 'rollbackImplications',
    'satisfiedStages', 'serverDevelopHead', 'statement', 'targetState', 'toolContractVersion',
    'unresolvedItems',
  ]
  const exactManifestContract = {
    schemaVersion: 2,
    toolContractVersion: PREVIEW_RELEASE_TOOL_CONTRACT_VERSION,
    capabilityModelVersion: 2,
    authoritySchemaVersion: 1,
    maximumReviewWindowMs: 86_400_000,
    canonicalCheckedInState: 'all-disabled',
    releaseTooling: 'disabled-only',
  }
  if (!exactKeys(plan, topLevelKeys)
    || plan.planSchemaVersion !== PLAN_SCHEMA_VERSION
    || plan.toolContractVersion !== PREVIEW_RELEASE_TOOL_CONTRACT_VERSION
    || plan.targetState !== 'disabled'
    || plan.observedState !== 'disabled'
    || canonicalJson(plan.manifestContract) !== canonicalJson(exactManifestContract)
    || plan.operationalVerificationRequired !== false
    || plan.noRemoteMutation !== true
    || plan.expectedFinalTopology?.targetState !== 'disabled'
    || plan.expectedFinalTopology?.cleanupCron !== null
    || !Array.isArray(plan.remoteBefore?.worker?.schedules)
    || plan.remoteBefore.worker.schedules.length !== 0
    || plan.migration?.status !== 'valid'
    || !Array.isArray(plan.migration.pending)
    || plan.migration.pending.length !== 0) {
    throw refusalError('Release plan is not the exact current disabled-only schema.', 'plan.schema')
  }
  if (!exactKeys(plan.expectedFinalTopology, [
    'accountId', 'cleanupCron', 'customDomains', 'd1', 'fingerprints', 'pagesBindings',
    'pagesBranch', 'pagesProject', 'previewUrls', 'routes', 'service', 'targetState',
    'worker', 'workerBindings', 'workersDev',
  ]) || !exactKeys(plan.expectedFinalTopology.d1, ['binding', 'id', 'name'])
    || !exactKeys(plan.expectedFinalTopology.fingerprints, ['pages', 'worker'])
    || !exactKeys(plan.remoteBefore, ['accountId', 'd1', 'pages', 'schemaVersion', 'worker'])
    || !exactKeys(plan.remoteBefore.pages, [
      'artifactHash', 'bindings', 'configHash', 'deployment', 'previewBranch', 'productionBranch',
      'project', 'submissionMode', 'ticketMode', 'validationMode',
    ])
    || !exactKeys(plan.remoteBefore.worker, [
      'artifactHash', 'artifactProvenance', 'bindings', 'customDomains', 'deploymentId', 'name',
      'previewUrls', 'routes', 'schedules', 'versionId', 'workersDev',
    ])) {
    throw refusalError('Release plan contains hidden or unsupported topology configuration.', 'plan.schema')
  }
  if (!Array.isArray(plan.futureStages)
    || plan.futureStages.some((entry) => !exactKeys(entry, ['approvalRequired', 'description', 'id'])
      || !DEPLOYMENT_STAGE_IDS.has(entry.id)
      || entry.approvalRequired !== true
      || entry.description !== CURRENT_STAGE_DESCRIPTIONS[entry.id])
    || canonicalJson(plan.futureStages.map(({ id }) => id))
      !== canonicalJson(['worker.deploy', 'pages.deploy'].filter((id) => plan.futureStages.some((entry) => entry.id === id)))) {
    throw refusalError('Release plan contains a legacy or unsupported stage.', 'plan.schema')
  }
  if (canonicalJson(plan.approvalCheckpoints) !== canonicalJson(plan.futureStages.map(({ id }) => id))) {
    throw refusalError('Release plan approval checkpoints do not match disabled-only stages.', 'plan.schema')
  }
  assertExactDisabledBindingInventory(plan.expectedFinalTopology.pagesBindings, 'Expected Pages', plan.expectedFinalTopology, 'pages')
  assertExactDisabledBindingInventory(plan.expectedFinalTopology.workerBindings, 'Expected Worker', plan.expectedFinalTopology, 'worker')
  assertExactDisabledBindingInventory(plan.remoteBefore.pages.bindings, 'Observed Pages', plan.expectedFinalTopology, 'pages')
  assertExactDisabledBindingInventory(plan.remoteBefore.worker.bindings, 'Observed Worker', plan.expectedFinalTopology, 'worker')
  assertExactBindings(plan.remoteBefore.pages.bindings, plan.expectedFinalTopology.pagesBindings, 'Plan Pages')
  assertExactBindings(plan.remoteBefore.worker.bindings, plan.expectedFinalTopology.workerBindings, 'Plan Worker')
  assertNoHiddenEnabledConfiguration(plan)
  assertCurrentDisabledExecutionContract(plan.executionContract)
  const expectedExecutionContract = buildExecutionContract({
    futureStages: plan.futureStages,
    targetState: 'disabled',
    manifest: {
      schemaVersion: plan.manifestContract.schemaVersion,
      toolContractVersion: plan.manifestContract.toolContractVersion,
      activation: {
        releaseTooling: plan.manifestContract.releaseTooling,
        canonicalCheckedInState: plan.manifestContract.canonicalCheckedInState,
      },
      cloudflare: {
        account: { id: plan.expectedFinalTopology.accountId },
        preview: {
          pages: {
            project: plan.expectedFinalTopology.pagesProject,
            branch: plan.expectedFinalTopology.pagesBranch,
          },
          worker: { name: plan.expectedFinalTopology.worker },
          d1: plan.expectedFinalTopology.d1,
        },
      },
    },
    gitHead: plan.gitHead,
    previewOrigin: plan.remoteBefore.pages.deployment?.previewOrigin,
  })
  assertExecutionContract(plan.executionContract, expectedExecutionContract)
  const { planId, ...withoutId } = plan
  if (typeof planId !== 'string' || derivePlanId(withoutId) !== planId) {
    throw refusalError('Release plan ID is invalid.', 'plan.plan-id')
  }
  return plan
}
