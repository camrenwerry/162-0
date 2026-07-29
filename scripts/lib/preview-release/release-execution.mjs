import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateReleasePackage } from './artifacts.mjs'
import { canonicalJson, immutablePlain } from './canonical.mjs'
import { createReadOnlyCloudflareClient, inspectPreviewRemoteState } from './cloudflare-readonly.mjs'
import { validateConfigurationModel } from './configuration.mjs'
import {
  buildExecutionContract,
  PREVIEW_DEPLOY_CREDENTIAL,
  PREVIEW_READ_CREDENTIAL,
  stageCommandText,
} from './execution-contract.mjs'
import { asWorkflowError, EXIT_CODES, localError, refusalError, remoteError } from './errors.mjs'
import { loadReleaseManifest } from './manifest.mjs'
import { classifyMigrationState, loadRepositoryMigrations } from './migrations.mjs'
import { redactText } from './redaction.mjs'
import { executionReport, validationReport } from './reporting.mjs'
import { createPreviewPlan } from '../../preview-plan.mjs'

const GENERIC_CREDENTIALS = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CF_API_TOKEN',
  'CF_API_KEY',
  'CF_EMAIL',
  'WRANGLER_OAUTH_TOKEN',
])

const SAFE_CHILD_ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR', 'FORCE_COLOR',
])

function exactToken(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.length < 20 || value.length > 4_096 || /[\u0000-\u0020\u007F]/u.test(value)) {
    throw refusalError(`${name} must contain one dedicated non-whitespace Preview credential.`, 'execution.credentials')
  }
  return value
}

export function validateExecutionEnvironment(environment = process.env, {
  stdinIsTTY = process.stdin.isTTY,
  stdoutIsTTY = process.stdout.isTTY,
  requireInteractive = true,
} = {}) {
  for (const name of GENERIC_CREDENTIALS) {
    if (typeof environment[name] === 'string' && environment[name].length > 0) {
      throw refusalError(`Generic or Production-capable credential ${name} is prohibited in the release parent environment.`, 'execution.credentials')
    }
  }
  const readToken = exactToken(environment, PREVIEW_READ_CREDENTIAL)
  const deployToken = exactToken(environment, PREVIEW_DEPLOY_CREDENTIAL)
  if (readToken === deployToken) {
    throw refusalError('Preview read and deploy credentials must be distinct.', 'execution.credentials')
  }
  if (environment.CI && environment.CI.toLowerCase() !== 'false') {
    throw refusalError('Preview release execution is prohibited in CI.', 'execution.approval')
  }
  if (requireInteractive && (!stdinIsTTY || !stdoutIsTTY)) {
    throw refusalError('Preview release execution requires an interactive input and output TTY.', 'execution.approval')
  }
  return Object.freeze({ readToken, deployToken })
}

function childEnvironment(environment, deployToken, accountId) {
  return Object.freeze({
    ...Object.fromEntries(SAFE_CHILD_ENVIRONMENT_KEYS
      .filter((key) => typeof environment[key] === 'string')
      .map((key) => [key, environment[key]])),
    CLOUDFLARE_API_TOKEN: deployToken,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_HIDE_BANNER: 'true',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
  })
}

function copyDirectory(source, destination) {
  if (!existsSync(source)) throw localError(`Required release input is missing: ${source}.`, 'execution.workspace')
  cpSync(source, destination, { recursive: true, dereference: false, errorOnExist: true })
}

export function createReleaseWorkspace(repositoryRoot, compiledStates) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'pennant-pursuit-preview-release-'))
  try {
    copyDirectory(path.join(repositoryRoot, 'dist'), path.join(workspace, 'dist'))
    copyDirectory(path.join(repositoryRoot, 'functions'), path.join(workspace, 'functions'))
    copyDirectory(path.join(repositoryRoot, 'src'), path.join(workspace, 'src'))
    copyDirectory(path.join(repositoryRoot, 'migrations'), path.join(workspace, 'migrations'))
    mkdirSync(path.join(workspace, 'workers/draft-validation'), { recursive: true, mode: 0o700 })
    copyDirectory(
      path.join(repositoryRoot, 'workers/draft-validation/src'),
      path.join(workspace, 'workers/draft-validation/src'),
    )
    for (const [state, compiled] of Object.entries(compiledStates)) {
      writeFileSync(
        path.join(workspace, 'workers/draft-validation', `wrangler-${state}.toml`),
        compiled.workerConfig,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
    }
    return workspace
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true })
    throw error
  }
}

function materializePagesConfiguration(workspace, compiledStates, state) {
  const compiled = compiledStates[state]
  if (!compiled) throw localError(`Unknown compiled Preview state ${state}.`, 'execution.configuration')
  writeFileSync(path.join(workspace, 'wrangler.toml'), compiled.pagesConfig, {
    encoding: 'utf8',
    flag: existsSync(path.join(workspace, 'wrangler.toml')) ? 'w' : 'wx',
    mode: 0o600,
  })
}

function stageWorkingDirectory(stage, repositoryRoot, workspace) {
  if (stage.cwd === 'repository') return repositoryRoot
  if (stage.cwd === 'release-workspace') return workspace
  throw refusalError(`Unapproved command working-directory role ${stage.cwd}.`, 'execution.command-list')
}

function executeFixedCommand(stage, {
  repositoryRoot,
  workspace,
  environment,
  deployToken,
  accountId,
  spawn = spawnSync,
  compiledStates,
}) {
  if (stage.kind !== 'command') throw localError('Only command stages can spawn a process.', 'execution.command-list')
  if (stage.configurationState !== null) materializePagesConfiguration(workspace, compiledStates, stage.configurationState)
  const executable = stage.executable === 'wrangler'
    ? path.join(repositoryRoot, 'node_modules/.bin/wrangler')
    : stage.executable === 'node'
      ? process.execPath
      : null
  if (!executable) throw refusalError(`Unapproved executable ${stage.executable}.`, 'execution.command-list')
  return spawn(executable, stage.args, {
    cwd: stageWorkingDirectory(stage, repositoryRoot, workspace),
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnvironment(environment, deployToken, accountId),
    timeout: stage.id === 'retention.smoke' ? 3 * 60 * 60 * 1_000 : 20 * 60 * 1_000,
  })
}

function summarizeProcessResult(result, sensitiveValues) {
  const output = [result?.stdout, result?.stderr]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join('\n')
  const redacted = redactText(output, sensitiveValues)
  return {
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    outputTail: redacted.slice(-4_096),
  }
}

function assertCommandSucceeded(stage, result) {
  if (result?.error) throw remoteError(`${stage.id} could not start: ${result.error.message}`, 'partial_execution', `execution.${stage.id}`)
  if (result?.signal) throw remoteError(`${stage.id} ended with signal ${result.signal}.`, 'partial_execution', `execution.${stage.id}`)
  if (result?.status !== 0) throw remoteError(`${stage.id} exited with status ${result?.status ?? 'unknown'}.`, 'partial_execution', `execution.${stage.id}`)
}

function expectedMode(targetState) {
  return targetState === 'disabled' ? 'disabled' : 'enabled'
}

function assertStageRemoteValidation(stage, remote, releasePackage, migration) {
  const targetState = releasePackage.plan.targetState
  if (stage.validation === 'worker-cron-disabled' && remote.worker.schedules.length !== 0) {
    throw remoteError('Worker Cron remained enabled after the approved disable stage.', 'partial_execution', `execution.${stage.id}`)
  }
  if (stage.validation === 'worker-cron-enabled'
    && canonicalJson(remote.worker.schedules) !== canonicalJson([releasePackage.plan.expectedFinalTopology.cleanupCron])) {
    throw remoteError('Worker Cron did not reach the approved enabled state.', 'partial_execution', `execution.${stage.id}`)
  }
  if (stage.validation === 'pages-submission-disabled' && remote.pages.submissionMode !== 'disabled') {
    throw remoteError('Pages submission gate remained enabled after the approved disable stage.', 'partial_execution', `execution.${stage.id}`)
  }
  if (stage.validation === 'preview-migrations-current' && migration.pending.length !== 0) {
    throw remoteError('Preview migrations remain pending after the approved migration stage.', 'partial_execution', `execution.${stage.id}`)
  }
  if (stage.validation === 'worker-target-configuration') {
    if (remote.worker.bindings.find(({ name }) => name === 'DRAFT_SUBMISSION_MODE')?.text !== expectedMode(targetState)) {
      throw remoteError('Worker submission mode differs from the approved target.', 'partial_execution', `execution.${stage.id}`)
    }
    if (remote.worker.schedules.length !== 0) {
      throw remoteError('Intermediate Worker deployment unexpectedly enabled Cron.', 'partial_execution', `execution.${stage.id}`)
    }
  }
  if (stage.validation === 'pages-target-configuration' && remote.pages.submissionMode !== expectedMode(targetState)) {
    throw remoteError('Pages submission mode differs from the approved target.', 'partial_execution', `execution.${stage.id}`)
  }
}

function withoutMigrationObservation(remote) {
  const { migrationObservation: _migrationObservation, ...safeRemote } = remote
  return immutablePlain(safeRemote)
}

function assertPreStageRemoteState(stage, {
  remote,
  migration,
  latestRemote,
  latestMigration,
  releasePackage,
}) {
  const expectedRemote = latestRemote === null
    ? releasePackage.plan.remoteBefore
    : latestRemote
  const actualRemote = latestRemote === null
    ? withoutMigrationObservation(remote)
    : remote
  const expectedMigration = latestMigration ?? releasePackage.plan.migration
  if (canonicalJson(actualRemote) !== canonicalJson(expectedRemote)
    || canonicalJson(migration) !== canonicalJson(expectedMigration)) {
    throw refusalError(
      `Preview remote state changed before stage ${stage.id}; generate and approve a fresh plan.`,
      `execution.${stage.id}.precondition`,
    )
  }
}

function stageTransitionProjection(remote, stage) {
  const projected = structuredClone(remote)
  if (['cron.disable', 'worker.deploy', 'cron.deploy'].includes(stage.id)) {
    projected.worker.bindings = '[APPROVED WORKER TRANSITION]'
    projected.worker.deploymentId = '[APPROVED WORKER TRANSITION]'
    projected.worker.schedules = '[APPROVED WORKER TRANSITION]'
    projected.worker.versionId = '[APPROVED WORKER TRANSITION]'
  } else if (['pages.disable', 'pages.deploy'].includes(stage.id)) {
    projected.pages.bindings = '[APPROVED PAGES TRANSITION]'
    projected.pages.deployment = '[APPROVED PAGES TRANSITION]'
    projected.pages.submissionMode = '[APPROVED PAGES TRANSITION]'
  } else if (stage.id === 'migration.apply') {
    projected.migrationObservation = '[APPROVED MIGRATION TRANSITION]'
  }
  return immutablePlain(projected)
}

function assertAllowedStageTransition(stage, before, after) {
  if (canonicalJson(stageTransitionProjection(before, stage))
    !== canonicalJson(stageTransitionProjection(after, stage))) {
    throw remoteError(
      `Stage ${stage.id} changed remote state outside its exact approved mutation boundary.`,
      'partial_execution',
      `execution.${stage.id}.mutation-boundary`,
    )
  }
}

function finalChecks(releasePackage, remote, migration, stageResults) {
  const targetState = releasePackage.plan.targetState
  const targetMode = expectedMode(targetState)
  const workerMode = remote.worker.bindings.find(({ name }) => name === 'DRAFT_SUBMISSION_MODE')?.text
  const requiredCron = targetState === 'cron-enabled'
  const completed = new Set(stageResults.filter(({ status }) => status === 'PASS').map(({ id }) => id))
  const checks = [
    { id: 'plan.binding', status: 'PASS', summary: 'Fresh plan exactly matched the approved package.' },
    { id: 'configuration.protected', status: 'PASS', summary: 'Protected configuration hashes matched the approved package.' },
    {
      id: 'remote.target-state',
      status: remote.pages.submissionMode === targetMode
        && workerMode === targetMode
        && (requiredCron
          ? canonicalJson(remote.worker.schedules) === canonicalJson([releasePackage.plan.expectedFinalTopology.cleanupCron])
          : remote.worker.schedules.length === 0) ? 'PASS' : 'FAIL',
      summary: 'Pages, Worker, and Cron state match the approved Preview target.',
    },
    {
      id: 'remote.migrations',
      status: migration.status === 'valid' && migration.pending.length === 0 ? 'PASS' : 'FAIL',
      summary: 'Preview migration metadata is valid and current.',
    },
    {
      id: 'remote.pages-commit',
      status: remote.pages.deployment?.commitHash === releasePackage.plan.gitHead ? 'PASS' : 'FAIL',
      summary: 'Latest Preview Pages deployment is bound to the approved commit.',
    },
    {
      id: 'remote.deployment-identities',
      status: (!completed.has('pages.deploy')
          || remote.pages.deployment?.id !== releasePackage.plan.remoteBefore.pages.deployment?.id)
        && (!completed.has('worker.deploy') && !completed.has('cron.deploy') && !completed.has('cron.disable')
          || remote.worker.deploymentId !== releasePackage.plan.remoteBefore.worker.deploymentId
          || remote.worker.versionId !== releasePackage.plan.remoteBefore.worker.versionId) ? 'PASS' : 'FAIL',
      summary: 'Required deployments produced new authoritative Preview deployment identities.',
    },
    {
      id: 'validation.required-smoke',
      status: releasePackage.plan.futureStages
        .filter(({ id }) => ['submission.smoke', 'retention.smoke'].includes(id))
        .every(({ id }) => completed.has(id)) ? 'PASS' : 'FAIL',
      summary: 'Every smoke stage required by the approved target completed.',
    },
    { id: 'production.prohibited', status: 'PASS', summary: 'No Production operation was available to the executor.' },
  ]
  return validationReport(checks)
}

function iso(now) {
  return new Date(now()).toISOString()
}

export async function executeReleasePackage(releasePackage, {
  repositoryRoot,
  environment = process.env,
  stdinIsTTY = process.stdin.isTTY,
  stdoutIsTTY = process.stdout.isTTY,
  requireInteractive = true,
  approve,
  runner,
  processRunner,
  client,
  fetchImplementation,
  output = console,
  runQualityStages = true,
  spawn = spawnSync,
  now = Date.now,
  createPlan = createPreviewPlan,
  loadManifest = loadReleaseManifest,
  compileConfiguration = validateConfigurationModel,
  inspectRemote = inspectPreviewRemoteState,
  loadMigrations = loadRepositoryMigrations,
  classifyMigrations = classifyMigrationState,
  createWorkspace = createReleaseWorkspace,
} = {}) {
  const startedAt = iso(now)
  const stageResults = []
  let mutationAttempted = false
  let workspace = null
  let releaseError = null
  let finalValidation = validationReport([])
  let status = 'FAIL'
  let credentials
  let loaded
  let readOnlyClient
  let knownMigrations
  try {
    credentials = validateExecutionEnvironment(environment, { stdinIsTTY, stdoutIsTTY, requireInteractive })
    loaded = loadManifest(repositoryRoot)
    const expectedContract = buildExecutionContract({
      futureStages: releasePackage.plan.futureStages,
      targetState: releasePackage.plan.targetState,
      manifest: loaded.manifest,
      gitHead: releasePackage.plan.gitHead,
      previewOrigin: releasePackage.plan.remoteBefore.pages.deployment.previewOrigin,
    })
    validateReleasePackage(releasePackage, {
      nowMs: now(),
      expectedExecutionContract: expectedContract,
      requireUnexpired: true,
    })
    readOnlyClient = client ?? createReadOnlyCloudflareClient({
      manifest: loaded.manifest,
      token: credentials.readToken,
      fetchImplementation,
    })
    const freshPlan = await createPlan({
      repositoryRoot,
      targetState: releasePackage.plan.targetState,
      token: credentials.readToken,
      runner,
      processRunner,
      client: readOnlyClient,
      output,
      captureStages: true,
      runQualityStages,
      color: false,
    })
    if (canonicalJson(freshPlan) !== canonicalJson(releasePackage.plan)) {
      throw refusalError('Fresh readiness plan differs from the approved package; the package is stale.', 'execution.plan-drift')
    }
    if (typeof approve !== 'function') throw localError('Interactive approval provider is unavailable.', 'execution.approval')
    const approved = await approve(releasePackage.approval.challenge)
    if (approved !== releasePackage.approval.challenge) {
      throw refusalError('Interactive approval challenge did not match exactly.', 'execution.approval')
    }
    const postApprovalPlan = await createPlan({
      repositoryRoot,
      targetState: releasePackage.plan.targetState,
      token: credentials.readToken,
      runner,
      processRunner,
      client: readOnlyClient,
      output,
      captureStages: true,
      runQualityStages: false,
      color: false,
    })
    if (canonicalJson(postApprovalPlan) !== canonicalJson(releasePackage.plan)) {
      throw refusalError('Readiness plan changed while approval was pending; the package is stale.', 'execution.plan-drift')
    }
    validateReleasePackage(releasePackage, {
      nowMs: now(),
      expectedExecutionContract: expectedContract,
      requireUnexpired: true,
    })
    const compiledStates = compileConfiguration(repositoryRoot, loaded.manifest)
    workspace = createWorkspace(repositoryRoot, compiledStates)
    knownMigrations = loadMigrations(repositoryRoot, loaded.manifest.configuration.migrationsDirectory)
    let latestRemote = null
    let latestMigration = null
    for (const stage of releasePackage.plan.executionContract.orderedStages) {
      const started = iso(now)
      let processSummary = null
      try {
        const beforeStageRemote = await inspectRemote({ manifest: loaded.manifest, client: readOnlyClient })
        const beforeStageMigration = classifyMigrations({
          knownMigrations,
          ...beforeStageRemote.migrationObservation,
        })
        assertPreStageRemoteState(stage, {
          remote: beforeStageRemote,
          migration: beforeStageMigration,
          latestRemote,
          latestMigration,
          releasePackage,
        })
        latestRemote = beforeStageRemote
        latestMigration = beforeStageMigration
        if (stage.kind === 'command') {
          mutationAttempted = true
          const result = executeFixedCommand(stage, {
            repositoryRoot,
            workspace,
            environment,
            deployToken: credentials.deployToken,
            accountId: loaded.manifest.cloudflare.account.id,
            spawn,
            compiledStates,
          })
          processSummary = summarizeProcessResult(result, [credentials.readToken, credentials.deployToken])
          assertCommandSucceeded(stage, result)
          latestRemote = await inspectRemote({ manifest: loaded.manifest, client: readOnlyClient })
          latestMigration = classifyMigrations({ knownMigrations, ...latestRemote.migrationObservation })
          assertAllowedStageTransition(stage, beforeStageRemote, latestRemote)
          assertStageRemoteValidation(stage, latestRemote, releasePackage, latestMigration)
          stageResults.push(immutablePlain({
            id: stage.id,
            status: 'PASS',
            startedAt: started,
            completedAt: iso(now),
            command: stageCommandText(stage),
            mutation: stage.mutation,
            process: processSummary,
            summary: `${stage.validation} passed.`,
          }))
        } else {
          assertStageRemoteValidation(stage, latestRemote, releasePackage, latestMigration)
          stageResults.push(immutablePlain({
            id: stage.id,
            status: 'PASS',
            startedAt: started,
            completedAt: iso(now),
            command: stageCommandText(stage),
            mutation: 'none',
            process: null,
            summary: `${stage.validation} passed.`,
          }))
        }
      } catch (error) {
        stageResults.push(immutablePlain({
          id: stage.id,
          status: 'FAIL',
          startedAt: started,
          completedAt: iso(now),
          command: stageCommandText(stage),
          mutation: stage.mutation,
          process: processSummary,
          summary: redactText(error instanceof Error ? error.message : String(error), [credentials.readToken, credentials.deployToken]),
        }))
        throw error
      }
    }
    latestRemote = await inspectRemote({ manifest: loaded.manifest, client: readOnlyClient })
    latestMigration = classifyMigrations({ knownMigrations, ...latestRemote.migrationObservation })
    finalValidation = finalChecks(releasePackage, latestRemote, latestMigration, stageResults)
    if (finalValidation.status !== 'PASS') throw remoteError('Final Preview validation did not pass.', 'partial_execution', 'execution.final-validation')
    status = 'PASS'
  } catch (error) {
    releaseError = asWorkflowError(error)
    status = mutationAttempted ? 'PARTIAL' : releaseError.status === 'REFUSED' ? 'REFUSED' : 'FAIL'
    const completedIds = new Set(stageResults.map(({ id }) => id))
    for (const stage of releasePackage.plan.executionContract.orderedStages) {
      if (!completedIds.has(stage.id)) {
        stageResults.push(immutablePlain({
          id: stage.id,
          status: 'NOT-RUN',
          startedAt: null,
          completedAt: null,
          command: stageCommandText(stage),
          mutation: stage.mutation,
          process: null,
          summary: 'Not run because an earlier safety check or stage failed.',
        }))
      }
    }
    if (mutationAttempted && loaded && readOnlyClient && knownMigrations) {
      try {
        const observedAfterFailure = await inspectRemote({ manifest: loaded.manifest, client: readOnlyClient })
        const migrationsAfterFailure = classifyMigrations({
          knownMigrations,
          ...observedAfterFailure.migrationObservation,
        })
        finalValidation = finalChecks(releasePackage, observedAfterFailure, migrationsAfterFailure, stageResults)
      } catch (inspectionError) {
        finalValidation = validationReport([{
          id: 'remote.failure-snapshot',
          status: 'FAIL',
          summary: `Read-only final-state inspection also failed: ${redactText(
            inspectionError instanceof Error ? inspectionError.message : String(inspectionError),
            credentials ? [credentials.readToken, credentials.deployToken] : [],
          )}`,
        }])
      }
    }
  } finally {
    if (workspace !== null) rmSync(workspace, { recursive: true, force: true })
  }
  const report = executionReport({
    releasePackage,
    startedAt,
    completedAt: iso(now),
    status,
    stageResults,
    finalValidation,
    mutationAttempted,
    error: releaseError,
    sensitiveValues: credentials ? [credentials.readToken, credentials.deployToken] : [],
  })
  return Object.freeze({
    report,
    exitCode: status === 'PASS'
      ? EXIT_CODES.SUCCESS
      : releaseError?.exitCode ?? (mutationAttempted ? EXIT_CODES.REMOTE_FAILURE : EXIT_CODES.LOCAL_FAILURE),
  })
}
