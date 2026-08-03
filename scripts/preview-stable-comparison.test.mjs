import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'acorn'
import { canonicalJson } from './lib/preview-release/canonical-data.mjs'
import {
  RELEASE_INSPECTION_CAPABILITY_SURFACES,
  RELEASE_INSPECTION_SURFACES,
} from './lib/release-inspection/capability-model.mjs'
import {
  createPreviewSingleReadSnapshot,
} from './lib/release-inspection/preview-observation-contracts.mjs'
import { PREVIEW_OPERATION_INVENTORY } from './lib/release-inspection/preview-observation-limits.mjs'
import {
  comparePreviewSingleReadSnapshots,
  PREVIEW_STABILITY_COMPARISONS,
  PREVIEW_STABLE_COMPARISON_KIND,
  PREVIEW_STABLE_COMPARISON_MAX_BYTES,
} from './lib/release-inspection/preview-stable-comparison.mjs'
import {
  createPreviewStabilityProjection,
} from './lib/release-inspection/preview-stability-projection.mjs'
import { SCHEMA4_CAPABILITIES } from '../shared/schema4-capabilities.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAPTURED_AT_MS = 1_900_000_000_000
const ISSUE_BY_STATE = Object.freeze({
  complete: null,
  missing: 'resource-missing',
  unavailable: 'resource-unavailable',
  partial: 'resource-partial',
  malformed: 'resource-malformed',
  contradictory: 'resource-contradictory',
})
const PAGE_GATES = Object.freeze([
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
])
const WORKER_GATES = Object.freeze([
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
  'RETENTION_CLEANUP_MODE',
])

function completeValues() {
  return {
    account: { kind: 'preview-account-observation', schemaVersion: 1, owned: true },
    'account-zones': {
      kind: 'preview-account-zones-observation', schemaVersion: 1,
      zones: [{ ordinal: 0, name: 'preview.example.com' }, { ordinal: 1, name: 'api.example.com' }],
    },
    'backend-schema-version': {
      kind: 'preview-backend-schema-observation', schemaVersion: 1,
      singletonIdentity: 'backend-schema-singleton', version: 4,
    },
    'd1-database': {
      kind: 'preview-d1-database-observation', schemaVersion: 1,
      identity: 'approved-preview-d1', name: 'pennant-pursuit-preview',
    },
    'migration-rows': {
      kind: 'preview-migration-rows-observation', schemaVersion: 1,
      rows: [{ id: 1, name: '0001_base.sql', appliedAtMs: 1_800_000_000_000, sourceHash: 'unavailable' }],
      pendingRepositorySuffix: ['0002_local-only.sql'], appliedSourceHashes: 'unavailable',
    },
    'migration-table-discovery': {
      kind: 'preview-migration-tables-observation', schemaVersion: 1,
      tables: ['backend_schema', 'd1_migrations'],
    },
    'pages-preview-deployments': {
      kind: 'preview-pages-deployments-observation', schemaVersion: 1,
      latestIdentity: 'pages-deployment-1',
      deployments: [{
        identity: 'pages-deployment-1', environment: 'preview', targetBranch: 'develop',
        createdAtMs: 1_800_000_000_000, commitHash: 'a'.repeat(40),
        stage: { name: 'deploy', status: 'success' },
        previewOrigin: 'https://one.preview.example.com',
        aliases: ['https://alias-b.preview.example.com', 'https://alias-a.preview.example.com'],
      }],
    },
    'pages-project': {
      kind: 'preview-pages-project-observation', schemaVersion: 1,
      identity: 'approved-preview-pages-project', compatibilityDate: '2026-07-14',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      wranglerConfigurationHash: 'b'.repeat(64),
      variables: PAGE_GATES.map((name) => ({ name, value: 'disabled' })),
      bindings: [
        { category: 'd1', name: 'DB', target: 'approved-preview-d1' },
        { category: 'service', name: 'VALIDATION_SERVICE', target: 'approved-preview-worker' },
      ],
    },
    'worker-custom-domains': {
      kind: 'preview-worker-custom-domains-observation', schemaVersion: 1,
      domains: [{
        identity: 'domain-1', hostname: 'worker.preview.example.com',
        zoneName: 'example.com', zoneOrdinal: 0, certificateIdentity: 'certificate-a',
        environment: 'preview',
      }],
    },
    'worker-deployments': {
      kind: 'preview-worker-deployments-observation', schemaVersion: 1,
      activeDeploymentIdentity: 'worker-deployment-1', activeVersionIdentity: 'worker-version-1',
      deployments: [{
        identity: 'worker-deployment-1', createdAtMs: 1_800_000_000_000,
        activeVersionIdentity: 'worker-version-1',
        versions: [{ identity: 'worker-version-1', trafficPercentage: 100 }],
      }],
    },
    'worker-routes': {
      kind: 'preview-worker-routes-observation', schemaVersion: 1,
      routes: [{
        identity: 'route-1', pattern: 'worker.preview.example.com/*', zoneOrdinal: 0,
        scriptIdentity: 'approved-preview-worker',
      }],
    },
    'worker-schedules': {
      kind: 'preview-worker-schedules-observation', schemaVersion: 1, schedules: [],
    },
    'worker-settings': {
      kind: 'preview-worker-settings-observation', schemaVersion: 1,
      compatibilityDate: '2026-07-14', compatibilityFlags: ['nodejs_compat'],
      secretPresence: 'unavailable',
      bindings: [
        ...WORKER_GATES.map((name) => ({ category: 'plain-text-gate', name, value: 'disabled' })),
        { category: 'd1', name: 'DB', target: 'approved-preview-d1' },
        { category: 'service', name: 'VALIDATION_SERVICE', target: 'approved-preview-worker' },
        {
          category: 'rate-limit', name: 'RATE_LIMIT_BURST',
          target: 'preview-rate-limit-burst', limit: 20, periodSeconds: 60,
        },
        {
          category: 'rate-limit', name: 'RATE_LIMIT_SUSTAINED',
          target: 'preview-rate-limit-sustained', limit: 100, periodSeconds: 60,
        },
      ],
    },
    'worker-subdomain': {
      kind: 'preview-worker-public-urls-observation', schemaVersion: 1,
      workersDev: false, previewUrls: false,
    },
  }
}

function incompleteValue(operation, state) {
  if (state === 'partial') {
    return { kind: 'preview-partial-resource-observation', schemaVersion: 1, operation, collectedCount: 1 }
  }
  if (state === 'contradictory') {
    return { kind: 'preview-resource-observation-placeholder', schemaVersion: 1 }
  }
  return null
}

function snapshotInput({
  capturedAtMs = CAPTURED_AT_MS,
  values = completeValues(),
  states = {},
  omit = [],
} = {}) {
  return {
    capturedAtMs,
    resourceOutcomes: PREVIEW_OPERATION_INVENTORY
      .filter((operation) => !omit.includes(operation))
      .map((operation) => {
        const state = states[operation] ?? 'complete'
        return {
          operation,
          state,
          issueCode: ISSUE_BY_STATE[state],
          capturedAtMs: capturedAtMs - 1,
          value: state === 'complete' ? values[operation] : incompleteValue(operation, state),
        }
      }),
  }
}

function makeSnapshot(options = {}) {
  return createPreviewSingleReadSnapshot(snapshotInput(options))
}

function compare(optionsOne = {}, optionsTwo = {}) {
  return comparePreviewSingleReadSnapshots(makeSnapshot(optionsOne), makeSnapshot(optionsTwo))
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertDeepFrozen(child)
}

function mutateMeaningful(operation, values) {
  const next = structuredClone(values)
  switch (operation) {
    case 'account-zones': next[operation].zones[0].name = 'changed.example.com'; break
    case 'backend-schema-version': next[operation].version = 5; break
    case 'migration-rows': next[operation].rows[0].appliedAtMs += 1; break
    case 'migration-table-discovery': next[operation].tables = ['backend_schema']; break
    case 'pages-preview-deployments': next[operation].deployments[0].commitHash = 'c'.repeat(40); break
    case 'pages-project': next[operation].compatibilityDate = '2026-07-15'; break
    case 'worker-custom-domains': next[operation].domains[0].hostname = 'changed.preview.example.com'; break
    case 'worker-deployments': next[operation].deployments[0].versions[0].trafficPercentage = 99; break
    case 'worker-routes': next[operation].routes[0].pattern = 'changed.preview.example.com/*'; break
    case 'worker-schedules': next[operation].schedules = ['0 3 * * *']; break
    case 'worker-settings': next[operation].compatibilityDate = '2026-07-15'; break
    case 'worker-subdomain': next[operation].previewUrls = true; break
    default: throw new TypeError(`${operation} has no second valid complete identity in the precursor contract`)
  }
  return next
}

test('all fourteen complete semantic resources and all applicable capabilities match', () => {
  const result = compare({}, { capturedAtMs: CAPTURED_AT_MS + 10_000 })
  assert.equal(result.kind, PREVIEW_STABLE_COMPARISON_KIND)
  assert.deepEqual(PREVIEW_STABILITY_COMPARISONS, ['MATCH', 'DRIFT', 'UNKNOWN'])
  assert.deepEqual(result.resourceInventory, PREVIEW_OPERATION_INVENTORY)
  assert.equal(Object.keys(result.resources).length, 14)
  for (const operation of PREVIEW_OPERATION_INVENTORY) {
    assert.equal(result.resources[operation].comparison, 'MATCH', operation)
    assert.ok(Object.hasOwn(result.resources[operation], 'stableValue'))
  }
  for (const capability of SCHEMA4_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const record = result.capabilities[capability].surfaces[surface]
      assert.equal(record.comparison,
        RELEASE_INSPECTION_CAPABILITY_SURFACES[capability].includes(surface)
          ? 'MATCH'
          : 'not-applicable')
    }
  }
  assert.equal(result.overallComparison, 'MATCH')
  assert.equal(result.overallCompleteness, 'complete')
  assert.equal(result.readOneSemanticHash, result.readTwoSemanticHash)
  assert.deepEqual(
    [result.releaseCurrentness, result.executionAuthorization, result.noRemoteMutation, result.productionContacted],
    ['UNKNOWN', 'prohibited', true, false],
  )
})

test('every incomplete resource state and absent outcome remains UNKNOWN for every resource family', () => {
  for (const operation of PREVIEW_OPERATION_INVENTORY) {
    for (const state of ['missing', 'unavailable', 'partial', 'malformed', 'contradictory']) {
      const result = compare({}, { states: { [operation]: state } })
      const record = result.resources[operation]
      assert.equal(record.comparison, 'UNKNOWN', `${operation}:${state}`)
      assert.equal(record.readTwoState, state)
      assert.equal(Object.hasOwn(record, 'stableValue'), false)
      assert.equal(result.overallComparison, 'UNKNOWN')
      assert.equal(result.overallCompleteness, 'incomplete')
    }
    const absent = compare({}, { omit: [operation] })
    assert.equal(absent.resources[operation].comparison, 'UNKNOWN', `${operation}:absent`)
    assert.equal(absent.resources[operation].readTwoState, 'absent')
  }
})

test('every resource with two valid complete semantic forms drifts on a meaningful change', () => {
  const baseline = completeValues()
  const variableResources = PREVIEW_OPERATION_INVENTORY.filter(
    (operation) => !['account', 'd1-database'].includes(operation),
  )
  for (const operation of variableResources) {
    const result = compare({ values: baseline }, { values: mutateMeaningful(operation, baseline) })
    assert.equal(result.resources[operation].comparison, 'DRIFT', operation)
    assert.equal(Object.hasOwn(result.resources[operation], 'stableValue'), false)
    assert.equal(result.overallComparison, 'DRIFT', operation)
  }
  // The validated precursor intentionally has only one complete Account and
  // D1 identity. Attempts to invent a second complete identity fail before comparison.
  for (const operation of ['account', 'd1-database']) {
    const invalid = structuredClone(baseline)
    if (operation === 'account') invalid.account.owned = false
    else invalid[operation].name = 'foreign-preview-database'
    assert.throws(() => makeSnapshot({ values: invalid }), /single-read contract refused/i)
  }
})

test('every independently meaningful retained field changes its resource comparison to DRIFT', () => {
  const cases = [
    ['account-zones', 'zone ordinal', (value) => { value.zones[0].ordinal = 2 }],
    ['account-zones', 'zone name', (value) => { value.zones[0].name = 'changed.example.com' }],
    ['pages-project', 'compatibility date', (value) => { value.compatibilityDate = '2026-07-15' }],
    ['pages-project', 'compatibility flags', (value) => { value.compatibilityFlags.push('streams_enable_constructors') }],
    ['pages-project', 'protected variable name', (value) => { value.variables[0].name = 'DRAFT_TICKET_MODE' }],
    ['pages-project', 'protected variable value', (value) => { value.variables[0].value = 'enabled' }],
    ['pages-project', 'approved D1 binding tuple', (value) => { value.bindings.shift() }],
    ['pages-project', 'approved service binding tuple', (value) => { value.bindings.pop() }],
    ['pages-project', 'reviewed configuration hash', (value) => { value.wranglerConfigurationHash = 'c'.repeat(64) }],
    ['pages-preview-deployments', 'latest deployment identity', (value) => { value.latestIdentity = 'pages-deployment-2' }],
    ['pages-preview-deployments', 'deployment identity', (value) => { value.deployments[0].identity = 'pages-deployment-2' }],
    ['pages-preview-deployments', 'commit hash', (value) => { value.deployments[0].commitHash = 'c'.repeat(40) }],
    ['pages-preview-deployments', 'stage name', (value) => { value.deployments[0].stage.name = 'publish' }],
    ['pages-preview-deployments', 'stage status', (value) => { value.deployments[0].stage.status = 'failed' }],
    ['pages-preview-deployments', 'HTTPS origin', (value) => { value.deployments[0].previewOrigin = 'https://two.preview.example.com' }],
    ['pages-preview-deployments', 'aliases', (value) => { value.deployments[0].aliases.push('https://alias-c.preview.example.com') }],
    ['pages-preview-deployments', 'creation timestamp', (value) => { value.deployments[0].createdAtMs += 1 }],
    ['worker-settings', 'compatibility date', (value) => { value.compatibilityDate = '2026-07-15' }],
    ['worker-settings', 'compatibility flags', (value) => { value.compatibilityFlags.push('streams_enable_constructors') }],
    ['worker-settings', 'plain-text gate value', (value) => { value.bindings[0].value = 'enabled' }],
    ['worker-settings', 'D1 binding identity tuple', (value) => { value.bindings = value.bindings.filter(({ category }) => category !== 'd1') }],
    ['worker-settings', 'service binding identity tuple', (value) => { value.bindings = value.bindings.filter(({ category }) => category !== 'service') }],
    ['worker-settings', 'rate-limit binding identity tuple', (value) => { value.bindings = value.bindings.filter(({ name }) => name !== 'RATE_LIMIT_BURST') }],
    ['worker-settings', 'rate-limit threshold', (value) => { value.bindings.find(({ name }) => name === 'RATE_LIMIT_BURST').limit += 1 }],
    ['worker-settings', 'rate-limit period', (value) => { value.bindings.find(({ name }) => name === 'RATE_LIMIT_BURST').periodSeconds += 1 }],
    ['worker-deployments', 'active deployment identity', (value) => { value.activeDeploymentIdentity = 'worker-deployment-2' }],
    ['worker-deployments', 'active version identity', (value) => { value.activeVersionIdentity = 'worker-version-2' }],
    ['worker-deployments', 'deployment identity', (value) => { value.deployments[0].identity = 'worker-deployment-2' }],
    ['worker-deployments', 'deployment timestamp', (value) => { value.deployments[0].createdAtMs += 1 }],
    ['worker-deployments', 'deployment active-version selection', (value) => { value.deployments[0].activeVersionIdentity = null }],
    ['worker-deployments', 'version identity', (value) => { value.deployments[0].versions[0].identity = 'worker-version-2' }],
    ['worker-deployments', 'traffic percentage', (value) => { value.deployments[0].versions[0].trafficPercentage = 99 }],
    ['worker-subdomain', 'workers.dev availability', (value) => { value.workersDev = true }],
    ['worker-subdomain', 'Preview URL availability', (value) => { value.previewUrls = true }],
    ['worker-schedules', 'schedule inventory', (value) => { value.schedules.push('0 3 * * *') }],
    ['worker-custom-domains', 'domain identity', (value) => { value.domains[0].identity = 'domain-2' }],
    ['worker-custom-domains', 'hostname', (value) => { value.domains[0].hostname = 'changed.preview.example.com' }],
    ['worker-custom-domains', 'zone name', (value) => { value.domains[0].zoneName = 'preview.example.com' }],
    ['worker-custom-domains', 'reviewed zone ordinal', (value) => { value.domains[0].zoneOrdinal = 1 }],
    ['worker-custom-domains', 'environment', (value) => { value.domains[0].environment = null }],
    ['worker-routes', 'route identity', (value) => { value.routes[0].identity = 'route-2' }],
    ['worker-routes', 'reviewed zone ordinal', (value) => { value.routes[0].zoneOrdinal = 1 }],
    ['worker-routes', 'canonical pattern', (value) => { value.routes[0].pattern = 'changed.preview.example.com/*' }],
    ['migration-table-discovery', 'table inventory', (value) => { value.tables.pop() }],
    ['migration-rows', 'migration ID', (value) => { value.rows[0].id = 2 }],
    ['migration-rows', 'migration name', (value) => { value.rows[0].name = '0001_changed.sql' }],
    ['migration-rows', 'applied timestamp', (value) => { value.rows[0].appliedAtMs += 1 }],
    ['migration-rows', 'added valid migration row', (value) => { value.rows.push({ id: 2, name: '0002_next.sql', appliedAtMs: 1_800_000_001_000, sourceHash: 'unavailable' }) }],
    ['migration-rows', 'removed migration row', (value) => { value.rows.pop() }],
    ['backend-schema-version', 'schema version', (value) => { value.version = 5 }],
  ]
  for (const [operation, label, mutate] of cases) {
    const left = completeValues()
    const right = structuredClone(left)
    mutate(right[operation])
    const result = compare({ values: left }, { values: right })
    assert.equal(result.resources[operation].comparison, 'DRIFT', `${operation}:${label}`)
  }
})

test('Worker plain-text binding name drift is retained without leaking provider records', () => {
  const left = completeValues()
  const right = structuredClone(left)
  const changedBinding = right['worker-settings'].bindings.find(
    ({ name }) => name === 'LEADERBOARD_IDENTITY_MODE',
  )
  assert.ok(changedBinding)
  assert.equal(
    right['worker-settings'].bindings.some(({ name }) => name === 'DRAFT_VALIDATION_MODE'),
    false,
  )
  changedBinding.name = 'DRAFT_VALIDATION_MODE'

  const result = compare({ values: left }, { values: right })
  const workerSettings = result.resources['worker-settings']
  assert.deepEqual(Object.keys(workerSettings).sort(), [
    'comparison', 'readOneSemanticHash', 'readOneState', 'readTwoSemanticHash',
    'readTwoState', 'reason',
  ])
  assert.equal(workerSettings.comparison, 'DRIFT')
  assert.equal(workerSettings.reason, 'semantic-values-differ')
  assert.equal(Object.hasOwn(workerSettings, 'stableValue'), false)
  assert.equal(result.overallComparison, 'DRIFT')
  assert.equal(result.overallCompleteness, 'complete')
  assert.equal(result.reasonCode, 'semantic-drift-detected')
  const diagnostic = canonicalJson(workerSettings)
  for (const rejectedProviderDetail of [
    'preview-worker-settings-observation', 'bindings', 'DRAFT_VALIDATION_MODE',
    'LEADERBOARD_IDENTITY_MODE', 'secretPresence',
  ]) assert.equal(diagnostic.includes(rejectedProviderDetail), false)

  const permuted = structuredClone(right)
  permuted['worker-settings'].bindings.reverse()
  const ordering = compare({ values: right }, { values: permuted })
  assert.equal(ordering.resources['worker-settings'].comparison, 'MATCH')
  assert.equal(ordering.overallComparison, 'MATCH')
})

test('Pages plain-text binding names and values are independently retained', () => {
  const left = completeValues()
  left['pages-project'].bindings = [
    { category: 'plain-text-gate', name: 'DRAFT_VALIDATION_MODE', value: 'disabled' },
    { category: 'service', name: 'VALIDATION_SERVICE', target: 'approved-preview-worker' },
  ]
  const renamed = structuredClone(left)
  renamed['pages-project'].bindings[0].name = 'DRAFT_TICKET_MODE'
  const revalued = structuredClone(left)
  revalued['pages-project'].bindings[0].value = 'enabled'
  for (const changed of [renamed, revalued]) {
    const result = compare({ values: left }, { values: changed })
    assert.equal(result.resources['pages-project'].comparison, 'DRIFT')
    assert.equal(result.overallComparison, 'DRIFT')
  }
  const permuted = structuredClone(renamed)
  permuted['pages-project'].bindings.reverse()
  assert.equal(
    compare({ values: renamed }, { values: permuted })
      .resources['pages-project'].comparison,
    'MATCH',
  )
})

test('closed precursor literals protect inseparable retained identity tuples', () => {
  const cases = [
    ['account', (value) => { value.owned = false }],
    ['pages-project', (value) => { value.identity = 'other-pages-project' }],
    ['pages-preview-deployments', (value) => { value.deployments[0].environment = 'production' }],
    ['pages-preview-deployments', (value) => { value.deployments[0].targetBranch = 'main' }],
    ['worker-routes', (value) => { value.routes[0].scriptIdentity = 'other-worker' }],
    ['d1-database', (value) => { value.identity = 'other-database' }],
    ['d1-database', (value) => { value.name = 'other-name' }],
    ['backend-schema-version', (value) => { value.singletonIdentity = 'other-singleton' }],
  ]
  for (const [operation, mutate] of cases) {
    const values = completeValues()
    mutate(values[operation])
    assert.throws(() => makeSnapshot({ values }), /single-read contract refused/i, operation)
  }
})

test('semantic sets, canonical inventories, capture time, local migration suffix, hashes, and certificates are volatile', () => {
  const left = completeValues()
  const right = structuredClone(left)
  right['account-zones'].zones.reverse()
  right['pages-project'].compatibilityFlags.reverse()
  right['pages-project'].variables.reverse()
  right['pages-project'].bindings.reverse()
  right['pages-preview-deployments'].deployments[0].aliases.reverse()
  right['worker-settings'].compatibilityFlags.reverse()
  right['worker-settings'].bindings.reverse()
  right['worker-deployments'].deployments[0].versions.reverse()
  right['worker-custom-domains'].domains[0].certificateIdentity = 'certificate-rotated'
  right['migration-rows'].pendingRepositorySuffix = ['9999_different-local-only.sql']
  right['migration-rows'].rows[0].sourceHash = 'unavailable'
  const result = compare(
    { capturedAtMs: CAPTURED_AT_MS, values: left },
    { capturedAtMs: CAPTURED_AT_MS + 50_000, values: right },
  )
  assert.equal(result.overallComparison, 'MATCH')
  assert.equal(result.readOneSemanticHash, result.readTwoSemanticHash)
  assert.equal(canonicalJson(result), canonicalJson(compare(
    { capturedAtMs: CAPTURED_AT_MS + 100_000, values: right },
    { capturedAtMs: CAPTURED_AT_MS + 200_000, values: left },
  )))
})

test('deployment, version, domain, route, and alias provider ordering remains MATCH', () => {
  const left = completeValues()
  left['pages-preview-deployments'].deployments.push({
    ...structuredClone(left['pages-preview-deployments'].deployments[0]),
    identity: 'pages-deployment-2',
    previewOrigin: 'https://two.preview.example.com',
  })
  left['worker-deployments'].deployments[0].versions.push({
    identity: 'worker-version-2', trafficPercentage: 0,
  })
  left['worker-deployments'].deployments.push({
    identity: 'worker-deployment-2', createdAtMs: 1_800_000_000_100,
    activeVersionIdentity: null,
    versions: [{ identity: 'worker-version-3', trafficPercentage: 0 }],
  })
  left['worker-custom-domains'].domains.push({
    identity: 'domain-2', hostname: 'two.preview.example.com', zoneName: 'example.com',
    zoneOrdinal: 0, certificateIdentity: null, environment: 'preview',
  })
  left['worker-routes'].routes.push({
    identity: 'route-2', pattern: 'two.preview.example.com/*', zoneOrdinal: 0,
    scriptIdentity: 'approved-preview-worker',
  })
  const right = structuredClone(left)
  right['pages-preview-deployments'].deployments.reverse()
  for (const deployment of right['pages-preview-deployments'].deployments) {
    deployment.aliases.reverse()
  }
  right['worker-deployments'].deployments.reverse()
  for (const deployment of right['worker-deployments'].deployments) deployment.versions.reverse()
  right['worker-custom-domains'].domains.reverse()
  right['worker-routes'].routes.reverse()
  const result = compare({ values: left }, { values: right })
  for (const operation of [
    'pages-preview-deployments',
    'worker-deployments',
    'worker-custom-domains',
    'worker-routes',
  ]) assert.equal(result.resources[operation].comparison, 'MATCH', operation)
})

function localeProjectionRunnerSource(projectionModuleUrl) {
  const contractsUrl = pathToFileURL(path.join(
    ROOT, 'scripts/lib/release-inspection/preview-observation-contracts.mjs',
  )).href
  const canonicalUrl = pathToFileURL(path.join(
    ROOT, 'scripts/lib/preview-release/canonical-data.mjs',
  )).href
  return `
import { createPreviewSingleReadSnapshot } from ${JSON.stringify(contractsUrl)}
import { createPreviewStabilityProjection } from ${JSON.stringify(projectionModuleUrl)}
import { canonicalJson } from ${JSON.stringify(canonicalUrl)}
const value = {
  kind: 'preview-pages-deployments-observation', schemaVersion: 1,
  latestIdentity: 'I-deployment',
  deployments: [
    { identity: 'i-deployment', environment: 'preview', targetBranch: 'develop',
      createdAtMs: 1, commitHash: null, stage: { name: 'deploy', status: 'success' },
      previewOrigin: 'https://i.preview.example.com', aliases: [] },
    { identity: 'I-deployment', environment: 'preview', targetBranch: 'develop',
      createdAtMs: 1, commitHash: null, stage: { name: 'deploy', status: 'success' },
      previewOrigin: 'https://one.preview.example.com', aliases: [] },
  ],
}
const snapshot = createPreviewSingleReadSnapshot({
  capturedAtMs: 2,
  resourceOutcomes: [{ operation: 'pages-preview-deployments', state: 'complete',
    issueCode: null, capturedAtMs: 1, value }],
})
const projected = createPreviewStabilityProjection(snapshot)
process.stdout.write(canonicalJson(projected.resources['pages-preview-deployments'].value))
`
}

function runLocaleProjection(directory, label, projectionModuleUrl, locale) {
  const runnerPath = path.join(directory, `${label}-${locale.replaceAll(/[^A-Za-z]/gu, '_')}.mjs`)
  writeFileSync(runnerPath, localeProjectionRunnerSource(projectionModuleUrl), 'utf8')
  const run = spawnSync(process.execPath, [runnerPath], {
    encoding: 'utf8',
    env: { ...process.env, LANG: locale, LC_ALL: locale },
  })
  assert.equal(run.status, 0, run.stderr)
  return run.stdout
}

test('code-unit ordering is locale-independent and a locale-sensitive mutation fails', () => {
  assert.equal('I-deployment' < 'i-deployment', true)
  assert.equal('I-deployment'.localeCompare('i-deployment', 'en-US') > 0, true)
  assert.equal('I-deployment'.localeCompare('i-deployment', 'tr-TR') < 0, true)
  const directory = mkdtempSync(path.join(tmpdir(), 'preview-code-unit-order-'))
  try {
    const runtimePath = path.join(
      ROOT, 'scripts/lib/release-inspection/preview-stability-projection.mjs',
    )
    const runtimeUrl = pathToFileURL(runtimePath).href
    const english = runLocaleProjection(directory, 'runtime', runtimeUrl, 'en_US.UTF-8')
    const turkish = runLocaleProjection(directory, 'runtime', runtimeUrl, 'tr_TR.UTF-8')
    assert.equal(english, turkish)
    assert.match(english, /"identity":"I-deployment"[\s\S]*"identity":"i-deployment"/u)

    let mutated = readFileSync(runtimePath, 'utf8')
    const codeUnitComparator = '([left], [right]) => left < right ? -1 : left > right ? 1 : 0'
    assert.equal(mutated.includes(codeUnitComparator), true)
    mutated = mutated.replace(
      codeUnitComparator,
      '([left], [right]) => left.localeCompare(right)',
    )
    const dependencyPaths = {
      '../preview-release/canonical-data.mjs': path.join(
        ROOT, 'scripts/lib/preview-release/canonical-data.mjs',
      ),
      './intrinsic-integrity.mjs': path.join(
        ROOT, 'scripts/lib/release-inspection/intrinsic-integrity.mjs',
      ),
      './preview-capability-projection-authority.mjs': path.join(
        ROOT, 'scripts/lib/release-inspection/preview-capability-projection-authority.mjs',
      ),
      './preview-observation-limits.mjs': path.join(
        ROOT, 'scripts/lib/release-inspection/preview-observation-limits.mjs',
      ),
    }
    for (const [specifier, dependencyPath] of Object.entries(dependencyPaths)) {
      mutated = mutated.replaceAll(`'${specifier}'`, JSON.stringify(pathToFileURL(dependencyPath).href))
    }
    const mutatedPath = path.join(directory, 'preview-stability-projection-mutated.mjs')
    writeFileSync(mutatedPath, mutated, 'utf8')
    const mutatedUrl = pathToFileURL(mutatedPath).href
    const mutatedEnglish = runLocaleProjection(
      directory, 'mutated', mutatedUrl, 'en_US.UTF-8',
    )
    const mutatedTurkish = runLocaleProjection(
      directory, 'mutated', mutatedUrl, 'tr_TR.UTF-8',
    )
    assert.notEqual(mutatedEnglish, mutatedTurkish)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('capability comparison covers enabled, disabled, drift, unknown, and non-applicable surfaces', () => {
  const enabled = completeValues()
  enabled['pages-project'].variables = enabled['pages-project'].variables
    .map((entry) => ({ ...entry, value: 'enabled' }))
  enabled['worker-settings'].bindings = enabled['worker-settings'].bindings
    .map((entry) => entry.category === 'plain-text-gate'
      ? { ...entry, value: 'enabled' }
      : entry)
  enabled['worker-schedules'].schedules = ['0 3 * * *']
  const enabledMatch = compare({ values: enabled }, { values: structuredClone(enabled) })
  const drift = compare({}, { values: enabled })
  const reverseDrift = compare({ values: enabled }, {})
  const unknown = compare({}, {
    states: {
      'pages-project': 'missing',
      'worker-settings': 'unavailable',
      'worker-schedules': 'partial',
    },
  })
  for (const capability of SCHEMA4_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const applicable = RELEASE_INSPECTION_CAPABILITY_SURFACES[capability].includes(surface)
      assert.equal(enabledMatch.capabilities[capability].surfaces[surface].comparison,
        applicable ? 'MATCH' : 'not-applicable')
      assert.equal(drift.capabilities[capability].surfaces[surface].comparison,
        applicable ? 'DRIFT' : 'not-applicable')
      assert.equal(reverseDrift.capabilities[capability].surfaces[surface].comparison,
        applicable ? 'DRIFT' : 'not-applicable')
      assert.equal(unknown.capabilities[capability].surfaces[surface].comparison,
        applicable ? 'UNKNOWN' : 'not-applicable')
    }
  }
})

test('UNKNOWN precedes DRIFT and no incomplete evidence becomes MATCH', () => {
  const changed = mutateMeaningful('worker-subdomain', completeValues())
  const result = compare({}, {
    values: changed,
    states: { 'migration-table-discovery': 'malformed' },
  })
  assert.equal(result.resources['worker-subdomain'].comparison, 'DRIFT')
  assert.equal(result.resources['migration-table-discovery'].comparison, 'UNKNOWN')
  assert.equal(result.overallComparison, 'UNKNOWN')
  assert.equal(result.reasonCode, 'unknown-required-comparison')
})

test('only opaque snapshots from the shared validation authority are accepted before property access', async () => {
  const valid = makeSnapshot()
  const candidates = [
    structuredClone(valid),
    JSON.parse(JSON.stringify(valid)),
    Object.create(valid),
    Object.defineProperties({}, Object.getOwnPropertyDescriptors(valid)),
  ]
  for (const candidate of candidates) {
    assert.throws(() => comparePreviewSingleReadSnapshots(candidate, valid), /opaque validated/i)
    assert.throws(() => comparePreviewSingleReadSnapshots(valid, candidate), /opaque validated/i)
  }
  let getterReads = 0
  const getter = {}
  Object.defineProperty(getter, 'resourceOutcomes', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('must not execute') },
  })
  let proxyTraps = 0
  const proxy = new Proxy({}, {
    get() { proxyTraps += 1; throw new Error('must not execute') },
    ownKeys() { proxyTraps += 1; throw new Error('must not execute') },
    getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('must not execute') },
  })
  assert.throws(() => comparePreviewSingleReadSnapshots(valid, getter), /opaque validated/i)
  assert.throws(() => comparePreviewSingleReadSnapshots(valid, proxy), /opaque validated/i)
  assert.equal(getterReads, 0)
  assert.equal(proxyTraps, 0)

  const authorityPath = pathToFileURL(path.join(
    ROOT, 'scripts/lib/release-inspection/preview-capability-projection-authority.mjs',
  ))
  const foreignAuthority = await import(`${authorityPath.href}?foreign-comparison-authority=1`)
  const foreign = foreignAuthority.validateAndAuthorizePreviewSingleReadSnapshot(structuredClone(valid))
  assert.throws(() => comparePreviewSingleReadSnapshots(valid, foreign), /opaque validated/i)
  assert.throws(() => comparePreviewSingleReadSnapshots(valid), /exactly two/i)
  assert.throws(() => comparePreviewSingleReadSnapshots(valid, valid, valid), /exactly two/i)
})

test('TypeScript widening cannot create runtime snapshot authority or alter authorized output', () => {
  const valid = makeSnapshot()
  const originalSerialization = canonicalJson(valid)
  const cloneWithExtra = (value) => ({ ...value, providerOnly: 'untrusted' })
  const widenedClone = cloneWithExtra(valid)
  assert.notEqual(widenedClone, valid)
  assert.equal(widenedClone.providerOnly, 'untrusted')
  assert.throws(
    () => comparePreviewSingleReadSnapshots(valid, widenedClone),
    /opaque validated/i,
  )
  assert.throws(() => createPreviewStabilityProjection(widenedClone), /opaque validated/i)

  let widenedReads = 0
  const widenedProxy = new Proxy(widenedClone, {
    get() { widenedReads += 1; throw new Error('must not execute') },
    ownKeys() { widenedReads += 1; throw new Error('must not execute') },
    getOwnPropertyDescriptor() { widenedReads += 1; throw new Error('must not execute') },
  })
  assert.throws(
    () => comparePreviewSingleReadSnapshots(valid, widenedProxy),
    /opaque validated/i,
  )
  assert.throws(() => createPreviewStabilityProjection(widenedProxy), /opaque validated/i)
  assert.equal(widenedReads, 0)

  // A TypeScript intersection assertion is erased. An alias remains the exact
  // same already-authorized identity; it does not register a second identity.
  const intersectionCastAlias = valid
  assert.equal(intersectionCastAlias, valid)
  assert.equal(Reflect.defineProperty(intersectionCastAlias, 'providerOnly', {
    value: 'untrusted', enumerable: true,
  }), false)
  assert.throws(() => Object.assign(valid, { providerOnly: 'untrusted' }), TypeError)
  assert.throws(() => {
    valid.resourceOutcomes[0].providerOnly = 'untrusted'
  }, TypeError)
  assert.equal(canonicalJson(valid), originalSerialization)

  const reconstructedIntersection = Object.assign({}, valid, { providerOnly: 'untrusted' })
  assert.throws(
    () => comparePreviewSingleReadSnapshots(valid, reconstructedIntersection),
    /opaque validated/i,
  )
  const result = comparePreviewSingleReadSnapshots(valid, intersectionCastAlias)
  assert.equal(canonicalJson(result).includes('providerOnly'), false)

  const extraTopLevelInput = { ...snapshotInput(), providerOnly: 'untrusted' }
  assert.throws(
    () => createPreviewSingleReadSnapshot(extraTopLevelInput),
    /single-read contract refused/i,
  )
  const extraNestedInput = snapshotInput()
  extraNestedInput.resourceOutcomes[0] = {
    ...extraNestedInput.resourceOutcomes[0], providerOnly: 'untrusted',
  }
  assert.throws(
    () => createPreviewSingleReadSnapshot(extraNestedInput),
    /single-read contract refused/i,
  )
})

test('output is closed, deterministic, compact, deeply frozen, and never grants authority', () => {
  const first = compare()
  const second = compare({}, { capturedAtMs: CAPTURED_AT_MS + 1_000 })
  assert.equal(canonicalJson(first), canonicalJson(second))
  assertDeepFrozen(first)
  assert.deepEqual(Object.keys(first).sort(), [
    'capabilities', 'capabilityInventory', 'environment', 'executionAuthorization', 'kind',
    'noRemoteMutation', 'overallComparison', 'overallCompleteness', 'productionContacted',
    'readOneSemanticHash', 'readTwoSemanticHash', 'reasonCode', 'releaseCurrentness',
    'resourceInventory', 'resources', 'schemaVersion', 'surfaceInventory',
  ])
  for (const forbidden of [
    'approval', 'readiness', 'noOp', 'permission', 'freshness', 'expiration',
    'delay', 'requestCount', 'ordinal', 'clock', 'mutationPlan', 'releaseRecommendation',
  ]) assert.equal(Object.hasOwn(first, forbidden), false, forbidden)
  assert.equal(new TextEncoder().encode(canonicalJson(first)).byteLength <= PREVIEW_STABLE_COMPARISON_MAX_BYTES, true)
  assert.deepEqual(createPreviewStabilityProjection(makeSnapshot()).resourceInventory, PREVIEW_OPERATION_INVENTORY)
})

const CLOSED_COMPARISON_SOURCE_GRAPH = new Map(Object.entries({
  'scripts/lib/preview-release/canonical-data.mjs': ['node:util'],
  'scripts/lib/release-inspection/capability-model.mjs': [
    '../../../shared/schema4-capabilities.mjs',
  ],
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'node:buffer', 'node:util', 'node:vm',
  ],
  'scripts/lib/release-inspection/preview-capability-projection-authority.mjs': [
    'node:util',
    '../preview-release/canonical-data.mjs',
    './intrinsic-integrity.mjs',
    './preview-observation-limits.mjs',
    './preview-resource-schemas.mjs',
  ],
  'scripts/lib/release-inspection/preview-capability-projection.mjs': [
    'node:util',
    '../preview-release/canonical-data.mjs',
    '../../../shared/schema4-capabilities.mjs',
    './capability-model.mjs',
    './intrinsic-integrity.mjs',
    './preview-capability-projection-authority.mjs',
  ],
  'scripts/lib/release-inspection/preview-observation-limits.mjs': [
    '../preview-release/canonical-data.mjs',
  ],
  'scripts/lib/release-inspection/preview-resource-schemas.mjs': [
    'node:util',
    '../preview-release/canonical-data.mjs',
    './preview-observation-limits.mjs',
  ],
  'scripts/lib/release-inspection/preview-stability-projection.mjs': [
    'node:crypto',
    'node:util',
    '../preview-release/canonical-data.mjs',
    './intrinsic-integrity.mjs',
    './preview-capability-projection-authority.mjs',
    './preview-observation-limits.mjs',
  ],
  'scripts/lib/release-inspection/preview-stable-comparison.mjs': [
    'node:crypto',
    'node:util',
    '../../../shared/schema4-capabilities.mjs',
    '../preview-release/canonical-data.mjs',
    './capability-model.mjs',
    './intrinsic-integrity.mjs',
    './preview-capability-projection.mjs',
    './preview-capability-projection-authority.mjs',
    './preview-observation-limits.mjs',
    './preview-stability-projection.mjs',
  ],
  'shared/schema4-capabilities.mjs': [],
}).map(([file, specifiers]) => [file, new Set(specifiers)]))

const APPROVED_UNRESOLVED_COMPUTED_MEMBERS = new Map(Object.entries({
  'scripts/lib/preview-release/canonical-data.mjs': [
    'clone[index]',
  ],
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'expectedKeys[index]', 'PROTECTED_GLOBAL_KEYS[index]', 'slots[index]',
    'Array.prototype[Symbol.iterator]', 'String.prototype[Symbol.iterator]',
    'Set.prototype[Symbol.iterator]', 'Map.prototype[Symbol.iterator]',
    'globalSlots[index]', 'queue[cursor]', 'keys[index]', 'descriptors[index]',
    'TRUSTED_GLOBAL_SLOTS[slotIndex]', 'TRUSTED_GRAPH[recordIndex]',
    'currentKeys[currentIndex]', 'trusted.keys[keyIndex]',
    'trusted.descriptors[keyIndex]',
  ],
  'scripts/lib/release-inspection/preview-capability-projection-authority.mjs': [
    'ISSUE_CODE_BY_STATE[outcome.state]',
  ],
  'scripts/lib/release-inspection/preview-capability-projection.mjs': [
    'RELEASE_INSPECTION_CAPABILITY_SURFACES[capability]',
    'SCHEMA4_RUNTIME_GATE_REGISTRY.capabilities[capability]',
    'surfaces[surface]', 'capabilities[capability]',
    'projection.capabilities[capability]', 'record.surfaces[surface]',
  ],
  'scripts/lib/release-inspection/preview-resource-schemas.mjs': [
    'daysInMonth[month - 1]', 'ranges[index]', 'EXPECTED_KIND[operation]',
  ],
  'scripts/lib/release-inspection/preview-stability-projection.mjs': [
    'keyed[index - 1]',
  ],
  'scripts/lib/release-inspection/preview-stable-comparison.mjs': [
    'RELEASE_INSPECTION_CAPABILITY_SURFACES[capability]', 'surfaces[surface]',
    'readOneProjection.capabilities[capability]',
    'readOneProjection.capabilities[capability].surfaces[surface]',
    'readTwoProjection.capabilities[capability]',
    'readTwoProjection.capabilities[capability].surfaces[surface]',
    'capabilities[capability]', 'resourceProjection.resources[operation]',
    'capabilityProjection.capabilities[capability]',
    'capabilityProjection.capabilities[capability].surfaces[surface]',
    'capabilities[capability].surfaces[surface]',
    'readOneResources.resources[operation]', 'readTwoResources.resources[operation]',
  ],
  'shared/schema4-capabilities.mjs': [
    'environment[descriptor.variable]', 'environment[descriptor.compatibilityCeiling]',
  ],
}).map(([file, members]) => [file, new Set(members)]))

const APPROVED_REFLECTIVE_CALLS = new Map(Object.entries({
  'scripts/lib/preview-release/canonical-data.mjs': [
    'Object.getPrototypeOf(value)',
    'Reflect.ownKeys(value)',
    "Object.getOwnPropertyDescriptor(value, 'length')",
    'Object.getOwnPropertyDescriptor(value, String(index))',
    'Object.getOwnPropertyDescriptor(value, key)',
    `Object.defineProperty(clone, key, {
        value: clonePlain(descriptor.value, \`${'${trail}.${key}'}\`),
        enumerable: true,
        configurable: true,
        writable: true,
      })`,
  ],
  'scripts/lib/release-inspection/preview-capability-projection-authority.mjs': [
    'Reflect.ownKeys(value)',
    'Reflect.getPrototypeOf(value)',
    'Reflect.getOwnPropertyDescriptor(value, String(index))',
    'Reflect.getOwnPropertyDescriptor(value, key)',
  ],
  'scripts/lib/release-inspection/preview-capability-projection.mjs': [
    'Reflect.ownKeys(value)',
    'Reflect.getOwnPropertyDescriptor(value, key)',
  ],
  'scripts/lib/release-inspection/preview-resource-schemas.mjs': [
    'Reflect.getPrototypeOf(value)',
    'Reflect.ownKeys(value)',
  ],
  'scripts/lib/release-inspection/preview-stability-projection.mjs': [
    `Object.fromEntries(PREVIEW_OPERATION_INVENTORY.map((operation) => [
    operation,
    projectResource(outcomes.get(operation) ?? null),
  ]))`,
  ],
  'scripts/lib/release-inspection/preview-stable-comparison.mjs': [
    `Object.fromEntries(PREVIEW_OPERATION_INVENTORY.map((operation) => {
      const resource = resourceProjection.resources[operation]
      return [operation, { state: resource.state, semanticHash: resource.semanticHash }]
    }))`,
    `Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [
      capability,
      {
        surfaces: Object.fromEntries(RELEASE_INSPECTION_SURFACES.map((surface) => {
          const record = capabilityProjection.capabilities[capability].surfaces[surface]
          return [surface, {
            applicability: record.applicability,
            candidateState: record.candidateState,
          }]
        })),
      },
    ]))`,
    `Object.fromEntries(RELEASE_INSPECTION_SURFACES.map((surface) => {
          const record = capabilityProjection.capabilities[capability].surfaces[surface]
          return [surface, {
            applicability: record.applicability,
            candidateState: record.candidateState,
          }]
        }))`,
    `Object.fromEntries(PREVIEW_OPERATION_INVENTORY.map((operation) => [
    operation,
    compareResource(
      readOneResources.resources[operation],
      readTwoResources.resources[operation],
    ),
  ]))`,
  ],
}).map(([file, calls]) => [file, new Set(calls)]))

const APPROVED_REFLECTIVE_MEMBERS = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'Reflect.apply', 'Reflect.getOwnPropertyDescriptor', 'Reflect.getPrototypeOf',
    'Reflect.ownKeys',
  ],
}).map(([file, members]) => [file, new Set(members)]))

const REFLECTIVE_METHODS_BY_OBJECT = new Map([
  ['Object', new Set([
    'assign', 'create', 'defineProperties', 'defineProperty',
    'fromEntries', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors',
    'getPrototypeOf', 'setPrototypeOf',
  ])],
  ['Reflect', new Set([
    'apply', 'construct', 'defineProperty', 'deleteProperty', 'get',
    'getOwnPropertyDescriptor', 'getPrototypeOf', 'has', 'isExtensible', 'ownKeys',
    'preventExtensions', 'set', 'setPrototypeOf',
  ])],
])

const CAPTURED_REFLECTIVE_METHODS = new Set([
  'reflectApply',
  'reflectGetOwnPropertyDescriptor',
  'reflectGetPrototypeOf',
  'reflectOwnKeys',
])

const APPROVED_CAPTURED_REFLECTIVE_DECLARATIONS = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'reflectOwnKeys = Reflect.ownKeys',
    'reflectApply = Reflect.apply',
    'reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor',
    'reflectGetPrototypeOf = Reflect.getPrototypeOf',
  ],
}).map(([file, declarations]) => [file, new Set(declarations)]))

const APPROVED_CAPTURED_REFLECTIVE_CALLS = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'reflectApply(trustedFunctionToString, value, [])',
    'reflectGetOwnPropertyDescriptor(trustedGlobalThis, "WeakMap")',
    'reflectGetPrototypeOf(currentConstructor)',
    'reflectGetPrototypeOf(currentPrototype)',
    'reflectOwnKeys(expectedPrototype)',
    'reflectOwnKeys(currentPrototype)',
    'reflectGetOwnPropertyDescriptor(expectedPrototype, key)',
    'reflectGetOwnPropertyDescriptor(currentPrototype, key)',
    'reflectGetOwnPropertyDescriptor(trustedGlobalThis, key)',
    'reflectGetPrototypeOf(reflectApply(Array.prototype[Symbol.iterator], [], []))',
    'reflectApply(Array.prototype[Symbol.iterator], [], [])',
    'reflectGetPrototypeOf(reflectApply(String.prototype[Symbol.iterator], "", []))',
    'reflectApply(String.prototype[Symbol.iterator], "", [])',
    'reflectGetPrototypeOf(reflectApply(Set.prototype[Symbol.iterator], new Set(), []))',
    'reflectApply(Set.prototype[Symbol.iterator], new Set(), [])',
    'reflectGetPrototypeOf(reflectApply(Map.prototype[Symbol.iterator], new Map(), []))',
    'reflectApply(Map.prototype[Symbol.iterator], new Map(), [])',
    'reflectOwnKeys(target)',
    'reflectGetOwnPropertyDescriptor(target, keys[index])',
    'reflectGetPrototypeOf(target)',
    'reflectGetOwnPropertyDescriptor(trustedGlobalThis, trusted.key)',
    'reflectGetPrototypeOf(trusted.target)',
    'reflectOwnKeys(trusted.target)',
    `reflectGetOwnPropertyDescriptor(
          trusted.target,
          trusted.keys[keyIndex],
        )`,
    'reflectApply(trustedWeakMapGet, authority, [key])',
    'reflectApply(trustedWeakMapSet, authority, [key, value])',
  ],
}).map(([file, calls]) => [file, new Set(calls)]))

const APPROVED_CAPTURED_REFLECTIVE_CONTAINER_SOURCE = `[
    ...iteratorPrototypes,
    NodeBuffer,
    reflectApply,
    reflectOwnKeys,
    reflectGetOwnPropertyDescriptor,
    reflectGetPrototypeOf,
    objectHasOwn,
    objectIs,
  ]`
const APPROVED_CAPTURED_REFLECTIVE_CONTAINER_INDEX = new Map([
  ['reflectApply', 2],
  ['reflectOwnKeys', 3],
  ['reflectGetOwnPropertyDescriptor', 4],
  ['reflectGetPrototypeOf', 5],
])

const APPROVED_SENSITIVE_QUEUE_REFERENCE_SEQUENCE = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    `queue = ${APPROVED_CAPTURED_REFLECTIVE_CONTAINER_SOURCE}`,
    'queue.push(globalSlots[index].descriptor.value)',
    'queue.length',
    'queue[cursor]',
    'queue.push(descriptor.value)',
    'queue.push(descriptor.get)',
    'queue.push(descriptor.set)',
    'queue.push(prototype)',
  ],
}))

const APPROVED_SENSITIVE_TARGET_REFERENCE_SEQUENCE = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    '$authority = queue[cursor]',
    'seen.has($authority)',
    'seen.add($authority)',
    'reflectOwnKeys($authority)',
    'reflectGetOwnPropertyDescriptor($authority, keys[index])',
    'reflectGetPrototypeOf($authority)',
    `records.push({
      $authority,
      prototype,
      keys,
      descriptors,
    })`,
  ],
}))

const APPROVED_SENSITIVE_RECORDS_PUSH_SOURCE = `$authority.push({
      target,
      prototype,
      keys,
      descriptors,
    })`

const APPROVED_SENSITIVE_RECORDS_REFERENCE_SEQUENCE = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    '$authority = []',
    '$authority.length >= MAX_TRUSTED_TARGETS',
    APPROVED_SENSITIVE_RECORDS_PUSH_SOURCE,
    'return $authority;',
  ],
}))

const APPROVED_TRUSTED_GRAPH_REFERENCE_SEQUENCE = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    '$authority = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)',
    '$authority.length > MAX_TRUSTED_TARGETS',
    'recordIndex < $authority.length',
    '$authority[recordIndex]',
  ],
}))

const APPROVED_TRUSTED_RECORD_REFERENCE_SEQUENCE = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    '$authority = TRUSTED_GRAPH[recordIndex]',
    'reflectGetPrototypeOf($authority.target)',
    'objectIs(reflectGetPrototypeOf($authority.target), $authority.prototype)',
    'reflectOwnKeys($authority.target)',
    'currentKeys.length !== $authority.keys.length',
    'keyIndex < $authority.keys.length',
    'objectIs(currentKeys[currentIndex], $authority.keys[keyIndex])',
    `reflectGetOwnPropertyDescriptor(
          $authority.target,
          $authority.keys[keyIndex],
        )`,
    `reflectGetOwnPropertyDescriptor(
          $authority.target,
          $authority.keys[keyIndex],
        )`,
    'descriptorsMatch($authority.descriptors[keyIndex], currentDescriptor)',
  ],
}))

const APPROVED_AUTHORITY_FACTORY_REFERENCE_SEQUENCE = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'function $factory(globalSlots)',
    '$factory(TRUSTED_GLOBAL_SLOTS)',
  ],
}))

const APPROVED_VM_ARGUMENT_SOURCE = `({
  WeakMap,
  functionToString: Function.prototype.toString,
  weakMapDelete: WeakMap.prototype.delete,
  weakMapGet: WeakMap.prototype.get,
  weakMapHas: WeakMap.prototype.has,
  weakMapPrototype: WeakMap.prototype,
  weakMapSet: WeakMap.prototype.set,
})`
const APPROVED_VM_CALL_SOURCE = `runInNewContext(\`${APPROVED_VM_ARGUMENT_SOURCE}\`)`
const APPROVED_VM_CALLS = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [APPROVED_VM_CALL_SOURCE],
}).map(([file, calls]) => [file, new Set(calls)]))

const APPROVED_DIRECT_AUTHORITY_MEMBERS = new Map(Object.entries({
  'scripts/lib/preview-release/canonical-data.mjs': [
    'Array.prototype', 'Object.prototype',
  ],
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': [
    'currentConstructor.prototype', 'Function.prototype', 'Object.prototype',
    'Array.prototype', 'String.prototype', 'Set.prototype', 'Map.prototype',
    'trusted.prototype',
  ],
  'scripts/lib/release-inspection/preview-capability-projection-authority.mjs': [
    'Array.prototype', 'Object.prototype',
  ],
  'scripts/lib/release-inspection/preview-resource-schemas.mjs': [
    'Object.prototype',
  ],
}).map(([file, members]) => [file, new Set(members)]))

const APPROVED_UNRESOLVED_COMPUTED_MEMBER_COUNTS = new Map(Object.entries({
  'scripts/lib/release-inspection/intrinsic-integrity.mjs': {
    'trusted.keys[keyIndex]': 2,
  },
  'scripts/lib/release-inspection/preview-capability-projection.mjs': {
    'RELEASE_INSPECTION_CAPABILITY_SURFACES[capability]': 2,
    'surfaces[surface]': 4,
  },
  'scripts/lib/release-inspection/preview-resource-schemas.mjs': {
    'ranges[index]': 2,
    'EXPECTED_KIND[operation]': 7,
  },
  'scripts/lib/release-inspection/preview-stable-comparison.mjs': {
    'capabilities[capability]': 2,
  },
}).map(([file, counts]) => [file, new Map(Object.entries(counts))]))

const APPROVED_REFLECTIVE_CALL_COUNTS = new Map(Object.entries({
  'scripts/lib/preview-release/canonical-data.mjs': {
    'Object.getPrototypeOf(value)': 2,
    'Reflect.ownKeys(value)': 2,
  },
  'scripts/lib/release-inspection/preview-capability-projection-authority.mjs': {
    'Reflect.getPrototypeOf(value)': 2,
    'Reflect.ownKeys(value)': 3,
  },
}).map(([file, counts]) => [file, new Map(Object.entries(counts))]))

function reviewedOccurrence(
  repositoryPath,
  snippet,
  approvals,
  countOverrides,
  observed,
) {
  if (!(approvals.get(repositoryPath)?.has(snippet) ?? false)) return false
  const count = (observed.get(snippet) ?? 0) + 1
  observed.set(snippet, count)
  const expected = countOverrides.get(repositoryPath)?.get(snippet) ?? 1
  return count <= expected
}

function assertReviewedOccurrenceInventory(
  repositoryPath,
  approvals,
  countOverrides,
  observed,
  label,
) {
  const expected = [...(approvals.get(repositoryPath) ?? [])]
    .map((snippet) => [
      snippet,
      countOverrides.get(repositoryPath)?.get(snippet) ?? 1,
    ])
    .sort(([left], [right]) => left.localeCompare(right))
  assert.deepEqual(
    [...observed].sort(([left], [right]) => left.localeCompare(right)),
    expected,
    `${repositoryPath}:${label} exact reviewed occurrence inventory`,
  )
}

function inspectOrderedOccurrence(
  repositoryPath,
  snippet,
  approvals,
  observed,
  label,
  unordered = false,
) {
  const expected = approvals.get(repositoryPath) ?? []
  if (unordered) {
    const expectedCounts = new Map()
    const observedCounts = new Map()
    for (const value of expected) expectedCounts.set(value, (expectedCounts.get(value) ?? 0) + 1)
    for (const value of observed) observedCounts.set(value, (observedCounts.get(value) ?? 0) + 1)
    const permitted = (expectedCounts.get(snippet) ?? 0) > (observedCounts.get(snippet) ?? 0)
    assert.equal(permitted, true, `${repositoryPath}:unapproved ${label}:${snippet}`)
  } else {
    assert.equal(
      snippet,
      expected[observed.length],
      `${repositoryPath}:out-of-order or unapproved ${label}:${snippet}`,
    )
  }
  observed.push(snippet)
}

function assertOrderedOccurrenceInventory(
  repositoryPath,
  approvals,
  observed,
  label,
  unordered = false,
) {
  const expected = approvals.get(repositoryPath) ?? []
  if (unordered) {
    assert.deepEqual(
      [...observed].sort(),
      [...expected].sort(),
      `${repositoryPath}:${label} exact unordered occurrence inventory`,
    )
    return
  }
  assert.deepEqual(
    observed,
    expected,
    `${repositoryPath}:${label} exact ordered occurrence inventory`,
  )
}

function walkSyntax(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue
    if (Array.isArray(value)) {
      for (const child of value) walkSyntax(child, visit, node)
    } else if (value && typeof value === 'object') walkSyntax(value, visit, node)
  }
}

function bindingIdentifiers(pattern, identifiers = []) {
  if (!pattern) return identifiers
  if (pattern.type === 'Identifier') identifiers.push(pattern)
  if (pattern.type === 'RestElement') bindingIdentifiers(pattern.argument, identifiers)
  if (pattern.type === 'AssignmentPattern') bindingIdentifiers(pattern.left, identifiers)
  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) bindingIdentifiers(element, identifiers)
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      bindingIdentifiers(
        property.type === 'RestElement' ? property.argument : property.value,
        identifiers,
      )
    }
  }
  return identifiers
}

function nearestBindingScope(node, parents, kind) {
  const functionScopes = new Set([
    'ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression', 'Program',
  ])
  const lexicalScopes = new Set([
    ...functionScopes,
    'BlockStatement', 'CatchClause', 'ForInStatement', 'ForOfStatement',
    'ForStatement', 'SwitchStatement',
  ])
  let current = parents.get(node)
  while (current) {
    if ((kind === 'var' ? functionScopes : lexicalScopes).has(current.type)) return current
    current = parents.get(current)
  }
  return null
}

function collectNamedBindings(syntax, parents, name) {
  const bindings = []
  const bindingNodes = new WeakSet()
  const add = (identifier, scope, declaration = null, declarator = null) => {
    if (identifier.name !== name) return
    bindingNodes.add(identifier)
    bindings.push({ declaration, declarator, identifier, scope })
  }
  walkSyntax(syntax, (node) => {
    if (node.type === 'VariableDeclaration') {
      const scope = nearestBindingScope(node, parents, node.kind)
      for (const declarator of node.declarations) {
        for (const identifier of bindingIdentifiers(declarator.id)) {
          add(identifier, scope, node, declarator)
        }
      }
    }
    if (['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']
      .includes(node.type)) {
      for (const parameter of node.params) {
        for (const identifier of bindingIdentifiers(parameter)) add(identifier, node)
      }
      if (node.id?.type === 'Identifier') {
        const scope = node.type === 'FunctionExpression'
          ? node
          : nearestBindingScope(node, parents, 'const')
        add(node.id, scope)
      }
    }
    if (node.type === 'CatchClause') {
      for (const identifier of bindingIdentifiers(node.param)) add(identifier, node)
    }
    if (node.type === 'ImportDeclaration') {
      const scope = nearestBindingScope(node, parents, 'const')
      for (const specifier of node.specifiers) add(specifier.local, scope)
    }
  })
  return { bindingNodes, bindings }
}

function resolvedBinding(identifier, bindingsByScope, parents) {
  let current = parents.get(identifier)
  while (current) {
    const bindings = bindingsByScope.get(current)
    if (bindings?.length > 0) return bindings.length === 1 ? bindings[0] : null
    current = parents.get(current)
  }
  return null
}

function isIdentifierReference(identifier, bindingNodes, parents) {
  if (bindingNodes.has(identifier)) return false
  const parent = parents.get(identifier)
  if (parent?.type === 'MemberExpression'
    && parent.computed === false && parent.property === identifier) return false
  if (parent?.type === 'Property' && parent.computed === false
    && parent.key === identifier && parent.value !== identifier) return false
  if (parent?.type === 'MethodDefinition' && parent.computed === false
    && parent.key === identifier) return false
  if (parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement'
    || parent?.type === 'ContinueStatement') return false
  return true
}

function sensitiveQueueReferenceContext(identifier, targetBinding, source, parents) {
  if (identifier === targetBinding.identifier) {
    return source.slice(targetBinding.declarator.start, targetBinding.declarator.end)
  }
  const parent = parents.get(identifier)
  if (parent?.type === 'MemberExpression' && parent.object === identifier) {
    const call = parents.get(parent)
    if (call?.type === 'CallExpression' && call.callee === parent) {
      return source.slice(call.start, call.end)
    }
    return source.slice(parent.start, parent.end)
  }
  if (parent?.type === 'CallExpression' || parent?.type === 'NewExpression'
    || parent?.type === 'VariableDeclarator' || parent?.type === 'AssignmentExpression'
    || parent?.type === 'ReturnStatement' || parent?.type === 'ArrayExpression'
    || parent?.type === 'Property' || parent?.type === 'SpreadElement'
    || parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') {
    return source.slice(parent.start, parent.end)
  }
  return source.slice(identifier.start, identifier.end)
}

function queueEscapeWeakening(identifier, parents) {
  const parent = parents.get(identifier)
  if (parent?.type === 'VariableDeclarator' && parent.init === identifier) {
    return 'omit-queue-direct-alias'
  }
  if (parent?.type === 'AssignmentExpression' && parent.right === identifier) {
    return 'omit-queue-direct-alias'
  }
  if ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression')
    && parent.arguments.includes(identifier)) return 'omit-queue-argument-escape'
  if (parent?.type === 'ArrayExpression' || parent?.type === 'Property'
    || parent?.type === 'SpreadElement') return 'omit-queue-container-escape'
  if (parent?.type === 'MemberExpression' && parent.object === identifier
    && parent.computed) return 'omit-queue-element-escape'
  return 'omit-queue-all-references'
}

function inspectSensitiveQueueBinding(syntax, source, repositoryPath, parents, weakening) {
  if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return
  const { bindingNodes, bindings } = collectNamedBindings(syntax, parents, 'queue')
  const targetCandidates = bindings.filter(({ declaration, declarator }) => {
    if (declaration?.kind !== 'const' || declaration.declarations.length !== 1
      || declarator?.id.type !== 'Identifier'
      || source.slice(declarator.init.start, declarator.init.end)
        !== APPROVED_CAPTURED_REFLECTIVE_CONTAINER_SOURCE) return false
    let current = parents.get(declaration)
    while (current && !['ArrowFunctionExpression', 'FunctionDeclaration',
      'FunctionExpression'].includes(current.type)) current = parents.get(current)
    return current?.type === 'FunctionDeclaration'
      && current.id?.name === 'captureTrustedGraph'
      && current.body.body[1] === declaration
  })
  assert.equal(targetCandidates.length, 1, `${repositoryPath}:single sensitive queue binding`)
  const [targetBinding] = targetCandidates
  assert.equal(
    bindings.filter(({ scope }) => scope === targetBinding.scope).length,
    1,
    `${repositoryPath}:unambiguous sensitive queue scope`,
  )
  const bindingsByScope = new Map()
  for (const binding of bindings) {
    const scoped = bindingsByScope.get(binding.scope) ?? []
    scoped.push(binding)
    bindingsByScope.set(binding.scope, scoped)
  }
  const observed = []
  const unordered = weakening === 'restore-unordered-queue-inventory'
  const inspectReference = (identifier) => {
    const context = sensitiveQueueReferenceContext(identifier, targetBinding, source, parents)
    const expected = APPROVED_SENSITIVE_QUEUE_REFERENCE_SEQUENCE
      .get(repositoryPath)?.[observed.length]
    const approved = unordered
      ? (APPROVED_SENSITIVE_QUEUE_REFERENCE_SEQUENCE
          .get(repositoryPath)?.includes(context) ?? false)
      : context === expected
    if (approved) {
      inspectOrderedOccurrence(
        repositoryPath,
        context,
        APPROVED_SENSITIVE_QUEUE_REFERENCE_SEQUENCE,
        observed,
        'sensitive queue reference',
        unordered,
      )
      return
    }
    if (weakening === 'omit-queue-all-references'
      || weakening === queueEscapeWeakening(identifier, parents)) return
    assert.fail(`${repositoryPath}:unapproved sensitive queue reference:${context}`)
  }
  inspectReference(targetBinding.identifier)
  walkSyntax(syntax, (node) => {
    if (node.type !== 'Identifier' || node.name !== 'queue'
      || !isIdentifierReference(node, bindingNodes, parents)) return
    if (resolvedBinding(node, bindingsByScope, parents) === targetBinding) inspectReference(node)
  })
  assertOrderedOccurrenceInventory(
    repositoryPath,
    APPROVED_SENSITIVE_QUEUE_REFERENCE_SEQUENCE,
    observed,
    'sensitive queue references',
    unordered,
  )
}

function enclosingFunction(node, parents) {
  let current = parents.get(node)
  while (current && !['ArrowFunctionExpression', 'FunctionDeclaration',
    'FunctionExpression'].includes(current.type)) current = parents.get(current)
  return current
}

function exactBindingForIdentifier(syntax, parents, identifier) {
  const resolution = collectNamedBindings(syntax, parents, identifier.name)
  const binding = resolution.bindings.find((candidate) => candidate.identifier === identifier)
  assert.ok(binding)
  const bindingsByScope = new Map()
  for (const candidate of resolution.bindings) {
    const scoped = bindingsByScope.get(candidate.scope) ?? []
    scoped.push(candidate)
    bindingsByScope.set(candidate.scope, scoped)
  }
  return { ...resolution, binding, bindingsByScope }
}

function exactBindingForDeclarator(syntax, parents, declarator) {
  assert.equal(declarator.id.type, 'Identifier')
  return exactBindingForIdentifier(syntax, parents, declarator.id)
}

function authorityReferenceExpression(identifier, binding, parents) {
  if (identifier === binding.identifier) return binding.declarator
  let current = identifier
  let parent = parents.get(current)
  while (parent?.type === 'MemberExpression' && parent.object === current) {
    current = parent
    parent = parents.get(current)
  }
  if (parent?.type === 'CallExpression' || parent?.type === 'NewExpression'
    || parent?.type === 'BinaryExpression' || parent?.type === 'AssignmentExpression'
    || parent?.type === 'VariableDeclarator' || parent?.type === 'ReturnStatement'
    || parent?.type === 'SpreadElement' || parent?.type === 'ForInStatement'
    || parent?.type === 'ForOfStatement') return parent
  if (parent?.type === 'Property') {
    const object = parents.get(parent)
    const container = object?.type === 'ObjectExpression' ? parents.get(object) : null
    if (container?.type === 'CallExpression' || container?.type === 'NewExpression') {
      return container
    }
    return object?.type === 'ObjectExpression' ? object : parent
  }
  if (parent?.type === 'ArrayExpression' || parent?.type === 'ObjectExpression'
    || parent?.type === 'ArrowFunctionExpression'
    || parent?.type === 'FunctionExpression') return parent
  return current
}

function normalizedBindingSource(source, expression, references, placeholder = '$authority') {
  const replacements = references
    .filter((identifier) => identifier.start >= expression.start
      && identifier.end <= expression.end)
    .sort((left, right) => right.start - left.start)
  let normalized = source.slice(expression.start, expression.end)
  for (const identifier of replacements) {
    const start = identifier.start - expression.start
    const end = identifier.end - expression.start
    normalized = `${normalized.slice(0, start)}${placeholder}${normalized.slice(end)}`
  }
  return normalized
}

function sensitiveBindingReferences(syntax, parents, declarator) {
  const resolution = exactBindingForDeclarator(syntax, parents, declarator)
  const references = [resolution.binding.identifier]
  walkSyntax(syntax, (node) => {
    if (node.type !== 'Identifier' || node.name !== resolution.binding.identifier.name
      || !isIdentifierReference(node, resolution.bindingNodes, parents)) return
    if (resolvedBinding(node, resolution.bindingsByScope, parents) === resolution.binding) {
      references.push(node)
    }
  })
  return { ...resolution, references }
}

function trustedEscapeWeakening(kind, identifier, parents) {
  const parent = parents.get(identifier)
  const member = parent?.type === 'MemberExpression' && parent.object === identifier
    ? parent
    : null
  const memberOwner = member ? parents.get(member) : null
  if (kind === 'trusted-graph') return 'omit-trusted-graph-escape'
  if (kind !== 'trusted-record') return 'omit-trusted-all-references'
  if (parent?.type === 'VariableDeclarator' && parent.init === identifier) {
    return 'omit-trusted-direct-alias'
  }
  if (parent?.type === 'AssignmentExpression' && parent.right === identifier) {
    return 'omit-trusted-direct-alias'
  }
  if (member && !member.computed && member.property?.name === 'target'
    && (memberOwner?.type === 'VariableDeclarator'
      || memberOwner?.type === 'AssignmentExpression'
      || memberOwner?.type === 'ReturnStatement'
      || memberOwner?.type === 'CallExpression'
      || memberOwner?.type === 'ArrayExpression'
      || memberOwner?.type === 'Property')) return 'omit-trusted-target-alias'
  if (parent?.type === 'ReturnStatement'
    || ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression')
      && parent.arguments.includes(identifier))) return 'omit-trusted-argument-return'
  return 'omit-trusted-all-references'
}

function inspectOrderedSensitiveBinding({
  syntax,
  source,
  repositoryPath,
  parents,
  declarator,
  approvals,
  label,
  kind,
  weakening,
}) {
  const resolution = sensitiveBindingReferences(syntax, parents, declarator)
  if (weakening === 'name-only-trusted-matching' && kind === 'trusted-record') {
    walkSyntax(syntax, (node) => {
      if (node.type !== 'Identifier' || node.name !== 'trusted'
        || !isIdentifierReference(node, resolution.bindingNodes, parents)) return
      assert.equal(
        resolvedBinding(node, resolution.bindingsByScope, parents),
        resolution.binding,
        `${repositoryPath}:name-only trusted-record false positive`,
      )
    })
    return
  }
  const observed = []
  for (const identifier of resolution.references) {
    let expression = authorityReferenceExpression(identifier, resolution.binding, parents)
    if (kind === 'trusted-graph' && expression.type === 'VariableDeclarator'
      && expression !== declarator && expression.init?.type === 'MemberExpression') {
      expression = expression.init
    }
    const context = normalizedBindingSource(
      source,
      expression,
      resolution.references,
    )
    const expected = approvals.get(repositoryPath)?.[observed.length]
    if (context === expected) {
      inspectOrderedOccurrence(repositoryPath, context, approvals, observed, label)
      continue
    }
    if (weakening === 'omit-trusted-all-references'
      || weakening === trustedEscapeWeakening(kind, identifier, parents)) continue
    assert.fail(`${repositoryPath}:unapproved ${label}:${context}`)
  }
  assertOrderedOccurrenceInventory(repositoryPath, approvals, observed, label)
}

function authorityFactoryEscapeWeakening(identifier, parents) {
  const parent = parents.get(identifier)
  if (parent?.type === 'VariableDeclarator' && parent.init === identifier) {
    return 'omit-factory-alias-rejection'
  }
  if (parent?.type === 'AssignmentExpression' && parent.right === identifier) {
    return 'omit-factory-alias-rejection'
  }
  if (parent?.type === 'ReturnStatement'
    || ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression')
      && parent.callee !== identifier && parent.arguments.includes(identifier))) {
    const reflectMember = parent.callee?.type === 'MemberExpression'
      && parent.callee.object?.type === 'Identifier'
      && parent.callee.object.name === 'Reflect'
      && parent.callee.property?.type === 'Identifier'
      && parent.callee.property.name === 'apply'
    return reflectMember
      ? 'omit-factory-call-apply-bind-rejection'
      : 'omit-factory-argument-return-rejection'
  }
  if (parent?.type === 'MemberExpression' && parent.object === identifier) {
    const property = !parent.computed && parent.property?.type === 'Identifier'
      ? parent.property.name
      : null
    if (['call', 'apply', 'bind'].includes(property)) {
      return 'omit-factory-call-apply-bind-rejection'
    }
  }
  if (parent?.type === 'CallExpression' && parent.callee === identifier) {
    return 'omit-factory-direct-second-call-rejection'
  }
  return 'omit-factory-all-references'
}

function inspectCaptureTrustedGraphFactory(
  syntax,
  repositoryPath,
  parents,
  weakening,
) {
  if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return
  const declarations = []
  walkSyntax(syntax, (node) => {
    if (node.type === 'FunctionDeclaration'
      && node.id?.type === 'Identifier'
      && node.id.name === 'captureTrustedGraph'
      && parents.get(node) === syntax) declarations.push(node)
  })
  assert.equal(declarations.length, 1, `${repositoryPath}:single authority factory`)
  const [declaration] = declarations
  assert.equal(parents.get(declaration), syntax, `${repositoryPath}:authority factory at module scope`)
  assert.equal(declaration.async, false, `${repositoryPath}:synchronous authority factory`)
  assert.equal(declaration.generator, false, `${repositoryPath}:non-generator authority factory`)
  assert.equal(declaration.params.length, 1, `${repositoryPath}:authority factory parameter count`)
  assert.equal(declaration.params[0]?.type, 'Identifier')
  assert.equal(declaration.params[0].name, 'globalSlots')
  assert.equal(declaration.body.type, 'BlockStatement')
  const resolution = exactBindingForIdentifier(syntax, parents, declaration.id)
  const references = []
  walkSyntax(syntax, (node) => {
    if (node.type !== 'Identifier' || node.name !== declaration.id.name
      || !isIdentifierReference(node, resolution.bindingNodes, parents)) return
    if (resolvedBinding(node, resolution.bindingsByScope, parents) === resolution.binding) {
      references.push(node)
    }
  })
  if (weakening === 'name-only-factory-matching') {
    walkSyntax(syntax, (node) => {
      if (node.type !== 'Identifier' || node.name !== 'captureTrustedGraph'
        || !isIdentifierReference(node, resolution.bindingNodes, parents)) return
      assert.equal(
        resolvedBinding(node, resolution.bindingsByScope, parents),
        resolution.binding,
        `${repositoryPath}:name-only authority-factory false positive`,
      )
    })
    return
  }
  const observed = []
  inspectOrderedOccurrence(
    repositoryPath,
    'function $factory(globalSlots)',
    APPROVED_AUTHORITY_FACTORY_REFERENCE_SEQUENCE,
    observed,
    'authority factory reference',
  )
  for (const identifier of references) {
    const call = parents.get(identifier)
    const declarator = call?.type === 'CallExpression' && call.callee === identifier
      ? parents.get(call)
      : null
    const declarationOwner = declarator?.type === 'VariableDeclarator'
      ? parents.get(declarator)
      : null
    const approvedCall = call?.type === 'CallExpression'
      && call.callee === identifier
      && call.arguments.length === 1
      && call.arguments[0]?.type === 'Identifier'
      && call.arguments[0].name === 'TRUSTED_GLOBAL_SLOTS'
      && declarator?.type === 'VariableDeclarator'
      && declarator.init === call
      && declarator.id?.type === 'Identifier'
      && declarator.id.name === 'TRUSTED_GRAPH'
      && declarationOwner?.type === 'VariableDeclaration'
      && declarationOwner.kind === 'const'
      && declarationOwner.declarations.length === 1
      && parents.get(declarationOwner) === syntax
      && declaration.start < call.start
    if (approvedCall) {
      inspectOrderedOccurrence(
        repositoryPath,
        '$factory(TRUSTED_GLOBAL_SLOTS)',
        APPROVED_AUTHORITY_FACTORY_REFERENCE_SEQUENCE,
        observed,
        'authority factory reference',
      )
      continue
    }
    const exactDirectCall = call?.type === 'CallExpression'
      && call.callee === identifier
      && call.arguments.length === 1
      && call.arguments[0]?.type === 'Identifier'
      && call.arguments[0].name === 'TRUSTED_GLOBAL_SLOTS'
    const permitsSecondCall = exactDirectCall && [
      'omit-factory-call-count-enforcement',
      'omit-factory-direct-second-call-rejection',
      'permit-second-exact-factory-invocation',
    ].includes(weakening)
    if (weakening === 'omit-factory-all-references'
      || permitsSecondCall
      || weakening === authorityFactoryEscapeWeakening(identifier, parents)) continue
    assert.fail(`${repositoryPath}:unapproved authority factory reference`)
  }
  assertOrderedOccurrenceInventory(
    repositoryPath,
    APPROVED_AUTHORITY_FACTORY_REFERENCE_SEQUENCE,
    observed,
    'authority factory references',
  )
}

function inspectTrustedGraphAuthority(syntax, source, repositoryPath, parents, weakening) {
  if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return
  const declarators = []
  walkSyntax(syntax, (node) => {
    if (node.type === 'VariableDeclarator') declarators.push(node)
  })
  const exactDeclarator = (initializer, functionName) =>
    declarators.filter((declarator) => {
      const declaration = parents.get(declarator)
      if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const'
        || declaration.declarations.length !== 1 || declarator.id.type !== 'Identifier'
        || source.slice(declarator.init?.start, declarator.init?.end) !== initializer) return false
      const owner = enclosingFunction(declaration, parents)
      if (functionName === null ? owner !== null : owner?.id?.name !== functionName) return false
      return true
    })
  const [target] = exactDeclarator('queue[cursor]', 'captureTrustedGraph')
  const recordsCandidates = exactDeclarator('[]', 'captureTrustedGraph')
    .filter((declarator) => declarator.id.name === 'records')
  const [records] = recordsCandidates
  const [graph] = exactDeclarator(
    'captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)',
    null,
  )
  const trustedCandidates = exactDeclarator(
    'TRUSTED_GRAPH[recordIndex]',
    'assertReleaseInspectionIntrinsicIntegrity',
  )
  assert.equal(exactDeclarator('queue[cursor]', 'captureTrustedGraph').length, 1)
  assert.equal(recordsCandidates.length, 1)
  assert.equal(exactDeclarator(
    'captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)', null,
  ).length, 1)
  assert.equal(trustedCandidates.length, 1)
  const [trusted] = trustedCandidates
  const trustedDeclaration = parents.get(trusted)
  const trustedBlock = parents.get(trustedDeclaration)
  const trustedLoop = parents.get(trustedBlock)
  assert.equal(trustedBlock?.type, 'BlockStatement')
  assert.equal(trustedBlock.body[0], trustedDeclaration)
  assert.equal(trustedLoop?.type, 'ForStatement')
  assert.equal(
    source.slice(trustedLoop.test.start, trustedLoop.test.end),
    'recordIndex < TRUSTED_GRAPH.length',
  )
  for (const contract of [
    [target, APPROVED_SENSITIVE_TARGET_REFERENCE_SEQUENCE, 'sensitive target', 'target'],
    [records, APPROVED_SENSITIVE_RECORDS_REFERENCE_SEQUENCE, 'trusted records', 'records'],
    [graph, APPROVED_TRUSTED_GRAPH_REFERENCE_SEQUENCE, 'TRUSTED_GRAPH', 'trusted-graph'],
    [trusted, APPROVED_TRUSTED_RECORD_REFERENCE_SEQUENCE, 'trusted record', 'trusted-record'],
  ]) {
    inspectOrderedSensitiveBinding({
      syntax,
      source,
      repositoryPath,
      parents,
      declarator: contract[0],
      approvals: contract[1],
      label: contract[2],
      kind: contract[3],
      weakening,
    })
  }
}

function calledNames(callee) {
  const names = []
  walkSyntax(callee, (node) => {
    if (node.type === 'Identifier') names.push(node.name)
    if (node.type === 'MemberExpression') {
      if (!node.computed && node.property.type === 'Identifier') names.push(node.property.name)
      if (node.computed && node.property.type === 'Literal'
        && typeof node.property.value === 'string') names.push(node.property.value)
    }
  })
  return names
}

function staticStringValues(node, bindings, seen = new Set(), weakening = '') {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return new Set([node.value])
  if (node.type === 'Literal' && typeof node.value === 'number'
    && Number.isFinite(node.value)) return new Set([String(node.value)])
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return new Set([node.quasis[0].value.cooked ?? node.quasis[0].value.raw])
  }
  if (weakening === 'omit-constant-folding') return null
  if (node.type === 'ParenthesizedExpression') {
    return staticStringValues(node.expression, bindings, seen, weakening)
  }
  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return null
    const values = bindings.get(node.name)
    return values ? new Set(values) : null
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticStringValues(node.left, bindings, seen, weakening)
    const right = staticStringValues(node.right, bindings, seen, weakening)
    if (!left || !right) return null
    const combined = new Set()
    for (const leftValue of left) {
      for (const rightValue of right) combined.add(leftValue + rightValue)
    }
    return combined
  }
  if (node.type === 'ConditionalExpression') {
    const consequent = staticStringValues(node.consequent, bindings, seen, weakening)
    const alternate = staticStringValues(node.alternate, bindings, seen, weakening)
    if (!consequent || !alternate) return null
    return new Set([...consequent, ...alternate])
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    && !node.callee.computed && node.callee.property.type === 'Identifier'
    && node.callee.property.name === 'join' && weakening !== 'omit-array-join'
    && node.callee.object.type === 'ArrayExpression' && node.arguments.length <= 1) {
    const separator = node.arguments.length === 0
      ? new Set([','])
      : staticStringValues(node.arguments[0], bindings, seen, weakening)
    if (!separator || separator.size !== 1) return null
    const parts = []
    for (const element of node.callee.object.elements) {
      const values = staticStringValues(element, bindings, seen, weakening)
      if (!values || values.size !== 1) return null
      parts.push([...values][0])
    }
    return new Set([parts.join([...separator][0])])
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    && !node.callee.computed && node.callee.object.type === 'Identifier'
    && node.callee.object.name === 'String'
    && node.callee.property.type === 'Identifier'
    && node.callee.property.name === 'fromCharCode'
    && weakening !== 'omit-from-char-code') {
    const codeUnits = []
    for (const argument of node.arguments) {
      if (argument.type !== 'Literal' || !Number.isInteger(argument.value)
        || argument.value < 0 || argument.value > 65_535) return null
      codeUnits.push(argument.value)
    }
    return new Set([String.fromCharCode(...codeUnits)])
  }
  return null
}

function collectStaticStringBindings(syntax, weakening = '') {
  const bindings = new Map()
  const declarations = []
  walkSyntax(syntax, (node) => {
    if (node.type !== 'VariableDeclaration' || node.kind !== 'const') return
    for (const declaration of node.declarations) {
      if (declaration.id.type === 'Identifier' && declaration.init) declarations.push(declaration)
    }
  })
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false
    for (const declaration of declarations) {
      if (bindings.has(declaration.id.name)) continue
      const values = staticStringValues(declaration.init, bindings, new Set(), weakening)
      if (!values) continue
      bindings.set(declaration.id.name, values)
      changed = true
    }
    if (!changed) break
  }
  return bindings
}

function inspectClosedModuleSource(repositoryPath, source) {
  const expectedSpecifiers = CLOSED_COMPARISON_SOURCE_GRAPH.get(repositoryPath)
  assert.ok(expectedSpecifiers, `unapproved graph module:${repositoryPath}`)
  const syntax = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const actualSpecifiers = new Set()
  const identifierCounts = new Map()
  const parents = new WeakMap()
  walkSyntax(syntax, (node, parent) => parents.set(node, parent))
  const weakening = process.env.PREVIEW_SOURCE_GRAPH_TEST_WEAKENING ?? ''
  inspectSensitiveQueueBinding(syntax, source, repositoryPath, parents, weakening)
  inspectCaptureTrustedGraphFactory(syntax, repositoryPath, parents, weakening)
  inspectTrustedGraphAuthority(syntax, source, repositoryPath, parents, weakening)
  const staticStrings = collectStaticStringBindings(syntax, weakening)
  const observedComputedApprovals = new Map()
  const observedReflectiveApprovals = new Map()
  const observedReflectiveMemberApprovals = new Map()
  const observedDirectAuthorityApprovals = new Map()
  const observedCapturedReflectiveDeclarations = new Map()
  const observedCapturedReflectiveCalls = new Map()
  const observedCapturedReflectiveContainerReferences = new Map()
  const observedVmCalls = new Map()
  const prohibitedCalls = new Set([
    'require', 'createRequire', 'eval', 'Function', 'AsyncFunction', 'GeneratorFunction',
    'AsyncGeneratorFunction', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
    'getBuiltinModule', '_load', 'dlopen', 'compileFunction', 'runInContext',
    'runInThisContext', 'Script', 'exec', 'execFile', 'fork', 'spawn', 'setTimeout',
    'setInterval', 'queueMicrotask',
  ])
  const prohibitedGlobals = new Set(['process', 'module', 'Deno', 'Bun', 'navigator'])
  if (weakening === 'omit-process') prohibitedGlobals.delete('process')
  const prohibitedReferences = new Set([
    ...prohibitedCalls,
    'global',
    'self',
    'window',
  ])
  if (weakening === 'omit-global') prohibitedReferences.delete('global')
  prohibitedReferences.delete('Function')
  const approvedIntegrityFunctionReference = (node) => {
    if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return false
    const member = parents.get(node)
    const comparison = parents.get(member)
    return member?.type === 'MemberExpression'
      && member.object === node
      && member.computed === false
      && member.property?.type === 'Identifier'
      && member.property.name === 'prototype'
      && comparison?.type === 'BinaryExpression'
      && comparison.operator === '!=='
      && comparison.right === member
      && comparison.left?.type === 'CallExpression'
      && comparison.left.callee?.type === 'Identifier'
      && comparison.left.callee.name === 'reflectGetPrototypeOf'
      && comparison.left.arguments.length === 1
      && comparison.left.arguments[0]?.type === 'Identifier'
      && comparison.left.arguments[0].name === 'currentConstructor'
  }
  const approvedIntegrityGlobalThisReference = (node) => {
    if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return false
    const declarator = parents.get(node)
    return declarator?.type === 'VariableDeclarator'
      && declarator.init === node
      && declarator.id?.type === 'Identifier'
      && declarator.id.name === 'trustedGlobalThis'
  }
  const approvedIntegrityConstructorMember = (node) => {
    if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return false
    const comparison = parents.get(node)
    return node.object?.type === 'Identifier'
      && node.object.name === 'currentPrototype'
      && comparison?.type === 'BinaryExpression'
      && comparison.operator === '!=='
      && comparison.left === node
      && comparison.right?.type === 'Identifier'
      && comparison.right.name === 'currentConstructor'
  }
  const approvedIntegrityVmReference = (node) => {
    if (repositoryPath !== 'scripts/lib/release-inspection/intrinsic-integrity.mjs') return false
    const parent = parents.get(node)
    if (parent?.type === 'ImportSpecifier') {
      return parent.imported?.type === 'Identifier'
        && parent.imported.name === 'runInNewContext'
        && parent.local?.type === 'Identifier'
        && parent.local.name === 'runInNewContext'
    }
    if (parent?.type !== 'CallExpression' || parent.callee !== node
      || parent.arguments.length !== 1) return false
    const [argument] = parent.arguments
    return argument.type === 'TemplateLiteral'
      && argument.expressions.length === 0
      && argument.quasis[0].value.raw === APPROVED_VM_ARGUMENT_SOURCE
  }
  walkSyntax(syntax, (node) => {
    if (node.type === 'Identifier') {
      identifierCounts.set(node.name, (identifierCounts.get(node.name) ?? 0) + 1)
      if (prohibitedReferences.has(node.name)) {
        assert.fail(`${repositoryPath}:prohibited reference:${node.name}`)
      }
      if (node.name === 'Function' && !approvedIntegrityFunctionReference(node)) {
        assert.fail(`${repositoryPath}:prohibited reference:Function`)
      }
      if (node.name === 'globalThis' && !approvedIntegrityGlobalThisReference(node)) {
        assert.fail(`${repositoryPath}:prohibited reference:globalThis`)
      }
      if (node.name === 'runInNewContext' && !approvedIntegrityVmReference(node)) {
        assert.fail(`${repositoryPath}:prohibited VM reference:runInNewContext`)
      }
      if (['Object', 'Reflect'].includes(node.name)
        && weakening !== 'omit-sensitive-root-references') {
        const parent = parents.get(node)
        if (parent?.type !== 'MemberExpression' || parent.object !== node) {
          assert.fail(`${repositoryPath}:unapproved sensitive root reference:${node.name}`)
        }
      }
      if (CAPTURED_REFLECTIVE_METHODS.has(node.name)
        && weakening !== 'omit-captured-authority') {
        const parent = parents.get(node)
        const declarationSource = parent?.type === 'VariableDeclarator'
          && parent.id === node
          ? source.slice(parent.start, parent.end)
          : null
        const callSource = parent?.type === 'CallExpression' && parent.callee === node
          ? source.slice(parent.start, parent.end)
          : null
        const approvedContainerIndex = APPROVED_CAPTURED_REFLECTIVE_CONTAINER_INDEX
          .get(node.name)
        const approvedContainer = repositoryPath
            === 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
          && parent?.type === 'ArrayExpression'
          && source.slice(parent.start, parent.end)
            === APPROVED_CAPTURED_REFLECTIVE_CONTAINER_SOURCE
          && parent.elements[approvedContainerIndex] === node
        const approvedDeclaration = declarationSource !== null && reviewedOccurrence(
          repositoryPath,
          declarationSource,
          APPROVED_CAPTURED_REFLECTIVE_DECLARATIONS,
          new Map(),
          observedCapturedReflectiveDeclarations,
        )
        const approvedCall = callSource !== null
          && (APPROVED_CAPTURED_REFLECTIVE_CALLS.get(repositoryPath)?.has(callSource) ?? false)
        if (approvedContainer) {
          const count = (observedCapturedReflectiveContainerReferences.get(node.name) ?? 0) + 1
          observedCapturedReflectiveContainerReferences.set(node.name, count)
          assert.equal(count, 1, `${repositoryPath}:single captured container reference:${node.name}`)
        }
        if (!approvedDeclaration && !approvedCall && !approvedContainer) {
          assert.fail(`${repositoryPath}:unapproved captured reflective authority:${node.name}`)
        }
      }
    }
    if (node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration') {
      if (node.source) actualSpecifiers.add(node.source.value)
      if (node.type === 'ImportDeclaration' && node.source.value === 'node:vm') {
        assert.equal(repositoryPath,
          'scripts/lib/release-inspection/intrinsic-integrity.mjs')
        assert.equal(node.specifiers.length, 1, `${repositoryPath}:exact VM import`)
        assert.equal(node.specifiers[0].type, 'ImportSpecifier', `${repositoryPath}:named VM import`)
        assert.equal(node.specifiers[0].imported.name, 'runInNewContext', `${repositoryPath}:VM import`)
        assert.equal(node.specifiers[0].local.name, 'runInNewContext', `${repositoryPath}:VM alias`)
      }
    }
    assert.notEqual(node.type, 'ImportExpression', `${repositoryPath}:dynamic import`)
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const names = calledNames(node.callee)
      for (const name of names) {
        assert.equal(prohibitedCalls.has(name), false, `${repositoryPath}:indirect call:${name}`)
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier'
        && CAPTURED_REFLECTIVE_METHODS.has(node.callee.name)
        && weakening !== 'omit-captured-authority') {
        const callSource = source.slice(node.start, node.end)
        assert.equal(
          reviewedOccurrence(
            repositoryPath,
            callSource,
            APPROVED_CAPTURED_REFLECTIVE_CALLS,
            new Map(),
            observedCapturedReflectiveCalls,
          ),
          true,
          `${repositoryPath}:unapproved captured reflective call:${callSource}`,
        )
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier'
        && node.callee.name === 'runInNewContext') {
        const callSource = source.slice(node.start, node.end)
        assert.equal(
          reviewedOccurrence(
            repositoryPath,
            callSource,
            APPROVED_VM_CALLS,
            new Map(),
            observedVmCalls,
          ),
          true,
          `${repositoryPath}:unapproved VM call:${callSource}`,
        )
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && !node.callee.computed && node.callee.object.type === 'Identifier'
        && ['Object', 'Reflect'].includes(node.callee.object.name)
        && node.callee.property.type === 'Identifier'
        && ['get', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors',
          'getPrototypeOf', 'construct', 'apply', 'assign', 'create',
          'defineProperties', 'defineProperty', 'fromEntries', 'has', 'isExtensible',
          'ownKeys', 'preventExtensions', 'setPrototypeOf']
          .includes(node.callee.property.name)
        && weakening !== 'omit-reflective-protection') {
        const callSource = source.slice(node.start, node.end)
        assert.equal(
          reviewedOccurrence(
            repositoryPath,
            callSource,
            APPROVED_REFLECTIVE_CALLS,
            APPROVED_REFLECTIVE_CALL_COUNTS,
            observedReflectiveApprovals,
          ),
          true,
          `${repositoryPath}:unapproved reflective call:${callSource}`,
        )
      }
    }
    if (node.type === 'Identifier' && prohibitedGlobals.has(node.name)) {
      assert.fail(`${repositoryPath}:prohibited global:${node.name}`)
    }
    if (node.type === 'Property' && parents.get(node)?.type === 'ObjectPattern') {
      const properties = node.computed
        ? staticStringValues(node.key, staticStrings, new Set(), weakening)
        : node.key.type === 'Identifier'
          ? new Set([node.key.name])
          : node.key.type === 'Literal' && typeof node.key.value === 'string'
            ? new Set([node.key.value])
            : null
      if (properties === null && weakening !== 'omit-unresolved-computed') {
        assert.fail(`${repositoryPath}:unresolved computed destructuring key`)
      }
      const pattern = parents.get(node)
      const patternOwner = parents.get(pattern)
      const destructuredSource = patternOwner?.type === 'VariableDeclarator'
        && patternOwner.id === pattern
        ? patternOwner.init
        : patternOwner?.type === 'AssignmentExpression' && patternOwner.left === pattern
          ? patternOwner.right
          : null
      for (const property of properties ?? []) {
        if (destructuredSource?.type === 'Identifier'
          && REFLECTIVE_METHODS_BY_OBJECT.get(destructuredSource.name)?.has(property)
          && weakening !== 'omit-reflective-protection') {
          assert.fail(
            `${repositoryPath}:prohibited reflective destructuring:${destructuredSource.name}.${property}`,
          )
        }
        if (['constructor', 'prototype', '__proto__'].includes(property)
          && weakening !== 'omit-direct-constructor') {
          assert.fail(`${repositoryPath}:prohibited destructuring member:${property}`)
        }
        if (['eval', 'Function', 'process', 'require', 'createRequire', 'module',
          'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction', 'binding',
          'runInContext', 'runInNewContext', 'runInThisContext', 'compileFunction',
          'getBuiltinModule', 'mainModule', 'dlopen', 'importScripts'].includes(property)) {
          assert.fail(`${repositoryPath}:prohibited destructuring member:${property}`)
        }
      }
    }
    if (node.type === 'MemberExpression') {
      const properties = !node.computed && node.property.type === 'Identifier'
        ? new Set([node.property.name])
        : weakening === 'omit-constant-folding'
          ? (node.property.type === 'Literal' && typeof node.property.value === 'string'
              ? new Set([node.property.value])
              : null)
          : staticStringValues(node.property, staticStrings, new Set(), weakening)
      const sensitiveRoot = node.object.type === 'Identifier'
        && ['globalThis', 'global', 'window', 'self', 'trustedGlobalThis'].includes(node.object.name)
      if (node.computed && properties === null) {
        const memberSource = source.slice(node.start, node.end)
        const approved = reviewedOccurrence(
          repositoryPath,
          memberSource,
          APPROVED_UNRESOLVED_COMPUTED_MEMBERS,
          APPROVED_UNRESOLVED_COMPUTED_MEMBER_COUNTS,
          observedComputedApprovals,
        )
        if (!approved && weakening !== 'omit-unresolved-computed') {
          assert.fail(`${repositoryPath}:unresolved computed member:${memberSource}`)
        }
        if (sensitiveRoot && !approved) {
          assert.fail(`${repositoryPath}:unresolved computed access on sensitive global root`)
        }
      }
      for (const property of properties ?? []) {
        const memberSource = source.slice(node.start, node.end)
        const reflectiveMethods = node.object.type === 'Identifier'
          ? REFLECTIVE_METHODS_BY_OBJECT.get(node.object.name)
          : null
        if (node.object.type === 'Identifier' && node.object.name === 'Reflect'
          && !reflectiveMethods?.has(property)
          && weakening !== 'omit-reflective-protection') {
          assert.fail(`${repositoryPath}:unapproved Reflect member:${memberSource}`)
        }
        if (reflectiveMethods?.has(property)
          && weakening !== 'omit-reflective-protection') {
          const parent = parents.get(node)
          const approvedDirectCall = parent?.type === 'CallExpression'
            && parent.callee === node
            && (APPROVED_REFLECTIVE_CALLS.get(repositoryPath)
              ?.has(source.slice(parent.start, parent.end)) ?? false)
          const approvedMember = approvedDirectCall || reviewedOccurrence(
            repositoryPath,
            memberSource,
            APPROVED_REFLECTIVE_MEMBERS,
            new Map(),
            observedReflectiveMemberApprovals,
          )
          if (!approvedMember) {
            assert.fail(`${repositoryPath}:unapproved reflective member:${memberSource}`)
          }
        }
        if (['constructor', 'prototype', '__proto__'].includes(property)) {
          const approved = property === 'constructor'
            ? approvedIntegrityConstructorMember(node)
            : reviewedOccurrence(
                repositoryPath,
                memberSource,
                APPROVED_DIRECT_AUTHORITY_MEMBERS,
                new Map(),
                observedDirectAuthorityApprovals,
              )
          if (!approved && weakening !== 'omit-direct-constructor') {
            assert.fail(`${repositoryPath}:prohibited member:${property}`)
          }
        }
        if (['eval', 'Function', 'AsyncFunction', 'GeneratorFunction',
          'AsyncGeneratorFunction', 'process', 'require', 'createRequire', 'module',
          'binding', 'runInContext', 'runInNewContext', 'runInThisContext',
          'compileFunction', 'Script', 'fetch', 'XMLHttpRequest', 'WebSocket',
          'importScripts', 'getBuiltinModule', 'mainModule', '_load',
          'dlopen', 'exec', 'execFile', 'fork', 'spawn', 'runInContext',
          '__lookupGetter__', '__lookupSetter__', '__defineGetter__',
          '__defineSetter__'].includes(property)) {
          assert.fail(`${repositoryPath}:prohibited member:${property}`)
        }
      }
    }
  })
  assertReviewedOccurrenceInventory(
    repositoryPath,
    APPROVED_UNRESOLVED_COMPUTED_MEMBERS,
    APPROVED_UNRESOLVED_COMPUTED_MEMBER_COUNTS,
    observedComputedApprovals,
    'computed members',
  )
  if (weakening !== 'omit-reflective-protection') {
    assertReviewedOccurrenceInventory(
      repositoryPath,
      APPROVED_REFLECTIVE_CALLS,
      APPROVED_REFLECTIVE_CALL_COUNTS,
      observedReflectiveApprovals,
      'reflective calls',
    )
    assertReviewedOccurrenceInventory(
      repositoryPath,
      APPROVED_REFLECTIVE_MEMBERS,
      new Map(),
      observedReflectiveMemberApprovals,
      'reflective members',
    )
  }
  if (weakening !== 'omit-captured-authority') {
    assertReviewedOccurrenceInventory(
      repositoryPath,
      APPROVED_CAPTURED_REFLECTIVE_DECLARATIONS,
      new Map(),
      observedCapturedReflectiveDeclarations,
      'captured reflective declarations',
    )
    assertReviewedOccurrenceInventory(
      repositoryPath,
      APPROVED_CAPTURED_REFLECTIVE_CALLS,
      new Map(),
      observedCapturedReflectiveCalls,
      'captured reflective calls',
    )
    const expectedContainerReferences = repositoryPath
        === 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
      ? [...CAPTURED_REFLECTIVE_METHODS].sort().map((name) => [name, 1])
      : []
    assert.deepEqual(
      [...observedCapturedReflectiveContainerReferences]
        .sort(([left], [right]) => left.localeCompare(right)),
      expectedContainerReferences,
      `${repositoryPath}:captured reflective container inventory`,
    )
  }
  assertReviewedOccurrenceInventory(
    repositoryPath,
    APPROVED_VM_CALLS,
    new Map(),
    observedVmCalls,
    'VM calls',
  )
  assertReviewedOccurrenceInventory(
    repositoryPath,
    APPROVED_DIRECT_AUTHORITY_MEMBERS,
    new Map(),
    observedDirectAuthorityApprovals,
    'direct authority members',
  )
  assert.deepEqual(
    [...actualSpecifiers].sort(),
    [...expectedSpecifiers].sort(),
    `${repositoryPath}:closed dependency manifest`,
  )
  if (repositoryPath === 'scripts/lib/release-inspection/intrinsic-integrity.mjs') {
    assert.equal(identifierCounts.get('globalThis'), 1, `${repositoryPath}:globalThis closure`)
    assert.equal(
      identifierCounts.get('trustedGlobalThis'),
      4,
      `${repositoryPath}:trusted global uses`,
    )
    const vmCalls = []
    walkSyntax(syntax, (node) => {
      if (node.type === 'CallExpression' && calledNames(node.callee).includes('runInNewContext')) {
        vmCalls.push(node)
      }
    })
    if (weakening !== 'omit-vm-occurrence') {
      assert.equal(vmCalls.length, 1, `${repositoryPath}:single approved VM call`)
    }
    const [argument] = vmCalls[0].arguments
    assert.equal(argument.type, 'TemplateLiteral', `${repositoryPath}:fixed VM source`)
    assert.equal(argument.expressions.length, 0, `${repositoryPath}:non-computed VM source`)
    assert.equal(
      argument.quasis[0].value.raw,
      APPROVED_VM_ARGUMENT_SOURCE,
      `${repositoryPath}:approved VM source`,
    )
  }
  return [...actualSpecifiers]
}

function closedModuleGraph(entries) {
  const visited = new Map()
  const pending = [...entries]
  while (pending.length > 0) {
    const repositoryPath = pending.pop()
    if (visited.has(repositoryPath)) continue
    const absolutePath = path.join(ROOT, repositoryPath)
    const source = readFileSync(absolutePath, 'utf8')
      + (repositoryPath === 'scripts/lib/release-inspection/preview-stability-projection.mjs'
        ? (process.env.PREVIEW_STABLE_COMPARISON_SOURCE_MUTATION ?? '')
        : '')
    visited.set(repositoryPath, source)
    for (const specifier of inspectClosedModuleSource(repositoryPath, source)) {
      if (!specifier.startsWith('.')) continue
      const resolved = path.relative(
        ROOT,
        path.resolve(path.dirname(absolutePath), specifier),
      )
      pending.push(resolved)
    }
  }
  assert.deepEqual([...visited.keys()].sort(), [...CLOSED_COMPARISON_SOURCE_GRAPH.keys()].sort())
  return visited
}

function exportNames(source) {
  return [...source.matchAll(/export\s+(?:const|function|type|interface)\s+([A-Za-z0-9_]+)/gu)]
    .map((match) => match[1]).sort()
}

test('comparison source graph is pure and runtime declarations have exact export parity', () => {
  const entries = ['preview-stability-projection', 'preview-stable-comparison']
  const graph = closedModuleGraph(entries.map(
    (entry) => `scripts/lib/release-inspection/${entry}.mjs`,
  ))
  const graphSource = [...graph.values()].join('\n')
  for (const forbidden of [
    'node:fs', 'node:child_process', 'node:http', 'node:https', 'node:net', 'node:tls',
    'remote-transport', 'preview-http-transport', 'preview-resource-observer',
    'wrangler deploy', 'release-execution', 'preview-plan', 'reporting.mjs',
    'artifacts.mjs', 'rollback', 'writeFile', 'appendFile',
  ]) assert.equal(graphSource.includes(forbidden), false, forbidden)
  for (const entry of entries) {
    const runtimePath = path.join(ROOT, `scripts/lib/release-inspection/${entry}.mjs`)
    const declarationPath = path.join(ROOT, `scripts/lib/release-inspection/${entry}.d.mts`)
    const runtimeExports = exportNames(readFileSync(runtimePath, 'utf8'))
    const declarationExports = exportNames(readFileSync(declarationPath, 'utf8'))
      .filter((name) => !name.startsWith('Preview'))
    assert.deepEqual(runtimeExports, declarationExports, entry)
  }
})

test('static property resolver folds reviewed constructor-name expressions', () => {
  const weakening = process.env.PREVIEW_SOURCE_GRAPH_TEST_WEAKENING ?? ''
  const syntax = parse(`
    const joined = ['con', 'structor'].join('')
    const encoded = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)
    const first = 'con'
    const chained = first + 'structor'
    const conditional = unknownCondition ? 'constructor' : 'constructor'
  `, { ecmaVersion: 'latest', sourceType: 'module' })
  const bindings = collectStaticStringBindings(syntax, weakening)
  for (const name of ['joined', 'encoded', 'chained', 'conditional']) {
    assert.deepEqual([...(bindings.get(name) ?? [])], ['constructor'], name)
  }
})

const ALIAS_AUTHORITY_MUTATIONS = [
  "\nconst R = Reflect\nvoid R.get(() => {}, 'constructor')('return 0')()\n",
  "\nconst R1 = Reflect\nconst R2 = R1\nvoid R2.get(() => {}, 'constructor')('return 0')()\n",
  "\nconst { get } = Reflect\nvoid get(() => {}, 'constructor')('return 0')()\n",
  "\nconst R = Reflect\nconst { get } = R\nvoid get(() => {}, 'constructor')('return 0')()\n",
  "\nconst R = Reflect\nvoid R['g' + 'et'](() => {}, 'constructor')('return 0')()\n",
  "\nconst get = Reflect.get.bind(Reflect)\nvoid get(() => {}, 'constructor')('return 0')()\n",
  "\nconst methods = { get: Reflect.get }\nvoid methods.get(() => {}, 'constructor')('return 0')()\n",
  "\nconst O = Object\nvoid O.getOwnPropertyDescriptor(() => {}, 'constructor').value('return 0')()\n",
  "\nconst { getOwnPropertyDescriptor } = Object\nvoid getOwnPropertyDescriptor(() => {}, 'constructor').value('return 0')()\n",
  "\nconst O = Object\nvoid O['getOwnProperty' + 'Descriptor'](() => {}, 'constructor').value('return 0')()\n",
  "\nvoid reflectGetOwnPropertyDescriptor(() => {}, 'constructor').value('return 0')()\n",
  `
const R = Reflect
const HiddenFunction = R.get(() => {}, 'constructor')
const hiddenGlobal = HiddenFunction('return globalThis')()
const hiddenProcess = R.get(hiddenGlobal, 'process')
const getModule = R.get(hiddenProcess, 'getBuiltinModule')
const moduleBuiltin = R.apply(getModule, hiddenProcess, ['module'])
const makeRequire = R.get(moduleBuiltin, 'createRequire')
const hiddenRequire = R.apply(makeRequire, moduleBuiltin, [import.meta.url])
void R.apply(hiddenRequire, undefined, ['fs'])
`,
  "\nfunction getReflect() { return Reflect }\nconst R = getReflect()\nvoid R.get(() => {}, 'constructor')('return 0')()\n",
  "\nlet R\nR = Reflect\nvoid R.get(() => {}, 'constructor')('return 0')()\n",
  "\nconst methods = [Reflect.get]\nvoid methods[0](() => {}, 'constructor')('return 0')()\n",
  "\nconst marker = 0, R = Reflect\nvoid marker\nvoid R.get(() => {}, 'constructor')('return 0')()\n",
  "\nconst R = unknownCondition ? Reflect : Reflect\nvoid R.get(() => {}, 'constructor')('return 0')()\n",
  "\nconst R = (0, Reflect)\nvoid R.get(() => {}, 'constructor')('return 0')()\n",
  "\nfunction useReflect(R) { return R.get(() => {}, 'constructor') }\nvoid useReflect(Reflect)('return 0')()\n",
  "\nconst holder = { authority: Reflect }\nvoid holder.authority.get(() => {}, 'constructor')('return 0')()\n",
  "\nvoid Reflect.get.call(Reflect, () => {}, 'constructor')('return 0')()\n",
  "\nvoid Reflect.get.apply(Reflect, [() => {}, 'constructor'])('return 0')()\n",
  "\nvoid Reflect.apply(Reflect.get, Reflect, [() => {}, 'constructor'])('return 0')()\n",
  "\nvoid new (Reflect.get(() => {}, 'constructor'))('return 0')\n",
  `
const R = Reflect
const processKey = ['pro', 'cess'].join('')
const moduleKey = String.fromCharCode(103, 101, 116, 66, 117, 105, 108, 116, 105, 110, 77, 111, 100, 117, 108, 101)
const requireKey = 'create' + 'Require'
const fsKey = String.fromCharCode(102, 115)
const HiddenFunction = R.get(() => {}, 'con' + 'structor')
const hiddenGlobal = HiddenFunction('return globalThis')()
const hiddenProcess = R.get(hiddenGlobal, processKey)
const getModule = R.get(hiddenProcess, moduleKey)
const moduleBuiltin = R.apply(getModule, hiddenProcess, ['module'])
const makeRequire = R.get(moduleBuiltin, requireKey)
const hiddenRequire = R.apply(makeRequire, moduleBuiltin, [import.meta.url])
void R.apply(hiddenRequire, undefined, [fsKey])
`,
  "\nconst hiddenApply = reflectApply\nvoid hiddenApply((() => {})['constructor'], undefined, ['return 0'])()\n",
  "\nvoid reflectGetPrototypeOf.call(undefined, async function () {}).constructor('return 0')()\n",
  "\nconst ownKeys = Reflect.ownKeys\nvoid ownKeys({})\n",
  "\nvoid Reflect.preventExtensions({})\n",
  "\nvoid Reflect.unreviewedMethod({})\n",
  "\nvoid Object.fromEntries([['authority', Reflect.get]])\n",
]

test('source-graph inspection rejects static, dynamic, computed, and indirect loading mutations', () => {
  const repositoryPath = 'scripts/lib/release-inspection/preview-stability-projection.mjs'
  const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
  const mutations = [
    "\nimport fs from 'node:fs'\n",
    "\nimport { readFile as hiddenRead } from 'node:fs'\nvoid hiddenRead\n",
    "\nimport { spawn as hiddenSpawn } from 'node:child_process'\nvoid hiddenSpawn\n",
    "\nvoid import('node:fs')\n",
    "\nvoid import('./' + 'hidden.mjs')\n",
    "\nvoid require('node:fs')\n",
    "\nvoid createRequire(import.meta.url)('node:fs')\n",
    "\nvoid (0, eval)('globalThis')\n",
    "\nconst hiddenEvaluator = eval\nhiddenEvaluator('0')\n",
    "\nconst hiddenEvaluator = eval\nhiddenEvaluator.call(undefined, '0')\n",
    "\nconst hiddenEvaluator = eval\nhiddenEvaluator.apply(undefined, ['0'])\n",
    "\nconst first = eval\nconst second = first\nsecond('0')\n",
    "\nconst { eval: hiddenEvaluator } = globalThis\nhiddenEvaluator('0')\n",
    "\nvoid globalThis.eval('0')\n",
    "\nvoid globalThis[\"eval\"]('0')\n",
    "\nvoid window.eval('0')\n",
    "\nvoid Reflect.apply(eval, undefined, ['0'])\n",
    "\nvoid new Function('return globalThis')\n",
    "\nvoid new globalThis.Function('return 0')\n",
    "\nvoid new globalThis[\"Function\"]('return 0')\n",
    "\nvoid new window.Function('return 0')\n",
    "\nconst { Function: HiddenFunction } = globalThis\nvoid new HiddenFunction('return 0')\n",
    "\nconst HiddenFunction = Function\nvoid new HiddenFunction('return 0')\n",
    "\nconst HiddenFunction = (() => {}).constructor\nvoid new HiddenFunction('return 0')\n",
    "\nconst hiddenRequire = require\nhiddenRequire('node:fs')\n",
    "\nconst hiddenCreateRequire = createRequire\nhiddenCreateRequire(import.meta.url)('node:fs')\n",
    "\nconst hiddenVmEvaluator = runInNewContext\nhiddenVmEvaluator('0')\n",
    "\nvoid new AsyncFunction('return 0')\n",
    "\nvoid new GeneratorFunction('return 0')\n",
    "\nvoid new AsyncGeneratorFunction('return 0')\n",
    "\nvoid compileFunction('return 0')\n",
    "\nvoid runInContext('0')\n",
    "\nvoid process.getBuiltinModule('node:fs')\n",
    "\nvoid globalThis['fetch']('https://example.com')\n",
    "\nvoid global[\"e\" + \"val\"]('0')\n",
    "\nvoid global[\"Fun\" + \"ction\"]('return 0')\n",
    "\nvoid Reflect.get(global, 'eval')('0')\n",
    "\nconst key = 'e' + 'val'\nvoid global[key]('0')\n",
    "\nconst firstKey = 'e'\nconst secondKey = firstKey + 'val'\nvoid global[secondKey]('0')\n",
    "\nconst root = global\nvoid root['eval']('0')\n",
    "\nconst p = global['pro' + 'cess']\nvoid p.getBuiltinModule('fs')\n",
    "\nvoid global.process['getBuiltin' + 'Module']('fs')\n",
    "\nvoid global.process.getBuiltinModule('module').createRequire(import.meta.url)('fs')\n",
    "\nconst createRequireKey = 'create' + 'Require'\nvoid global.process.getBuiltinModule('module')[createRequireKey](import.meta.url)('f' + 's')\n",
    "\nconst p = global.process\nconst getModule = p['getBuiltin' + 'Module']\nconst moduleBuiltin = getModule('module')\nconst makeRequire = moduleBuiltin['create' + 'Require']\nvoid makeRequire(import.meta.url)('child_' + 'process')\n",
    "\nvoid Reflect.get(global, 'Fun' + 'ction')('return 0')\n",
    "\nvoid Object.getOwnPropertyDescriptor(global, 'e' + 'val').value('0')\n",
    "\nvoid Reflect.get(() => {}, 'con' + 'structor')('return 0')\n",
    "\nvoid Object.getOwnPropertyDescriptor(() => {}, 'con' + 'structor').value('return 0')\n",
    "\nvoid global.process.getBuiltinModule('f' + 's')\n",
    "\nvoid global.process.getBuiltinModule('node:' + 'fs/promises')\n",
    "\nvoid global.process.getBuiltinModule('child_' + 'process')\n",
    "\nconst unknownKey = String(Date.now())\nvoid global[unknownKey]\n",
    "\nvoid global['benign-static-key']\n",
    "\nvoid process.benignStaticKey\n",
    "\nvoid ({})['con' + 'structor']\n",
    "\nconst constructorKey = ['con', 'structor'].join('')\nconst HiddenFunction = (() => {})[constructorKey]\nvoid HiddenFunction('return 0')()\n",
    "\nconst constructorKey = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)\nvoid (() => {})[constructorKey]('return 0')()\n",
    "\nconst constructorKey = ['con', 'structor'].join('')\nvoid Object.getOwnPropertyDescriptor(() => {}, constructorKey).value('return 0')()\n",
    "\nvoid (() => {}).constructor('return 0')()\n",
    "\nvoid (() => {}).constructor.constructor('return 0')()\n",
    "\nvoid [].filter.constructor('return 0')()\n",
    "\nvoid Reflect.get(() => {}, 'constructor')('return 0')()\n",
    "\nconst constructorKey = getUnknownKey()\nvoid (() => {})[constructorKey]\n",
    "\nconst constructorKey = ['con', 'structor'].join('')\nconst firstConstructor = (() => {})[constructorKey]\nconst secondConstructor = firstConstructor\nvoid secondConstructor('return 0')()\n",
    "\nvoid Reflect.apply((() => {})['constructor'], undefined, ['return 0'])()\n",
    "\nvoid new ((() => {})['constructor'])('return 0')\n",
    "\nvoid (async function () {}).constructor('return 0')()\n",
    "\nvoid (function* () {}).constructor('return 0')()\n",
    "\nvoid (async function* () {}).constructor('return 0')()\n",
    "\nvoid (() => {}).bind(undefined).constructor('return 0')()\n",
    "\nvoid ({}).constructor.constructor('return 0')()\n",
    "\nvoid [].constructor.constructor('return 0')()\n",
    "\nvoid Object.getPrototypeOf(async function () {}).constructor('return 0')()\n",
    "\nconst firstPart = 'con'\nconst secondPart = firstPart + 'structor'\nvoid (() => {})[secondPart]('return 0')()\n",
    "\nconst constructorKey = unknownCondition ? 'constructor' : 'constructor'\nvoid (() => {})[constructorKey]('return 0')()\n",
    "\nvoid (() => {})[getUnknownKey()]\n",
    "\nvoid Object.getOwnPropertyDescriptors(() => {})\n",
    "\nconst hiddenDescriptor = Object.getOwnPropertyDescriptor\nvoid hiddenDescriptor(() => {}, 'constructor').value('return 0')()\n",
    "\nconst hiddenReflectGet = Reflect.get\nvoid hiddenReflectGet(() => {}, 'constructor')('return 0')()\n",
    "\nconst hiddenPrototype = Object.getPrototypeOf\nvoid hiddenPrototype(async function () {}).constructor('return 0')()\n",
    "\nconst { getOwnPropertyDescriptor: hiddenDescriptor } = Object\nvoid hiddenDescriptor(() => {}, 'constructor').value('return 0')()\n",
    "\nconst { get: hiddenReflectGet } = Reflect\nvoid hiddenReflectGet(() => {}, 'constructor')('return 0')()\n",
    "\nvoid Object.defineProperty({}, 'value', { value: 1 })\n",
    "\nconst { constructor: HiddenFunction } = (() => {})\nvoid HiddenFunction('return 0')()\n",
    "\nconst { ['con' + 'structor']: HiddenFunction } = (() => {})\nvoid HiddenFunction('return 0')()\n",
    "\nconst key = getUnknownKey()\nconst { [key]: hiddenValue } = (() => {})\nvoid hiddenValue\n",
    "\nvoid Reflect.construct((() => {})['constructor'], ['return 0'])\n",
    "\nvoid Object.create((() => {})['prototype'])\n",
    "\nvoid Object.setPrototypeOf({}, (() => {})['prototype'])\n",
    ...ALIAS_AUTHORITY_MUTATIONS,
  ]
  for (const mutation of mutations) {
    assert.throws(() => inspectClosedModuleSource(repositoryPath, source + mutation))
  }
})

test('reviewed AST allowlists reject extra copies outside the exact source inventory', () => {
  const cases = [
    [
      'scripts/lib/release-inspection/preview-capability-projection.mjs',
      '\nfunction hiddenComputed(surfaces, surface) { return surfaces[surface] }\n',
    ],
    [
      'scripts/lib/release-inspection/preview-capability-projection-authority.mjs',
      '\nfunction hiddenDescriptor(value, key) { return Reflect.getOwnPropertyDescriptor(value, key) }\n',
    ],
    [
      'scripts/lib/release-inspection/intrinsic-integrity.mjs',
      '\nconst hiddenPrototypeAuthority = Object.prototype\n',
    ],
  ]
  for (const [repositoryPath, mutation] of cases) {
    const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
    assert.throws(() => inspectClosedModuleSource(repositoryPath, source + mutation))
  }
})

test('VM authority has exactly one immutable reviewed import, call, and result boundary', () => {
  const repositoryPath = 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
  const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, source))
  const withoutCall = source.replace(APPROVED_VM_CALL_SOURCE, 'null')
  const duplicateCall = `${source}\nvoid ${APPROVED_VM_CALL_SOURCE}\n`
  const alteredCall = source.replace(
    APPROVED_VM_ARGUMENT_SOURCE,
    APPROVED_VM_ARGUMENT_SOURCE.replace('WeakMap,', 'WeakSet,'),
  )
  const aliasedImport = source.replace(
    'import { runInNewContext } from "node:vm";',
    'import { runInNewContext as hiddenVm } from "node:vm";',
  )
  for (const mutation of [
    withoutCall,
    duplicateCall,
    alteredCall,
    aliasedImport,
    `${source}\nexport { runInNewContext }\n`,
    `${source}\nfunction getVm() { return runInNewContext }\nvoid getVm\n`,
    `${source}\nconst hiddenVm = runInNewContext\nvoid hiddenVm('0')\n`,
    `${source}\nvoid pristineWeakMapIntrinsics.constructor('return 0')()\n`,
    injectSensitiveQueueFixture(source, '  void queue[2];'),
    source.replace(
      '    const target = queue[cursor];',
      '    const target = queue[cursor];\n    const stolenTarget = target;\n    void stolenTarget;',
    ),
    injectTrustedRecordFixture(source, '      void trusted.target;'),
    `${source}\nconst duplicateQueue = ${APPROVED_CAPTURED_REFLECTIVE_CONTAINER_SOURCE}\nvoid duplicateQueue\n`,
  ]) assert.throws(() => inspectClosedModuleSource(repositoryPath, mutation))
})

function injectSensitiveQueueFixture(source, fixture) {
  const marker = '  const seen = new WeakSet();'
  assert.equal(source.includes(marker), true)
  return source.replace(marker, `${fixture}\n\n${marker}`)
}

const SENSITIVE_QUEUE_ESCAPE_FIXTURES = [
  ['direct alias', '  const escapedQueue = queue;\n  void escapedQueue;'],
  ['chained alias', '  const firstQueue = queue;\n  const secondQueue = firstQueue;\n  void secondQueue;'],
  ['assignment alias', '  let escapedQueue;\n  escapedQueue = queue;\n  void escapedQueue;'],
  ['destructuring', '  const [capturedMethod] = queue;\n  void capturedMethod;'],
  ['array storage', '  const queueArray = [queue];\n  void queueArray;'],
  ['object storage', '  const queueObject = { queue };\n  void queueObject;'],
  ['array spread', '  const copiedQueue = [...queue];\n  void copiedQueue;'],
  [
    'helper argument',
    '  function consumeQueue(value) { return value.length; }\n  void consumeQueue(queue);',
  ],
  ['helper return', '  function returnQueue() { return queue; }\n  void returnQueue;'],
  ['closure capture', '  const captureQueue = () => queue;\n  void captureQueue;'],
  ['aliased indexing', '  const escapedQueue = queue;\n  void escapedQueue[2];'],
  [
    'aliased iteration',
    '  const escapedQueue = queue;\n  for (const value of escapedQueue) void value;',
  ],
  ['captured element alias', '  const escapedMethod = queue[2];\n  void escapedMethod;'],
  ['captured element storage', '  const escapedMethods = [queue[2]];\n  void escapedMethods;'],
  [
    'captured element return',
    '  function returnCapturedMethod() { return queue[2]; }\n  void returnCapturedMethod;',
  ],
  ['captured element invocation', '  void queue[2](undefined);'],
  [
    'helper-returned alias',
    '  function identityQueue(value) { return value; }\n  const escapedQueue = identityQueue(queue);\n  void escapedQueue[2];',
  ],
  ['bound captured element', '  void queue[2].bind(undefined);'],
  ['computed captured element', "  void queue['1' + '1'];"],
]

test('sensitive queue binding rejects every escape without rejecting shadowed local queues', () => {
  const repositoryPath = 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
  const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, source))
  for (const [label, fixture] of SENSITIVE_QUEUE_ESCAPE_FIXTURES) {
    assert.throws(
      () => inspectClosedModuleSource(
        repositoryPath,
        injectSensitiveQueueFixture(source, fixture),
      ),
      undefined,
      label,
    )
  }
  const unrelatedQueue = `${source}
function inspectUnrelatedQueue() {
  const queue = []
  queue.push('ordinary-value')
  return queue.length
}
void inspectUnrelatedQueue
`
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, unrelatedQueue))
  const shadowedQueue = injectSensitiveQueueFixture(
    source,
    `  {
    const queue = [];
    queue.push('ordinary-value');
    void queue.length;
  }`,
  )
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, shadowedQueue))
})

function injectTrustedRecordFixture(source, fixture) {
  const marker = '      const trusted = TRUSTED_GRAPH[recordIndex];'
  assert.equal(source.includes(marker), true)
  return source.replace(marker, `${marker}\n${fixture}`)
}

function injectTrustedGraphFixture(source, fixture) {
  const marker = 'const TRUSTED_GRAPH = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);'
  assert.equal(source.includes(marker), true)
  return source.replace(marker, `${marker}\n${fixture}`)
}

const TRUSTED_RECORD_ESCAPE_FIXTURES = [
  ['direct alias', '      const escapedTrusted = trusted;\n      void escapedTrusted;'],
  [
    'chained alias',
    '      const firstTrusted = trusted;\n      const secondTrusted = firstTrusted;\n      void secondTrusted;',
  ],
  ['assignment alias', '      let escapedTrusted;\n      escapedTrusted = trusted;'],
  [
    'conditional alias',
    '      const escapedTrusted = recordIndex >= 0 ? trusted : trusted;\n      void escapedTrusted;',
  ],
  ['sequence alias', '      const escapedTrusted = (void 0, trusted);\n      void escapedTrusted;'],
  ['destructuring', '      const { target: escapedTarget } = trusted;\n      void escapedTarget;'],
  ['array storage', '      const trustedArray = [trusted];\n      void trustedArray;'],
  ['array spread', '      const trustedCopy = [...trusted];\n      void trustedCopy;'],
  ['object storage', '      const trustedObject = { trusted };\n      void trustedObject;'],
  ['object spread', '      const trustedCopy = { ...trusted };\n      void trustedCopy;'],
  [
    'helper argument',
    '      function consumeTrusted(value) { return value; }\n      void consumeTrusted(trusted);',
  ],
  ['helper return', '      function returnTrusted() { return trusted; }\n      void returnTrusted;'],
  ['closure capture', '      const captureTrusted = () => trusted;\n      void captureTrusted;'],
  [
    'target through record alias',
    '      const escapedTrusted = trusted;\n      void escapedTrusted.target;',
  ],
  ['computed target', "      void trusted['target'];"],
  ['target extraction', '      const escapedTarget = trusted.target;\n      void escapedTarget;'],
  ['target storage', '      const escapedTargets = [trusted.target];\n      void escapedTargets;'],
  [
    'target helper argument',
    '      function consumeTarget(value) { return value; }\n      void consumeTarget(trusted.target);',
  ],
  [
    'target helper return',
    '      function returnTarget() { return trusted.target; }\n      void returnTarget;',
  ],
  ['target invocation', '      void trusted.target();'],
  ['record call', '      void trusted.call(undefined);'],
  ['record apply', '      void trusted.apply(undefined, []);'],
  ['record bind', '      void trusted.bind(undefined);'],
  ['record mutation', '      trusted.target = undefined;'],
  ['unapproved property', '      void trusted.keys;'],
]

test('trusted-record binding rejects record and target escapes without shadow false positives', () => {
  const repositoryPath = 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
  const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, source))
  for (const [label, fixture] of TRUSTED_RECORD_ESCAPE_FIXTURES) {
    assert.throws(
      () => inspectClosedModuleSource(
        repositoryPath,
        injectTrustedRecordFixture(source, fixture),
      ),
      undefined,
      label,
    )
  }
  const graphFixtures = [
    ['graph alias', 'const escapedGraph = TRUSTED_GRAPH;\nvoid escapedGraph;'],
    ['graph entry storage', 'void [TRUSTED_GRAPH[0]];'],
    ['graph iterator escape', 'void TRUSTED_GRAPH[Symbol.iterator];'],
  ]
  for (const [label, fixture] of graphFixtures) {
    assert.throws(
      () => inspectClosedModuleSource(
        repositoryPath,
        injectTrustedGraphFixture(source, fixture),
      ),
      undefined,
      label,
    )
  }
  const unrelatedTrusted = `${source}
function inspectUnrelatedTrusted() {
  const trusted = { target: 'ordinary-value' }
  return trusted.target
}
void inspectUnrelatedTrusted
`
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, unrelatedTrusted))
  const shadowedTrusted = injectTrustedRecordFixture(
    source,
    `      {
        const trusted = { target: 'ordinary-value' };
        void trusted.target;
      }`,
  )
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, shadowedTrusted))
})

function injectAuthorityFactoryFixture(source, fixture, beforeApprovedCall = false) {
  const marker = 'const TRUSTED_GRAPH = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);'
  assert.equal(source.includes(marker), true)
  return beforeApprovedCall
    ? source.replace(marker, `${fixture}\n${marker}`)
    : source.replace(marker, `${marker}\n${fixture}`)
}

const AUTHORITY_FACTORY_ESCAPE_FIXTURES = [
  ['second direct call', 'void captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);'],
  [
    'second identical call',
    'const SECOND_TRUSTED_GRAPH = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);\nvoid SECOND_TRUSTED_GRAPH;',
  ],
  ['altered argument', 'void captureTrustedGraph([]);'],
  ['direct alias', 'const escapedFactory = captureTrustedGraph;\nvoid escapedFactory;'],
  [
    'chained alias',
    'const firstFactory = captureTrustedGraph;\nconst secondFactory = firstFactory;\nvoid secondFactory;',
  ],
  ['assignment alias', 'let escapedFactory;\nescapedFactory = captureTrustedGraph;'],
  [
    'conditional alias',
    'const escapedFactory = true ? captureTrustedGraph : captureTrustedGraph;\nvoid escapedFactory;',
  ],
  ['sequence alias', 'const escapedFactory = (void 0, captureTrustedGraph);'],
  ['array storage', 'const factoryArray = [captureTrustedGraph];\nvoid factoryArray;'],
  ['object storage', 'const factoryObject = { captureTrustedGraph };\nvoid factoryObject;'],
  [
    'factory destructuring',
    'const [escapedFactory] = [captureTrustedGraph];\nvoid escapedFactory;',
  ],
  [
    'helper argument',
    'function consumeFactory(value) { return value; }\nvoid consumeFactory(captureTrustedGraph);',
  ],
  [
    'helper return',
    'function returnFactory() { return captureTrustedGraph; }\nvoid returnFactory;',
  ],
  [
    'closure capture',
    'const captureFactory = () => captureTrustedGraph;\nvoid captureFactory;',
  ],
  ['bind invocation', 'void captureTrustedGraph.bind(undefined);'],
  [
    'bound call invocation',
    'void captureTrustedGraph.bind(undefined)(TRUSTED_GLOBAL_SLOTS);',
  ],
  [
    'call invocation',
    'void captureTrustedGraph.call(undefined, TRUSTED_GLOBAL_SLOTS);',
  ],
  [
    'apply invocation',
    'void captureTrustedGraph.apply(undefined, [TRUSTED_GLOBAL_SLOTS]);',
  ],
  [
    'Reflect.apply invocation',
    'void Reflect.apply(captureTrustedGraph, undefined, [TRUSTED_GLOBAL_SLOTS]);',
  ],
  [
    'helper-returned alias',
    'function identityFactory(value) { return value; }\nconst escapedFactory = identityFactory(captureTrustedGraph);',
  ],
  [
    'second result assignment',
    'const escapedGraph = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);\nvoid escapedGraph;',
  ],
  ['second result indexed', 'void captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)[0];'],
  [
    'second result iterated',
    'for (const escapedRecord of captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)) void escapedRecord;',
  ],
  [
    'second result destructured',
    'const [escapedRecord] = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);\nvoid escapedRecord;',
  ],
  [
    'second result spread',
    'const escapedRecords = [...captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)];',
  ],
  [
    'second result array storage',
    'const escapedGraphs = [captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)];',
  ],
  [
    'second result object storage',
    'const escapedGraphs = { graph: captureTrustedGraph(TRUSTED_GLOBAL_SLOTS) };',
  ],
  [
    'second result passed onward',
    'function consumeGraph(value) { return value; }\nvoid consumeGraph(captureTrustedGraph(TRUSTED_GLOBAL_SLOTS));',
  ],
  [
    'second result returned',
    'function returnGraph() { return captureTrustedGraph(TRUSTED_GLOBAL_SLOTS); }\nvoid returnGraph;',
  ],
  ['new invocation', 'void new captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);'],
  [
    'computed invocation',
    "void captureTrustedGraph['call'](undefined, TRUSTED_GLOBAL_SLOTS);",
  ],
  ['property attachment', 'captureTrustedGraph.exposed = true;'],
  ['export', 'export { captureTrustedGraph };'],
]

test('authority-producing factory permits one exact call and rejects every escape', () => {
  const repositoryPath = 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
  const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, source))
  const withoutCall = source.replace(
    'captureTrustedGraph(TRUSTED_GLOBAL_SLOTS)',
    '[]',
  )
  assert.throws(() => inspectClosedModuleSource(repositoryPath, withoutCall))
  for (const [label, fixture] of AUTHORITY_FACTORY_ESCAPE_FIXTURES) {
    assert.throws(
      () => inspectClosedModuleSource(
        repositoryPath,
        injectAuthorityFactoryFixture(source, fixture),
      ),
      undefined,
      label,
    )
  }
  const invocationBefore = injectAuthorityFactoryFixture(
    source,
    'void captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);',
    true,
  )
  assert.throws(() => inspectClosedModuleSource(repositoryPath, invocationBefore))
  const syntax = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const factory = syntax.body.find((node) => node.type === 'FunctionDeclaration'
    && node.id?.name === 'captureTrustedGraph')
  const graphDeclaration = syntax.body.find((node) => node.type === 'VariableDeclaration'
    && node.declarations[0]?.id?.name === 'TRUSTED_GRAPH')
  assert.ok(factory)
  assert.ok(graphDeclaration)
  const reordered = `${source.slice(0, factory.start)}${source.slice(
    graphDeclaration.start,
    graphDeclaration.end,
  )}\n${source.slice(factory.start, graphDeclaration.start)}${source.slice(
    graphDeclaration.end,
  )}`
  assert.throws(() => inspectClosedModuleSource(repositoryPath, reordered))
  const shadowedFactory = `${source}
function inspectUnrelatedFactory() {
  function captureTrustedGraph(value) { return value }
  return captureTrustedGraph([])
}
void inspectUnrelatedFactory
`
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, shadowedFactory))
})

test('sensitive queue inventory enforces exact source order and occurrence sequence', () => {
  const repositoryPath = 'scripts/lib/release-inspection/intrinsic-integrity.mjs'
  const source = readFileSync(path.join(ROOT, repositoryPath), 'utf8')
  const getBlock = `      if (isObjectLike(descriptor.get)) {
        queue.push(descriptor.get);
      }`
  const setBlock = `      if (isObjectLike(descriptor.set)) {
        queue.push(descriptor.set);
      }`
  assert.equal(source.includes(`${getBlock}\n${setBlock}`), true)
  const reordered = source.replace(`${getBlock}\n${setBlock}`, `${setBlock}\n${getBlock}`)
  const duplicated = source.replace(
    '        queue.push(descriptor.get);',
    '        queue.push(descriptor.get);\n        queue.push(descriptor.get);',
  )
  const removed = source.replace('        queue.push(descriptor.get);\n', '')
  const altered = source.replace(
    '        queue.push(descriptor.get);',
    '        queue.unshift(descriptor.get);',
  )
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, source))
  for (const mutation of [reordered, duplicated, removed, altered]) {
    assert.throws(() => inspectClosedModuleSource(repositoryPath, mutation))
  }
  const unrelatedBefore = `${source}\nconst unrelatedOrderMarker = 1;\nvoid unrelatedOrderMarker;\n`
  const unrelatedAfter = unrelatedBefore.replace(
    'const unrelatedOrderMarker = 1;\nvoid unrelatedOrderMarker;',
    'void unrelatedOrderMarker;\nconst unrelatedOrderMarker = 1;',
  )
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, unrelatedBefore))
  assert.doesNotThrow(() => inspectClosedModuleSource(repositoryPath, unrelatedAfter))
})

test('representative source-graph escapes make the checked-in focused suite fail', () => {
  const mutations = [
    "\nconst hiddenEvaluator = eval\nhiddenEvaluator('0')\n",
    "\nconst hiddenEvaluator = eval\nhiddenEvaluator.call(undefined, '0')\n",
    "\nconst hiddenEvaluator = eval\nhiddenEvaluator.apply(undefined, ['0'])\n",
    "\nconst first = eval\nconst second = first\nsecond('0')\n",
    "\nconst { eval: hiddenEvaluator } = globalThis\nhiddenEvaluator('0')\n",
    "\nvoid globalThis[\"eval\"]('0')\n",
    "\nvoid Reflect.apply(eval, undefined, ['0'])\n",
    "\nconst HiddenFunction = Function\nvoid new HiddenFunction('return 0')\n",
    "\nconst hiddenRequire = require\nhiddenRequire('node:fs')\n",
    "\nconst hiddenCreateRequire = createRequire\nhiddenCreateRequire(import.meta.url)('node:fs')\n",
    "\nconst hiddenVmEvaluator = runInNewContext\nhiddenVmEvaluator('0')\n",
    "\nvoid new AsyncFunction('return 0')\n",
    "\nvoid new GeneratorFunction('return 0')\n",
    "\nvoid new AsyncGeneratorFunction('return 0')\n",
    "\nvoid compileFunction('return 0')\n",
    "\nvoid runInContext('0')\n",
    "\nimport { readFile as hiddenRead } from 'node:fs'\nvoid hiddenRead\n",
    "\nimport { spawn as hiddenSpawn } from 'node:child_process'\nvoid hiddenSpawn\n",
    "\nconst key = ['con', 'structor'].join('')\nconst HiddenFunction = (() => {})[key]\nvoid HiddenFunction('return 0')()\n",
    "\nconst key = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)\nvoid (() => {})[key]('return 0')()\n",
    "\nconst key = ['con', 'structor'].join('')\nvoid Object.getOwnPropertyDescriptor(() => {}, key).value('return 0')()\n",
    "\nvoid (() => {}).constructor('return 0')()\n",
    "\nvoid (() => {}).constructor.constructor('return 0')()\n",
    "\nvoid [].filter.constructor('return 0')()\n",
    "\nvoid Reflect.get(() => {}, 'constructor')('return 0')()\n",
    "\nconst key = getUnknownKey()\nvoid (() => {})[key]\n",
    "\nconst key = ['con', 'structor'].join('')\nconst first = (() => {})[key]\nconst second = first\nvoid second('return 0')()\n",
    "\nvoid Reflect.apply((() => {})['constructor'], undefined, ['return 0'])()\n",
    "\nvoid new ((() => {})['constructor'])('return 0')\n",
    "\nvoid (async function () {}).constructor('return 0')()\n",
    "\nvoid (function* () {}).constructor('return 0')()\n",
    "\nvoid (async function* () {}).constructor('return 0')()\n",
    "\nvoid (() => {}).bind(undefined).constructor('return 0')()\n",
    "\nvoid ({}).constructor.constructor('return 0')()\n",
    "\nvoid [].constructor.constructor('return 0')()\n",
    "\nvoid Object.getPrototypeOf(async function () {}).constructor('return 0')()\n",
    "\nconst firstPart = 'con'\nconst key = firstPart + 'structor'\nvoid (() => {})[key]('return 0')()\n",
    "\nconst key = unknownCondition ? 'constructor' : 'constructor'\nvoid (() => {})[key]('return 0')()\n",
    "\nvoid Object.getOwnPropertyDescriptors(() => {})\n",
    "\nconst hiddenDescriptor = Object.getOwnPropertyDescriptor\nvoid hiddenDescriptor(() => {}, 'constructor').value('return 0')()\n",
    "\nconst hiddenReflectGet = Reflect.get\nvoid hiddenReflectGet(() => {}, 'constructor')('return 0')()\n",
    "\nconst hiddenPrototype = Object.getPrototypeOf\nvoid hiddenPrototype(async function () {}).constructor('return 0')()\n",
    "\nconst { getOwnPropertyDescriptor: hiddenDescriptor } = Object\nvoid hiddenDescriptor(() => {}, 'constructor').value('return 0')()\n",
    "\nconst { get: hiddenReflectGet } = Reflect\nvoid hiddenReflectGet(() => {}, 'constructor')('return 0')()\n",
    "\nvoid Object.defineProperty({}, 'value', { value: 1 })\n",
    "\nconst { constructor: HiddenFunction } = (() => {})\nvoid HiddenFunction('return 0')()\n",
    "\nconst { ['con' + 'structor']: HiddenFunction } = (() => {})\nvoid HiddenFunction('return 0')()\n",
    "\nconst key = getUnknownKey()\nconst { [key]: hiddenValue } = (() => {})\nvoid hiddenValue\n",
    "\nvoid Reflect.construct((() => {})['constructor'], ['return 0'])\n",
    "\nvoid Object.create((() => {})['prototype'])\n",
    "\nvoid Object.setPrototypeOf({}, (() => {})['prototype'])\n",
    ...ALIAS_AUTHORITY_MUTATIONS,
  ]
  for (const mutation of mutations) {
    const childEnvironment = {
      ...process.env,
      PREVIEW_STABLE_COMPARISON_SOURCE_MUTATION: mutation,
    }
    delete childEnvironment.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, [
      '--test',
      '--test-name-pattern=^comparison source graph is pure',
      fileURLToPath(import.meta.url),
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: childEnvironment,
    })
    assert.notEqual(run.status, 0, mutation)
    assert.match(`${run.stdout}\n${run.stderr}`, /comparison source graph is pure/u)
  }
})

test('isolated declaration, analyzer, and VM weakenings make checked-in contract suites fail', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'preview-final-remediation-mutations-'))
  const copyRoot = path.join(directory, 'repository')
  try {
    cpSync(path.join(ROOT, 'scripts'), path.join(copyRoot, 'scripts'), { recursive: true })
    cpSync(path.join(ROOT, 'shared'), path.join(copyRoot, 'shared'), { recursive: true })
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(copyRoot, 'node_modules'), 'dir')

    const declarationPath = path.join(
      copyRoot, 'scripts/lib/release-inspection/preview-stability-projection.d.mts',
    )
    const declarationSource = readFileSync(declarationPath, 'utf8')
    const classAuthority = `declare class PreviewExactSemanticValueAuthority {
  private readonly previewExactSemanticValueAuthority: void
  private constructor()
}`
    const phantomAuthority =
      'declare const previewExactSemanticValueBrand: unique symbol'
    const nominalExact = `type PreviewExactSemanticObject<Shape extends object> =
  Readonly<Shape> & PreviewExactSemanticValueAuthority`
    const spreadPreservingExact = `type PreviewExactSemanticObject<Shape extends object> =
  Readonly<Shape> & Readonly<{
    [previewExactSemanticValueBrand]: keyof Shape
  }>`
    assert.equal(declarationSource.includes(classAuthority), true)
    assert.equal(declarationSource.includes(nominalExact), true)
    writeFileSync(
      declarationPath,
      declarationSource
        .replace(classAuthority, phantomAuthority)
        .replace(nominalExact, spreadPreservingExact),
      'utf8',
    )
    const declarationMutation = spawnSync(
      path.join(ROOT, 'node_modules/.bin/tsc'),
      ['--project', 'scripts/tsconfig.release-observation.json', '--noEmit'],
      { cwd: copyRoot, encoding: 'utf8' },
    )
    assert.notEqual(declarationMutation.status, 0)
    assert.match(
      `${declarationMutation.stdout}\n${declarationMutation.stderr}`,
      /Unused '@ts-expect-error' directive/u,
    )

    const focusedTestPath = path.join(copyRoot, 'scripts/preview-stable-comparison.test.mjs')
    const focusedSource = readFileSync(focusedTestPath, 'utf8')
    const weakeningExpression =
      "const weakening = process.env.PREVIEW_SOURCE_GRAPH_TEST_WEAKENING ?? ''"
    assert.equal(focusedSource.includes(weakeningExpression), true)
    for (const weakening of [
      'omit-global',
      'omit-constant-folding',
      'omit-process',
      'omit-unresolved-computed',
      'omit-array-join',
      'omit-from-char-code',
      'omit-reflective-protection',
      'omit-direct-constructor',
      'omit-sensitive-root-references',
      'omit-captured-authority',
    ]) {
      const childEnvironment = {
        ...process.env,
        PREVIEW_SOURCE_GRAPH_TEST_WEAKENING: weakening,
      }
      delete childEnvironment.NODE_TEST_CONTEXT
      const analyzerMutation = spawnSync(process.execPath, [
        '--test',
        '--test-name-pattern=^(static property resolver|source-graph inspection rejects)',
        focusedTestPath,
      ], {
        cwd: copyRoot,
        encoding: 'utf8',
        env: childEnvironment,
      })
      assert.notEqual(analyzerMutation.status, 0, weakening)
      assert.match(
        `${analyzerMutation.stdout}\n${analyzerMutation.stderr}`,
        /(?:static property resolver|source-graph inspection rejects)/u,
      )
    }

    for (const weakening of [
      'omit-queue-all-references',
      'omit-queue-direct-alias',
      'omit-queue-argument-escape',
      'omit-queue-container-escape',
      'omit-queue-element-escape',
    ]) {
      const queueEnvironment = {
        ...process.env,
        PREVIEW_SOURCE_GRAPH_TEST_WEAKENING: weakening,
      }
      delete queueEnvironment.NODE_TEST_CONTEXT
      const queueMutation = spawnSync(process.execPath, [
        '--test',
        '--test-name-pattern=^sensitive queue binding rejects',
        focusedTestPath,
      ], {
        cwd: copyRoot,
        encoding: 'utf8',
        env: queueEnvironment,
      })
      assert.notEqual(queueMutation.status, 0, weakening)
      assert.match(
        `${queueMutation.stdout}\n${queueMutation.stderr}`,
        /sensitive queue binding rejects/u,
      )
    }

    for (const weakening of [
      'omit-trusted-all-references',
      'omit-trusted-direct-alias',
      'omit-trusted-target-alias',
      'omit-trusted-argument-return',
      'omit-trusted-graph-escape',
      'name-only-trusted-matching',
    ]) {
      const trustedEnvironment = {
        ...process.env,
        PREVIEW_SOURCE_GRAPH_TEST_WEAKENING: weakening,
      }
      delete trustedEnvironment.NODE_TEST_CONTEXT
      const trustedMutation = spawnSync(process.execPath, [
        '--test',
        '--test-name-pattern=^trusted-record binding rejects',
        focusedTestPath,
      ], {
        cwd: copyRoot,
        encoding: 'utf8',
        env: trustedEnvironment,
      })
      assert.notEqual(trustedMutation.status, 0, weakening)
      assert.match(
        `${trustedMutation.stdout}\n${trustedMutation.stderr}`,
        /trusted-record binding rejects/u,
      )
    }

    for (const weakening of [
      'omit-factory-all-references',
      'omit-factory-call-count-enforcement',
      'omit-factory-direct-second-call-rejection',
      'omit-factory-alias-rejection',
      'omit-factory-argument-return-rejection',
      'omit-factory-call-apply-bind-rejection',
      'name-only-factory-matching',
      'permit-second-exact-factory-invocation',
    ]) {
      const factoryEnvironment = {
        ...process.env,
        PREVIEW_SOURCE_GRAPH_TEST_WEAKENING: weakening,
      }
      delete factoryEnvironment.NODE_TEST_CONTEXT
      const factoryMutation = spawnSync(process.execPath, [
        '--test',
        '--test-name-pattern=^authority-producing factory',
        focusedTestPath,
      ], {
        cwd: copyRoot,
        encoding: 'utf8',
        env: factoryEnvironment,
      })
      assert.notEqual(factoryMutation.status, 0, weakening)
      assert.match(
        `${factoryMutation.stdout}\n${factoryMutation.stderr}`,
        /authority-producing factory/u,
      )
    }

    const unorderedQueueEnvironment = {
      ...process.env,
      PREVIEW_SOURCE_GRAPH_TEST_WEAKENING: 'restore-unordered-queue-inventory',
    }
    delete unorderedQueueEnvironment.NODE_TEST_CONTEXT
    const unorderedQueueMutation = spawnSync(process.execPath, [
      '--test',
      '--test-name-pattern=^sensitive queue inventory enforces',
      focusedTestPath,
    ], {
      cwd: copyRoot,
      encoding: 'utf8',
      env: unorderedQueueEnvironment,
    })
    assert.notEqual(unorderedQueueMutation.status, 0, 'restore unordered queue inventory')
    assert.match(
      `${unorderedQueueMutation.stdout}\n${unorderedQueueMutation.stderr}`,
      /sensitive queue inventory enforces/u,
    )

    const intrinsicPath = path.join(
      copyRoot, 'scripts/lib/release-inspection/intrinsic-integrity.mjs',
    )
    const intrinsicSource = readFileSync(intrinsicPath, 'utf8')
    const queueGetBlock = `      if (isObjectLike(descriptor.get)) {
        queue.push(descriptor.get);
      }`
    const queueSetBlock = `      if (isObjectLike(descriptor.set)) {
        queue.push(descriptor.set);
      }`
    assert.equal(intrinsicSource.includes(`${queueGetBlock}\n${queueSetBlock}`), true)
    writeFileSync(
      intrinsicPath,
      intrinsicSource.replace(
        `${queueGetBlock}\n${queueSetBlock}`,
        `${queueSetBlock}\n${queueGetBlock}`,
      ),
      'utf8',
    )
    const reorderedQueueEnvironment = { ...process.env }
    delete reorderedQueueEnvironment.NODE_TEST_CONTEXT
    const reorderedQueueMutation = spawnSync(process.execPath, [
      '--test',
      '--test-name-pattern=^comparison source graph is pure',
      focusedTestPath,
    ], {
      cwd: copyRoot,
      encoding: 'utf8',
      env: reorderedQueueEnvironment,
    })
    assert.notEqual(reorderedQueueMutation.status, 0, 'reordered queue operations')
    assert.match(
      `${reorderedQueueMutation.stdout}\n${reorderedQueueMutation.stderr}`,
      /(?:sensitive queue reference|comparison source graph is pure)/u,
    )
    writeFileSync(intrinsicPath, intrinsicSource, 'utf8')
    const vmDeclaration =
      `const pristineWeakMapIntrinsics = ${APPROVED_VM_CALL_SOURCE};`
    assert.equal(intrinsicSource.includes(vmDeclaration), true)
    writeFileSync(
      intrinsicPath,
      intrinsicSource.replace(
        vmDeclaration,
        `${vmDeclaration}\nconst duplicatePristineWeakMapIntrinsics = ${APPROVED_VM_CALL_SOURCE};\nvoid duplicatePristineWeakMapIntrinsics;`,
      ),
      'utf8',
    )
    const vmEnvironment = {
      ...process.env,
      PREVIEW_SOURCE_GRAPH_TEST_WEAKENING: 'omit-vm-occurrence',
    }
    delete vmEnvironment.NODE_TEST_CONTEXT
    const vmMutation = spawnSync(process.execPath, [
      '--test',
      '--test-name-pattern=^comparison source graph is pure',
      focusedTestPath,
    ], {
      cwd: copyRoot,
      encoding: 'utf8',
      env: vmEnvironment,
    })
    assert.notEqual(vmMutation.status, 0, 'omit-vm-occurrence')
    assert.match(
      `${vmMutation.stdout}\n${vmMutation.stderr}`,
      /(?:VM calls exact reviewed occurrence inventory|unapproved VM call)/u,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function assertDocumentationAuthorityContract(documents) {
  const milestone = documents.milestone
  const backend = documents.backend
  const workflow = documents.workflow
  for (const required of [
    /`MATCH` means only that two normalized Preview reads are semantically equal\./u,
    /`DRIFT` means that two complete Preview reads differ semantically\./u,
    /`UNKNOWN` means stability is unproven/u,
    /A stable match does not mean current, ready,[\s\S]*or permitted to execute\./u,
    /`executionAuthorization: "prohibited"`/u,
    /Double-read execution, the required delay, clocks, and request accounting are\s+deferred to 3D-2B\.3b\./u,
    /Freshness, expiration, and construction of the final\s+stable artifact are deferred to 3D-2B\.3c\./u,
    /no\s+authenticated Preview observation occurs/u,
    /Production observation remains\s+excluded/u,
    /Plain-text binding names and values are not classified as inseparable tuples\./u,
    /retains each field independently/u,
    /Runtime validation and private object identity are the authority boundary\./u,
    /assignability therefore is not proof of provenance or authorization\./u,
    /A widened\s+clone has a different identity and is rejected before property reads/u,
    /Consumers must never\s+infer currentness, execution permission, or provenance from TypeScript\s+assignability\./u,
  ]) assert.match(milestone, required)
  assert.match(
    backend,
    /`MATCH` means stable equality between two normalized\s+Preview reads and does not mean local-versus-remote agreement, currentness, or\s+authorization\./u,
  )
  assert.match(
    workflow,
    /Its `MATCH` means only read-to-read semantic stability and grants neither\s+currentness nor execution authority\./u,
  )
  const combined = Object.values(documents).join('\n')
  for (const contradiction of [
    /(?:`?MATCH`?) (?:means|implies) (?:release )?currentness/u,
    /(?:`?MATCH`?) (?:means|implies) (?:execution )?authorization/u,
    /executionAuthorization: "(?:approved|permitted|authorized)"/u,
    /(?<!no\n)(?<!no )authenticated Preview observation (?:did occur|occurs|was performed)/iu,
    /Production observation (?:is|was|remains) (?:included|performed|authorized)/u,
  ]) assert.doesNotMatch(combined, contradiction)
}

test('documentation mechanically preserves comparison and authority boundaries', () => {
  const documents = {
    milestone: readFileSync(path.join(
      ROOT, 'docs/MILESTONE_3D2B3A_STABLE_COMPARISON_CONTRACT.md',
    ), 'utf8'),
    backend: readFileSync(path.join(ROOT, 'docs/BACKEND_OPERATIONS.md'), 'utf8'),
    workflow: readFileSync(path.join(ROOT, 'docs/PREVIEW_RELEASE_WORKFLOW.md'), 'utf8'),
  }
  assertDocumentationAuthorityContract(documents)
  const contradictions = [
    documents.milestone.replace(
      'A stable match does not mean current, ready,',
      'MATCH means currentness and readiness.',
    ),
    documents.milestone.replace(
      '`executionAuthorization: "prohibited"`',
      '`executionAuthorization: "approved"`',
    ),
    documents.milestone.replace(
      'no\nauthenticated Preview observation occurs',
      'authenticated Preview observation occurs',
    ),
  ]
  for (const milestone of contradictions) {
    assert.throws(() => assertDocumentationAuthorityContract({ ...documents, milestone }))
  }
})

test('snapshot validation rejects symbols, accessors, proxies, BigInt, non-finite numbers, cycles, and oversized inputs', () => {
  const hostile = [
    Object.defineProperty({}, Symbol('authority'), { value: true }),
    Object.defineProperty({}, 'capturedAtMs', { enumerable: true, get() { return CAPTURED_AT_MS } }),
    new Proxy({}, {}),
    { capturedAtMs: 1n },
    { capturedAtMs: Number.POSITIVE_INFINITY },
  ]
  const cyclic = { capturedAtMs: CAPTURED_AT_MS }
  cyclic.resourceOutcomes = [cyclic]
  hostile.push(cyclic, { capturedAtMs: CAPTURED_AT_MS, extra: 'x'.repeat(1_048_577) })
  for (const input of hostile) {
    assert.throws(() => createPreviewSingleReadSnapshot(input), /single-read contract refused/i)
  }
})
