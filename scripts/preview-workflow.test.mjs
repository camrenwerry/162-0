import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { canonicalHash, immutablePlain } from './lib/preview-release/canonical.mjs'
import { createReadOnlyCloudflareClient, inspectPreviewRemoteState } from './lib/preview-release/cloudflare-readonly.mjs'
import { assertLocalReleaseGraph, validateRuntimeCommandGraph } from './lib/preview-release/command-safety.mjs'
import { compilePreviewState, validateConfigurationModel } from './lib/preview-release/configuration.mjs'
import { EXIT_CODES } from './lib/preview-release/errors.mjs'
import { computeReleaseHashes, createFixedRunner, inspectLocalState, inspectServerDevelop } from './lib/preview-release/local-state.mjs'
import { loadReleaseManifest, parseReleaseManifest, validateReleaseManifest } from './lib/preview-release/manifest.mjs'
import {
  assertSelectOnlySql,
  BACKEND_VERSION_SQL,
  classifyMigrationState,
  compareMigrationNames,
  loadRepositoryMigrations,
  MIGRATION_ROWS_SQL,
  MIGRATION_TABLES_SQL,
} from './lib/preview-release/migrations.mjs'
import { buildReleasePlan, derivePlanId } from './lib/preview-release/plan.mjs'
import { redactText } from './lib/preview-release/redaction.mjs'
import { checkReport, failureReport, renderHumanCheck, renderHumanPlan } from './lib/preview-release/reporting.mjs'
import { credentialFreeEnvironment, parsePreviewCheckArguments } from './preview-check.mjs'
import { assertStableObservationWindow, parsePreviewPlanArguments } from './preview-plan.mjs'

const REPOSITORY_ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const loaded = loadReleaseManifest(REPOSITORY_ROOT)
const manifest = loaded.manifest
const clone = (value) => structuredClone(value)
const validateEndpoint = (value, validator) => typeof validator === 'function' ? validator(value, () => {}) : value
const ACCOUNT_ID = 'a'.repeat(32)
const ZONE_ID = 'b'.repeat(32)
const FULL_HEAD = 'c'.repeat(40)
const WORKER_DEPLOYMENT_ID = '11111111-1111-4111-8111-111111111111'
const WORKER_VERSION_ID = '22222222-2222-4222-8222-222222222222'

function resolvedManifest() {
  const value = clone(manifest)
  value.cloudflare.account = { status: 'resolved', id: ACCOUNT_ID, reason: '' }
  value.cloudflare.preview.worker.routeZoneIds = { status: 'resolved', values: [ZONE_ID], reason: '' }
  value.cloudflare.production.pages.branch = { status: 'resolved', value: 'main', reason: '' }
  value.cloudflare.production.pages.domains = { status: 'resolved', values: ['pennant-pursuit.example'], reason: '' }
  return validateReleaseManifest(value)
}

function result(stdout = '', status = 0, stderr = '') {
  return { stdout, stderr, status }
}

function gitKey(command, args) {
  return JSON.stringify([command, args])
}

function cleanLocalRunner(overrides = new Map()) {
  const defaults = new Map([
    [gitKey('git', ['rev-parse', '--show-toplevel']), result(`${REPOSITORY_ROOT}\n`)],
    [gitKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']), result('develop\n')],
    [gitKey('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']), result('origin/develop\n')],
    [gitKey('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']), result()],
    [gitKey('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('0\t0\n')],
    [gitKey('git', ['diff', '--check']), result()],
    [gitKey('git', ['config', '--get', 'remote.origin.url']), result(`${manifest.repository.remoteUrl}\n`)],
    [gitKey('git', ['rev-parse', 'HEAD']), result(`${FULL_HEAD}\n`)],
    [gitKey('npm', ['--version']), result('11.16.0\n')],
    [gitKey('git', ['ls-remote', '--heads', 'origin', 'refs/heads/develop']), result(`${FULL_HEAD}\trefs/heads/develop\n`)],
  ])
  const calls = []
  return {
    calls,
    runner(command, args) {
      calls.push({ command, args: [...args] })
      return overrides.get(gitKey(command, args)) ?? defaults.get(gitKey(command, args)) ?? result()
    },
  }
}

function knownMigrations() {
  return loadRepositoryMigrations(REPOSITORY_ROOT)
}

function migrationRows(count = knownMigrations().length) {
  return knownMigrations().slice(0, count).map(({ id, name }) => ({ id, name, applied_at: `2026-07-${String(id).padStart(2, '0')} 12:34:56` }))
}

function validMigration(count = knownMigrations().length) {
  return classifyMigrationState({
    knownMigrations: knownMigrations(),
    tables: count === 0 ? ['d1_migrations'] : ['backend_schema', 'd1_migrations'],
    rows: migrationRows(count),
    backendVersion: count === 0 ? null : count,
  })
}

function remoteState(state = 'disabled') {
  const submissionMode = state === 'disabled' ? 'disabled' : 'enabled'
  const sortBindings = (bindings) => bindings.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
  const pagesBindings = sortBindings([
    { name: 'DB', type: 'd1', id: manifest.cloudflare.preview.d1.id },
    { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: submissionMode },
    { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'VALIDATION_SERVICE', type: 'service', service: manifest.cloudflare.preview.worker.name, environment: '' },
  ])
  const workerBindings = sortBindings([
    { name: 'DB', type: 'd1', id: manifest.cloudflare.preview.d1.id },
    { name: 'RATE_LIMIT_BURST', type: 'ratelimit', namespaceId: '16204011' },
    { name: 'RATE_LIMIT_SUSTAINED', type: 'ratelimit', namespaceId: '16204012' },
    { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: submissionMode },
  ])
  return {
    schemaVersion: 2,
    accountId: ACCOUNT_ID,
    pages: {
      project: manifest.cloudflare.preview.pages.project,
      previewBranch: 'develop',
      productionBranch: 'main',
      deployment: { id: 'preview-deployment', createdOn: '2026-07-22T12:00:00.000Z', branch: 'develop', commitHash: FULL_HEAD, status: 'success' },
      artifactHash: null,
      configHash: null,
      submissionMode,
      validationMode: 'enabled',
      ticketMode: 'enabled',
      bindings: pagesBindings,
    },
    worker: {
      name: manifest.cloudflare.preview.worker.name,
      workersDev: false,
      previewUrls: false,
      routes: [],
      customDomains: [],
      schedules: state === 'cron-enabled' ? [manifest.activation.cleanupCron] : [],
      bindings: workerBindings,
      artifactHash: null,
      artifactProvenance: 'unproven',
      deploymentId: WORKER_DEPLOYMENT_ID,
      versionId: WORKER_VERSION_ID,
    },
    d1: { id: manifest.cloudflare.preview.d1.id, name: manifest.cloudflare.preview.d1.name },
    migrationObservation: { tables: ['backend_schema', 'd1_migrations'], rows: migrationRows(), backendVersion: 2 },
  }
}

function rawWorkerBindings(state = 'disabled') {
  return remoteState(state).worker.bindings.map((binding) => {
    if (binding.type === 'ratelimit') return { name: binding.name, type: binding.type, namespace_id: binding.namespaceId }
    return clone(binding)
  })
}

function planFixture({ state = 'disabled', targetState = 'disabled', head = FULL_HEAD, remote = remoteState(state), migration = validMigration(), exactArtifacts = true } = {}) {
  const reviewed = resolvedManifest()
  const compiled = compilePreviewState(REPOSITORY_ROOT, reviewed, targetState)
  const hashes = {
    source: '1'.repeat(64), repositoryTree: '2'.repeat(64), package: '3'.repeat(64), lockfile: '4'.repeat(64),
    manifest: canonicalHash(reviewed), configuration: compiled.hashes.combined, toolchain: '5'.repeat(64),
    workerSourceArtifact: '6'.repeat(64), pagesSourceArtifact: '7'.repeat(64), appBuildArtifact: '8'.repeat(64),
    workerBuildArtifact: '9'.repeat(64), pagesFunctionsBuildArtifact: 'a'.repeat(64),
  }
  const preparedRemote = clone(remote)
  if (preparedRemote.pages.deployment) preparedRemote.pages.deployment.commitHash = head
  const artifactBasis = { repositoryTree: hashes.repositoryTree, package: hashes.package, lockfile: hashes.lockfile, toolchain: hashes.toolchain }
  preparedRemote.pages.artifactHash = exactArtifacts ? canonicalHash({
    ...artifactBasis, configuration: compiled.hashes.pages, source: hashes.pagesSourceArtifact,
    applicationBundle: hashes.appBuildArtifact, functionsBundle: hashes.pagesFunctionsBuildArtifact,
  }) : null
  preparedRemote.worker.artifactHash = exactArtifacts ? canonicalHash({
    ...artifactBasis, configuration: compiled.hashes.worker, source: hashes.workerSourceArtifact, workerBundle: hashes.workerBuildArtifact,
  }) : null
  return {
    manifest: reviewed,
    manifestHash: canonicalHash(reviewed),
    local: { head },
    serverHead: head,
    targetState,
    compiled,
    hashes,
    remote: preparedRemote,
    migration,
  }
}

test('canonical manifest is valid, non-secret, and keeps ungrounded identities unresolved', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.cloudflare.account.status, 'unresolved')
  assert.equal(manifest.cloudflare.account.id, null)
  assert.equal(JSON.stringify(manifest).includes('PENNANT_PREVIEW_API_TOKEN'), false)
})

for (const [description, mutate, pattern] of [
  ['missing required identity', (value) => { delete value.cloudflare.preview.worker.name }, /must contain exactly/],
  ['Preview D1 equals Production D1', (value) => { value.cloudflare.preview.d1.id = value.cloudflare.production.d1.id }, /D1 identities must be distinct/],
  ['Preview Worker equals Production Worker', (value) => { value.cloudflare.preview.worker.name = value.cloudflare.production.worker.name }, /Worker identities must be distinct/],
  ['service targets collide', (value) => { value.cloudflare.preview.worker.serviceBinding.service = value.cloudflare.production.worker.serviceBinding.service }, /service targets must be distinct/],
  ['rate-limit namespaces collide', (value) => { value.cloudflare.preview.worker.rateLimitNamespaces[0] = value.cloudflare.production.worker.rateLimitNamespaces[0] }, /rate-limit namespaces must be distinct/],
  ['invalid Cron expression', (value) => { value.activation.cleanupCron = 'not a cron' }, /Cron expression is invalid/],
  ['unexpected Worker public URL', (value) => { value.cloudflare.preview.worker.workersDev = true }, /public URLs must be disabled/],
  ['Preview branch equals resolved production branch', (value) => { value.cloudflare.production.pages.branch = { status: 'resolved', value: 'develop', reason: '' } }, /must differ/],
  ['credential field', (value) => { value.cloudflare.apiToken = 'prohibited' }, /must contain exactly|prohibited credential/],
  ['credential string value', (value) => { value.cloudflare.account.reason = 'Authorization: Bearer fixture' }, /prohibited credential material/],
]) {
  test(`manifest refuses ${description}`, () => {
    const value = clone(manifest)
    mutate(value)
    assert.throws(() => validateReleaseManifest(value), pattern)
  })
}

test('manifest parser rejects a BOM and malformed JSON', () => {
  assert.throws(() => parseReleaseManifest(`\uFEFF${loaded.source}`), /BOM/)
  assert.throws(() => parseReleaseManifest('{'), /not valid JSON/)
})

test('all activation states compile to Preview-only deployment material', () => {
  const states = validateConfigurationModel(REPOSITORY_ROOT, manifest)
  assert.deepEqual(Object.keys(states), ['disabled', 'submission-enabled', 'cron-enabled'])
  for (const compiled of Object.values(states)) {
    assert.equal(compiled.previewOnly, true)
    assert.doesNotMatch(`${compiled.pagesConfig}\n${compiled.workerConfig}`, /\[env\.production\]/)
    assert.doesNotMatch(`${compiled.pagesConfig}\n${compiled.workerConfig}`, /pennant-pursuit-validation-production|4b821c17-b88b-462d-a2ed-c6a2113cc362|1620402[12]/)
  }
  assert.equal(states['submission-enabled'].pagesConfig, states['cron-enabled'].pagesConfig)
})

test('configuration compiler rejects unknown state and Production identity injection', () => {
  assert.throws(() => compilePreviewState(REPOSITORY_ROOT, manifest, 'unknown'), /Unknown Preview activation state/)
  const pages = readFileSync(path.join(REPOSITORY_ROOT, 'wrangler.toml'), 'utf8').replace(
    'service = "pennant-pursuit-validation-preview"',
    'service = "pennant-pursuit-validation-preview"\n# pennant-pursuit-validation-production',
  )
  assert.throws(() => compilePreviewState(REPOSITORY_ROOT, manifest, 'disabled', {
    sources: {
      pages,
      worker: readFileSync(path.join(REPOSITORY_ROOT, manifest.configuration.worker), 'utf8'),
      activation: readFileSync(path.join(REPOSITORY_ROOT, manifest.configuration.activationStates), 'utf8'),
    },
  }), /prohibited Production identity/)
})

test('CLI contracts default offline and require an explicit planning target', () => {
  assert.deepEqual(parsePreviewCheckArguments([]), { mode: 'offline', json: false, color: true })
  assert.equal(parsePreviewCheckArguments(['--offline']).mode, 'offline')
  assert.equal(parsePreviewCheckArguments(['--online', '--json', '--no-color']).mode, 'online')
  assert.throws(() => parsePreviewCheckArguments(['--online', '--offline']), (error) => error.exitCode === EXIT_CODES.USAGE)
  assert.throws(() => parsePreviewPlanArguments([]), (error) => error.exitCode === EXIT_CODES.USAGE)
  assert.throws(() => parsePreviewPlanArguments(['--target-state', 'unknown']), (error) => error.exitCode === EXIT_CODES.USAGE)
  assert.deepEqual(parsePreviewPlanArguments(['--target-state', 'disabled', '--json', '--no-color']), { targetState: 'disabled', json: true, color: false })
})

test('human and JSON reports are stable, color can be disabled, and secrets are redacted', () => {
  const report = { mode: 'offline', checks: [{ id: 'one', status: 'PASS', summary: 'passed' }] }
  assert.doesNotMatch(renderHumanCheck(report, false), /\u001B/)
  const plan = buildReleasePlan(planFixture())
  const humanPlan = renderHumanPlan(plan, false)
  assert.doesNotMatch(humanPlan, /\u001B/)
  assert.match(humanPlan, /local intended evidence only/)
  assert.equal(plan.artifactEvidence.worker.intendedProvenance, 'local-intended-only')
  assert.equal(plan.artifactEvidence.pages.intendedProvenance, 'local-intended-only')
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(plan)))
  const sensitive = 'sensitive-fixture-value'
  const error = new Error(`Authorization: Bearer ${sensitive}`)
  const failed = failureReport('preview:check', error, [], [sensitive])
  assert.equal(JSON.stringify(failed).includes(sensitive), false)
  assert.equal(redactText(`PENNANT_PREVIEW_API_TOKEN=${sensitive}`, [sensitive]).includes(sensitive), false)
  assert.equal('migrationObservation' in plan.remoteBefore, false)
})

test('online client requires only the dedicated Preview credential and unresolved identities refuse before contact', () => {
  let contacts = 0
  assert.throws(() => createReadOnlyCloudflareClient({ manifest, token: undefined, fetchImplementation: () => { contacts += 1 } }), (error) => error.exitCode === EXIT_CODES.REMOTE_FAILURE)
  assert.throws(() => createReadOnlyCloudflareClient({ manifest, token: 'sensitive-fixture-value', fetchImplementation: () => { contacts += 1 } }), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL)
  assert.equal(contacts, 0)
})

function jsonResponse(resultValue, init = {}) {
  return new Response(JSON.stringify({ success: true, result: resultValue, ...(init.resultInfo ? { result_info: init.resultInfo } : {}) }), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function previewDeployment(id = 'preview-deployment', createdOn = '2026-07-22T12:00:00.000Z', branch = 'develop') {
  return {
    id,
    created_on: createdOn,
    environment: 'preview',
    url: `https://${id}.diamond-draft.pages.dev`,
    aliases: ['https://develop.diamond-draft.pages.dev'],
    deployment_trigger: { metadata: { branch, commit_hash: FULL_HEAD } },
    latest_stage: { status: 'success' },
  }
}

function faithfulPagesConfig() {
  return {
    always_use_latest_compatibility_date: false,
    build_image_major_version: 3,
    compatibility_date: '2026-07-01',
    compatibility_flags: [],
    env_vars: {
      DRAFT_VALIDATION_MODE: { type: 'plain_text', value: 'enabled' },
      DRAFT_TICKET_MODE: { type: 'plain_text', value: 'enabled' },
      DRAFT_SUBMISSION_MODE: { type: 'plain_text', value: 'disabled' },
    },
    fail_open: true,
    usage_model: 'standard',
    ai_bindings: {},
    analytics_engine_datasets: {},
    browsers: {},
    d1_databases: { DB: { id: manifest.cloudflare.preview.d1.id } },
    durable_object_namespaces: {},
    hyperdrive_bindings: {},
    kv_namespaces: {},
    limits: { cpu_ms: 100 },
    mtls_certificates: {},
    placement: { mode: 'smart' },
    queue_producers: {},
    r2_buckets: {},
    services: { VALIDATION_SERVICE: { service: manifest.cloudflare.preview.worker.name } },
    vectorize_bindings: {},
    wrangler_config_hash: 'fixture-config-hash',
  }
}

function completeInspectionClient({
  pages = [[previewDeployment()]],
  pagesConfig,
  workerBindings = rawWorkerBindings(),
  workerDeployments,
  zonePages,
  domains = [],
  routes = {},
} = {}) {
  const calls = []
  const exactPagesConfig = pagesConfig ?? faithfulPagesConfig()
  const exactZonePages = zonePages ?? [[{ id: ZONE_ID, account: { id: ACCOUNT_ID } }]]
  const exactWorkerDeployments = workerDeployments ?? [{
    id: WORKER_DEPLOYMENT_ID,
    created_on: '2026-07-22T12:00:00.000Z',
    versions: [{ version_id: WORKER_VERSION_ID, percentage: 100 }],
  }]
  return {
    calls,
    client: {
      async request(operation, parameters, validator) {
        calls.push({ operation, parameters: clone(parameters) })
        if (operation === 'pages-deployments') {
          const items = pages[parameters.page - 1] ?? []
          return validateEndpoint({ items, resultInfo: { page: parameters.page, totalPages: pages.length, totalCount: pages.flat().length } }, validator)
        }
        if (operation === 'account-zones') {
          const items = exactZonePages[parameters.page - 1] ?? []
          return validateEndpoint({ items, resultInfo: { page: parameters.page, totalPages: exactZonePages.length, totalCount: exactZonePages.flat().length } }, validator)
        }
        if (operation === 'worker-domains') {
          return validateEndpoint({ items: domains, resultInfo: null }, validator)
        }
        if (operation === 'worker-routes') {
          return validateEndpoint(routes[parameters.zoneId] ?? [], validator)
        }
        const values = {
          account: { id: ACCOUNT_ID },
          'pages-project': {
            name: manifest.cloudflare.preview.pages.project,
            production_branch: 'main',
            domains: ['pennant-pursuit.example'],
            deployment_configs: { preview: exactPagesConfig },
          },
          'worker-settings': { bindings: workerBindings, tags: ['untrusted-worker-tag'] },
          'worker-deployments': { deployments: exactWorkerDeployments },
          'worker-subdomain': { enabled: false, previews_enabled: false },
          'worker-schedules': { schedules: [] },
          'd1-database': { uuid: manifest.cloudflare.preview.d1.id, name: manifest.cloudflare.preview.d1.name },
          'migration-tables': [{ success: true, results: [{ name: 'backend_schema' }, { name: 'd1_migrations' }] }],
          'migration-rows': [{ success: true, results: migrationRows() }],
          'backend-version': [{ success: true, results: [{ version: knownMigrations().length }] }],
        }
        return validateEndpoint(values[operation], validator)
      },
    },
  }
}

function productionInspectionHarness({ deadlineStage, deadlineValue = 10 } = {}) {
  const reviewed = resolvedManifest()
  const contacts = []
  let clears = 0
  const fetchImplementation = async (input, options) => {
    const url = new URL(input)
    const path = url.pathname
    let operation
    let resultValue
    let resultInfo
    if (path === `/client/v4/accounts/${ACCOUNT_ID}`) {
      operation = 'account'
      resultValue = { id: ACCOUNT_ID }
    } else if (path === '/client/v4/zones' && url.searchParams.has('account.id')) {
      operation = 'account-zones'
      resultValue = [{ id: ZONE_ID, account: { id: ACCOUNT_ID } }]
      resultInfo = { count: 1, page: 1, per_page: 25, total_count: 1, total_pages: 1 }
    } else if (path.endsWith('/pages/projects/diamond-draft/deployments')) {
      operation = 'pages-deployments'
      resultValue = [previewDeployment()]
      resultInfo = { count: 1, page: 1, per_page: 25, total_count: 1, total_pages: 1 }
    } else if (path.endsWith('/pages/projects/diamond-draft')) {
      operation = 'pages-project'
      resultValue = {
        name: reviewed.cloudflare.preview.pages.project,
        production_branch: 'main',
        domains: ['pennant-pursuit.example'],
        deployment_configs: { preview: faithfulPagesConfig() },
      }
    } else if (path.endsWith('/settings')) {
      operation = 'worker-settings'
      resultValue = { bindings: rawWorkerBindings() }
    } else if (path.endsWith('/deployments')) {
      operation = 'worker-deployments'
      resultValue = { deployments: [{
        id: WORKER_DEPLOYMENT_ID,
        created_on: '2026-07-22T12:00:00.000Z',
        versions: [{ version_id: WORKER_VERSION_ID, percentage: 100 }],
      }] }
    } else if (path.endsWith('/subdomain')) {
      operation = 'worker-subdomain'
      resultValue = { enabled: false, previews_enabled: false }
    } else if (path.endsWith('/schedules')) {
      operation = 'worker-schedules'
      resultValue = { schedules: [] }
    } else if (path.endsWith('/workers/domains')) {
      operation = 'worker-domains'
      resultValue = []
    } else if (path.endsWith('/workers/routes')) {
      operation = 'worker-routes'
      resultValue = []
    } else if (path.endsWith(`/d1/database/${reviewed.cloudflare.preview.d1.id}`) && options.method === 'GET') {
      operation = 'd1-database'
      resultValue = { uuid: reviewed.cloudflare.preview.d1.id, name: reviewed.cloudflare.preview.d1.name }
    } else if (path.endsWith(`/d1/database/${reviewed.cloudflare.preview.d1.id}/query`)) {
      const sql = JSON.parse(options.body).sql
      if (sql === MIGRATION_TABLES_SQL) {
        operation = 'migration-tables'
        resultValue = [{ success: true, results: [{ name: 'backend_schema' }, { name: 'd1_migrations' }] }]
      } else if (sql === MIGRATION_ROWS_SQL) {
        operation = 'migration-rows'
        resultValue = [{ success: true, results: migrationRows() }]
      } else if (sql === BACKEND_VERSION_SQL) {
        operation = 'backend-version'
        resultValue = [{ success: true, results: [{ version: knownMigrations().length }] }]
      }
    }
    assert.ok(operation, `unexpected request ${options.method} ${url}`)
    contacts.push(operation)
    return jsonResponse(resultValue, resultInfo ? { resultInfo } : {})
  }
  const client = createReadOnlyCloudflareClient({
    manifest: reviewed,
    token: 'sensitive-fixture-value',
    timeoutMs: 10,
    monotonicNow: (stage) => stage === deadlineStage ? deadlineValue : 0,
    setTimer: () => Symbol('endpoint-deadline'),
    clearTimer: () => { clears += 1 },
    fetchImplementation,
  })
  return { reviewed, client, contacts, clears: () => clears }
}

test('read-only client uses one exact GET, rejects Production/wrong-account/disallowed inputs before contact, and never retries', async () => {
  const reviewed = resolvedManifest()
  let contacts = 0
  const client = createReadOnlyCloudflareClient({
    manifest: reviewed,
    token: 'sensitive-fixture-value',
    fetchImplementation: async (url, options) => {
      contacts += 1
      assert.equal(options.method, 'GET')
      assert.equal(options.redirect, 'manual')
      assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`)
      return jsonResponse({ id: ACCOUNT_ID })
    },
  })
  assert.deepEqual(await client.request('account', { accountId: ACCOUNT_ID }), { id: ACCOUNT_ID })
  assert.equal(contacts, 1)
  await assert.rejects(client.request('worker-metadata', { accountId: ACCOUNT_ID, worker: reviewed.cloudflare.production.worker.name }), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL)
  await assert.rejects(client.request('account', { accountId: 'd'.repeat(32) }), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL)
  await assert.rejects(client.request('account', { accountId: ACCOUNT_ID, path: '/arbitrary' }), /requires exactly/)
  await assert.rejects(client.request('delete-resource', { accountId: ACCOUNT_ID }), /not allowlisted/)
  assert.equal(contacts, 1)
})

for (const [description, fetchImplementation, classification] of [
  ['redirect', async () => new Response('', { status: 302, headers: { location: 'https://example.invalid' } }), 'redirect_rejected'],
  ['oversized declared body', async () => jsonResponse({}, { headers: { 'content-length': '2000000' } }), 'response_too_large'],
  ['missing content type', async () => new Response('{}', { status: 200 }), 'unexpected_content_type'],
  ['malformed JSON', async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), 'malformed_json'],
  ['unexpected JSON shape', async () => new Response(JSON.stringify({ success: false }), { status: 200, headers: { 'content-type': 'application/json' } }), 'remote_api_failure'],
]) {
  test(`read-only client classifies ${description}`, async () => {
    const client = createReadOnlyCloudflareClient({ manifest: resolvedManifest(), token: 'sensitive-fixture-value', fetchImplementation })
    await assert.rejects(client.request('account', { accountId: ACCOUNT_ID }), (error) => error.classification === classification)
  })
}

test('read-only client rejects oversized streams, invalid UTF-8, a BOM, timeouts, and redacts fetch errors', async () => {
  const reviewed = resolvedManifest()
  const request = async (fetchImplementation, options = {}) => {
    const client = createReadOnlyCloudflareClient({ manifest: reviewed, token: 'sensitive-fixture-value', fetchImplementation, ...options })
    return client.request('account', { accountId: ACCOUNT_ID })
  }
  await assert.rejects(request(async () => new Response(new Uint8Array(33), { headers: { 'content-type': 'application/json' } }), { maximumBytes: 32 }), /streaming size limit/)
  await assert.rejects(request(async () => new Response(new Uint8Array([0xFF]), { headers: { 'content-type': 'application/json' } })), /valid UTF-8/)
  await assert.rejects(request(async () => new Response(new Uint8Array([0xEF, 0xBB, 0xBF, 0x7B, 0x7D]), { headers: { 'content-type': 'application/json' } })), /UTF-8 BOM/)
  await assert.rejects(request(async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))), { timeoutMs: 5 }), (error) => error.classification === 'request_timeout')
  await assert.rejects(request(async () => { throw new Error('sensitive-fixture-value') }), (error) => !error.message.includes('sensitive-fixture-value'))
})

test('D1 migration operations send only exact SELECT statements through approved read-only POSTs', async () => {
  const bodies = []
  const client = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(),
    token: 'sensitive-fixture-value',
    fetchImplementation: async (_url, options) => {
      bodies.push({ method: options.method, body: JSON.parse(options.body) })
      return jsonResponse([{ success: true, results: [] }])
    },
  })
  for (const operation of ['migration-tables', 'migration-rows', 'backend-version']) {
    await client.request(operation, { accountId: ACCOUNT_ID, databaseId: manifest.cloudflare.preview.d1.id })
  }
  assert.deepEqual(bodies.map(({ method }) => method), ['POST', 'POST', 'POST'])
  assert.deepEqual(bodies.map(({ body }) => body.sql), [MIGRATION_TABLES_SQL, MIGRATION_ROWS_SQL, BACKEND_VERSION_SQL])
  assert.throws(() => assertSelectOnlySql('CREATE TABLE d1_migrations (id INTEGER)'), /exact reviewed SELECT-only/)
})

test('read-only migration inspection fails closed when the live query endpoint is unavailable', async () => {
  let contacts = 0
  const client = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(),
    token: 'sensitive-fixture-value',
    fetchImplementation: async (_url, options) => {
      contacts += 1
      assert.equal(options.method, 'POST')
      assert.equal(JSON.parse(options.body).sql, MIGRATION_TABLES_SQL)
      return jsonResponse({}, { status: 503 })
    },
  })
  await assert.rejects(
    client.request('migration-tables', { accountId: ACCOUNT_ID, databaseId: manifest.cloudflare.preview.d1.id }),
    (error) => error.classification === 'remote_http_failure',
  )
  assert.equal(contacts, 1)
})

test('full remote inspection validates safe shapes and returns no private response values', async () => {
  const reviewed = resolvedManifest()
  const operations = []
  const fakeClient = {
    async request(operation, _parameters, validator) {
      operations.push(operation)
      const values = {
        account: { id: ACCOUNT_ID, name: 'not-returned' },
        'account-zones': { items: [{ id: ZONE_ID, account: { id: ACCOUNT_ID } }], resultInfo: { page: 1, totalPages: 1, totalCount: 1 } },
        'pages-project': {
          name: 'diamond-draft', production_branch: 'main', domains: ['pennant-pursuit.example'],
          deployment_configs: { preview: {
            env_vars: { DRAFT_VALIDATION_MODE: { value: 'enabled' }, DRAFT_TICKET_MODE: { value: 'enabled' }, DRAFT_SUBMISSION_MODE: { value: 'disabled' } },
            d1_databases: { DB: { id: manifest.cloudflare.preview.d1.id } },
            services: { VALIDATION_SERVICE: { service: manifest.cloudflare.preview.worker.name } },
          } },
        },
        'pages-deployments': { items: [{
          id: 'preview-deployment',
          created_on: '2026-07-22T12:00:00.000Z',
          environment: 'preview',
          url: 'https://fixture.diamond-draft.pages.dev',
          aliases: ['https://develop.diamond-draft.pages.dev'],
          deployment_trigger: { metadata: { branch: 'develop', commit_hash: FULL_HEAD } },
          latest_stage: { status: 'success' },
        }], resultInfo: { page: 1, totalPages: 1, totalCount: 1 } },
        'worker-settings': { bindings: rawWorkerBindings() },
        'worker-deployments': { deployments: [{
          id: WORKER_DEPLOYMENT_ID,
          created_on: '2026-07-22T12:00:00.000Z',
          versions: [{ version_id: WORKER_VERSION_ID, percentage: 100 }],
        }] },
        'worker-subdomain': { enabled: false, previews_enabled: false },
        'worker-schedules': { schedules: [] },
        'worker-domains': { items: [], resultInfo: null },
        'worker-routes': [],
        'd1-database': { uuid: manifest.cloudflare.preview.d1.id, name: manifest.cloudflare.preview.d1.name },
        'migration-tables': [{ success: true, results: [{ name: 'backend_schema' }, { name: 'd1_migrations' }] }],
        'migration-rows': [{ success: true, results: migrationRows() }],
        'backend-version': [{ success: true, results: [{ version: 2 }] }],
      }
      return validateEndpoint(values[operation], validator)
    },
  }
  const remote = await inspectPreviewRemoteState({ manifest: reviewed, client: fakeClient })
  assert.equal(remote.accountId, ACCOUNT_ID)
  assert.equal(JSON.stringify(remote).includes('not-returned'), false)
  assert.deepEqual(operations, ['account', 'account-zones', 'pages-project', 'pages-deployments', 'worker-settings', 'worker-deployments', 'worker-subdomain', 'worker-schedules', 'worker-domains', 'worker-routes', 'd1-database', 'migration-tables', 'migration-rows', 'backend-version'])
})

test('migration classifier covers absent, empty, applied, and pending suffix states', () => {
  const known = knownMigrations()
  assert.equal(classifyMigrationState({ knownMigrations: known, tables: [], rows: undefined, backendVersion: null }).classification, 'metadata-table-absent')
  assert.equal(validMigration(0).classification, 'metadata-table-empty')
  assert.equal(validMigration(known.length).classification, 'all-applied')
  assert.equal(validMigration(1).classification, 'pending-suffix')
})

test('migration classifier refuses unmanaged or contradictory schema metadata', () => {
  const known = knownMigrations()
  assert.equal(classifyMigrationState({ knownMigrations: known, tables: ['backend_schema'], rows: undefined, backendVersion: 2 }).classification, 'unmanaged-schema')
  assert.equal(classifyMigrationState({ knownMigrations: known, tables: ['backend_schema', 'd1_migrations'], rows: [], backendVersion: 1 }).classification, 'version-mismatch')
  assert.equal(classifyMigrationState({ knownMigrations: known, tables: ['d1_migrations'], rows: migrationRows(1), backendVersion: null }).classification, 'version-mismatch')
})

for (const [description, rows, backendVersion, classification] of [
  ['unknown migration', [{ id: 1, name: '0000_unknown.sql', applied_at: '2026-07-22 12:34:56' }], 1, 'unknown-applied-migration'],
  ['out-of-order migration', [{ id: 2, name: knownMigrations()[1].name, applied_at: '2026-07-22 12:34:56' }, { id: 1, name: knownMigrations()[0].name, applied_at: '2026-07-22 12:34:56' }], 2, 'ambiguous-malformed'],
  ['future migration', [...migrationRows(), { id: 3, name: '9999_future.sql', applied_at: '2026-07-22 12:34:56' }], 3, 'database-ahead'],
  ['malformed row', [{ id: '1', name: knownMigrations()[0].name }], 1, 'ambiguous-malformed'],
  ['schema version ahead', migrationRows(), 99, 'database-ahead'],
]) {
  test(`migration classifier refuses ${description}`, () => {
    const state = classifyMigrationState({ knownMigrations: knownMigrations(), tables: ['backend_schema', 'd1_migrations'], rows, backendVersion })
    assert.equal(state.status, 'ambiguous')
    assert.equal(state.classification, classification)
  })
}

test('migration classification explicitly records that applied source hashes are unavailable', () => {
  assert.equal(validMigration().repositoryIntegrity, 'not-verifiable-without-applied-hashes')
})

test('local inspection accepts only the exact clean repository contract', () => {
  const fake = cleanLocalRunner()
  const local = inspectLocalState({ repositoryRoot: REPOSITORY_ROOT, manifest, runner: fake.runner })
  assert.equal(local.head, FULL_HEAD)
  assert.equal(local.branch, 'develop')
})

for (const [description, command, args, stdout, pattern] of [
  ['wrong repository', 'git', ['rev-parse', '--show-toplevel'], '/wrong/repository\n', /allowed-root policy/],
  ['wrong branch', 'git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], 'main\n', /Expected branch develop/],
  ['wrong upstream', 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], 'origin/main\n', /Expected upstream/],
  ['dirty tracked file', 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], ' M file\0', /changes are not allowed/],
  ['staged file', 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'M  file\0', /changes are not allowed/],
  ['untracked file', 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], '?? file\0', /changes are not allowed/],
  ['ahead', 'git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop'], '1\t0\n', /found 1 0/],
  ['behind', 'git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop'], '0\t1\n', /found 0 1/],
]) {
  test(`local inspection refuses ${description}`, () => {
    const fake = cleanLocalRunner(new Map([[gitKey(command, args), result(stdout)]]))
    assert.throws(() => inspectLocalState({ repositoryRoot: REPOSITORY_ROOT, manifest, runner: fake.runner }), pattern)
  })
}

test('server hash inspection uses exactly git ls-remote and classifies match, mismatch, and malformed output', () => {
  const matching = cleanLocalRunner()
  assert.equal(inspectServerDevelop({ repositoryRoot: REPOSITORY_ROOT, manifest, runner: matching.runner }), FULL_HEAD)
  assert.deepEqual(matching.calls.at(-1), { command: 'git', args: ['ls-remote', '--heads', 'origin', 'refs/heads/develop'] })
  const changed = cleanLocalRunner(new Map([[gitKey('git', ['ls-remote', '--heads', 'origin', 'refs/heads/develop']), result(`${'d'.repeat(40)}\trefs/heads/develop\n`)]]))
  assert.notEqual(inspectServerDevelop({ repositoryRoot: REPOSITORY_ROOT, manifest, runner: changed.runner }), FULL_HEAD)
  const malformed = cleanLocalRunner(new Map([[gitKey('git', ['ls-remote', '--heads', 'origin', 'refs/heads/develop']), result('ambiguous')]]))
  assert.throws(() => inspectServerDevelop({ repositoryRoot: REPOSITORY_ROOT, manifest, runner: malformed.runner }), /missing or ambiguous/)
})

test('fixed subprocess environment removes both Preview and generic Cloudflare credentials', () => {
  let options
  const runner = createFixedRunner({ PATH: '/fixture', PENNANT_PREVIEW_API_TOKEN: 'sensitive-fixture-value', CLOUDFLARE_API_TOKEN: 'generic-fixture-value' }, (_command, _args, received) => {
    options = received
    return result()
  })
  runner('git', ['status'], REPOSITORY_ROOT)
  assert.equal(options.shell, false)
  assert.equal(options.env.PENNANT_PREVIEW_API_TOKEN, undefined)
  assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined)
})

test('plan IDs are deterministic and change with HEAD, target, and remote state', () => {
  const first = buildReleasePlan(planFixture())
  const second = buildReleasePlan(planFixture())
  assert.equal(first.planId, second.planId)
  assert.notEqual(buildReleasePlan(planFixture({ head: 'd'.repeat(40) })).planId, first.planId)
  assert.notEqual(buildReleasePlan(planFixture({ targetState: 'submission-enabled' })).planId, first.planId)
  const changedRemote = remoteState()
  changedRemote.pages.deployment.id = 'different-deployment'
  assert.notEqual(buildReleasePlan(planFixture({ remote: changedRemote })).planId, first.planId)
})

test('conservative staged plans include exact future approvals and no-mutation statement', () => {
  const disabled = buildReleasePlan(planFixture())
  assert.equal(disabled.outcome, 'PLAN')
  assert.deepEqual(disabled.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
  assert.equal(disabled.noRemoteMutation, true)
  const pending = validMigration(1)
  const plan = buildReleasePlan(planFixture({ targetState: 'cron-enabled', migration: pending }))
  assert.deepEqual(plan.futureStages.map(({ id }) => id), ['migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'])
  assert.deepEqual(plan.approvalCheckpoints, plan.futureStages.map(({ id }) => id))
  assert.equal(plan.statement, 'Phase 1 performed no remote mutation.')
})

test('untrusted remote artifact fingerprints conservatively prevent a no-op', () => {
  const plan = buildReleasePlan(planFixture({ exactArtifacts: false }))
  assert.equal(plan.outcome, 'PLAN')
  assert.deepEqual(plan.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
})

test('plans disable public gates first and pause Cron before a pending migration', () => {
  const disable = buildReleasePlan(planFixture({ state: 'cron-enabled', targetState: 'disabled' }))
  assert.deepEqual(disable.futureStages.map(({ id }) => id), ['pages.disable', 'worker.deploy'])
  const pending = buildReleasePlan(planFixture({ state: 'cron-enabled', targetState: 'cron-enabled', migration: validMigration(1) }))
  assert.deepEqual(pending.futureStages.map(({ id }) => id), ['cron.disable', 'pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'])
})

test('planning refuses server mismatch, ambiguous migrations, Production collision, and ambiguous remote gates', () => {
  assert.throws(() => buildReleasePlan({ ...planFixture(), serverHead: 'd'.repeat(40) }), (error) => error.exitCode === EXIT_CODES.REMOTE_FAILURE)
  assert.throws(() => buildReleasePlan({ ...planFixture(), migration: classifyMigrationState({ knownMigrations: knownMigrations(), tables: ['d1_migrations'], rows: [{ id: 1 }], backendVersion: null }) }), /Migration state is ambiguous/)
  const productionCollision = remoteState()
  productionCollision.d1.id = manifest.cloudflare.production.d1.id
  assert.throws(() => buildReleasePlan(planFixture({ remote: productionCollision })), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL)
  const ambiguous = remoteState()
  ambiguous.pages.submissionMode = 'enabled'
  ambiguous.pages.bindings.find(({ name }) => name === 'DRAFT_SUBMISSION_MODE').text = 'enabled'
  assert.throws(() => buildReleasePlan(planFixture({ remote: ambiguous })), /submission gates disagree/)
})

test('P1-01 exact binding inventories reject every extra or duplicate binding and accept only the reviewed set', async () => {
  const cases = [
    ['alternate Production D1', 'worker', { name: 'ALT_DATABASE', type: 'd1', id: manifest.cloudflare.production.d1.id }],
    ['alternate Preview D1', 'worker', { name: 'ALT_DATABASE', type: 'd1', id: manifest.cloudflare.preview.d1.id }],
    ['extra service', 'pages', { name: 'ALT_SERVICE', type: 'service', service: manifest.cloudflare.preview.worker.name, environment: '' }],
    ['unknown category', 'worker', { name: 'UNKNOWN_BINDING', type: 'future_cloudflare_binding' }],
    ['KV binding', 'pages', { name: 'EXTRA_KV', type: 'kv_namespace', namespaceId: 'fixture' }],
    ['secret name', 'worker', { name: 'EXTRA_SECRET', type: 'secret_text' }],
  ]
  for (const [label, target, extra] of cases) {
    const observed = remoteState()
    observed[target].bindings.push(extra)
    observed[target].bindings.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
    assert.throws(() => buildReleasePlan(planFixture({ remote: observed })), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL, label)
  }

  const duplicateBindings = [...remoteState().worker.bindings, clone(remoteState().worker.bindings[0])]
  const duplicate = completeInspectionClient({ workerBindings: duplicateBindings })
  await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: duplicate.client }), /duplicated/)
  assert.deepEqual(duplicate.calls.map(({ operation }) => operation), ['account', 'account-zones', 'pages-project', 'pages-deployments', 'worker-settings'])
  assert.equal(buildReleasePlan(planFixture()).outcome, 'PLAN')

  const faithful = completeInspectionClient({ pagesConfig: faithfulPagesConfig() })
  const observed = await inspectPreviewRemoteState({ manifest: resolvedManifest(), client: faithful.client })
  assert.equal(observed.pages.configHash, 'fixture-config-hash')
  for (const [category, entry] of [
    ['hyperdrive_bindings', { EXTRA_HYPERDRIVE: { id: 'hyperdrive-id' } }],
    ['vectorize_bindings', { EXTRA_VECTORIZE: { index_name: 'vector-index' } }],
    ['browsers', { EXTRA_BROWSER: {} }],
    ['mtls_certificates', { EXTRA_MTLS: { certificate_id: 'certificate-id' } }],
  ]) {
    const pagesConfig = faithfulPagesConfig()
    pagesConfig[category] = entry
    const extraBinding = completeInspectionClient({ pagesConfig })
    await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: extraBinding.client }), /binding inventory/)
  }
  const unknownCategory = faithfulPagesConfig()
  unknownCategory.future_binding_category = {}
  await assert.rejects(
    inspectPreviewRemoteState({ manifest: resolvedManifest(), client: completeInspectionClient({ pagesConfig: unknownCategory }).client }),
    /unknown category/,
  )
})

test('P1-02 enabled targets remain operationally unverified and artifacts remain unproven', () => {
  const submission = buildReleasePlan(planFixture({ state: 'submission-enabled', targetState: 'submission-enabled' }))
  assert.deepEqual(submission.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy', 'submission.smoke'])
  assert.equal(submission.deploymentOutcome, 'CHANGES-REQUIRED')
  assert.equal(submission.operationalVerificationRequired, true)
  assert.equal(submission.outcome, 'PLAN')
  assert.match(renderHumanPlan(submission, false), /Deployment changes: CHANGES-REQUIRED/)
  assert.match(renderHumanPlan(submission, false), /Operational verification required: yes/)

  for (const evidence of [null, {}, { status: 'stale' }, { status: 'verified', targetState: 'disabled' }]) {
    const observed = remoteState('cron-enabled')
    observed.operationalEvidence = evidence
    const cron = buildReleasePlan(planFixture({ state: 'cron-enabled', targetState: 'cron-enabled', remote: observed }))
    assert.deepEqual(cron.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'])
    assert.equal(cron.deploymentOutcome, 'CHANGES-REQUIRED')
  }
})

test('P1-03 Worker exposure inspection is complete, manifest-bound, paginated, and fail-closed', async () => {
  const unresolved = clone(resolvedManifest())
  unresolved.cloudflare.preview.worker.routeZoneIds = { status: 'unresolved', values: [], reason: 'Fixture unresolved inventory.' }
  const unresolvedClient = completeInspectionClient()
  await assert.rejects(inspectPreviewRemoteState({ manifest: validateReleaseManifest(unresolved), client: unresolvedClient.client }), /route-zone inventory is unresolved/)
  assert.equal(unresolvedClient.calls.length, 0)

  for (const hostname of ['preview.example.invalid', 'production-like.example.invalid']) {
    const exposed = completeInspectionClient({ domains: [{ hostname, service: manifest.cloudflare.preview.worker.name }] })
    await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: exposed.client }), /custom domain/)
  }

  const secondZone = 'd'.repeat(32)
  const twoZones = clone(resolvedManifest())
  twoZones.cloudflare.preview.worker.routeZoneIds = { status: 'resolved', values: [ZONE_ID, secondZone], reason: '' }
  const routed = completeInspectionClient({
    zonePages: [[{ id: ZONE_ID, account: { id: ACCOUNT_ID } }, { id: secondZone, account: { id: ACCOUNT_ID } }]],
    routes: { [secondZone]: [{ id: 'route-2', pattern: 'preview.example.invalid/*', script: manifest.cloudflare.preview.worker.name }] },
  })
  await assert.rejects(inspectPreviewRemoteState({ manifest: validateReleaseManifest(twoZones), client: routed.client }), /public route/)
  assert.equal(routed.calls.some(({ operation, parameters }) => operation === 'worker-routes' && parameters.zoneId === secondZone), true)

  const complete = completeInspectionClient()
  const safe = await inspectPreviewRemoteState({ manifest: resolvedManifest(), client: complete.client })
  assert.deepEqual(safe.worker.routes, [])
  assert.deepEqual(safe.worker.customDomains, [])
  assert.equal(complete.calls.some(({ operation, parameters }) => operation === 'worker-domains' && !('page' in parameters)), true)

  const extraZone = completeInspectionClient({ zonePages: [[{ id: ZONE_ID, account: { id: ACCOUNT_ID } }, { id: secondZone, account: { id: ACCOUNT_ID } }]] })
  await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: extraZone.client }), /zone inventory/)

  const omittedZone = completeInspectionClient()
  await assert.rejects(inspectPreviewRemoteState({ manifest: validateReleaseManifest(twoZones), client: omittedZone.client }), /zone inventory/)

  const matching = completeInspectionClient({ zonePages: [[{ id: ZONE_ID, account: { id: ACCOUNT_ID } }, { id: secondZone, account: { id: ACCOUNT_ID } }]] })
  const matchingRemote = await inspectPreviewRemoteState({ manifest: validateReleaseManifest(twoZones), client: matching.client })
  assert.deepEqual(matchingRemote.worker.routes, [])
  assert.equal(matching.calls.filter(({ operation }) => operation === 'worker-routes').length, 2)

  const incompleteBase = completeInspectionClient()
  const incomplete = {
    async request(operation, parameters, validator) {
      if (operation === 'account-zones') return validateEndpoint({ items: [{ id: ZONE_ID, account: { id: ACCOUNT_ID } }], resultInfo: { page: 1, totalPages: 2, totalCount: 26 } }, validator)
      return incompleteBase.client.request(operation, parameters, validator)
    },
  }
  await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: incomplete }), /pagination/)
})

test('P1-04 repository migration discovery mirrors pinned Wrangler top-level ordering and rejects unsafe bytes', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'preview-migrations-'))
  try {
    const directory = path.join(fixtureRoot, 'migrations')
    mkdirSync(directory)
    for (const name of ['manual.sql', '10_tenth.sql', '2_second.sql', 'alpha.sql']) writeFileSync(path.join(directory, name), 'SELECT 1;\n')
    assert.deepEqual(loadRepositoryMigrations(fixtureRoot).map(({ name }) => name), ['2_second.sql', '10_tenth.sql', 'alpha.sql', 'manual.sql'])
    assert.equal(compareMigrationNames('2_second.sql', '10_tenth.sql') < 0, true)

    writeFileSync(path.join(directory, 'invalid.sql'), new Uint8Array([0xFF]))
    assert.throws(() => loadRepositoryMigrations(fixtureRoot), /valid UTF-8/)
    rmSync(path.join(directory, 'invalid.sql'))
    writeFileSync(path.join(directory, 'bom.sql'), new Uint8Array([0xEF, 0xBB, 0xBF, 0x53]))
    assert.throws(() => loadRepositoryMigrations(fixtureRoot), /UTF-8 BOM/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('P1-04 applied migration metadata rejects empty names, duplicate identities, timestamps, and database ordering drift', () => {
  const known = knownMigrations()
  const base = { knownMigrations: known, tables: ['backend_schema', 'd1_migrations'], backendVersion: 2 }
  const malformedRows = [
    [{ id: 1, name: '', applied_at: '2026-07-22 12:34:56' }],
    [{ ...migrationRows()[0] }, { ...migrationRows()[1], id: 1 }],
    [{ ...migrationRows()[0] }, { ...migrationRows()[1], name: migrationRows()[0].name }],
    [{ ...migrationRows()[0], applied_at: '2026-02-30 12:34:56' }],
    [{ ...migrationRows()[1], id: 1 }, { ...migrationRows()[0], id: 2 }],
  ]
  for (const rows of malformedRows) assert.equal(classifyMigrationState({ ...base, rows }).status, 'ambiguous')
})

test('P1-05 runtime command graph rejects direct, nested, lifecycle, cyclic, shell, redirection, Git, and Wrangler mutation paths', () => {
  for (const scripts of [
    { root: 'curl https://example.invalid' },
    { root: 'npm run nested', nested: 'curl https://example.invalid' },
    { root: 'node scripts/preview-check.mjs', preroot: 'git push' },
    { root: 'node scripts/preview-check.mjs', postroot: 'wrangler deploy' },
    { root: 'npm run root' },
    { root: 'node scripts/preview-check.mjs | sh' },
    { root: 'node $(echo scripts/preview-check.mjs)' },
    { root: 'node scripts/preview-check.mjs > output.txt' },
    { root: 'wrangler deploy' },
    { root: 'git commit -am unsafe' },
  ]) assert.throws(() => assertLocalReleaseGraph(scripts, ['root']))

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'preview-command-graph-'))
  try {
    writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ scripts: {
      lint: 'node scripts/preview-check.mjs --lint',
      prelint: 'git push',
      test: 'node scripts/preview-check.mjs --tests',
      typecheck: 'node scripts/preview-check.mjs --typecheck',
    } }))
    assert.throws(() => validateRuntimeCommandGraph(fixtureRoot, [{ label: 'Lint', command: 'npm', args: ['run', 'lint'] }]), /unsafe/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }

  const safeEnvironment = credentialFreeEnvironment({
    PATH: '/fixture', HOME: '/private', PENNANT_PREVIEW_API_TOKEN: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture',
    CLOUDFLARE_API_KEY: 'fixture', CF_API_TOKEN: 'fixture', CF_API_KEY: 'fixture', CLOUDFLARE_EMAIL: 'fixture',
    WRANGLER_OAUTH_TOKEN: 'fixture', API_KEY: 'fixture',
  })
  for (const name of ['HOME', 'PENNANT_PREVIEW_API_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_API_KEY', 'CLOUDFLARE_EMAIL', 'WRANGLER_OAUTH_TOKEN', 'API_KEY']) assert.equal(safeEnvironment[name], undefined)
})

test('P1-06 stable observation windows reject every local, server, Worker, Pages, and migration change', () => {
  const baseline = {
    initialLocal: { head: FULL_HEAD, clean: true, branch: 'develop', upstream: 'origin/develop', remoteUrl: manifest.repository.remoteUrl },
    finalLocal: { head: FULL_HEAD, clean: true, branch: 'develop', upstream: 'origin/develop', remoteUrl: manifest.repository.remoteUrl },
    initialServerHead: FULL_HEAD,
    finalServerHead: FULL_HEAD,
    initialRemote: remoteState(),
    finalRemote: remoteState(),
  }
  assert.doesNotThrow(() => assertStableObservationWindow(clone(baseline)))
  for (const mutate of [
    (value) => { value.finalLocal.head = 'd'.repeat(40) },
    (value) => { value.finalLocal.clean = false },
    (value) => { value.finalLocal.remoteUrl = 'https://example.invalid/changed.git' },
    (value) => { value.finalServerHead = 'd'.repeat(40) },
    (value) => { value.finalRemote.worker.deploymentId = '33333333-3333-4333-8333-333333333333' },
    (value) => { value.finalRemote.worker.versionId = 'changed' },
    (value) => { value.finalRemote.pages.deployment.id = 'changed' },
    (value) => { value.finalRemote.migrationObservation.rows = [] },
  ]) {
    const changed = clone(baseline)
    mutate(changed)
    assert.throws(() => assertStableObservationWindow(changed), (error) => error.exitCode === EXIT_CODES.REMOTE_FAILURE)
  }
})

test('P1-06 active Worker deployment evidence detects code-only version drift and rejects split traffic', async () => {
  const first = await inspectPreviewRemoteState({ manifest: resolvedManifest(), client: completeInspectionClient().client })
  const changedVersionId = '33333333-3333-4333-8333-333333333333'
  const changed = await inspectPreviewRemoteState({
    manifest: resolvedManifest(),
    client: completeInspectionClient({
      workerDeployments: [{
        id: WORKER_DEPLOYMENT_ID,
        created_on: '2026-07-22T12:00:00.000Z',
        versions: [{ version_id: changedVersionId, percentage: 100 }],
      }],
    }).client,
  })
  assert.deepEqual(first.worker.bindings, changed.worker.bindings)
  assert.notEqual(first.worker.versionId, changed.worker.versionId)
  assert.throws(() => assertStableObservationWindow({
    initialLocal: { head: FULL_HEAD }, finalLocal: { head: FULL_HEAD },
    initialServerHead: FULL_HEAD, finalServerHead: FULL_HEAD,
    initialRemote: first, finalRemote: changed,
  }), (error) => error.exitCode === EXIT_CODES.REMOTE_FAILURE)

  const split = completeInspectionClient({
    workerDeployments: [{
      id: WORKER_DEPLOYMENT_ID,
      created_on: '2026-07-22T12:00:00.000Z',
      versions: [
        { version_id: WORKER_VERSION_ID, percentage: 50 },
        { version_id: changedVersionId, percentage: 50 },
      ],
    }],
  })
  await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: split.client }), /authoritative version/)
})

test('P1-07 all current, target, and migration combinations preserve safe stage ordering', () => {
  const expectations = {
    current: {
      disabled: {
        disabled: ['worker.deploy', 'pages.deploy'],
        'submission-enabled': ['worker.deploy', 'pages.deploy', 'submission.smoke'],
        'cron-enabled': ['worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
      },
      'submission-enabled': {
        disabled: ['pages.disable', 'worker.deploy'],
        'submission-enabled': ['worker.deploy', 'pages.deploy', 'submission.smoke'],
        'cron-enabled': ['worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
      },
      'cron-enabled': {
        disabled: ['pages.disable', 'worker.deploy'],
        'submission-enabled': ['worker.deploy', 'pages.deploy', 'submission.smoke'],
        'cron-enabled': ['worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
      },
    },
    pending: {
      disabled: {
        disabled: ['migration.apply', 'worker.deploy', 'pages.deploy'],
        'submission-enabled': ['migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke'],
        'cron-enabled': ['migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
      },
      'submission-enabled': {
        disabled: ['pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy'],
        'submission-enabled': ['pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke'],
        'cron-enabled': ['pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
      },
      'cron-enabled': {
        disabled: ['cron.disable', 'pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy'],
        'submission-enabled': ['cron.disable', 'pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke'],
        'cron-enabled': ['cron.disable', 'pages.disable', 'submission.disable.verify', 'migration.apply', 'worker.deploy', 'pages.deploy', 'submission.smoke', 'cron.deploy', 'retention.smoke'],
      },
    },
  }
  for (const [migrationState, currentStates] of Object.entries(expectations)) {
    for (const [state, targets] of Object.entries(currentStates)) {
      for (const [targetState, stages] of Object.entries(targets)) {
        const migration = migrationState === 'pending' ? validMigration(1) : validMigration()
        const plan = buildReleasePlan(planFixture({ state, targetState, migration }))
        assert.deepEqual(plan.futureStages.map(({ id }) => id), stages, `${migrationState}: ${state} -> ${targetState}`)
        const migrationIndex = stages.indexOf('migration.apply')
        const verificationIndex = stages.indexOf('submission.disable.verify')
        const cronDisableIndex = stages.indexOf('cron.disable')
        if (verificationIndex >= 0) assert.equal(verificationIndex < migrationIndex, true)
        if (cronDisableIndex >= 0) assert.equal(cronDisableIndex < migrationIndex, true)
      }
    }
  }
  assert.match(buildReleasePlan(planFixture({ targetState: 'disabled' })).rollbackImplications, /forward-only/)
})

test('P1-08 intended artifact fingerprints cover every deployment input but remote provenance remains unproven', () => {
  const exact = planFixture()
  const baseline = buildReleasePlan(exact)
  assert.equal(baseline.deploymentOutcome, 'CHANGES-REQUIRED')
  assert.deepEqual(baseline.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
  const inputChanges = [
    ['lockfile', 'b'.repeat(64), true, true],
    ['package', 'c'.repeat(64), true, true],
    ['toolchain', 'd'.repeat(64), true, true],
    ['workerSourceArtifact', 'e'.repeat(64), true, false],
    ['pagesSourceArtifact', 'f'.repeat(64), false, true],
    ['appBuildArtifact', '0'.repeat(64), false, true],
    ['workerBuildArtifact', 'a'.repeat(64), true, false],
    ['pagesFunctionsBuildArtifact', 'b'.repeat(64), false, true],
  ]
  for (const [field, value, workerChanges, pagesChanges] of inputChanges) {
    const changed = planFixture()
    changed.hashes[field] = value
    const plan = buildReleasePlan(changed)
    assert.deepEqual(plan.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'], field)
    assert.equal(plan.hashes.intendedWorkerArtifact !== baseline.hashes.intendedWorkerArtifact, workerChanges, `${field}: Worker`)
    assert.equal(plan.hashes.intendedPagesArtifact !== baseline.hashes.intendedPagesArtifact, pagesChanges, `${field}: Pages`)
  }
  const absent = planFixture()
  absent.remote.pages.artifactHash = null
  absent.remote.worker.artifactHash = null
  assert.deepEqual(buildReleasePlan(absent).futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
  const mismatch = planFixture()
  mismatch.remote.pages.artifactHash = '0'.repeat(64)
  mismatch.remote.worker.artifactHash = '0'.repeat(64)
  assert.deepEqual(buildReleasePlan(mismatch).futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
  assert.equal(baseline.artifactEvidence.pages.sourceCommitMatches, true)
  assert.equal(baseline.artifactEvidence.pages.provenCurrent, false)
  assert.equal(baseline.artifactEvidence.pages.provenance, 'unproven')
  assert.equal(baseline.artifactEvidence.worker.provenCurrent, false)
  assert.equal(baseline.artifactEvidence.worker.activeDeploymentId, WORKER_DEPLOYMENT_ID)
  assert.equal(baseline.artifactEvidence.worker.activeVersionId, WORKER_VERSION_ID)
})

test('P1-08 immutable HEAD tree hashing is deterministic and does not reduce identity to the commit hash', () => {
  const tree = [
    `100644 blob ${'1'.repeat(40)}\tpackage.json`,
    `100644 blob ${'2'.repeat(40)}\tpackage-lock.json`,
    `100644 blob ${'3'.repeat(40)}\tsrc/main.tsx`,
    `100644 blob ${'4'.repeat(40)}\tpublic/asset.svg`,
    `100644 blob ${'5'.repeat(40)}\tfunctions/api.ts`,
    `100644 blob ${'6'.repeat(40)}\tworkers/draft-validation/src/index.ts`,
  ].join('\0') + '\0'
  const runner = (command, args) => command === 'git' && args[0] === 'ls-tree' ? result(tree) : result()
  const input = { repositoryRoot: REPOSITORY_ROOT, manifestHash: loaded.hash, configurationHash: 'f'.repeat(64), toolchain: { node: '24.0.0', npm: '11.0.0', wrangler: '4.111.0' }, runner }
  const first = computeReleaseHashes(input)
  const second = computeReleaseHashes(input)
  assert.deepEqual(first, second)
  assert.notEqual(first.workerSourceArtifact, first.pagesSourceArtifact)
  assert.equal(first.package.length, 64)
})

test('P1-09 online inspection omits the raw Worker source endpoint', async () => {
  let contacts = 0
  const client = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async () => { contacts += 1; return jsonResponse({}) },
  })
  await assert.rejects(client.request('worker-metadata', { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name }), /not allowlisted/)
  assert.equal(contacts, 0)
  const inspected = completeInspectionClient()
  await inspectPreviewRemoteState({ manifest: resolvedManifest(), client: inspected.client })
  assert.equal(inspected.calls.some(({ operation }) => operation === 'worker-metadata'), false)
})

test('P1-10 request deadline remains active through body streaming and cancels stalled readers without retry', async () => {
  const reviewed = resolvedManifest()
  let zeroContacts = 0
  let zeroClears = 0
  const zeroDeadline = createReadOnlyCloudflareClient({
    manifest: reviewed,
    token: 'sensitive-fixture-value',
    timeoutMs: 0,
    monotonicNow: () => 100,
    setTimer: () => Symbol('zero-deadline'),
    clearTimer: () => { zeroClears += 1 },
    fetchImplementation: async () => { zeroContacts += 1; return jsonResponse({ id: ACCOUNT_ID }) },
  })
  await assert.rejects(zeroDeadline.request('account', { accountId: ACCOUNT_ID }), (error) => error.classification === 'request_timeout')
  assert.equal(zeroContacts, 0)
  assert.equal(zeroClears, 1)

  for (const partial of [false, true]) {
    let contacts = 0
    let cancellations = 0
    const stream = new ReadableStream({
      start(controller) { if (partial) controller.enqueue(new TextEncoder().encode('{"success":true,')) },
      cancel() { cancellations += 1 },
    })
    const client = createReadOnlyCloudflareClient({
      manifest: reviewed, token: 'sensitive-fixture-value', timeoutMs: 5,
      fetchImplementation: async () => { contacts += 1; return new Response(stream, { headers: { 'content-type': 'application/json' } }) },
    })
    await assert.rejects(client.request('account', { accountId: ACCOUNT_ID }), (error) => error.classification === 'request_timeout')
    assert.equal(contacts, 1)
    assert.equal(cancellations, 1)
  }

  let parsingClockCalls = 0
  let parsingClears = 0
  const parsingDeadline = createReadOnlyCloudflareClient({
    manifest: reviewed,
    token: 'sensitive-fixture-value',
    timeoutMs: 10,
    monotonicNow: () => (++parsingClockCalls >= 16 ? 20 : 0),
    setTimer: () => Symbol('parsing-deadline'),
    clearTimer: () => { parsingClears += 1 },
    fetchImplementation: async () => jsonResponse({ id: ACCOUNT_ID }),
  })
  await assert.rejects(parsingDeadline.request('account', { accountId: ACCOUNT_ID }), (error) => error.classification === 'request_timeout')
  assert.equal(parsingClears, 1)

  let successClears = 0
  const completing = createReadOnlyCloudflareClient({
    manifest: reviewed,
    token: 'sensitive-fixture-value',
    timeoutMs: 10,
    monotonicNow: (() => { let first = true; return () => { if (first) { first = false; return 0 } return 9 } })(),
    setTimer: () => Symbol('success-deadline'),
    clearTimer: () => { successClears += 1 },
    fetchImplementation: async () => jsonResponse({ id: ACCOUNT_ID }),
  })
  assert.deepEqual(await completing.request('account', { accountId: ACCOUNT_ID }), { id: ACCOUNT_ID })
  assert.equal(successClears, 1)
})

test('FINAL-01 endpoint semantics remain inside the production inspection request deadline', async () => {
  for (const [label, deadlineStage, operation] of [
    ['Pages project binding validation', 'pages-project-binding-normalized', 'pages-project'],
    ['Worker active deployment validation', 'worker-deployments-version-normalized', 'worker-deployments'],
    ['D1 migration-result validation', 'd1-query-rows-normalized', 'migration-tables'],
    ['Worker domain normalization', 'worker-domains-inventory-normalized', 'worker-domains'],
  ]) {
    const expired = productionInspectionHarness({ deadlineStage })
    await assert.rejects(
      inspectPreviewRemoteState({ manifest: expired.reviewed, client: expired.client }),
      (error) => error.classification === 'request_timeout',
      label,
    )
    assert.equal(expired.contacts.filter((contact) => contact === operation).length, 1, `${label} did not retry`)
    assert.equal(expired.clears(), expired.contacts.length, `${label} cleaned each contacted request timer exactly once`)
  }

  const justBefore = productionInspectionHarness({ deadlineStage: 'pages-project-bindings-complete', deadlineValue: 9 })
  const remote = await inspectPreviewRemoteState({ manifest: justBefore.reviewed, client: justBefore.client })
  assert.equal(remote.pages.project, manifest.cloudflare.preview.pages.project)
  assert.equal(justBefore.clears(), justBefore.contacts.length)

  const callbackNotRun = productionInspectionHarness({ deadlineStage: 'pages-project-bindings-complete', deadlineValue: 10 })
  await assert.rejects(
    inspectPreviewRemoteState({ manifest: callbackNotRun.reviewed, client: callbackNotRun.client }),
    (error) => error.classification === 'request_timeout',
  )
  assert.equal(callbackNotRun.contacts.filter((contact) => contact === 'pages-project').length, 1)
  assert.equal(callbackNotRun.clears(), callbackNotRun.contacts.length)
})

test('P1-11 every Cloudflare operation enforces exact parameters and rejects irrelevant Production values before fetch', async () => {
  const reviewed = resolvedManifest()
  const exact = {
    account: { accountId: ACCOUNT_ID },
    'account-zones': { accountId: ACCOUNT_ID, page: 1 },
    'pages-project': { accountId: ACCOUNT_ID, project: manifest.cloudflare.preview.pages.project },
    'pages-deployments': { accountId: ACCOUNT_ID, project: manifest.cloudflare.preview.pages.project, page: 1 },
    'worker-settings': { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name },
    'worker-deployments': { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name },
    'worker-subdomain': { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name },
    'worker-schedules': { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name },
    'worker-domains': { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name },
    'worker-routes': { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name, zoneId: ZONE_ID },
    'd1-database': { accountId: ACCOUNT_ID, databaseId: manifest.cloudflare.preview.d1.id },
    'migration-tables': { accountId: ACCOUNT_ID, databaseId: manifest.cloudflare.preview.d1.id },
    'migration-rows': { accountId: ACCOUNT_ID, databaseId: manifest.cloudflare.preview.d1.id },
    'backend-version': { accountId: ACCOUNT_ID, databaseId: manifest.cloudflare.preview.d1.id },
  }
  for (const [operation, parameters] of Object.entries(exact)) {
    let contacts = 0
    const client = createReadOnlyCloudflareClient({
      manifest: reviewed, token: 'sensitive-fixture-value',
      fetchImplementation: async () => {
        contacts += 1
        if (['account-zones', 'pages-deployments'].includes(operation)) {
          return jsonResponse([], { resultInfo: { count: 0, page: 1, per_page: 25, total_count: 0, total_pages: 1 } })
        }
        if (operation === 'worker-domains' || operation === 'worker-routes') return jsonResponse([])
        if (operation === 'worker-deployments') return jsonResponse({ deployments: [] })
        return jsonResponse(operation.startsWith('migration-') || operation === 'backend-version' ? [] : {})
      },
    })
    await client.request(operation, parameters)
    assert.equal(contacts, 1, operation)

    const invalidInputs = []
    const missing = clone(parameters)
    delete missing[Object.keys(missing)[0]]
    invalidInputs.push(missing)
    invalidInputs.push({ ...parameters, unexpected: 'value' })
    invalidInputs.push({ ...parameters, irrelevant: reviewed.cloudflare.production.worker.name })
    invalidInputs.push({ ...parameters, irrelevant: reviewed.cloudflare.production.d1.id })
    invalidInputs.push({ ...parameters, irrelevant: encodeURIComponent(encodeURIComponent(reviewed.cloudflare.production.worker.name)) })
    for (const invalid of invalidInputs) await assert.rejects(client.request(operation, invalid))
    assert.equal(contacts, 1, `${operation} rejected inputs`)

    for (const key of Object.keys(parameters)) {
      let getterReads = 0
      const accessorParameters = {}
      for (const [name, value] of Object.entries(parameters)) Object.defineProperty(accessorParameters, name, { enumerable: true, configurable: true, writable: true, value })
      Object.defineProperty(accessorParameters, key, {
        enumerable: true,
        configurable: true,
        get() { getterReads += 1; return getterReads === 1 ? parameters[key] : reviewed.cloudflare.production.worker.name },
      })
      await assert.rejects(client.request(operation, accessorParameters), /accessors/)
      assert.equal(getterReads, 0, `${operation}.${key}`)
    }
    assert.equal(contacts, 1, `${operation} rejected accessor inputs`)
  }

  for (const unexpectedName of ['domain', 'branch']) {
    let getterReads = 0
    const input = { accountId: ACCOUNT_ID }
    Object.defineProperty(input, unexpectedName, { enumerable: true, get() { getterReads += 1; return 'develop' } })
    await assert.rejects(createReadOnlyCloudflareClient({
      manifest: reviewed,
      token: 'sensitive-fixture-value',
      fetchImplementation: async () => { throw new Error('fetch must not run') },
    }).request('account', input))
    assert.equal(getterReads, 0)
  }

  const surpriseInputs = [
    Object.assign(Object.create({ inherited: 'value' }), { accountId: ACCOUNT_ID }),
    Object.defineProperty({ accountId: ACCOUNT_ID }, 'hidden', { value: 'value' }),
    Object.assign({ accountId: ACCOUNT_ID }, { [Symbol('surprise')]: 'value' }),
  ]
  for (const input of surpriseInputs) {
    let contacts = 0
    const client = createReadOnlyCloudflareClient({
      manifest: reviewed,
      token: 'sensitive-fixture-value',
      fetchImplementation: async () => { contacts += 1; return jsonResponse({ id: ACCOUNT_ID }) },
    })
    await assert.rejects(client.request('account', input))
    assert.equal(contacts, 0)
  }

  let exactIdentityContacts = 0
  const exactIdentityClient = createReadOnlyCloudflareClient({
    manifest: reviewed, token: 'sensitive-fixture-value',
    fetchImplementation: async () => { exactIdentityContacts += 1; return jsonResponse([]) },
  })
  await assert.rejects(exactIdentityClient.request('pages-project', { accountId: ACCOUNT_ID, project: 'unexpected-project' }))
  await assert.rejects(exactIdentityClient.request('worker-routes', { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name, zoneId: 'e'.repeat(32) }))
  assert.equal(exactIdentityContacts, 0)
})

test('P1-12 endpoint-specific inventory contracts preserve completeness and select the latest relevant deployment', async () => {
  const older = Array.from({ length: 25 }, (_, index) => previewDeployment(`older-${index}`, `2026-07-21T${String(index % 24).padStart(2, '0')}:00:00.000Z`))
  const latest = previewDeployment('latest', '2026-07-22T13:00:00.000Z')
  const paginated = completeInspectionClient({ pages: [[older[10], ...older.slice(0, 10), ...older.slice(11)], [latest]] })
  const remote = await inspectPreviewRemoteState({ manifest: resolvedManifest(), client: paginated.client })
  assert.equal(remote.pages.deployment.id, 'latest')
  assert.equal(paginated.calls.filter(({ operation }) => operation === 'pages-deployments').length, 2)

  for (const pages of [
    [[previewDeployment('duplicate')], [previewDeployment('duplicate', '2026-07-23T12:00:00.000Z')]],
    [[previewDeployment('equal-a'), previewDeployment('equal-b')]],
    [[previewDeployment('wrong-branch', '2026-07-22T13:00:00.000Z', 'feature')]],
    [[{ ...previewDeployment('bad-time'), created_on: 'not-a-timestamp' }]],
  ]) {
    const unsafe = completeInspectionClient({ pages })
    await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: unsafe.client }))
  }

  let contacts = 0
  const missingMetadata = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async () => { contacts += 1; return jsonResponse([]) },
  })
  await assert.rejects(missingMetadata.request('pages-deployments', { accountId: ACCOUNT_ID, project: manifest.cloudflare.preview.pages.project, page: 1 }), /pagination metadata/)
  assert.equal(contacts, 1)
  const excessive = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async () => jsonResponse([], { resultInfo: { count: 0, page: 1, per_page: 25, total_count: 0, total_pages: 11 } }),
  })
  await assert.rejects(excessive.request('pages-deployments', { accountId: ACCOUNT_ID, project: manifest.cloudflare.preview.pages.project, page: 1 }), /incomplete or inconsistent/)

  const truncated = completeInspectionClient({ pages: [[previewDeployment('only-one')], []] })
  await assert.rejects(inspectPreviewRemoteState({ manifest: resolvedManifest(), client: truncated.client }), /pagination/)

  const domainsWithoutMetadata = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async () => jsonResponse([]),
  })
  assert.deepEqual(await domainsWithoutMetadata.request('worker-domains', {
    accountId: ACCOUNT_ID,
    worker: manifest.cloudflare.preview.worker.name,
  }), { items: [], resultInfo: null })

  const documentedDomain = { hostname: 'preview.example.invalid', service: manifest.cloudflare.preview.worker.name, environment: 'production', zone_id: ZONE_ID }
  const domainsWithMetadata = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async () => jsonResponse([documentedDomain], {
      resultInfo: { count: 1, page: 1, per_page: 20, total_count: 1, total_pages: 1 },
    }),
  })
  assert.deepEqual((await domainsWithMetadata.request('worker-domains', {
    accountId: ACCOUNT_ID,
    worker: manifest.cloudflare.preview.worker.name,
  })).items, [documentedDomain])

  const inconsistentDomains = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async () => jsonResponse([], {
      resultInfo: { count: 0, page: 1, per_page: 20, total_count: 1, total_pages: 1 },
    }),
  })
  await assert.rejects(inconsistentDomains.request('worker-domains', {
    accountId: ACCOUNT_ID,
    worker: manifest.cloudflare.preview.worker.name,
  }), /incomplete or inconsistent/)

  const documentedRoute = { id: 'route-id', pattern: 'preview.example.invalid/*', script: manifest.cloudflare.preview.worker.name }
  const routes = createReadOnlyCloudflareClient({
    manifest: resolvedManifest(), token: 'sensitive-fixture-value',
    fetchImplementation: async (url) => {
      assert.equal(new URL(url).search, '')
      return jsonResponse([documentedRoute])
    },
  })
  assert.deepEqual(await routes.request('worker-routes', {
    accountId: ACCOUNT_ID,
    worker: manifest.cloudflare.preview.worker.name,
    zoneId: ZONE_ID,
  }), [documentedRoute])

  for (const [operation, parameters, resultValue] of [
    ['worker-domains', { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name }, {}],
    ['worker-routes', { accountId: ACCOUNT_ID, worker: manifest.cloudflare.preview.worker.name, zoneId: ZONE_ID }, {}],
  ]) {
    const malformed = createReadOnlyCloudflareClient({
      manifest: resolvedManifest(), token: 'sensitive-fixture-value',
      fetchImplementation: async () => jsonResponse(resultValue),
    })
    await assert.rejects(malformed.request(operation, parameters), /unexpected JSON shape/)
  }
})

test('P1-13 manifest parsing rejects duplicate and dangerous keys and returns deeply immutable plain data', () => {
  const duplicateTop = loaded.source.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "schemaVersion": 1,')
  const duplicateNested = loaded.source.replace('"branch": "develop",', '"branch": "develop",\n        "branch": "develop",')
  const dangerous = loaded.source.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "__proto__": {},')
  for (const source of [duplicateTop, duplicateNested]) assert.throws(() => parseReleaseManifest(source), /duplicate object key/)
  assert.throws(() => parseReleaseManifest(dangerous), /dangerous object key/)

  const accessor = clone(manifest)
  Object.defineProperty(accessor, 'schemaVersion', { enumerable: true, get() { throw new Error('getter executed') } })
  assert.throws(() => validateReleaseManifest(accessor), /accessors/)
  const exotic = Object.create({ inherited: true })
  Object.assign(exotic, clone(manifest))
  assert.throws(() => validateReleaseManifest(exotic), /plain object/)

  let getterReads = 0
  const accessorArray = [manifest.activation.allowedStates[0]]
  Object.defineProperty(accessorArray, '0', { enumerable: true, configurable: true, get() { getterReads += 1; return 'disabled' } })
  for (const unsafe of [
    accessorArray,
    new (class UnsafeArray extends Array {})('disabled'),
    Object.assign(['disabled'], { [Symbol('surprise')]: true }),
    Object.assign(['disabled'], { surprise: true }),
    Array(1),
    Object.seal(['disabled']),
  ]) assert.throws(() => immutablePlain(unsafe), /plain array|symbol|sparse arrays|standard data elements/)
  assert.equal(getterReads, 0)

  const source = [{ state: 'disabled' }]
  const copied = immutablePlain(source)
  source[0].state = 'changed'
  source.push({ state: 'changed' })
  assert.deepEqual(copied, [{ state: 'disabled' }])
  assert.equal(Object.isFrozen(copied), true)
  assert.equal(Object.isFrozen(copied[0]), true)
  assert.throws(() => copied.push({ state: 'changed' }), TypeError)

  let planGetterReads = 0
  const unsafePlanInput = planFixture()
  const unsafeSchedules = []
  Object.defineProperty(unsafeSchedules, '0', { enumerable: true, configurable: true, get() { planGetterReads += 1; return manifest.activation.cleanupCron } })
  Object.defineProperty(unsafeSchedules, 'length', { writable: true, value: 1 })
  unsafePlanInput.remote.worker.schedules = unsafeSchedules
  assert.throws(() => buildReleasePlan(unsafePlanInput), /standard data elements/)
  assert.equal(planGetterReads, 0)

  let reportGetterReads = 0
  const unsafeChecks = []
  Object.defineProperty(unsafeChecks, '0', { enumerable: true, configurable: true, get() { reportGetterReads += 1; return { id: 'unsafe', status: 'PASS', summary: 'unsafe' } } })
  Object.defineProperty(unsafeChecks, 'length', { writable: true, value: 1 })
  assert.throws(() => checkReport({ mode: 'offline', checks: unsafeChecks }), /standard data elements/)
  assert.equal(reportGetterReads, 0)

  const validated = parseReleaseManifest(loaded.source)
  assert.equal(Object.isFrozen(validated.cloudflare.preview), true)
  assert.equal(Object.isFrozen(validated.activation.allowedStates), true)
  assert.throws(() => { validated.cloudflare.preview.worker.name = 'changed' }, TypeError)
  assert.throws(() => { validated.activation.allowedStates.push('changed') }, TypeError)
  assert.equal(validated.cloudflare.preview.worker.name, manifest.cloudflare.preview.worker.name)
})

test('P1-14 plans and report inputs are canonical, unaliased, recursively frozen, and ID-consistent', () => {
  const input = planFixture({ targetState: 'cron-enabled', migration: validMigration(1) })
  const originalRemoteId = input.remote.pages.deployment.id
  const plan = buildReleasePlan(input)
  const before = JSON.stringify(plan)
  for (const mutate of [
    () => plan.futureStages.push({ id: 'unsafe' }),
    () => plan.approvalCheckpoints.push('unsafe'),
    () => plan.migration.pending.splice(0, 1),
    () => { plan.remoteBefore.pages.deployment.id = 'unsafe' },
  ]) assert.throws(mutate, TypeError)
  input.remote.pages.deployment.id = 'changed-after-plan'
  input.migration.pending.length = 0
  assert.equal(plan.remoteBefore.pages.deployment.id, originalRemoteId)
  assert.equal(JSON.stringify(plan), before)
  const { planId, ...withoutId } = plan
  assert.equal(derivePlanId(withoutId), planId)
  assert.equal(Object.isFrozen(plan.remoteBefore.worker.bindings), true)
})

test('stable exit-code contract exposes only Phase 1 codes', () => {
  assert.deepEqual(EXIT_CODES, { SUCCESS: 0, USAGE: 2, LOCAL_FAILURE: 10, REMOTE_FAILURE: 11, PRODUCTION_REFUSAL: 12 })
})
