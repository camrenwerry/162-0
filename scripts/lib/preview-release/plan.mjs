import { canonicalHash, immutablePlain } from './canonical.mjs'
import { assertExactBindings, expectedPagesBindings, expectedWorkerBindings } from './binding-inventory.mjs'
import { refusalError, remoteError } from './errors.mjs'

const PLAN_SCHEMA_VERSION = 2
const DEPLOYMENT_STAGE_IDS = new Set(['pages.disable', 'cron.disable', 'migration.apply', 'worker.deploy', 'pages.deploy', 'cron.deploy'])

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

function currentState(remote, approvedCron) {
  const pageMode = remote.pages.submissionMode
  const workerMode = workerFlag(remote, 'DRAFT_SUBMISSION_MODE')
  if (!['enabled', 'disabled'].includes(pageMode) || !['enabled', 'disabled'].includes(workerMode)) throw remoteError('Remote submission gates are missing or malformed.', 'ambiguous_remote_state', 'plan.current-state')
  if (pageMode !== workerMode) throw remoteError('Remote Pages and Worker submission gates disagree.', 'ambiguous_remote_state', 'plan.current-state')
  if (remote.pages.validationMode !== 'enabled' || remote.pages.ticketMode !== 'enabled') throw remoteError('Remote Pages fail-closed gate values are unexpected.', 'ambiguous_remote_state', 'plan.current-state')
  if (workerFlag(remote, 'DRAFT_VALIDATION_MODE') !== 'enabled' || workerFlag(remote, 'DRAFT_TICKET_MODE') !== 'enabled') throw remoteError('Remote Worker fail-closed gate values are unexpected.', 'ambiguous_remote_state', 'plan.current-state')
  if (!Array.isArray(remote.worker.schedules) || remote.worker.schedules.some((cron) => cron !== approvedCron) || remote.worker.schedules.length > 1) throw remoteError('Remote Worker Cron state is not one approved state.', 'ambiguous_remote_state', 'plan.current-state')
  if (pageMode === 'disabled' && remote.worker.schedules.length === 0) return 'disabled'
  if (pageMode === 'enabled' && remote.worker.schedules.length === 0) return 'submission-enabled'
  if (pageMode === 'enabled' && remote.worker.schedules.length === 1) return 'cron-enabled'
  throw remoteError('Remote activation state is ambiguous.', 'ambiguous_remote_state', 'plan.current-state')
}

function stage(id, description, approvalRequired = true) {
  return { id, description, approvalRequired }
}

function requiredStages(targetState, observedState, migration, { workerArtifactCurrent, pagesArtifactCurrent }) {
  const stages = []
  const pendingMigration = migration.pending.length > 0
  const observedSubmissions = observedState !== 'disabled'
  const observedCron = observedState === 'cron-enabled'

  if (pendingMigration && observedSubmissions) {
    if (observedCron) stages.push(stage('cron.disable', 'Deploy the reviewed Preview Worker configuration with Cron disabled before maintenance.'))
    stages.push(stage('pages.disable', 'Deploy the reviewed Preview Pages configuration with the public submission gate disabled.'))
    stages.push(stage('submission.disable.verify', 'Verify through a separately authorized future check that the public Preview submission gate is disabled.'))
  }
  if (pendingMigration) stages.push(stage('migration.apply', 'Apply the reviewed pending Preview D1 migration suffix after write-disable verification.'))

  if (targetState === 'disabled') {
    if (!pendingMigration && observedSubmissions) {
      stages.push(stage('pages.disable', 'Deploy the reviewed Preview Pages configuration with the public submission gate disabled.'))
    }
    if (observedState !== 'disabled' || !workerArtifactCurrent || pendingMigration) stages.push(stage('worker.deploy', 'Deploy the Preview-only Worker disabled configuration.'))
    if ((!observedSubmissions && !pagesArtifactCurrent) || (pendingMigration && !observedSubmissions)) stages.push(stage('pages.deploy', 'Deploy the Preview-only Pages disabled configuration.'))
    return stages
  }

  const maintenance = pendingMigration && observedSubmissions
  const workerNeedsSubmissionDeploy = maintenance || pendingMigration || observedState === 'disabled' || !workerArtifactCurrent
  if (workerNeedsSubmissionDeploy) stages.push(stage('worker.deploy', 'Deploy the Preview-only submission-enabled Worker configuration with Cron absent.'))
  const pagesNeedsDeploy = maintenance || observedState === 'disabled' || !pagesArtifactCurrent
  if (pagesNeedsDeploy) stages.push(stage('pages.deploy', 'Deploy the Preview-only Pages submission gate as enabled.'))
  if (targetState === 'submission-enabled' && observedCron && !maintenance && !workerNeedsSubmissionDeploy) stages.push(stage('worker.deploy', 'Deploy the Preview-only submission-enabled Worker configuration with Cron absent.'))
  stages.push(stage('submission.smoke', 'Run the separately authorized future Preview submission smoke test; Phase 1 has no trusted receipt proof.'))

  if (targetState === 'cron-enabled') {
    if (observedState !== 'cron-enabled' || maintenance || pendingMigration || !workerArtifactCurrent) stages.push(stage('cron.deploy', 'Deploy the Preview-only cron-enabled Worker configuration after submission verification.'))
    stages.push(stage('retention.smoke', 'Run the separately authorized future Preview retention smoke test; Phase 1 has no trusted receipt proof.'))
  }
  return stages
}

export function derivePlanId(planWithoutId) {
  return `pp-preview-${canonicalHash(planWithoutId).slice(0, 24)}`
}

export function buildReleasePlan(input) {
  const { manifest, manifestHash, local, serverHead, targetState, compiled, hashes, remote, migration } = immutablePlain(input)
  if (!manifest.activation.allowedStates.includes(targetState)) throw remoteError(`Unknown target state ${targetState}.`, 'invalid_target_state', 'plan.target-state')
  if (local.head !== serverHead) throw remoteError('Current HEAD differs from server-side develop.', 'server_git_mismatch', 'plan.git-head')
  if (migration.status !== 'valid') throw remoteError(`Migration state is ambiguous: ${migration.reason}`, 'ambiguous_migration_state', 'plan.migrations')
  assertRemoteTopology(manifest, remote)
  const observedState = currentState(remote, manifest.activation.cleanupCron)
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
  const futureStages = requiredStages(targetState, observedState, migration, { workerArtifactCurrent, pagesArtifactCurrent })
  const deploymentChangesRequired = futureStages.some(({ id }) => DEPLOYMENT_STAGE_IDS.has(id))
  const operationalVerificationRequired = futureStages.some(({ id }) => ['submission.smoke', 'retention.smoke', 'submission.disable.verify'].includes(id))
  const satisfiedStages = [
    stage('checks.offline', 'All local Preview release-readiness checks are satisfied.', false),
    stage('checks.online', 'Server Git and allowlisted Cloudflare Preview reads are satisfied.', false),
    ...(migration.pending.length === 0 ? [stage('migration.current', 'All known Preview migrations are already applied.', false)] : []),
    ...(observedState === targetState ? [stage('topology.target-state', `Remote Preview configuration is already ${targetState}.`, false)] : []),
  ]
  const rollbackImplications = targetState === 'disabled'
    ? 'No remote rollback is implemented. Applied D1 migrations remain forward-only.'
    : 'A future rollback must disable the public Pages gate before reducing Worker state; D1 has no automatic down-migration.'
  const withoutId = immutablePlain({
    planSchemaVersion: PLAN_SCHEMA_VERSION,
    toolContractVersion: manifest.toolContractVersion,
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
    deploymentOutcome: deploymentChangesRequired ? 'CHANGES-REQUIRED' : 'NO-OP',
    operationalVerificationRequired,
    expectedFinalTopology: {
      accountId: manifest.cloudflare.account.id,
      pagesProject: manifest.cloudflare.preview.pages.project,
      pagesBranch: manifest.cloudflare.preview.pages.branch,
      worker: manifest.cloudflare.preview.worker.name,
      d1: manifest.cloudflare.preview.d1,
      service: manifest.cloudflare.preview.worker.serviceBinding.service,
      pagesBindings: expectedPagesBindings(manifest.cloudflare.preview, targetState === 'disabled' ? 'disabled' : 'enabled'),
      workerBindings: expectedWorkerBindings(manifest.cloudflare.preview, targetState === 'disabled' ? 'disabled' : 'enabled'),
      workersDev: false, previewUrls: false, routes: [], customDomains: [], targetState,
      fingerprints: { pages: intendedPagesArtifact, worker: intendedWorkerArtifact },
    },
    rollbackImplications,
    unresolvedItems: [
      'Applied migration source hashes are not stored by d1_migrations and therefore cannot be compared after application.',
      'Phase 1 has no trusted durable smoke receipt; enabled states retain future operational verification stages.',
      'Phase 1 does not implement release, rollback, deployment, migration application, or smoke execution.',
    ],
    noRemoteMutation: true,
    phase: 1,
    outcome: futureStages.length === 0 ? 'NO-OP' : 'PLAN',
    statement: 'Phase 1 performed no remote mutation.',
  })
  return immutablePlain({ ...withoutId, planId: derivePlanId(withoutId) })
}
