import {
  allowedKeys,
  assertRecordBudget,
  boundedAscii,
  canonicalCalendarDate,
  canonicalHttpsOrigin,
  compareText,
  exactKeys,
  normalizationFail,
  normalizedTimestamp,
  normalizedValue,
  paginationInfo,
  providerPlain,
  safeIdentity,
  sortedUniqueStrings,
} from './preview-normalization.mjs'
import { REMOTE_OBSERVATION_LIMITS } from './remote-transport.mjs'

const PROJECT_OPERATION = 'pages-project'
const DEPLOYMENT_OPERATION = 'pages-preview-deployments'
const PREVIEW_BRANCH = 'develop'
const APPROVED_VARIABLES = new Set([
  'DRAFT_VALIDATION_MODE',
  'DRAFT_TICKET_MODE',
  'LEADERBOARD_ENVIRONMENT',
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
])
const SECRET_KEY = /(?:secret|token|password|credential|cookie|private|api.?key)/iu
const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u
const CONFIG_HASH = /^[0-9a-f]{64}$/u

function normalizeVariables(operation, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    normalizationFail(operation, 'malformed', 'invalid-preview-variables')
  }
  if (Reflect.ownKeys(input).length > APPROVED_VARIABLES.size) {
    normalizationFail(operation, 'malformed', 'preview-variable-inventory-exceeded')
  }
  const variables = []
  for (const name of Reflect.ownKeys(input)) {
    if (typeof name !== 'string' || SECRET_KEY.test(name) || !APPROVED_VARIABLES.has(name)) {
      normalizationFail(operation, 'malformed', 'unsupported-preview-variable')
    }
    const record = exactKeys(
      operation,
      input[name],
      ['type', 'value'],
      'invalid-preview-variable-value',
    )
    if (record.type !== 'plain_text' || typeof record.value !== 'string'
      || !['disabled', 'enabled', 'preview'].includes(record.value)) {
      normalizationFail(operation, 'malformed', 'invalid-preview-variable-value')
    }
    variables.push(Object.freeze({ name, value: record.value }))
  }
  return variables.sort((left, right) => compareText(left.name, right.name))
}

function keyedBindings(operation, input, category, identity) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    normalizationFail(operation, 'malformed', `invalid-${category}-bindings`)
  }
  if (Reflect.ownKeys(input).length > 1) {
    normalizationFail(operation, 'malformed', `invalid-${category}-bindings`)
  }
  const bindings = []
  for (const name of Reflect.ownKeys(input)) {
    if (typeof name !== 'string') normalizationFail(operation, 'malformed', 'invalid-binding-name')
    safeIdentity(operation, name, 'invalid-binding-name')
    const value = input[name]
    if (category === 'd1') {
      allowedKeys(operation, value, ['id'], ['id'], 'invalid-d1-binding')
      if (name !== 'DB' || value.id !== (identity.observedDatabaseId ?? identity.databaseId)) {
        normalizationFail(operation, 'contradictory', 'preview-d1-binding-mismatch')
      }
      bindings.push(Object.freeze({ category: 'd1', name, target: 'approved-preview-d1' }))
    } else {
      allowedKeys(operation, value, ['service', 'environment'], ['service'], 'invalid-service-binding')
      if (name !== 'VALIDATION_SERVICE' || value.service !== identity.workerName
        || (Object.hasOwn(value, 'environment') && value.environment !== 'preview')) {
        normalizationFail(operation, 'contradictory', 'preview-service-binding-mismatch')
      }
      bindings.push(Object.freeze({ category: 'service', name, target: 'approved-preview-worker' }))
    }
  }
  return bindings
}

export function normalizePagesProject(providerResult, identity) {
  const result = providerPlain(PROJECT_OPERATION, providerResult)
  allowedKeys(PROJECT_OPERATION, result, [
    'name', 'subdomain', 'deployment_configs', 'wrangler_config_hash',
    'production_branch', 'domains', 'source',
  ], ['name', 'deployment_configs'], 'invalid-pages-project')
  if (result.name !== identity.pagesProject) {
    normalizationFail(PROJECT_OPERATION, 'contradictory', 'pages-project-identity-mismatch')
  }
  if (Object.hasOwn(result, 'domains')) {
    if (!Array.isArray(result.domains)) {
      normalizationFail(PROJECT_OPERATION, 'malformed', 'invalid-pages-domain-inventory')
    }
    assertRecordBudget(PROJECT_OPERATION, result.domains)
  }
  const configs = allowedKeys(PROJECT_OPERATION, result.deployment_configs, [
    'preview', 'production',
  ], ['preview'], 'invalid-pages-deployment-configs')
  const preview = allowedKeys(PROJECT_OPERATION, configs.preview, [
    'compatibility_date', 'compatibility_flags', 'env_vars', 'd1_databases', 'services',
  ], [], 'unsupported-preview-configuration')
  let compatibilityDate = null
  if (Object.hasOwn(preview, 'compatibility_date')) {
    compatibilityDate = canonicalCalendarDate(
      PROJECT_OPERATION,
      preview.compatibility_date,
      'invalid-compatibility-date',
    )
  }
  const compatibilityFlags = Object.hasOwn(preview, 'compatibility_flags')
    ? sortedUniqueStrings(
      PROJECT_OPERATION,
      preview.compatibility_flags,
      (value) => boundedAscii(PROJECT_OPERATION, value, 'invalid-compatibility-flag', /^[a-z0-9_-]+$/u, 64),
      'duplicate-compatibility-flag',
    )
    : []
  const variables = Object.hasOwn(preview, 'env_vars')
    ? normalizeVariables(PROJECT_OPERATION, preview.env_vars)
    : []
  const bindings = [
    ...(Object.hasOwn(preview, 'd1_databases')
      ? keyedBindings(PROJECT_OPERATION, preview.d1_databases, 'd1', identity) : []),
    ...(Object.hasOwn(preview, 'services')
      ? keyedBindings(PROJECT_OPERATION, preview.services, 'service', identity) : []),
  ].sort((left, right) => compareText(left.name, right.name))
  if (new Set(bindings.map(({ name }) => name)).size !== bindings.length) {
    normalizationFail(PROJECT_OPERATION, 'contradictory', 'duplicate-binding-name')
  }
  let wranglerConfigurationHash = null
  if (Object.hasOwn(result, 'wrangler_config_hash')) {
    wranglerConfigurationHash = boundedAscii(
      PROJECT_OPERATION,
      result.wrangler_config_hash,
      'invalid-wrangler-configuration-hash',
      CONFIG_HASH,
      64,
    )
  }
  return normalizedValue('preview-pages-project-observation', {
    identity: 'approved-preview-pages-project',
    compatibilityDate,
    compatibilityFlags,
    wranglerConfigurationHash,
    variables,
    bindings,
  })
}

function normalizeDeployment(input) {
  const deployment = allowedKeys(DEPLOYMENT_OPERATION, input, [
    'id', 'environment', 'created_on', 'modified_on', 'deployment_trigger', 'latest_stage',
    'url', 'aliases',
  ], ['id', 'environment', 'created_on', 'deployment_trigger', 'latest_stage', 'url'], 'invalid-pages-deployment')
  const identity = safeIdentity(DEPLOYMENT_OPERATION, deployment.id, 'invalid-deployment-identity')
  if (deployment.environment !== 'preview') {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'wrong-deployment-environment')
  }
  const trigger = exactKeys(
    DEPLOYMENT_OPERATION,
    deployment.deployment_trigger,
    ['type', 'metadata'],
    'invalid-deployment-trigger',
  )
  boundedAscii(
    DEPLOYMENT_OPERATION,
    trigger.type,
    'invalid-deployment-trigger',
    /^(?:ad_hoc|github|gitlab)$/u,
    16,
  )
  const metadata = allowedKeys(DEPLOYMENT_OPERATION, trigger.metadata, [
    'branch', 'commit_hash', 'commit_message',
  ], ['branch'], 'invalid-deployment-metadata')
  const targetBranch = boundedAscii(
    DEPLOYMENT_OPERATION,
    metadata.branch,
    'invalid-preview-branch',
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u,
    128,
  )
  let commitHash = null
  if (Object.hasOwn(metadata, 'commit_hash')) {
    commitHash = boundedAscii(
      DEPLOYMENT_OPERATION,
      metadata.commit_hash,
      'invalid-commit-hash',
      HASH,
      64,
    )
  }
  if (Object.hasOwn(metadata, 'commit_message')) {
    boundedAscii(
      DEPLOYMENT_OPERATION,
      metadata.commit_message,
      'invalid-commit-message',
      /^[\x20-\x7E]+$/u,
      512,
    )
  }
  const stage = exactKeys(
    DEPLOYMENT_OPERATION,
    deployment.latest_stage,
    ['name', 'status', 'started_on', 'ended_on'],
    'invalid-deployment-stage',
  )
  const stageName = boundedAscii(
    DEPLOYMENT_OPERATION,
    stage.name,
    'invalid-deployment-stage',
    /^[a-z][a-z0-9_-]*$/u,
    32,
  )
  const stageStatus = boundedAscii(
    DEPLOYMENT_OPERATION,
    stage.status,
    'invalid-deployment-stage',
    /^(?:active|failure|idle|queued|success)$/u,
    16,
  )
  const createdAtMs = normalizedTimestamp(DEPLOYMENT_OPERATION, deployment.created_on)
  if (Object.hasOwn(deployment, 'modified_on')) {
    const modifiedAtMs = normalizedTimestamp(DEPLOYMENT_OPERATION, deployment.modified_on)
    if (modifiedAtMs < createdAtMs) {
      normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'invalid-deployment-timeline')
    }
  }
  const stageStartedAtMs = normalizedTimestamp(DEPLOYMENT_OPERATION, stage.started_on)
  const stageEndedAtMs = normalizedTimestamp(DEPLOYMENT_OPERATION, stage.ended_on)
  if (stageStartedAtMs < createdAtMs || stageEndedAtMs < stageStartedAtMs) {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'invalid-deployment-timeline')
  }
  const aliases = Object.hasOwn(deployment, 'aliases')
    ? sortedUniqueStrings(
      DEPLOYMENT_OPERATION,
      deployment.aliases,
      (value) => canonicalHttpsOrigin(DEPLOYMENT_OPERATION, value, 'invalid-deployment-alias'),
      'duplicate-deployment-alias',
    )
    : []
  return Object.freeze({
    identity,
    environment: 'preview',
    targetBranch,
    createdAtMs,
    commitHash,
    stage: Object.freeze({ name: stageName, status: stageStatus }),
    previewOrigin: canonicalHttpsOrigin(DEPLOYMENT_OPERATION, deployment.url),
    aliases,
  })
}

export function normalizePagesDeploymentPage(providerResult, resultInfo, page) {
  const result = providerPlain(DEPLOYMENT_OPERATION, providerResult)
  if (!Array.isArray(result)) normalizationFail(DEPLOYMENT_OPERATION, 'malformed', 'invalid-deployment-list')
  assertRecordBudget(DEPLOYMENT_OPERATION, result)
  let aliasRecordCount = 0
  for (const deployment of result) {
    if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
      normalizationFail(DEPLOYMENT_OPERATION, 'malformed', 'invalid-pages-deployment')
    }
    if (Object.hasOwn(deployment, 'aliases')) {
      assertRecordBudget(DEPLOYMENT_OPERATION, deployment.aliases, 'alias-record-budget-exceeded')
      aliasRecordCount += deployment.aliases.length
      if (aliasRecordCount > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
        normalizationFail(DEPLOYMENT_OPERATION, 'malformed', 'aggregate-alias-record-budget-exceeded')
      }
    }
  }
  const normalized = result.map(normalizeDeployment)
  const providerIdentities = normalized.map(({ identity }) => identity)
  if (new Set(providerIdentities).size !== providerIdentities.length) {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'duplicate-deployment-identity')
  }
  const deployments = normalized.filter(({ targetBranch }) => targetBranch === PREVIEW_BRANCH)
  const pageInfo = paginationInfo(DEPLOYMENT_OPERATION, providerPlain(
    DEPLOYMENT_OPERATION,
    resultInfo,
  ), page, normalized.length)
  return Object.freeze({
    deployments: Object.freeze(deployments),
    providerIdentities: Object.freeze(providerIdentities),
    aliasRecordCount,
    pageInfo,
  })
}

export function finalizePagesDeployments(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    normalizationFail(DEPLOYMENT_OPERATION, 'unavailable', 'deployment-pages-absent')
  }
  let providerRecordCount = 0
  let aliasRecordCount = 0
  for (const page of pages) {
    if (!page || typeof page !== 'object'
      || !Array.isArray(page.providerIdentities) || !Array.isArray(page.deployments)
      || !Number.isSafeInteger(page.aliasRecordCount) || page.aliasRecordCount < 0) {
      normalizationFail(DEPLOYMENT_OPERATION, 'malformed', 'invalid-deployment-page')
    }
    assertRecordBudget(DEPLOYMENT_OPERATION, page.providerIdentities)
    assertRecordBudget(DEPLOYMENT_OPERATION, page.deployments)
    providerRecordCount += page.providerIdentities.length
    if (providerRecordCount > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      normalizationFail(DEPLOYMENT_OPERATION, 'malformed', 'aggregate-record-budget-exceeded')
    }
    aliasRecordCount += page.aliasRecordCount
    if (aliasRecordCount > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      normalizationFail(DEPLOYMENT_OPERATION, 'malformed', 'aggregate-alias-record-budget-exceeded')
    }
  }
  const first = pages[0].pageInfo
  if (pages.length !== first.totalPages
    || pages.some((entry, index) => entry.pageInfo.page !== index + 1
      || entry.pageInfo.perPage !== first.perPage
      || entry.pageInfo.totalCount !== first.totalCount
      || entry.pageInfo.totalPages !== first.totalPages)) {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'pagination-metadata-changed')
  }
  const providerIdentities = pages.flatMap((entry) => entry.providerIdentities)
  if (providerIdentities.length !== first.totalCount) {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'truncated-deployment-pagination')
  }
  if (new Set(providerIdentities).size !== providerIdentities.length) {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'duplicate-deployment-identity')
  }
  const deployments = pages.flatMap((entry) => entry.deployments)
  deployments.sort((left, right) => right.createdAtMs - left.createdAtMs
    || compareText(left.identity, right.identity))
  if (deployments.length === 0) normalizationFail(DEPLOYMENT_OPERATION, 'missing', 'preview-deployment-missing')
  if (deployments.length > 1 && deployments[0].createdAtMs === deployments[1].createdAtMs) {
    normalizationFail(DEPLOYMENT_OPERATION, 'contradictory', 'ambiguous-latest-deployment')
  }
  return normalizedValue('preview-pages-deployments-observation', {
    latestIdentity: deployments[0].identity,
    deployments,
  })
}
