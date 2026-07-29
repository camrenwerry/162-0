import { canonicalJson, immutablePlain } from './canonical.mjs'
import { localError, refusalError } from './errors.mjs'
import {
  DEDICATED_PREVIEW_CREDENTIAL,
  DEDICATED_PREVIEW_DEPLOY_CREDENTIAL,
} from './redaction.mjs'

export const EXECUTION_CONTRACT_VERSION = 'preview-release-execution-v1'
export const PREVIEW_DEPLOY_CREDENTIAL = DEDICATED_PREVIEW_DEPLOY_CREDENTIAL
export const PREVIEW_READ_CREDENTIAL = DEDICATED_PREVIEW_CREDENTIAL
export const PREVIEW_SMOKE_ACKNOWLEDGEMENT = 'D1C4_PREVIEW_ONLY'

const COMMAND_STAGE_IDS = new Set([
  'cron.disable',
  'pages.disable',
  'migration.apply',
  'worker.deploy',
  'pages.deploy',
  'submission.smoke',
  'cron.deploy',
  'retention.smoke',
])

const INSPECTION_STAGE_IDS = new Set(['submission.disable.verify'])

function descriptor(id, {
  executable,
  args,
  cwd,
  configurationState = null,
  mutation,
  validation,
}) {
  return immutablePlain({
    id,
    kind: 'command',
    executable,
    args,
    cwd,
    configurationState,
    credentialSource: PREVIEW_DEPLOY_CREDENTIAL,
    childCredentialName: 'CLOUDFLARE_API_TOKEN',
    mutation,
    validation,
  })
}

function inspection(id, validation) {
  return immutablePlain({
    id,
    kind: 'inspection',
    executable: null,
    args: [],
    cwd: 'repository',
    configurationState: null,
    credentialSource: PREVIEW_READ_CREDENTIAL,
    childCredentialName: null,
    mutation: 'none',
    validation,
  })
}

function workerDeploy(id, state, manifest, gitHead) {
  return descriptor(id, {
    executable: 'wrangler',
    args: [
      '--cwd',
      'workers/draft-validation',
      'deploy',
      '--config',
      `wrangler-${state}.toml`,
      '--strict',
      '--message',
      `Pennant Pursuit Preview ${state} ${gitHead}`,
    ],
    cwd: 'release-workspace',
    configurationState: state,
    mutation: 'preview-worker-deployment',
    validation: id === 'cron.disable'
      ? 'worker-cron-disabled'
      : id === 'cron.deploy'
        ? 'worker-cron-enabled'
        : 'worker-target-configuration',
  })
}

function pagesDeploy(id, state, manifest, gitHead) {
  return descriptor(id, {
    executable: 'wrangler',
    args: [
      'pages',
      'deploy',
      'dist',
      '--project-name',
      manifest.cloudflare.preview.pages.project,
      '--branch',
      manifest.cloudflare.preview.pages.branch,
      '--commit-hash',
      gitHead,
      '--commit-dirty=false',
    ],
    cwd: 'release-workspace',
    configurationState: state,
    mutation: 'preview-pages-deployment',
    validation: id === 'pages.disable' ? 'pages-submission-disabled' : 'pages-target-configuration',
  })
}

function smokeDescriptor(id, manifest, previewOrigin) {
  const script = id === 'submission.smoke'
    ? '/tmp/pennant-pursuit-d1c4-submission-smoke/d1c4-submission-smoke.js'
    : '/tmp/pennant-pursuit-d1c4-retention-smoke/d1c4-retention-smoke.js'
  return descriptor(id, {
    executable: 'node',
    args: [
      script,
      '--preview-base-url',
      previewOrigin,
      '--preview-worker',
      manifest.cloudflare.preview.worker.name,
      '--preview-environment',
      'preview',
      '--account-id',
      manifest.cloudflare.account.id,
      '--database-id',
      manifest.cloudflare.preview.d1.id,
      '--ack',
      PREVIEW_SMOKE_ACKNOWLEDGEMENT,
      '--execute',
    ],
    cwd: 'repository',
    mutation: id === 'submission.smoke'
      ? 'preview-smoke-owned-submission-rows'
      : 'preview-smoke-owned-retention-sentinels',
    validation: id === 'submission.smoke' ? 'submission-smoke-passed' : 'retention-smoke-passed',
  })
}

export function buildExecutionContract({ futureStages, targetState, manifest, gitHead, previewOrigin }) {
  if (!Array.isArray(futureStages)) throw localError('Release stages are missing.', 'execution.contract')
  if (!manifest.activation.allowedStates.includes(targetState)) throw localError('Execution target state is invalid.', 'execution.contract')
  if (typeof previewOrigin !== 'string' || previewOrigin.length === 0) {
    throw localError('The reviewed Preview smoke origin is missing.', 'execution.contract')
  }
  const finalSubmissionState = targetState === 'disabled' ? 'disabled' : 'submission-enabled'
  const workerState = targetState === 'cron-enabled' ? 'submission-enabled' : targetState
  const stages = futureStages.map(({ id }) => {
    if (id === 'cron.disable') return workerDeploy(id, 'submission-enabled', manifest, gitHead)
    if (id === 'pages.disable') return pagesDeploy(id, 'disabled', manifest, gitHead)
    if (id === 'submission.disable.verify') return inspection(id, 'pages-submission-disabled')
    if (id === 'migration.apply') {
      return descriptor(id, {
        executable: 'wrangler',
        args: [
          'd1',
          'migrations',
          'apply',
          manifest.cloudflare.preview.d1.name,
          '--remote',
          '--config',
          'wrangler.toml',
        ],
        cwd: 'release-workspace',
        configurationState: 'disabled',
        mutation: 'preview-d1-forward-migrations',
        validation: 'preview-migrations-current',
      })
    }
    if (id === 'worker.deploy') return workerDeploy(id, workerState, manifest, gitHead)
    if (id === 'pages.deploy') return pagesDeploy(id, finalSubmissionState, manifest, gitHead)
    if (id === 'submission.smoke' || id === 'retention.smoke') return smokeDescriptor(id, manifest, previewOrigin)
    if (id === 'cron.deploy') return workerDeploy(id, 'cron-enabled', manifest, gitHead)
    throw localError(`Release stage ${id} has no fixed execution contract.`, 'execution.contract')
  })
  return immutablePlain({
    version: EXECUTION_CONTRACT_VERSION,
    orderedStages: stages,
    mutationBoundary: {
      accountId: manifest.cloudflare.account.id,
      pagesProject: manifest.cloudflare.preview.pages.project,
      pagesBranch: manifest.cloudflare.preview.pages.branch,
      worker: manifest.cloudflare.preview.worker.name,
      d1Database: manifest.cloudflare.preview.d1,
      previewOrigin,
      productionOperationsProhibited: true,
    },
    finalValidation: [
      'repository-and-plan-still-current',
      'protected-configuration-byte-identical',
      'preview-identities-exact',
      'preview-migrations-current',
      'target-state-exact',
      'required-smoke-stages-passed',
      'production-operations-absent',
    ],
  })
}

export function assertExecutionContract(actual, expected) {
  let actualCanonical
  let expectedCanonical
  try {
    actualCanonical = canonicalJson(actual)
    expectedCanonical = canonicalJson(expected)
  } catch (error) {
    throw localError(
      `Release command contract is malformed: ${error instanceof Error ? error.message : 'unknown value'}.`,
      'execution.command-list',
    )
  }
  if (actualCanonical !== expectedCanonical) {
    throw refusalError('Release command list differs from the exact generated Preview execution contract.', 'execution.command-list')
  }
  for (const stage of actual.orderedStages) {
    if (stage.kind === 'command' && !COMMAND_STAGE_IDS.has(stage.id)) {
      throw refusalError(`Unapproved mutation stage ${stage.id}.`, 'execution.command-list')
    }
    if (stage.kind === 'inspection' && !INSPECTION_STAGE_IDS.has(stage.id)) {
      throw refusalError(`Unapproved inspection stage ${stage.id}.`, 'execution.command-list')
    }
    if (!['command', 'inspection'].includes(stage.kind)) {
      throw refusalError(`Unsupported execution stage kind for ${stage.id}.`, 'execution.command-list')
    }
  }
  return immutablePlain(actual)
}

export function stageCommandText(stage) {
  if (stage.kind !== 'command') return '[internal read-only inspection]'
  return [stage.executable, ...stage.args].map((value) => {
    const text = String(value)
    return /^[A-Za-z0-9_./:=+-]+$/.test(text) ? text : JSON.stringify(text)
  }).join(' ')
}
