import {
  canonicalJson,
  immutablePlain,
  PREVIEW_RELEASE_PLAN_SCHEMA_VERSION,
  PREVIEW_RELEASE_TOOL_CONTRACT_VERSION,
} from './canonical.mjs'
import { localError, refusalError } from './errors.mjs'
import {
  DEDICATED_PREVIEW_CREDENTIAL,
  DEDICATED_PREVIEW_DEPLOY_CREDENTIAL,
} from './redaction.mjs'
import { assertNoReleaseInspectionArtifactForLegacyExecution } from '../release-inspection/markers.mjs'

export const EXECUTION_CONTRACT_VERSION = 'preview-release-execution-disabled-only-v2'
export const PREVIEW_DEPLOY_CREDENTIAL = DEDICATED_PREVIEW_DEPLOY_CREDENTIAL
export const PREVIEW_READ_CREDENTIAL = DEDICATED_PREVIEW_CREDENTIAL

const COMMAND_STAGE_IDS = new Set([
  'worker.deploy',
  'pages.deploy',
])

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

function workerDeploy(id, gitHead) {
  return descriptor(id, {
    executable: 'wrangler',
    args: [
      '--cwd',
      'workers/draft-validation',
      'deploy',
      '--config',
      'wrangler-disabled.toml',
      '--strict',
      '--message',
      `Pennant Pursuit Preview disabled ${gitHead}`,
    ],
    cwd: 'release-workspace',
    configurationState: 'disabled',
    mutation: 'preview-worker-deployment',
    validation: 'worker-disabled-configuration',
  })
}

function pagesDeploy(id, manifest, gitHead) {
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
    configurationState: 'disabled',
    mutation: 'preview-pages-deployment',
    validation: 'pages-disabled-configuration',
  })
}

export function buildExecutionContract(input) {
  assertNoReleaseInspectionArtifactForLegacyExecution(input)
  const { futureStages, targetState, manifest, gitHead, previewOrigin } = immutablePlain(input)
  if (!Array.isArray(futureStages)) throw localError('Release stages are missing.', 'execution.contract')
  if (manifest.activation.releaseTooling !== 'disabled-only' || targetState !== 'disabled') {
    throw localError('Legacy Preview execution remains disabled-only; release-inspection evidence grants no execution authority.', 'execution.contract')
  }
  if (manifest.toolContractVersion !== PREVIEW_RELEASE_TOOL_CONTRACT_VERSION
    || manifest.activation.canonicalCheckedInState !== 'all-disabled') {
    throw localError('The current disabled-only manifest contract is missing or unsupported.', 'execution.contract')
  }
  if (typeof previewOrigin !== 'string' || previewOrigin.length === 0) {
    throw localError('The reviewed Preview smoke origin is missing.', 'execution.contract')
  }
  const stages = futureStages.map(({ id }) => {
    if (id === 'worker.deploy') return workerDeploy(id, gitHead)
    if (id === 'pages.deploy') return pagesDeploy(id, manifest, gitHead)
    throw localError(`Release stage ${id} has no fixed execution contract.`, 'execution.contract')
  })
  return immutablePlain({
    version: EXECUTION_CONTRACT_VERSION,
    releaseBoundary: {
      planSchemaVersion: PREVIEW_RELEASE_PLAN_SCHEMA_VERSION,
      toolContractVersion: PREVIEW_RELEASE_TOOL_CONTRACT_VERSION,
      releaseTooling: 'disabled-only',
      canonicalCheckedInState: 'all-disabled',
      targetState: 'disabled',
    },
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
      'disabled-deployments-validated',
      'production-operations-absent',
    ],
  })
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort())
}

export function assertCurrentDisabledExecutionContract(input) {
  assertNoReleaseInspectionArtifactForLegacyExecution(input)
  let contract
  try {
    contract = immutablePlain(input)
  } catch (error) {
    throw localError(
      `Release command contract is malformed: ${error instanceof Error ? error.message : 'unknown value'}.`,
      'execution.command-list',
    )
  }
  if (!exactKeys(contract, ['finalValidation', 'mutationBoundary', 'orderedStages', 'releaseBoundary', 'version'])
    || contract.version !== EXECUTION_CONTRACT_VERSION
    || canonicalJson(contract.releaseBoundary) !== canonicalJson({
      planSchemaVersion: PREVIEW_RELEASE_PLAN_SCHEMA_VERSION,
      toolContractVersion: PREVIEW_RELEASE_TOOL_CONTRACT_VERSION,
      releaseTooling: 'disabled-only',
      canonicalCheckedInState: 'all-disabled',
      targetState: 'disabled',
    })
    || !Array.isArray(contract.orderedStages)) {
    throw refusalError('Release command contract is not the current disabled-only contract.', 'execution.command-list')
  }
  const seen = new Set()
  for (const stage of contract.orderedStages) {
    if (!exactKeys(stage, [
      'args', 'childCredentialName', 'configurationState', 'credentialSource', 'cwd', 'executable',
      'id', 'kind', 'mutation', 'validation',
    ]) || stage.kind !== 'command' || !COMMAND_STAGE_IDS.has(stage.id) || seen.has(stage.id)
      || stage.configurationState !== 'disabled' || stage.executable !== 'wrangler') {
      throw refusalError(`Unsupported or non-disabled execution stage ${stage?.id ?? 'unknown'}.`, 'execution.command-list')
    }
    seen.add(stage.id)
  }
  const orderedIds = contract.orderedStages.map(({ id }) => id)
  if (canonicalJson(orderedIds) !== canonicalJson(['worker.deploy', 'pages.deploy'].filter((id) => seen.has(id)))) {
    throw refusalError('Disabled-only execution stages are out of order.', 'execution.command-list')
  }
  return contract
}

export function assertExecutionContract(actual, expected) {
  const validatedActual = assertCurrentDisabledExecutionContract(actual)
  const validatedExpected = assertCurrentDisabledExecutionContract(expected)
  let actualCanonical
  let expectedCanonical
  try {
    actualCanonical = canonicalJson(validatedActual)
    expectedCanonical = canonicalJson(validatedExpected)
  } catch (error) {
    throw localError(
      `Release command contract is malformed: ${error instanceof Error ? error.message : 'unknown value'}.`,
      'execution.command-list',
    )
  }
  if (actualCanonical !== expectedCanonical) {
    throw refusalError('Release command list differs from the exact generated Preview execution contract.', 'execution.command-list')
  }
  return validatedActual
}

export function stageCommandText(stage) {
  if (stage.kind !== 'command') return '[internal read-only inspection]'
  return [stage.executable, ...stage.args].map((value) => {
    const text = String(value)
    return /^[A-Za-z0-9_./:=+-]+$/.test(text) ? text : JSON.stringify(text)
  }).join(' ')
}
