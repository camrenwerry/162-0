import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from './lib/preview-release/canonical.mjs'
import {
  loadReleaseManifest,
  productionDenylist,
} from './lib/preview-release/manifest.mjs'
import {
  normalizeBackendSchemaVersion,
  normalizeD1Database,
  normalizeMigrationRows,
  normalizeMigrationTableDiscovery,
  repositoryMigrationNamesForObservation,
} from './lib/release-inspection/preview-d1-observer.mjs'
import {
  finalizePagesDeployments,
  normalizePagesDeploymentPage,
  normalizePagesProject,
} from './lib/release-inspection/preview-pages-observer.mjs'
import {
  observePreviewResourcesWithTransport,
} from './lib/release-inspection/preview-resource-observer.mjs'
import { validatePreviewNormalizedResourceValue } from './lib/release-inspection/preview-resource-schemas.mjs'
import {
  PreviewResourceNormalizationError,
} from './lib/release-inspection/preview-normalization.mjs'
import {
  finalizeWorkerRoutes,
  normalizeWorkerCustomDomains,
  normalizeWorkerDeployments,
  normalizeWorkerRoutes,
  normalizeWorkerSchedules,
  normalizeWorkerSettings,
  normalizeWorkerSubdomain,
} from './lib/release-inspection/preview-worker-observer.mjs'
import {
  createMockPreviewResourceTransport,
} from './lib/release-inspection/testing/mock-preview-transport.mjs'
import { REMOTE_OBSERVATION_LIMITS } from './lib/release-inspection/remote-transport.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = path.join(ROOT, 'scripts/fixtures/release-observation/preview-single-read-v1')
const ACCOUNT_ID = '1'.repeat(32)
const ZONE_ID = '2'.repeat(32)
const DATABASE_ID = '00000000-0000-4000-8000-000000000001'
const TOKEN = 'synthetic-preview-resource-token'
const identity = Object.freeze({
  accountId: ACCOUNT_ID,
  pagesProject: 'diamond-draft',
  workerName: 'pennant-pursuit-validation-preview',
  databaseId: 'ba6255b4-9425-4863-b10f-79149180f75a',
  observedDatabaseId: DATABASE_ID,
  observedRateLimitNamespaceIds: Object.freeze({
    RATE_LIMIT_BURST: 'fixture-preview-rate-limit-burst',
    RATE_LIMIT_SUSTAINED: 'fixture-preview-rate-limit-sustained',
  }),
  routeZoneIds: Object.freeze([ZONE_ID]),
})
const repositoryNames = repositoryMigrationNamesForObservation()
const MAXIMUM_RECORDS = REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily

function fixture(name) {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)))
}

function parsedFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))
}

function bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value))
}

function operation(name) {
  if (name === 'account-zones' || name === 'pages-preview-deployments') {
    return { operation: name, page: 1 }
  }
  if (name === 'worker-routes') return { operation: name, routeZoneIndex: 0 }
  return { operation: name }
}

function exchange(name, fixtureName, overrides = {}) {
  return {
    request: operation(name),
    bytes: fixture(fixtureName),
    status: 200,
    contentType: 'application/json',
    fault: 'none',
    ...overrides,
  }
}

const fullExchanges = () => [
  exchange('account', 'account.json'),
  exchange('account-zones', 'zones-page.json'),
  exchange('pages-project', 'pages-project.json'),
  exchange('pages-preview-deployments', 'pages-deployments-page.json'),
  exchange('worker-settings', 'worker-settings.json'),
  exchange('worker-deployments', 'worker-deployments.json'),
  exchange('worker-subdomain', 'worker-subdomain.json'),
  exchange('worker-schedules', 'worker-schedules.json'),
  exchange('worker-custom-domains', 'worker-custom-domains.json'),
  exchange('worker-routes', 'worker-routes.json'),
  exchange('d1-database', 'd1-database.json'),
  exchange('migration-table-discovery', 'migration-tables-query.json'),
  exchange('migration-rows', 'migration-rows-query.json'),
  exchange('backend-schema-version', 'backend-schema-version-query.json'),
]

function providerBytes(result, resultInfo) {
  return bytes({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
  })
}

async function observeOperationResult(operationName, result, resultInfo, capturedAtMs = 1_800_000_001_000) {
  const exchanges = fullExchanges()
  const index = exchanges.findIndex(({ request }) => request.operation === operationName)
  assert.notEqual(index, -1)
  exchanges[index] = {
    ...exchanges[index],
    bytes: providerBytes(result, resultInfo),
  }
  const snapshot = await observePreviewResourcesWithTransport(createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    exchanges,
  ), { capturedAtMs })
  return {
    snapshot,
    outcome: snapshot.resourceOutcomes.find(({ operation: name }) => name === operationName),
  }
}

function syntheticRouteZoneId(index) {
  return index === 0 ? ZONE_ID : (index + 2).toString(16).padStart(32, '0')
}

function routeRecords(count, { offset = 0, script = identity.workerName } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = offset + index
    return {
      id: `route-budget-${String(ordinal).padStart(4, '0')}`,
      pattern: `route-budget-${ordinal}.preview.invalid/*`,
      script,
    }
  })
}

function workerDeploymentRecords(count) {
  const baseTime = 1_900_000_000_000
  return Array.from({ length: count }, (_, index) => ({
    id: `worker-deployment-budget-${String(index).padStart(4, '0')}`,
    created_on: new Date(baseTime - index * 1_000).toISOString(),
    versions: [{
      version_id: `worker-version-budget-${String(index).padStart(4, '0')}`,
      percentage: 100,
    }],
  }))
}

function workerDeploymentsWithAggregateVersions(secondVersionCount, { permuted = false } = {}) {
  const firstVersionCount = Math.floor(MAXIMUM_RECORDS / 2)
  const deployments = [firstVersionCount, secondVersionCount].map((count, deploymentIndex) => ({
    id: `aggregate-version-deployment-${deploymentIndex}`,
    created_on: new Date(1_950_000_000_000 - deploymentIndex * 1_000).toISOString(),
    versions: Array.from({ length: count }, (_, versionIndex) => ({
      version_id: `aggregate-version-${deploymentIndex}-${String(versionIndex).padStart(4, '0')}`,
      percentage: versionIndex === 0 ? 100 : 0,
    })),
  }))
  if (permuted) {
    deployments.forEach(({ versions }) => versions.reverse())
    deployments.reverse()
  }
  return deployments
}

function pagesDeploymentWithAliases(ordinal, aliasCount) {
  const deployment = structuredClone(parsedFixture('pages-deployments-page.json').result[0])
  const createdAtMs = 2_050_000_000_000 - ordinal * 100_000
  deployment.id = `cross-page-deployment-${String(ordinal).padStart(3, '0')}`
  deployment.created_on = new Date(createdAtMs).toISOString()
  deployment.modified_on = new Date(createdAtMs + 90_000).toISOString()
  deployment.latest_stage.started_on = new Date(createdAtMs + 30_000).toISOString()
  deployment.latest_stage.ended_on = new Date(createdAtMs + 80_000).toISOString()
  deployment.url = `https://cross-page-deployment-${ordinal}.preview.invalid`
  deployment.aliases = Array.from(
    { length: aliasCount },
    (_, aliasIndex) => `https://cross-page-${ordinal}-alias-${aliasIndex}.preview.invalid`,
  )
  return deployment
}

function pagesAliasPaginationExchanges(secondPageAliasCount, { permuted = false } = {}) {
  const firstPage = Array.from(
    { length: 25 },
    (_, ordinal) => pagesDeploymentWithAliases(ordinal, 5),
  )
  const secondPage = [pagesDeploymentWithAliases(25, secondPageAliasCount)]
  if (permuted) {
    firstPage.forEach(({ aliases }) => aliases.reverse())
    secondPage[0].aliases.reverse()
    firstPage.reverse()
  }
  const exchanges = fullExchanges()
  const deploymentIndex = exchanges.findIndex(
    ({ request }) => request.operation === 'pages-preview-deployments',
  )
  assert.notEqual(deploymentIndex, -1)
  exchanges.splice(
    deploymentIndex,
    1,
    {
      ...exchange('pages-preview-deployments', 'pages-deployments-page.json'),
      request: { operation: 'pages-preview-deployments', page: 1 },
      bytes: providerBytes(firstPage, {
        page: 1, per_page: 25, count: 25, total_count: 26, total_pages: 2,
      }),
    },
    {
      ...exchange('pages-preview-deployments', 'pages-deployments-page.json'),
      request: { operation: 'pages-preview-deployments', page: 2 },
      bytes: providerBytes(secondPage, {
        page: 2, per_page: 25, count: 1, total_count: 26, total_pages: 2,
      }),
    },
  )
  return exchanges
}

async function observePagesAliasAggregate(secondPageAliasCount, options, capturedAtMs) {
  const transport = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    pagesAliasPaginationExchanges(secondPageAliasCount, options),
  )
  const snapshot = await observePreviewResourcesWithTransport(transport, { capturedAtMs })
  assert.equal(transport.requestBudget().used, 15)
  assert.equal(transport.assertExhausted(), true)
  return {
    snapshot,
    outcome: snapshot.resourceOutcomes.find(
      ({ operation: name }) => name === 'pages-preview-deployments',
    ),
  }
}

function scheduleRecords(count) {
  return Array.from({ length: count }, (_, index) => ({
    cron: `${index % 60} ${Math.floor(index / 60)} * * *`,
  }))
}

function customDomainRecords(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `domain-budget-${String(index).padStart(4, '0')}`,
    hostname: `domain-budget-${index}.preview.invalid`,
    service: identity.workerName,
    zone_id: ZONE_ID,
    zone_name: 'preview.invalid',
    environment: 'preview',
    cert_id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
  }))
}

function routeAggregationExchanges(routeCounts) {
  const zoneCount = routeCounts.length
  const exchanges = [exchange('account', 'account.json')]
  const totalPages = Math.ceil(zoneCount / 25)
  for (let page = 1; page <= totalPages; page += 1) {
    const start = (page - 1) * 25
    const records = Array.from(
      { length: Math.min(25, zoneCount - start) },
      (_, offset) => {
        const ordinal = start + offset
        return { id: syntheticRouteZoneId(ordinal), name: `zone-${ordinal}.preview.invalid` }
      },
    )
    exchanges.push({
      ...exchange('account-zones', 'zones-page.json'),
      request: { operation: 'account-zones', page },
      bytes: providerBytes(records, {
        page,
        per_page: 25,
        count: records.length,
        total_count: zoneCount,
        total_pages: totalPages,
      }),
    })
  }
  exchanges.push(
    exchange('pages-project', 'pages-project.json'),
    exchange('pages-preview-deployments', 'pages-deployments-page.json'),
    exchange('worker-settings', 'worker-settings.json'),
    exchange('worker-deployments', 'worker-deployments.json'),
    exchange('worker-subdomain', 'worker-subdomain.json'),
    exchange('worker-schedules', 'worker-schedules.json'),
    exchange('worker-custom-domains', 'worker-custom-domains.json'),
  )
  let offset = 0
  for (let routeZoneIndex = 0; routeZoneIndex < zoneCount; routeZoneIndex += 1) {
    exchanges.push({
      ...exchange('worker-routes', 'worker-routes.json'),
      request: { operation: 'worker-routes', routeZoneIndex },
      bytes: providerBytes(routeRecords(routeCounts[routeZoneIndex], { offset })),
    })
    offset += routeCounts[routeZoneIndex]
  }
  exchanges.push(
    exchange('d1-database', 'd1-database.json'),
    exchange('migration-table-discovery', 'migration-tables-query.json'),
    exchange('migration-rows', 'migration-rows-query.json'),
    exchange('backend-schema-version', 'backend-schema-version-query.json'),
  )
  return exchanges
}

test('fixture catalog covers every registered resource operation with strict provider envelopes', () => {
  const index = parsedFixture('index.json')
  assert.equal(index.schemaVersion, 1)
  assert.deepEqual(Object.keys(index.fixtures), fullExchanges().map(({ request }) => request.operation))
  for (const name of Object.values(index.fixtures)) {
    const fixtureValue = parsedFixture(name)
    assert.equal(fixtureValue.success, true)
    assert.deepEqual(fixtureValue.errors, [])
    assert.deepEqual(fixtureValue.messages, [])
    assert.ok(Object.hasOwn(fixtureValue, 'result'))
  }
})

test('raw fixtures contain only synthetic identifiers and no credential-shaped material', () => {
  const manifest = loadReleaseManifest(ROOT).manifest
  const realIdentifiers = [
    manifest.cloudflare.account.id,
    manifest.cloudflare.preview.d1.id,
    ...manifest.cloudflare.preview.worker.rateLimitNamespaces,
    ...manifest.cloudflare.preview.worker.routeZoneIds.values,
    ...productionDenylist(manifest, { includeBranch: false }),
  ].filter(Boolean)
  const sources = readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFileSync(path.join(FIXTURES, name), 'utf8'))
  for (const source of sources) {
    for (const identifier of realIdentifiers) assert.equal(source.includes(identifier), false)
    assert.doesNotMatch(source, /(?:bearer\s+|api[_-]?token|authorization|-----BEGIN)/iu)
  }
})

test('full fixture-backed mock read exercises transport, parser, private normalization, and snapshot contract', async () => {
  const mock = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    fullExchanges(),
  )
  const snapshot = await observePreviewResourcesWithTransport(mock, { capturedAtMs: 1_800_000_000_000 })
  assert.equal(snapshot.observationState, 'complete')
  assert.equal(snapshot.resourceOutcomes.length, 14)
  assert.equal(mock.requestBudget().used, 14)
  assert.equal(mock.assertExhausted(), true)
  assert.equal(Object.isFrozen(snapshot), true)
  const rendered = canonicalJson(snapshot)
  for (const secret of [ACCOUNT_ID, ZONE_ID, DATABASE_ID, TOKEN, 'authorization', 'cf_ray']) {
    assert.equal(rendered.includes(secret), false)
  }
  assert.equal(rendered.includes('MATCH'), false)
  assert.equal(rendered.includes('DRIFT'), false)
  assert.equal(snapshot.releaseCurrentness, 'UNKNOWN')
  assert.equal(snapshot.executionAuthorization, 'prohibited')
})

test('Pages project retains only approved Preview configuration and discards incidental Production fields', () => {
  const envelope = parsedFixture('pages-project.json')
  const value = normalizePagesProject(envelope.result, identity)
  assert.equal(value.identity, 'approved-preview-pages-project')
  assert.deepEqual(value.compatibilityFlags, ['nodejs_compat'])
  assert.deepEqual(value.bindings.map(({ category }) => category), ['d1', 'service'])
  assert.equal(canonicalJson(value).includes('production_branch'), false)
  assert.equal(canonicalJson(value).includes('main'), false)
})

test('Pages project rejects unknown variables, secret-like fields, binding mismatches, and Production poisoning', () => {
  const valid = parsedFixture('pages-project.json').result
  const variants = [
    { ...valid, deployment_configs: { preview: { ...valid.deployment_configs.preview, env_vars: { UNKNOWN_MODE: 'disabled' } } } },
    { ...valid, deployment_configs: { preview: { ...valid.deployment_configs.preview, env_vars: { API_TOKEN: 'disabled' } } } },
    { ...valid, deployment_configs: { preview: { ...valid.deployment_configs.preview, d1_databases: { DB: { id: '00000000-0000-4000-8000-000000000002' } } } } },
    { ...valid, source: 'pennant-pursuit-validation-production' },
  ]
  for (const variant of variants) assert.throws(() => normalizePagesProject(variant, identity))
})

test('Pages deployment pagination normalizes deterministically and rejects empty, duplicate, tied, and malformed records', () => {
  const envelope = parsedFixture('pages-deployments-page.json')
  const page = normalizePagesDeploymentPage(envelope.result, envelope.result_info, 1)
  const value = finalizePagesDeployments([page])
  assert.equal(value.latestIdentity, 'deployment-preview-001')
  assert.deepEqual(value.deployments[0].aliases, ['https://develop.diamond-draft.pages.dev'])
  assert.throws(() => finalizePagesDeployments([{
    deployments: [],
    providerIdentities: [],
    aliasRecordCount: 0,
    pageInfo: { page: 1, perPage: 25, totalCount: 0, totalPages: 1 },
  }]), /preview-deployment-missing/)
  assert.throws(() => finalizePagesDeployments([
    normalizePagesDeploymentPage([], {
      page: 1, per_page: 25, count: 0, total_count: 0, total_pages: 0,
    }, 1),
  ]), /preview-deployment-missing/)
  const duplicated = { ...envelope, result: [envelope.result[0], envelope.result[0]], result_info: {
    ...envelope.result_info, count: 2, total_count: 2,
  } }
  assert.throws(() => finalizePagesDeployments([
    normalizePagesDeploymentPage(duplicated.result, duplicated.result_info, 1),
  ]), /duplicate-deployment-identity/)
  const tied = structuredClone(envelope)
  tied.result.push(structuredClone(tied.result[0]))
  tied.result[1].id = 'deployment-preview-002'
  tied.result_info.count = 2
  tied.result_info.total_count = 2
  assert.throws(() => finalizePagesDeployments([
    normalizePagesDeploymentPage(tied.result, tied.result_info, 1),
  ]), /ambiguous-latest-deployment/)
  for (const mutation of [
    (entry) => { entry.environment = 'production' },
    (entry) => { entry.deployment_trigger.metadata.commit_hash = 'bad' },
    (entry) => { entry.created_on = 'yesterday' },
    (entry) => { entry.url = 'http://preview.invalid' },
    (entry) => { entry.aliases = ['develop.diamond-draft.pages.dev'] },
    (entry) => { entry.aliases = ['http://develop.diamond-draft.pages.dev'] },
    (entry) => { entry.aliases = ['https://develop.diamond-draft.pages.dev:8443'] },
    (entry) => { entry.aliases = ['https://develop.diamond-draft.pages.dev/path'] },
    (entry) => { entry.aliases = ['https://develop.diamond-draft.pages.dev?query=1'] },
    (entry) => { entry.latest_stage.status = 'unknown' },
  ]) {
    const invalid = structuredClone(envelope)
    mutation(invalid.result[0])
    assert.throws(() => normalizePagesDeploymentPage(invalid.result, invalid.result_info, 1))
  }
  const wrongBranch = structuredClone(envelope)
  wrongBranch.result[0].deployment_trigger.metadata.branch = 'feature/other'
  assert.throws(() => finalizePagesDeployments([
    normalizePagesDeploymentPage(wrongBranch.result, wrongBranch.result_info, 1),
  ]), /preview-deployment-missing/)
})

test('pagination freezes first-page totals and rejects changed metadata, truncation, and limit overflow', () => {
  const envelope = parsedFixture('pages-deployments-page.json')
  for (const change of [
    { page: 2 }, { per_page: 24 }, { count: 2 }, { total_pages: 11 }, { total_count: 251 },
  ]) assert.throws(() => normalizePagesDeploymentPage(
    envelope.result,
    { ...envelope.result_info, ...change },
    1,
  ))
})

test('production path enforces the cross-page aggregate Pages alias budget', async () => {
  const firstPageAliasCount = 25 * 5
  const accepted = await observePagesAliasAggregate(
    MAXIMUM_RECORDS - firstPageAliasCount,
    { permuted: false },
    1_800_000_001_005,
  )
  assert.equal(accepted.outcome.state, 'complete')
  assert.equal(accepted.outcome.value.deployments.reduce(
    (count, deployment) => count + deployment.aliases.length,
    0,
  ), MAXIMUM_RECORDS)

  const secondPageAliasCount = MAXIMUM_RECORDS - firstPageAliasCount + 1
  const refused = await observePagesAliasAggregate(
    secondPageAliasCount,
    { permuted: false },
    1_800_000_001_006,
  )
  const permuted = await observePagesAliasAggregate(
    secondPageAliasCount,
    { permuted: true },
    1_800_000_001_006,
  )
  for (const result of [refused, permuted]) {
    assert.equal(result.outcome.state, 'malformed')
    assert.equal(result.outcome.issueCode, 'resource-malformed')
    assert.equal(result.outcome.value, null)
    assert.equal(result.snapshot.resourceOutcomes.find(
      ({ operation: name }) => name === 'backend-schema-version',
    ).state, 'complete')
    const rendered = canonicalJson(result.snapshot)
    for (const sentinel of [
      'cross-page-deployment-000',
      `cross-page-25-alias-${secondPageAliasCount - 1}`,
      `https://cross-page-25-alias-${secondPageAliasCount - 1}.preview.invalid`,
      ACCOUNT_ID,
      ZONE_ID,
      TOKEN,
      'authorization',
      'cf_ray',
    ]) assert.equal(rendered.includes(sentinel), false)
  }
  assert.equal(canonicalJson(refused.snapshot), canonicalJson(permuted.snapshot))
})

test('Worker settings accepts allowlisted bindings and rejects collisions, unknown categories, secrets, and identity mismatch', () => {
  const result = parsedFixture('worker-settings.json').result
  const value = normalizeWorkerSettings(result, identity)
  assert.equal(value.secretPresence, 'unavailable')
  assert.deepEqual(value.bindings.map(({ name }) => name), [
    'DB', 'DRAFT_VALIDATION_MODE', 'RATE_LIMIT_BURST', 'RATE_LIMIT_SUSTAINED', 'VALIDATION_SERVICE',
  ])
  const variants = [
    { ...result, bindings: [...result.bindings, result.bindings[0]] },
    { ...result, bindings: [{ name: 'SECRET', type: 'secret_text', text: 'hidden' }] },
    { ...result, bindings: [{ name: 'UNKNOWN', type: 'plain_text', text: 'disabled' }] },
    { ...result, bindings: [{ name: 'DB', type: 'd1', id: '00000000-0000-4000-8000-000000000002' }] },
    { ...result, bindings: [{ name: 'VALIDATION_SERVICE', type: 'service', service: 'other-preview' }] },
    { ...result, bindings: [{ name: 'RATE_LIMIT_BURST', type: 'ratelimit', namespace_id: '999', simple: { limit: 5, period: 10 } }] },
  ]
  for (const variant of variants) assert.throws(() => normalizeWorkerSettings(variant, identity))
})

test('Pages and Worker compatibility dates share strict Gregorian calendar validation', () => {
  const pages = parsedFixture('pages-project.json').result
  const worker = parsedFixture('worker-settings.json').result
  for (const valid of ['2000-02-29', '2024-02-29', '2026-04-30']) {
    assert.equal(normalizePagesProject({
      ...pages,
      deployment_configs: {
        ...pages.deployment_configs,
        preview: { ...pages.deployment_configs.preview, compatibility_date: valid },
      },
    }, identity).compatibilityDate, valid)
    assert.equal(normalizeWorkerSettings({ ...worker, compatibility_date: valid }, identity).compatibilityDate, valid)
  }
  for (const invalid of [
    '1900-02-29', '2026-02-29', '2026-02-30', '2026-02-31', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-1-01', '2026-01-1',
    '2026-01-01T00:00:00Z', ' 2026-01-01', '２０２６-０１-０１', '2026‐01‐01',
  ]) {
    assert.throws(() => normalizePagesProject({
      ...pages,
      deployment_configs: {
        ...pages.deployment_configs,
        preview: { ...pages.deployment_configs.preview, compatibility_date: invalid },
      },
    }, identity))
    assert.throws(() => normalizeWorkerSettings({ ...worker, compatibility_date: invalid }, identity))
  }
})

test('Worker deployments enforce identities, traffic totals, active selection, and deterministic latest ordering', () => {
  const result = parsedFixture('worker-deployments.json').result
  const value = normalizeWorkerDeployments(result)
  assert.equal(value.activeVersionIdentity, 'worker-version-001')
  const duplicate = structuredClone(result)
  duplicate.deployments.push(structuredClone(duplicate.deployments[0]))
  assert.throws(() => normalizeWorkerDeployments(duplicate), /duplicate-deployment-identity/)
  const invalidTraffic = structuredClone(result)
  invalidTraffic.deployments[0].versions[0].percentage = 99
  assert.throws(() => normalizeWorkerDeployments(invalidTraffic), /invalid-traffic-allocation/)
  const splitTraffic = structuredClone(result)
  splitTraffic.deployments[0].versions = [
    { version_id: 'a', percentage: 50 }, { version_id: 'b', percentage: 50 },
  ]
  assert.throws(() => normalizeWorkerDeployments(splitTraffic), /ambiguous-active-version/)
  assert.throws(() => normalizeWorkerDeployments({ deployments: [] }), /worker-deployment-missing/)
})

test('production path enforces 250 Worker deployments and nested versions before complete outcomes', async () => {
  const accepted = await observeOperationResult(
    'worker-deployments',
    { deployments: workerDeploymentRecords(MAXIMUM_RECORDS) },
    undefined,
    1_800_000_001_001,
  )
  assert.equal(accepted.outcome.state, 'complete')
  assert.equal(accepted.outcome.value.deployments.length, MAXIMUM_RECORDS)

  const oversizedRecords = workerDeploymentRecords(MAXIMUM_RECORDS + 1)
  const refused = await observeOperationResult(
    'worker-deployments',
    { deployments: oversizedRecords },
    undefined,
    1_800_000_001_002,
  )
  assert.equal(refused.outcome.state, 'malformed')
  assert.equal(refused.outcome.issueCode, 'resource-malformed')
  assert.equal(refused.outcome.value, null)
  assert.equal(refused.snapshot.resourceOutcomes.find(
    ({ operation: name }) => name === 'backend-schema-version',
  ).state, 'complete')
  const refusedJson = canonicalJson(refused.snapshot)
  assert.equal(refusedJson.includes(oversizedRecords[0].id), false)
  assert.equal(refusedJson.includes(oversizedRecords.at(-1).id), false)

  const versions = Array.from({ length: MAXIMUM_RECORDS }, (_, index) => ({
    version_id: `nested-version-${String(index).padStart(4, '0')}`,
    percentage: index === 0 ? 100 : 0,
  }))
  const nestedAccepted = await observeOperationResult('worker-deployments', {
    deployments: [{
      id: 'nested-version-deployment',
      created_on: '2027-01-15T00:00:00.000Z',
      versions,
    }],
  }, undefined, 1_800_000_001_003)
  assert.equal(nestedAccepted.outcome.state, 'complete')
  assert.equal(nestedAccepted.outcome.value.deployments[0].versions.length, MAXIMUM_RECORDS)
  const nestedRefused = await observeOperationResult('worker-deployments', {
    deployments: [{
      id: 'nested-version-deployment',
      created_on: '2027-01-15T00:00:00.000Z',
      versions: [...versions, { version_id: 'nested-version-over-budget', percentage: 0 }],
    }],
  }, undefined, 1_800_000_001_004)
  assert.equal(nestedRefused.outcome.state, 'malformed')
})

test('production path enforces the aggregate Worker version budget across deployments', async () => {
  const firstVersionCount = Math.floor(MAXIMUM_RECORDS / 2)
  const accepted = await observeOperationResult('worker-deployments', {
    deployments: workerDeploymentsWithAggregateVersions(
      MAXIMUM_RECORDS - firstVersionCount,
    ),
  }, undefined, 1_800_000_001_007)
  assert.equal(accepted.outcome.state, 'complete')
  assert.equal(accepted.outcome.value.deployments.reduce(
    (count, deployment) => count + deployment.versions.length,
    0,
  ), MAXIMUM_RECORDS)

  const secondVersionCount = MAXIMUM_RECORDS - firstVersionCount + 1
  const refused = await observeOperationResult('worker-deployments', {
    deployments: workerDeploymentsWithAggregateVersions(secondVersionCount),
  }, undefined, 1_800_000_001_008)
  const permuted = await observeOperationResult('worker-deployments', {
    deployments: workerDeploymentsWithAggregateVersions(
      secondVersionCount,
      { permuted: true },
    ),
  }, undefined, 1_800_000_001_008)
  for (const result of [refused, permuted]) {
    assert.equal(result.outcome.state, 'malformed')
    assert.equal(result.outcome.issueCode, 'resource-malformed')
    assert.equal(result.outcome.value, null)
    assert.equal(result.snapshot.resourceOutcomes.find(
      ({ operation: name }) => name === 'backend-schema-version',
    ).state, 'complete')
    const rendered = canonicalJson(result.snapshot)
    for (const sentinel of [
      'aggregate-version-deployment-0',
      `aggregate-version-1-${String(secondVersionCount - 1).padStart(4, '0')}`,
      ACCOUNT_ID,
      ZONE_ID,
      TOKEN,
      'authorization',
      'cf_ray',
    ]) assert.equal(rendered.includes(sentinel), false)
  }
  assert.equal(canonicalJson(refused.snapshot), canonicalJson(permuted.snapshot))
})

test('Worker public URL settings require explicit booleans without enforcing activation policy', () => {
  assert.deepEqual(normalizeWorkerSubdomain({ enabled: true, previews_enabled: false }), {
    kind: 'preview-worker-public-urls-observation', schemaVersion: 1, workersDev: true, previewUrls: false,
  })
  for (const invalid of [{ enabled: false }, { enabled: 0, previews_enabled: false }]) {
    assert.throws(() => normalizeWorkerSubdomain(invalid))
  }
})

test('Worker schedules accept the provider container and parse the complete Cron grammar', () => {
  assert.deepEqual(normalizeWorkerSchedules({ schedules: [
    { cron: '*/5 0-12/2 1,15 * 1-5' },
  ] }).schedules, ['*/5 0-12/2 1,15 * 1-5'])
  assert.deepEqual(normalizeWorkerSchedules({ schedules: [] }).schedules, [])
  for (const invalid of [
    [{ cron: '0 0 * * *' }],
    { schedules: [{ cron: '@daily' }] },
    { schedules: [{ cron: '0 0 * *' }] },
    { schedules: [{ cron: '60 0 * * *' }] },
    { schedules: [{ cron: '0 0 * * *\n' }] },
    { schedules: [{ cron: '0\t0 * * *' }] },
    { schedules: [{ cron: ' 0 0 * * *' }] },
    { schedules: [{ cron: '*/5/2 * * * *' }] },
    { schedules: [{ cron: '1-10/2/3 * * * *' }] },
    { schedules: [{ cron: '/5 * * * *' }] },
    { schedules: [{ cron: '*/ * * * *' }] },
    { schedules: [{ cron: '1//2 * * * *' }] },
    { schedules: [{ cron: '*/999999999999999999999 * * * *' }] },
    { schedules: [{ cron: '0 0 * * *junk' }] },
    { schedules: [{ cron: '0 0 * * *' }, { cron: '0 0 * * *' }] },
    { schedules: [], ignored: true },
  ]) assert.throws(() => normalizeWorkerSchedules(invalid))
})

test('production path accepts 250 schedules and refuses record 251 without truncation', async () => {
  const accepted = await observeOperationResult(
    'worker-schedules',
    { schedules: scheduleRecords(MAXIMUM_RECORDS) },
    undefined,
    1_800_000_001_010,
  )
  assert.equal(accepted.outcome.state, 'complete')
  assert.equal(accepted.outcome.value.schedules.length, MAXIMUM_RECORDS)

  const oversized = scheduleRecords(MAXIMUM_RECORDS + 1)
  const first = await observeOperationResult(
    'worker-schedules',
    { schedules: oversized },
    undefined,
    1_800_000_001_011,
  )
  const permuted = await observeOperationResult(
    'worker-schedules',
    { schedules: [...oversized].reverse() },
    undefined,
    1_800_000_001_011,
  )
  assert.equal(first.outcome.state, 'malformed')
  assert.equal(first.outcome.issueCode, 'resource-malformed')
  assert.equal(first.outcome.value, null)
  assert.equal(permuted.outcome.state, 'malformed')
  assert.equal(canonicalJson(first.snapshot), canonicalJson(permuted.snapshot))
  assert.equal(first.snapshot.resourceOutcomes.find(
    ({ operation: name }) => name === 'backend-schema-version',
  ).state, 'complete')
})

test('Worker custom domains enforce service filter, zone ownership, hostname ownership, and uniqueness', () => {
  const envelope = parsedFixture('worker-custom-domains.json')
  const value = normalizeWorkerCustomDomains(envelope.result, envelope.result_info, identity)
  assert.equal(value.domains[0].zoneOrdinal, 0)
  assert.equal(value.domains[0].certificateIdentity, '00000000-0000-4000-8000-000000000002')
  for (const mutation of [
    (entry) => { entry.service = 'other-preview' },
    (entry) => { entry.zone_id = '3'.repeat(32) },
    (entry) => { entry.hostname = 'outside.invalid' },
    (entry) => { entry.environment = 'production' },
    (entry) => { entry.cert_id = 'certificate-preview-001' },
  ]) {
    const invalid = structuredClone(envelope)
    mutation(invalid.result[0])
    assert.throws(() => normalizeWorkerCustomDomains(invalid.result, invalid.result_info, identity))
  }
  assert.throws(() => normalizeWorkerCustomDomains(
    [envelope.result[0], envelope.result[0]],
    { ...envelope.result_info, count: 2, total_count: 2 },
    identity,
  ), /duplicate-custom-domain/)
  const implementationOnly = structuredClone(envelope)
  implementationOnly.result[0].certificate_id = implementationOnly.result[0].cert_id
  delete implementationOnly.result[0].cert_id
  assert.throws(() => normalizeWorkerCustomDomains(
    implementationOnly.result,
    implementationOnly.result_info,
    identity,
  ), /invalid-custom-domain/)
})

test('production path enforces custom-domain limits with and without pagination metadata', async () => {
  const records = customDomainRecords(MAXIMUM_RECORDS)
  const withoutInfo = await observeOperationResult(
    'worker-custom-domains',
    records,
    undefined,
    1_800_000_001_020,
  )
  assert.equal(withoutInfo.outcome.state, 'complete')
  assert.equal(withoutInfo.outcome.value.domains.length, MAXIMUM_RECORDS)

  const validInfo = {
    page: 1,
    per_page: MAXIMUM_RECORDS,
    count: MAXIMUM_RECORDS,
    total_count: MAXIMUM_RECORDS,
    total_pages: 1,
  }
  const withInfo = await observeOperationResult(
    'worker-custom-domains',
    records,
    validInfo,
    1_800_000_001_021,
  )
  assert.equal(withInfo.outcome.state, 'complete')
  assert.equal(withInfo.outcome.value.domains.length, MAXIMUM_RECORDS)

  const oversized = customDomainRecords(MAXIMUM_RECORDS + 1)
  for (const [resultInfo, capturedAtMs] of [
    [undefined, 1_800_000_001_022],
    [{
      page: 1,
      per_page: MAXIMUM_RECORDS + 1,
      count: MAXIMUM_RECORDS + 1,
      total_count: MAXIMUM_RECORDS + 1,
      total_pages: 1,
    }, 1_800_000_001_023],
  ]) {
    const refused = await observeOperationResult(
      'worker-custom-domains',
      oversized,
      resultInfo,
      capturedAtMs,
    )
    assert.equal(refused.outcome.state, 'malformed')
    assert.equal(refused.outcome.issueCode, 'resource-malformed')
    assert.equal(refused.outcome.value, null)
    const rendered = canonicalJson(refused.snapshot)
    assert.equal(rendered.includes(oversized[0].id), false)
    assert.equal(rendered.includes(oversized.at(-1).hostname), false)
    assert.equal(refused.snapshot.resourceOutcomes.find(
      ({ operation: name }) => name === 'backend-schema-version',
    ).state, 'complete')
  }
})

test('Worker routes canonicalize reviewed routes and reject grammar, duplicates, and Production poisoning', () => {
  const result = parsedFixture('worker-routes.json').result
  const routes = normalizeWorkerRoutes(result, identity, 0)
  assert.equal(routes.routes.length, 1)
  assert.equal(routes.inventory.length, 2)
  assert.equal(routes.routes[0].pattern, 'validation.preview.invalid/api/*')
  assert.equal(normalizeWorkerRoutes([{
    id: 'route-canonical', pattern: 'Preview.Invalid/Path/*', script: identity.workerName,
  }], identity, 0).routes[0].pattern, 'preview.invalid/Path/*')
  for (const pattern of [
    'https://preview.invalid/*', 'user@preview.invalid/*', 'preview.invalid:443/*',
    'preview.invalid/a/*/b', 'preview.invalid/*?x=1', 'preview.invalid\\path/*',
  ]) assert.throws(() => normalizeWorkerRoutes([
    { id: 'route-invalid', pattern, script: identity.workerName },
  ], identity, 0))
  assert.throws(() => normalizeWorkerRoutes([result[0], result[0]], identity, 0), /duplicate-route/)
  assert.throws(() => normalizeWorkerRoutes([{
    id: 'route-production', pattern: 'preview.invalid/*', script: 'pennant-pursuit-validation-production',
  }], identity, 0), /production-poisoning/)
})

test('production path enforces one-zone raw route limits before filtering or deduplication', async () => {
  const accepted = await observeOperationResult(
    'worker-routes',
    routeRecords(MAXIMUM_RECORDS),
    undefined,
    1_800_000_001_030,
  )
  assert.equal(accepted.outcome.state, 'complete')
  assert.equal(accepted.outcome.value.routes.length, MAXIMUM_RECORDS)

  const oversizedVariants = [
    routeRecords(MAXIMUM_RECORDS + 1),
    [
      ...routeRecords(MAXIMUM_RECORDS),
      ...routeRecords(1, { offset: MAXIMUM_RECORDS, script: null }),
    ],
    [
      ...routeRecords(MAXIMUM_RECORDS),
      ...routeRecords(1, { offset: MAXIMUM_RECORDS, script: 'unrelated-preview-worker' }),
    ],
    [
      ...routeRecords(MAXIMUM_RECORDS),
      { ...routeRecords(1, { offset: MAXIMUM_RECORDS })[0], id: 'route-budget-0000' },
    ],
  ]
  for (let index = 0; index < oversizedVariants.length; index += 1) {
    const refused = await observeOperationResult(
      'worker-routes',
      oversizedVariants[index],
      undefined,
      1_800_000_001_031 + index,
    )
    assert.equal(refused.outcome.state, 'malformed')
    assert.equal(refused.outcome.issueCode, 'resource-malformed')
    assert.equal(refused.outcome.value, null)
    assert.equal(refused.snapshot.resourceOutcomes.find(
      ({ operation: name }) => name === 'backend-schema-version',
    ).state, 'complete')
  }
})

test('production path enforces the aggregate route limit across reviewed zones', async () => {
  const acceptedExchanges = routeAggregationExchanges([125, 125])
  const acceptedSnapshot = await observePreviewResourcesWithTransport(createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    acceptedExchanges,
  ), { capturedAtMs: 1_800_000_001_040 })
  const accepted = acceptedSnapshot.resourceOutcomes.find(
    ({ operation: name }) => name === 'worker-routes',
  )
  assert.equal(accepted.state, 'complete')
  assert.equal(accepted.value.routes.length, MAXIMUM_RECORDS)

  const oversizedExchanges = routeAggregationExchanges(Array.from({ length: 32 }, () => 8))
  const oversizedSnapshot = await observePreviewResourcesWithTransport(createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    oversizedExchanges,
  ), { capturedAtMs: 1_800_000_001_041 })
  const refused = oversizedSnapshot.resourceOutcomes.find(
    ({ operation: name }) => name === 'worker-routes',
  )
  assert.equal(refused.state, 'malformed')
  assert.equal(refused.issueCode, 'resource-malformed')
  assert.equal(refused.value, null)
  assert.equal(oversizedSnapshot.resourceOutcomes.find(
    ({ operation: name }) => name === 'backend-schema-version',
  ).state, 'complete')
})

test('route-zone aggregation covers multiple zones once and rejects cross-zone conflicts', () => {
  const route = (identityValue, pattern, zoneOrdinal) => Object.freeze({
    inventory: Object.freeze([Object.freeze({ identity: identityValue, pattern, zoneOrdinal })]),
    routes: Object.freeze([Object.freeze({
      identity: identityValue, pattern, zoneOrdinal, scriptIdentity: 'approved-preview-worker',
    })]),
  })
  const first = route('route-a', 'a.preview.invalid/*', 0)
  const second = route('route-b', 'b.preview.invalid/*', 1)
  assert.deepEqual(finalizeWorkerRoutes([second, first]).routes.map(({ zoneOrdinal }) => zoneOrdinal), [0, 1])
  assert.throws(() => finalizeWorkerRoutes([
    first, route('route-a', 'b.preview.invalid/*', 1),
  ]), /conflicting-route-inventory/)
  assert.throws(() => finalizeWorkerRoutes([
    first, route('route-b', 'a.preview.invalid/*', 1),
  ]), /conflicting-route-inventory/)
})

test('D1 database, table discovery, migration prefix, timestamps, and schema singleton are closed', () => {
  assert.equal(normalizeD1Database(parsedFixture('d1-database.json').result, identity).identity, 'approved-preview-d1')
  assert.deepEqual(normalizeMigrationTableDiscovery(parsedFixture('migration-tables-query.json').result).tables, [
    'backend_schema', 'd1_migrations',
  ])
  const migrations = normalizeMigrationRows(parsedFixture('migration-rows-query.json').result, repositoryNames)
  assert.equal(migrations.rows.length, repositoryNames.length)
  assert.equal(migrations.appliedSourceHashes, 'unavailable')
  assert.ok(migrations.rows.every(({ sourceHash }) => sourceHash === 'unavailable'))
  assert.equal(normalizeBackendSchemaVersion(parsedFixture('backend-schema-version-query.json').result).version, 4)
})

test('runtime schemas enforce every normalized authority literal exactly', () => {
  const pages = normalizePagesProject(parsedFixture('pages-project.json').result, identity)
  const worker = normalizeWorkerSettings(parsedFixture('worker-settings.json').result, identity)
  const database = normalizeD1Database(parsedFixture('d1-database.json').result, identity)
  const schema = normalizeBackendSchemaVersion(parsedFixture('backend-schema-version-query.json').result)
  const routes = finalizeWorkerRoutes([
    normalizeWorkerRoutes(parsedFixture('worker-routes.json').result, identity, 0),
  ])
  const cases = [
    ['pages-project', pages, (value) => { value.identity = 'forged-pages-project' }],
    ['pages-project', pages, (value) => { value.variables[0].name = 'FORGED_MODE' }],
    ['pages-project', pages, (value) => { value.bindings.push({ category: 'rate-limit', name: 'RATE_LIMIT_BURST', target: 'preview-rate-limit-burst', limit: 1, periodSeconds: 1 }) }],
    ['pages-project', pages, (value) => { value.bindings.find(({ category }) => category === 'd1').target = 'forged-d1' }],
    ['pages-project', pages, (value) => { value.bindings.find(({ category }) => category === 'service').target = 'forged-worker' }],
    ['worker-settings', worker, (value) => { value.bindings.find(({ category }) => category === 'rate-limit').target = 'forged-rate-limit' }],
    ['d1-database', database, (value) => { value.identity = 'forged-d1' }],
    ['d1-database', database, (value) => { value.name = 'forged-preview-name' }],
    ['backend-schema-version', schema, (value) => { value.singletonIdentity = 'forged-singleton' }],
    ['worker-routes', routes, (value) => { value.routes[0].scriptIdentity = 'forged-worker' }],
  ]
  for (const [operationName, valid, mutate] of cases) {
    const forged = structuredClone(valid)
    mutate(forged)
    assert.throws(() => validatePreviewNormalizedResourceValue(operationName, forged))
  }
})

test('all other modeled collections use the shared ceiling or a stricter semantic bound', () => {
  const pages = parsedFixture('pages-project.json').result
  assert.throws(() => normalizePagesProject({
    ...pages,
    deployment_configs: {
      ...pages.deployment_configs,
      preview: {
        ...pages.deployment_configs.preview,
        compatibility_flags: Array.from(
          { length: MAXIMUM_RECORDS + 1 },
          (_, index) => `flag-${index}`,
        ),
      },
    },
  }, identity), /record-budget-exceeded/)
  assert.throws(() => normalizePagesProject({
    ...pages,
    domains: Array.from(
      { length: MAXIMUM_RECORDS + 1 },
      (_, index) => `domain-${index}.preview.invalid`,
    ),
  }, identity), /record-budget-exceeded/)

  const deploymentEnvelope = parsedFixture('pages-deployments-page.json')
  const deploymentWithAliases = structuredClone(deploymentEnvelope)
  deploymentWithAliases.result[0].aliases = Array.from(
    { length: MAXIMUM_RECORDS + 1 },
    (_, index) => `https://alias-${index}.preview.invalid`,
  )
  assert.throws(() => normalizePagesDeploymentPage(
    deploymentWithAliases.result,
    deploymentWithAliases.result_info,
    1,
  ), /record-budget-exceeded/)
  const twoDeployments = [
    structuredClone(deploymentEnvelope.result[0]),
    structuredClone(deploymentEnvelope.result[0]),
  ]
  twoDeployments[1].id = 'deployment-preview-002'
  twoDeployments[1].created_on = '2026-07-15T12:01:00.000Z'
  twoDeployments[1].modified_on = '2026-07-15T12:02:30.000Z'
  twoDeployments[1].latest_stage.started_on = '2026-07-15T12:01:30.000Z'
  twoDeployments[1].latest_stage.ended_on = '2026-07-15T12:02:00.000Z'
  twoDeployments[1].url = 'https://deployment-preview-002.preview.invalid'
  for (let index = 0; index < twoDeployments.length; index += 1) {
    twoDeployments[index].aliases = Array.from(
      { length: MAXIMUM_RECORDS / 2 },
      (_, aliasIndex) => `https://alias-${index}-${aliasIndex}.preview.invalid`,
    )
  }
  const aliasPage = normalizePagesDeploymentPage(twoDeployments, {
    page: 1, per_page: 25, count: 2, total_count: 2, total_pages: 1,
  }, 1)
  assert.equal(aliasPage.aliasRecordCount, MAXIMUM_RECORDS)
  const aliasValue = finalizePagesDeployments([aliasPage])
  assert.doesNotThrow(() => validatePreviewNormalizedResourceValue(
    'pages-preview-deployments',
    aliasValue,
  ))
  twoDeployments[1].aliases.push('https://alias-over-budget.preview.invalid')
  assert.throws(() => normalizePagesDeploymentPage(twoDeployments, {
    page: 1, per_page: 25, count: 2, total_count: 2, total_pages: 1,
  }, 1), /aggregate-alias-record-budget-exceeded/)
  const forgedAliases = structuredClone(aliasValue)
  forgedAliases.deployments[0].aliases.push('https://alias-over-budget.preview.invalid')
  assert.throws(() => validatePreviewNormalizedResourceValue(
    'pages-preview-deployments',
    forgedAliases,
  ))

  const worker = parsedFixture('worker-settings.json').result
  assert.throws(() => normalizeWorkerSettings({
    ...worker,
    compatibility_flags: Array.from(
      { length: MAXIMUM_RECORDS + 1 },
      (_, index) => `flag-${index}`,
    ),
  }, identity), /record-budget-exceeded/)
  assert.throws(() => normalizeWorkerSettings({
    ...worker,
    bindings: Array.from({ length: 14 }, () => structuredClone(worker.bindings[0])),
  }, identity), /worker-binding-inventory-exceeded/)

  const splitVersions = workerDeploymentRecords(2)
  splitVersions.forEach((deployment, deploymentIndex) => {
    deployment.versions = Array.from({ length: MAXIMUM_RECORDS / 2 }, (_, versionIndex) => ({
      version_id: `split-${deploymentIndex}-${versionIndex}`,
      percentage: versionIndex === 0 ? 100 : 0,
    }))
  })
  const splitVersionValue = normalizeWorkerDeployments({ deployments: splitVersions })
  assert.doesNotThrow(() => validatePreviewNormalizedResourceValue(
    'worker-deployments',
    splitVersionValue,
  ))
  const forgedVersions = structuredClone(splitVersionValue)
  forgedVersions.deployments[0].versions.push({
    identity: 'split-over-budget',
    trafficPercentage: 0,
  })
  assert.throws(() => validatePreviewNormalizedResourceValue(
    'worker-deployments',
    forgedVersions,
  ))

  const query = (rows) => [{ success: true, results: rows, meta: {} }]
  assert.throws(() => normalizeMigrationTableDiscovery(query([
    { name: 'backend_schema' }, { name: 'd1_migrations' }, { name: 'extra_table' },
  ])), /migration-table-inventory-exceeded/)
  const migrationRows = parsedFixture('migration-rows-query.json').result[0].results
  assert.throws(() => normalizeMigrationRows(query([
    ...migrationRows,
    { id: 5, name: '0005_over_budget.sql', applied_at: '2026-07-15 12:06:00' },
  ]), repositoryNames), /database-ahead-of-repository/)

  assert.throws(() => validatePreviewNormalizedResourceValue('worker-schedules', {
    kind: 'preview-worker-schedules-observation',
    schemaVersion: 1,
    schedules: Array.from({ length: MAXIMUM_RECORDS + 1 }, () => '0 0 * * *'),
  }))

  for (const relativePath of [
    'scripts/lib/release-inspection/preview-d1-observer.mjs',
    'scripts/lib/release-inspection/preview-normalization.mjs',
    'scripts/lib/release-inspection/preview-pages-observer.mjs',
    'scripts/lib/release-inspection/preview-provider-normalizers.mjs',
    'scripts/lib/release-inspection/preview-resource-observer.mjs',
    'scripts/lib/release-inspection/preview-resource-schemas.mjs',
    'scripts/lib/release-inspection/preview-worker-observer.mjs',
  ]) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, relativePath), 'utf8'), /\b250\b/u)
  }
})

test('D1 normalization rejects mismatches, unknown tables, duplicate/out-of-order/ahead rows, timestamps, and schema rows', () => {
  assert.throws(() => normalizeD1Database({ uuid: '00000000-0000-4000-8000-000000000002', name: 'pennant-pursuit-preview' }, identity))
  const query = (rows) => [{ success: true, results: rows, meta: {} }]
  assert.deepEqual(normalizeMigrationTableDiscovery(query([])).tables, [])
  assert.throws(() => normalizeMigrationTableDiscovery(query([{ name: 'unknown_table' }])), /unknown-migration-table/)
  const validRows = parsedFixture('migration-rows-query.json').result[0].results
  const variants = [
    [...validRows, validRows[0]],
    [{ ...validRows[0], id: 2 }],
    [{ ...validRows[0], name: '9999_future.sql' }],
    [{ ...validRows[0], applied_at: '2026-99-99 99:99:99' }],
  ]
  for (const rows of variants) assert.throws(() => normalizeMigrationRows(query(rows), repositoryNames))
  assert.throws(() => normalizeBackendSchemaVersion(query([])), /backend-schema-row-missing/)
  assert.throws(() => normalizeBackendSchemaVersion(query([{ id: 1, version: 4 }, { id: 1, version: 4 }])))
  assert.throws(() => normalizeBackendSchemaVersion(query([{ id: 2, version: 4 }])))
  assert.throws(() => normalizeBackendSchemaVersion(query([{ id: 1, version: '4' }])))
})

test('malformed D1 query containers are closed normalization failures rather than ordinary exceptions', () => {
  const malformed = [null, undefined, true, 1, 'result', {}, [undefined], new Array(1)]
  for (const value of malformed) {
    let failure
    try { normalizeMigrationTableDiscovery(value) } catch (error) { failure = error }
    assert.ok(failure instanceof PreviewResourceNormalizationError)
    assert.equal(failure.state, 'malformed')
  }
  const hostile = new Proxy([], { get() { throw new Error('hostile getter') } })
  assert.throws(
    () => normalizeMigrationTableDiscovery(hostile),
    (error) => error instanceof PreviewResourceNormalizationError && error.state === 'malformed',
  )
  assert.throws(
    () => normalizeMigrationRows([{ success: true }], repositoryNames),
    (error) => error instanceof PreviewResourceNormalizationError && error.state === 'malformed',
  )
})

test('every provider normalizer closes null, primitive, sparse, and malformed record inputs', () => {
  const calls = [
    () => normalizePagesProject(null, identity),
    () => normalizePagesDeploymentPage(null, {}, 1),
    () => normalizeWorkerSettings(null, identity),
    () => normalizeWorkerDeployments(null),
    () => normalizeWorkerSubdomain(null),
    () => normalizeWorkerSchedules(null),
    () => normalizeWorkerCustomDomains(null, undefined, identity),
    () => normalizeWorkerRoutes(null, identity, 0),
    () => normalizeD1Database(null, identity),
    () => normalizeMigrationRows(null, repositoryNames),
    () => normalizeBackendSchemaVersion(null),
    () => normalizeWorkerRoutes([null], identity, 0),
    () => normalizePagesDeploymentPage([null], {
      page: 1, per_page: 25, count: 1, total_count: 1, total_pages: 1,
    }, 1),
  ]
  for (const invoke of calls) {
    assert.throws(
      invoke,
      (error) => error instanceof PreviewResourceNormalizationError && error.state === 'malformed',
    )
  }
})

test('orchestration classifies bounded provider unavailability and continues independent resources without retry', async () => {
  const exchanges = fullExchanges()
  exchanges[4] = exchange('worker-settings', 'worker-settings.json', {
    bytes: bytes({ success: false, errors: [{ code: 1000 }], messages: [] }),
  })
  const mock = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    exchanges,
  )
  const snapshot = await observePreviewResourcesWithTransport(mock, { capturedAtMs: 1_800_000_000_001 })
  assert.equal(snapshot.observationState, 'partial')
  assert.equal(snapshot.resourceOutcomes.find(({ operation: name }) => name === 'worker-settings').state, 'unavailable')
  assert.equal(snapshot.resourceOutcomes.find(({ operation: name }) => name === 'd1-database').state, 'partial')
  assert.equal(snapshot.resourceOutcomes.find(({ operation: name }) => name === 'backend-schema-version').state, 'complete')
  assert.equal(mock.requestBudget().used, 14)
})

test('D1 reconciliation preserves failed dependent evidence and contradicts only complete conflicts', async () => {
  const outcomeState = async (operationName, replacements) => {
    const exchanges = fullExchanges()
    for (const [index, value] of replacements) exchanges[index] = value
    const snapshot = await observePreviewResourcesWithTransport(createMockPreviewResourceTransport(
      { PENNANT_PREVIEW_API_TOKEN: TOKEN },
      exchanges,
    ), { capturedAtMs: 1_800_000_000_010 })
    return snapshot.resourceOutcomes.find(({ operation: name }) => name === operationName).state
  }
  const failedEnvelope = bytes({ success: false, errors: [{ code: 1000 }], messages: [] })
  const malformedEnvelope = bytes({ success: true, errors: [], messages: [], result: null })
  const missingEnvelope = bytes({ success: true, errors: [], messages: [], result: [] })
  assert.equal(await outcomeState('migration-rows', [[12, exchange('migration-rows', 'migration-rows-query.json', {
    bytes: failedEnvelope,
  })]]), 'unavailable')
  assert.equal(await outcomeState('migration-rows', [[12, exchange('migration-rows', 'migration-rows-query.json', {
    bytes: malformedEnvelope,
  })]]), 'malformed')
  assert.equal(await outcomeState('migration-rows', [[12, exchange('migration-rows', 'migration-rows-query.json', {
    bytes: missingEnvelope,
  })]]), 'missing')
  assert.equal(await outcomeState('backend-schema-version', [[13, exchange(
    'backend-schema-version',
    'backend-schema-version-query.json',
    { bytes: failedEnvelope },
  )]]), 'unavailable')
  assert.equal(await outcomeState('backend-schema-version', [[13, exchange(
    'backend-schema-version',
    'backend-schema-version-query.json',
    { bytes: malformedEnvelope },
  )]]), 'malformed')
  assert.equal(await outcomeState('backend-schema-version', [[13, exchange(
    'backend-schema-version',
    'backend-schema-version-query.json',
    { bytes: missingEnvelope },
  )]]), 'missing')
  assert.equal(await outcomeState('migration-table-discovery', [[11, exchange(
    'migration-table-discovery',
    'migration-tables-query.json',
    { bytes: failedEnvelope },
  )]]), 'unavailable')
  assert.equal(await outcomeState('migration-rows', [[11, exchange(
    'migration-table-discovery',
    'migration-tables-query.json',
    { bytes: failedEnvelope },
  )]]), 'complete')
  assert.equal(await outcomeState('migration-table-discovery', [[11, exchange(
    'migration-table-discovery',
    'migration-tables-query.json',
    { bytes: malformedEnvelope },
  )]]), 'malformed')
  assert.equal(await outcomeState('migration-rows', [[11, exchange(
    'migration-table-discovery',
    'migration-tables-query.json',
    { bytes: malformedEnvelope },
  )]]), 'complete')
  const absentTables = bytes({
    success: true,
    errors: [],
    messages: [],
    result: [{ success: true, results: [], meta: {} }],
  })
  assert.equal(await outcomeState('migration-rows', [[11, exchange(
    'migration-table-discovery',
    'migration-tables-query.json',
    { bytes: absentTables },
  )]]), 'contradictory')
  assert.equal(await outcomeState('backend-schema-version', [[11, exchange(
    'migration-table-discovery',
    'migration-tables-query.json',
    { bytes: absentTables },
  )]]), 'contradictory')
  const conflictingSchema = bytes({
    success: true,
    errors: [],
    messages: [],
    result: [{ success: true, results: [{ id: 1, version: 3 }], meta: {} }],
  })
  assert.equal(await outcomeState('backend-schema-version', [[13, exchange(
    'backend-schema-version',
    'backend-schema-version-query.json',
    { bytes: conflictingSchema },
  )]]), 'contradictory')
})

test('orchestration stops after account ownership failure and marks every unobserved operation unavailable', async () => {
  const exchanges = [exchange('account', 'account.json', {
    bytes: bytes({ success: true, errors: [], messages: [], result: { id: '9'.repeat(32) } }),
  })]
  const mock = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    exchanges,
  )
  const snapshot = await observePreviewResourcesWithTransport(mock, { capturedAtMs: 1_800_000_000_002 })
  assert.equal(snapshot.resourceOutcomes.length, 14)
  assert.equal(snapshot.resourceOutcomes[0].state, 'contradictory')
  assert.ok(snapshot.resourceOutcomes.slice(1).every(({ state }) => state === 'unavailable'))
  assert.equal(mock.requestBudget().used, 1)
})

test('snapshot serialization is stable under provider ordering permutations', async () => {
  const exchanges = fullExchanges()
  const shuffledSettings = parsedFixture('worker-settings.json')
  shuffledSettings.result.bindings.reverse()
  exchanges[4] = exchange('worker-settings', 'worker-settings.json', { bytes: bytes(shuffledSettings) })
  const first = await observePreviewResourcesWithTransport(createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN }, fullExchanges(),
  ), { capturedAtMs: 1_800_000_000_003 })
  const second = await observePreviewResourcesWithTransport(createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN }, exchanges,
  ), { capturedAtMs: 1_800_000_000_003 })
  assert.equal(canonicalJson(first), canonicalJson(second))
})

test('partial pagination is explicit and never converted to a complete empty inventory', async () => {
  const firstPage = bytes({
    success: true,
    errors: [],
    messages: [],
    result: Array.from({ length: 25 }, (_, index) => ({
      id: index === 0 ? ZONE_ID : (index + 16).toString(16).padStart(32, '0'),
      name: index === 0 ? 'preview.invalid' : `unrelated-${index}.invalid`,
    })),
    result_info: { page: 1, per_page: 25, count: 25, total_count: 26, total_pages: 2 },
  })
  const transport = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    [
      exchange('account', 'account.json'),
      exchange('account-zones', 'zones-page.json', { bytes: firstPage }),
      {
        ...exchange('account-zones', 'zones-page.json', {
          bytes: bytes({ success: false, errors: [{ code: 1000 }], messages: [] }),
        }),
        request: { operation: 'account-zones', page: 2 },
      },
    ],
  )
  const snapshot = await observePreviewResourcesWithTransport(transport, { capturedAtMs: 1_800_000_000_004 })
  const zones = snapshot.resourceOutcomes.find(({ operation: name }) => name === 'account-zones')
  assert.equal(zones.state, 'partial')
  assert.equal(zones.value.collectedCount, 25)
  assert.ok(snapshot.resourceOutcomes.slice(2).every(({ state }) => state === 'unavailable'))
  assert.equal(transport.requestBudget().used, 3)
})

test('maximum pagination and 32-zone orchestration shape consumes exactly 63 sequential requests', async () => {
  const routeZoneIds = Array.from({ length: 32 }, (_, index) => (
    index === 0 ? ZONE_ID : (index + 2).toString(16).padStart(32, '0')
  ))
  const exchanges = [exchange('account', 'account.json')]
  for (let page = 1; page <= 10; page += 1) {
    const start = (page - 1) * 25
    exchanges.push({
      ...exchange('account-zones', 'zones-page.json'),
      request: { operation: 'account-zones', page },
      bytes: bytes({
        success: true,
        errors: [],
        messages: [],
        result: Array.from({ length: 25 }, (_, offset) => {
          const ordinal = start + offset
          return {
            id: ordinal < routeZoneIds.length
              ? routeZoneIds[ordinal]
              : (ordinal + 64).toString(16).padStart(32, '0'),
            name: ordinal < routeZoneIds.length
              ? `zone-${ordinal}.preview.invalid`
              : `unrelated-${ordinal}.invalid`,
          }
        }),
        result_info: { page, per_page: 25, count: 25, total_count: 250, total_pages: 10 },
      }),
    })
  }
  exchanges.push(exchange('pages-project', 'pages-project.json'))
  const deploymentTemplate = parsedFixture('pages-deployments-page.json').result[0]
  const baseTime = 2_000_000_000_000
  for (let page = 1; page <= 10; page += 1) {
    const start = (page - 1) * 25
    exchanges.push({
      ...exchange('pages-preview-deployments', 'pages-deployments-page.json'),
      request: { operation: 'pages-preview-deployments', page },
      bytes: bytes({
        success: true,
        errors: [],
        messages: [],
        result: Array.from({ length: 25 }, (_, offset) => {
          const ordinal = start + offset
          const created = baseTime - ordinal * 120_000
          return {
            ...structuredClone(deploymentTemplate),
            id: `deployment-${String(ordinal).padStart(3, '0')}`,
            created_on: new Date(created).toISOString(),
            modified_on: new Date(created + 90_000).toISOString(),
            latest_stage: {
              ...deploymentTemplate.latest_stage,
              started_on: new Date(created + 30_000).toISOString(),
              ended_on: new Date(created + 80_000).toISOString(),
            },
            url: `https://deployment-${ordinal}.preview.invalid`,
            aliases: [],
          }
        }),
        result_info: { page, per_page: 25, count: 25, total_count: 250, total_pages: 10 },
      }),
    })
  }
  exchanges.push(
    exchange('worker-settings', 'worker-settings.json'),
    exchange('worker-deployments', 'worker-deployments.json'),
    exchange('worker-subdomain', 'worker-subdomain.json'),
    exchange('worker-schedules', 'worker-schedules.json'),
    exchange('worker-custom-domains', 'worker-custom-domains.json'),
  )
  for (let routeZoneIndex = 0; routeZoneIndex < 32; routeZoneIndex += 1) {
    exchanges.push({
      ...exchange('worker-routes', 'worker-routes.json'),
      request: { operation: 'worker-routes', routeZoneIndex },
      bytes: bytes({
        success: true,
        errors: [],
        messages: [],
        result: [{
          id: `route-${routeZoneIndex}`,
          pattern: `route-${routeZoneIndex}.preview.invalid/*`,
          script: identity.workerName,
        }],
      }),
    })
  }
  exchanges.push(
    exchange('d1-database', 'd1-database.json'),
    exchange('migration-table-discovery', 'migration-tables-query.json'),
    exchange('migration-rows', 'migration-rows-query.json'),
    exchange('backend-schema-version', 'backend-schema-version-query.json'),
  )
  const transport = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    exchanges,
  )
  const snapshot = await observePreviewResourcesWithTransport(transport, { capturedAtMs: 2_000_000_000_000 })
  assert.equal(snapshot.observationState, 'complete')
  assert.equal(transport.requestBudget().used, 63)
  assert.equal(transport.assertExhausted(), true)
})

test('opaque authority and route-zone, page, record, and request bounds fail closed', async () => {
  let accessed = 0
  const structural = { reviewedRouteZoneCount: 1 }
  Object.defineProperty(structural, 'request', { get() { accessed += 1; return async () => {} } })
  const inherited = Object.create(structural)
  const valid = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    fullExchanges(),
  )
  for (const forged of [
    structural,
    inherited,
    { ...valid },
    new Proxy(valid, {}),
    JSON.parse(JSON.stringify(valid)),
    Object.assign(Object.create(Object.getPrototypeOf(valid)), valid),
  ]) {
    await assert.rejects(
      observePreviewResourcesWithTransport(forged, { capturedAtMs: 1 }),
      /authority provenance is absent/,
    )
  }
  assert.equal(accessed, 0)
  const thirtyThreeZones = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    [{
      ...exchange('worker-routes', 'worker-routes.json'),
      request: { operation: 'worker-routes', routeZoneIndex: 32 },
    }],
  )
  await assert.rejects(
    observePreviewResourcesWithTransport(thirtyThreeZones, { capturedAtMs: 1 }),
    /route-zone budget is invalid/,
  )
  assert.equal(thirtyThreeZones.requestBudget().used, 0)
  const envelope = parsedFixture('pages-deployments-page.json')
  assert.throws(() => normalizePagesDeploymentPage(
    envelope.result,
    { ...envelope.result_info, total_pages: 11, total_count: 251 },
    1,
  ), /pagination/)
  const budget = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    Array.from({ length: 65 }, () => exchange('account', 'account.json')),
  )
  for (let index = 0; index < 63; index += 1) await budget.request({ operation: 'account' })
  assert.equal(budget.requestBudget().used, 63)
  await budget.request({ operation: 'account' })
  assert.equal(budget.requestBudget().used, 64)
  await assert.rejects(budget.request({ operation: 'account' }), /request budget is exhausted/)
  assert.equal(budget.requestBudget().used, 64)
})

test('Production poisoning variants and diagnostics never expose protected sentinels', () => {
  const production = 'pennant-pursuit-validation-production'
  const fullwidth = [...production].map((character) => {
    if (/[A-Za-z0-9]/u.test(character)) return String.fromCharCode(character.charCodeAt(0) + 0xFEE0)
    return character
  }).join('')
  for (const poisoned of [
    production,
    production.toUpperCase(),
    encodeURIComponent(production),
    encodeURIComponent(encodeURIComponent(production)),
    fullwidth,
  ]) {
    let failure
    try {
      normalizeWorkerRoutes([{
        id: 'route-poisoned', pattern: 'preview.invalid/*', script: poisoned,
      }], identity, 0)
    } catch (error) { failure = error }
    assert.match(String(failure), /production-poisoning/)
    for (const sentinel of [ACCOUNT_ID, ZONE_ID, DATABASE_ID, TOKEN, poisoned]) {
      assert.equal(String(failure).includes(sentinel), false)
    }
  }
})

test('every canonical protected Production identifier and encoded variant is rejected', () => {
  const manifest = loadReleaseManifest(ROOT).manifest
  const protectedIdentifiers = productionDenylist(manifest, { includeBranch: true })
  assert.ok(protectedIdentifiers.length > 0)
  for (const identifierValue of protectedIdentifiers) {
    const fullwidth = [...identifierValue].map((character) => (
      /[A-Za-z0-9]/u.test(character)
        ? String.fromCharCode(character.charCodeAt(0) + 0xFEE0)
        : character
    )).join('')
    for (const variant of [
      identifierValue,
      identifierValue.toUpperCase(),
      encodeURIComponent(identifierValue),
      encodeURIComponent(encodeURIComponent(identifierValue)),
      fullwidth,
    ]) {
      const project = parsedFixture('pages-project.json').result
      assert.throws(
        () => normalizePagesProject({ ...project, source: variant }, identity),
        /production-poisoning/,
      )
    }
  }
  const normalizationSource = readFileSync(
    path.join(ROOT, 'scripts/lib/release-inspection/preview-normalization.mjs'),
    'utf8',
  )
  for (const identifierValue of protectedIdentifiers) {
    assert.equal(normalizationSource.includes(identifierValue), false)
  }
  assert.match(normalizationSource, /productionDenylist/)
})
