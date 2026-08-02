import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { canonicalJson } from './lib/preview-release/canonical-data.mjs'
import {
  RELEASE_INSPECTION_CAPABILITY_SURFACES,
  RELEASE_INSPECTION_SURFACES,
} from './lib/release-inspection/capability-model.mjs'
import {
  createPreviewCapabilityProjection,
  PREVIEW_CAPABILITY_PROJECTION_KIND,
  PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES,
  PREVIEW_CANDIDATE_GATE_MODES,
  PREVIEW_CANDIDATE_STATES,
  renderPreviewCapabilityProjection,
  validatePreviewCapabilityProjection,
} from './lib/release-inspection/preview-capability-projection.mjs'
import {
  createPreviewSingleReadSnapshot,
} from './lib/release-inspection/preview-observation-contracts.mjs'
import { SCHEMA4_CAPABILITIES } from '../shared/schema4-capabilities.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAPTURED_AT_MS = 1_800_000_000_000
const ISSUE_BY_STATE = Object.freeze({
  complete: null,
  missing: 'resource-missing',
  unavailable: 'resource-unavailable',
  partial: 'resource-partial',
  malformed: 'resource-malformed',
  contradictory: 'resource-contradictory',
})
const PAGE_VARIABLES = Object.freeze([
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_RECOVERY_MODE',
])
const WORKER_VARIABLES = Object.freeze([
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_RECOVERY_MODE',
  'RETENTION_CLEANUP_MODE',
])

function placeholder() {
  return { kind: 'preview-resource-observation-placeholder', schemaVersion: 1 }
}

function pagesValue(variables) {
  return {
    kind: 'preview-pages-project-observation',
    schemaVersion: 1,
    identity: 'approved-preview-pages-project',
    compatibilityDate: null,
    compatibilityFlags: [],
    wranglerConfigurationHash: null,
    variables,
    bindings: [],
  }
}

function workerValue(bindings) {
  return {
    kind: 'preview-worker-settings-observation',
    schemaVersion: 1,
    compatibilityDate: null,
    compatibilityFlags: [],
    secretPresence: 'unavailable',
    bindings,
  }
}

function schedulesValue(schedules) {
  return { kind: 'preview-worker-schedules-observation', schemaVersion: 1, schedules }
}

function outcome(operation, state, value) {
  const normalizedValue = state === 'complete'
    ? value
    : state === 'partial'
      ? {
          kind: 'preview-partial-resource-observation',
          schemaVersion: 1,
          operation,
          collectedCount: 1,
        }
      : state === 'contradictory'
        ? placeholder()
        : null
  return {
    operation,
    state,
    issueCode: ISSUE_BY_STATE[state],
    capturedAtMs: CAPTURED_AT_MS,
    value: normalizedValue,
  }
}

function variables(names, mode = 'disabled') {
  return names.map((name) => ({ name, value: mode }))
}

function bindings(names, mode = 'disabled') {
  return names.map((name) => ({ category: 'plain-text-gate', name, value: mode }))
}

function snapshot({
  pagesState = 'complete',
  pagesVariables = variables(PAGE_VARIABLES),
  workerState = 'complete',
  workerBindings = bindings(WORKER_VARIABLES),
  scheduleState = 'complete',
  schedules = [],
  extraOutcomes = [],
  includePages = true,
  includeWorker = true,
  includeSchedule = true,
} = {}) {
  const resourceOutcomes = [
    ...(includePages ? [outcome('pages-project', pagesState, pagesValue(pagesVariables))] : []),
    ...(includeWorker ? [outcome('worker-settings', workerState, workerValue(workerBindings))] : []),
    ...(includeSchedule ? [outcome('worker-schedules', scheduleState, schedulesValue(schedules))] : []),
    ...extraOutcomes,
  ]
  return createPreviewSingleReadSnapshot({ capturedAtMs: CAPTURED_AT_MS, resourceOutcomes })
}

function project(options) {
  return createPreviewCapabilityProjection(snapshot(options))
}

function state(projection, capability, surface) {
  return projection.capabilities[capability].surfaces[surface].candidateState
}

function replaceMode(entries, name, mode) {
  return entries.map((entry) => entry.name === name ? { ...entry, value: mode } : entry)
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertDeepFrozen(child)
}

test('projection exposes exactly seven capabilities, four surfaces, and the authoritative applicability matrix', () => {
  const projection = project()
  assert.equal(projection.kind, PREVIEW_CAPABILITY_PROJECTION_KIND)
  assert.deepEqual(projection.capabilityInventory, SCHEMA4_CAPABILITIES)
  assert.deepEqual(projection.surfaceInventory, RELEASE_INSPECTION_SURFACES)
  assert.deepEqual(Object.keys(projection.capabilities), [...SCHEMA4_CAPABILITIES].sort())
  assert.equal(SCHEMA4_CAPABILITIES.length, 7)
  assert.equal(RELEASE_INSPECTION_SURFACES.length, 4)
  for (const capability of SCHEMA4_CAPABILITIES) {
    assert.deepEqual(
      Object.keys(projection.capabilities[capability].surfaces),
      [...RELEASE_INSPECTION_SURFACES].sort(),
    )
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const record = projection.capabilities[capability].surfaces[surface]
      const applicable = RELEASE_INSPECTION_CAPABILITY_SURFACES[capability].includes(surface)
      assert.deepEqual(record, applicable
        ? { applicability: 'applicable', candidateState: 'disabled' }
        : { applicability: 'not-applicable', candidateState: 'not-applicable' })
    }
  }
})

test('complete explicit disabled and enabled gate evidence projects independently', () => {
  const disabled = project()
  for (const capability of SCHEMA4_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      if (RELEASE_INSPECTION_CAPABILITY_SURFACES[capability].includes(surface)) {
        assert.equal(state(disabled, capability, surface), 'disabled')
      }
    }
  }

  const enabled = project({
    pagesVariables: variables(PAGE_VARIABLES, 'enabled'),
    workerBindings: bindings(WORKER_VARIABLES, 'enabled'),
    schedules: ['0 3 * * *'],
  })
  for (const capability of SCHEMA4_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      if (RELEASE_INSPECTION_CAPABILITY_SURFACES[capability].includes(surface)) {
        assert.equal(state(enabled, capability, surface), 'enabled')
      }
    }
  }
})

test('missing, partial, unavailable, malformed, contradictory, and incomplete evidence remains unknown', () => {
  for (const resourceState of ['missing', 'partial', 'unavailable', 'malformed', 'contradictory']) {
    const projection = project({
      pagesState: resourceState,
      workerState: resourceState,
      scheduleState: resourceState,
    })
    for (const capability of SCHEMA4_CAPABILITIES) {
      for (const surface of RELEASE_INSPECTION_CAPABILITY_SURFACES[capability]) {
        assert.equal(state(projection, capability, surface), 'unknown', `${resourceState}: ${capability}.${surface}`)
      }
    }
  }

  const absent = project({ includePages: false, includeWorker: false, includeSchedule: false })
  const completeButEmpty = project({ pagesVariables: [], workerBindings: [] })
  for (const capability of SCHEMA4_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_CAPABILITY_SURFACES[capability]) {
      assert.equal(state(absent, capability, surface), 'unknown')
      if (surface !== 'schedule') assert.equal(state(completeButEmpty, capability, surface), 'unknown')
    }
  }

  const duplicatePages = project({
    pagesVariables: [
      ...variables(PAGE_VARIABLES),
      { name: 'LEADERBOARD_READ_MODE', value: 'enabled' },
    ],
  })
  assert.equal(state(duplicatePages, 'leaderboardRead', 'frontend'), 'unknown')
  assert.equal(state(duplicatePages, 'leaderboardRead', 'pages'), 'unknown')

  assert.throws(() => snapshot({
    pagesVariables: [{ name: 'LEADERBOARD_READ_MODE', value: 'unsupported' }],
  }), /single-read contract refused/i)
  const unsupportedAsMalformed = project({ pagesState: 'malformed' })
  assert.equal(state(unsupportedAsMalformed, 'leaderboardRead', 'frontend'), 'unknown')
  assert.equal(state(unsupportedAsMalformed, 'leaderboardRead', 'pages'), 'unknown')
})

test('identity compatibility ceilings accept only exact modes and never widen a narrow gate', () => {
  assert.deepEqual(PREVIEW_CANDIDATE_GATE_MODES, ['disabled', 'enabled'])
  assert.deepEqual(PREVIEW_CANDIDATE_STATES, ['disabled', 'enabled', 'unknown'])
  const identityVariables = Object.freeze({
    identityClaim: 'LEADERBOARD_IDENTITY_CLAIM_MODE',
    identityStatus: 'LEADERBOARD_IDENTITY_STATUS_MODE',
    identityRename: 'LEADERBOARD_IDENTITY_RENAME_MODE',
    identityRecovery: 'LEADERBOARD_RECOVERY_MODE',
  })
  for (const [capability, narrowVariable] of Object.entries(identityVariables)) {
    const pageNarrowEnabled = replaceMode(variables(PAGE_VARIABLES), narrowVariable, 'enabled')
    const workerNarrowEnabled = replaceMode(bindings(WORKER_VARIABLES), narrowVariable, 'enabled')
    const ceilingDisabled = project({
      pagesVariables: pageNarrowEnabled,
      workerBindings: workerNarrowEnabled,
    })
    assert.equal(state(ceilingDisabled, capability, 'frontend'), 'disabled')
    assert.equal(state(ceilingDisabled, capability, 'pages'), 'disabled')
    assert.equal(state(ceilingDisabled, capability, 'worker'), 'disabled')

    const ceilingEnabled = project({
      pagesVariables: replaceMode(pageNarrowEnabled, 'LEADERBOARD_IDENTITY_MODE', 'enabled'),
      workerBindings: replaceMode(workerNarrowEnabled, 'LEADERBOARD_IDENTITY_MODE', 'enabled'),
    })
    assert.equal(state(ceilingEnabled, capability, 'frontend'), 'enabled')
    assert.equal(state(ceilingEnabled, capability, 'pages'), 'enabled')
    assert.equal(state(ceilingEnabled, capability, 'worker'), 'enabled')

    const ceilingMissing = project({
      pagesVariables: pageNarrowEnabled.filter(({ name }) => name !== 'LEADERBOARD_IDENTITY_MODE'),
      workerBindings: workerNarrowEnabled.filter(({ name }) => name !== 'LEADERBOARD_IDENTITY_MODE'),
    })
    assert.equal(state(ceilingMissing, capability, 'frontend'), 'unknown')
    assert.equal(state(ceilingMissing, capability, 'pages'), 'unknown')
    assert.equal(state(ceilingMissing, capability, 'worker'), 'unknown')
  }
})

test('schedule projection distinguishes complete empty, complete non-empty, and every incomplete state', () => {
  assert.equal(state(project({ schedules: [] }), 'cleanupCron', 'schedule'), 'disabled')
  assert.equal(state(project({ schedules: ['0 3 * * *'] }), 'cleanupCron', 'schedule'), 'enabled')
  for (const scheduleState of ['missing', 'partial', 'unavailable', 'malformed', 'contradictory']) {
    assert.equal(state(project({ scheduleState }), 'cleanupCron', 'schedule'), 'unknown')
  }
  assert.equal(state(project({ includeSchedule: false }), 'cleanupCron', 'schedule'), 'unknown')
})

test('Pages, Worker, schedule, and unrelated resource families cannot contaminate one another', () => {
  const pageOnly = project({
    pagesVariables: variables(PAGE_VARIABLES, 'enabled'),
    includeWorker: false,
    includeSchedule: false,
  })
  assert.equal(state(pageOnly, 'leaderboardRead', 'frontend'), 'enabled')
  assert.equal(state(pageOnly, 'leaderboardRead', 'pages'), 'enabled')
  assert.equal(state(pageOnly, 'identityClaim', 'worker'), 'unknown')
  assert.equal(state(pageOnly, 'cleanupCron', 'schedule'), 'unknown')

  const workerOnly = project({
    includePages: false,
    workerBindings: bindings(WORKER_VARIABLES, 'enabled'),
    includeSchedule: false,
  })
  assert.equal(state(workerOnly, 'identityClaim', 'worker'), 'enabled')
  assert.equal(state(workerOnly, 'identityClaim', 'frontend'), 'unknown')
  assert.equal(state(workerOnly, 'identityClaim', 'pages'), 'unknown')

  const scheduleOnly = project({ includePages: false, includeWorker: false, schedules: ['0 3 * * *'] })
  assert.equal(state(scheduleOnly, 'cleanupCron', 'schedule'), 'enabled')
  assert.equal(state(scheduleOnly, 'cleanupCron', 'worker'), 'unknown')
  assert.equal(state(scheduleOnly, 'draftSubmission', 'pages'), 'unknown')

  const irrelevantExistence = project({
    includePages: false,
    includeWorker: false,
    includeSchedule: false,
    extraOutcomes: [
      outcome('pages-preview-deployments', 'complete', placeholder()),
      outcome('worker-deployments', 'complete', placeholder()),
      outcome('worker-routes', 'complete', placeholder()),
      outcome('worker-custom-domains', 'complete', placeholder()),
      outcome('d1-database', 'complete', placeholder()),
      outcome('migration-table-discovery', 'complete', placeholder()),
    ],
  })
  for (const capability of SCHEMA4_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_CAPABILITY_SURFACES[capability]) {
      assert.equal(state(irrelevantExistence, capability, surface), 'unknown')
    }
  }
})

test('authority fields are permanent and comparison, readiness, permission, and mutation vocabulary is rejected', () => {
  const projection = project()
  assert.equal(projection.releaseCurrentness, 'UNKNOWN')
  assert.equal(projection.executionAuthorization, 'prohibited')
  assert.equal(projection.noRemoteMutation, true)
  assert.equal(projection.productionContacted, false)
  for (const [field, value] of [
    ['releaseCurrentness', 'CURRENT'],
    ['executionAuthorization', 'approved'],
    ['noRemoteMutation', false],
    ['productionContacted', true],
    ['comparison', 'MATCH'],
    ['drift', 'DRIFT'],
    ['readiness', 'ready'],
    ['approval', true],
    ['noOp', true],
    ['permission', 'deploy'],
    ['mutationPlan', []],
    ['execution', {}],
  ]) {
    const candidate = structuredClone(projection)
    candidate[field] = value
    assert.throws(() => validatePreviewCapabilityProjection(candidate), /projection refused/i, field)
  }
})

test('projection is deterministic, deeply frozen, canonical, bounded, and order-insensitive', () => {
  const first = project({
    pagesVariables: variables(PAGE_VARIABLES, 'enabled'),
    workerBindings: bindings(WORKER_VARIABLES, 'enabled'),
    schedules: ['0 3 * * *'],
  })
  const second = project({
    pagesVariables: [...variables(PAGE_VARIABLES, 'enabled')].reverse(),
    workerBindings: [...bindings(WORKER_VARIABLES, 'enabled')].reverse(),
    schedules: ['0 3 * * *'],
  })
  assert.deepEqual(first, second)
  assert.equal(canonicalJson(first), canonicalJson(second))
  assertDeepFrozen(first)
  assert.deepEqual(validatePreviewCapabilityProjection(first), first)
  const rendered = renderPreviewCapabilityProjection(first)
  assert.equal(rendered, `${canonicalJson(first)}\n`)
  assert.equal(rendered.endsWith('\n'), true)
  assert.equal(new TextEncoder().encode(rendered).byteLength <= PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES, true)
})

test('unvalidated, hostile, dangerous-key, and oversized projection inputs fail closed', () => {
  const unvalidated = structuredClone(snapshot())
  assert.throws(() => createPreviewCapabilityProjection(unvalidated), /opaque validated/i)
  assert.throws(() => createPreviewCapabilityProjection(new Proxy({}, {})), /opaque validated/i)
  const dangerous = JSON.parse('{"__proto__":{"approval":true}}')
  assert.throws(() => validatePreviewCapabilityProjection(dangerous), /projection refused/i)
  const accessor = {}
  Object.defineProperty(accessor, 'kind', { enumerable: true, get() { throw new Error('must not run') } })
  assert.throws(() => validatePreviewCapabilityProjection(accessor), /projection refused/i)
  const oversized = structuredClone(project())
  oversized.capabilities.leaderboardRead.surfaces.pages.extra = 'x'.repeat(
    PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES,
  )
  assert.throws(() => validatePreviewCapabilityProjection(oversized), /byte limit/i)
})

test('projection authority rejects every structural, copied, inherited, and hostile reconstruction before property access', () => {
  const valid = snapshot()
  const structural = structuredClone(valid)
  const serialized = JSON.parse(JSON.stringify(valid))
  const inherited = Object.create(valid)
  const copiedOwnProperties = Object.defineProperties({}, Object.getOwnPropertyDescriptors(valid))
  for (const symbol of Object.getOwnPropertySymbols(valid)) {
    Object.defineProperty(copiedOwnProperties, symbol, Object.getOwnPropertyDescriptor(valid, symbol))
  }
  const prototypeManipulated = structuredClone(valid)
  Object.setPrototypeOf(prototypeManipulated, null)
  const copiedSymbol = structuredClone(valid)
  Object.defineProperty(copiedSymbol, Symbol('forged-authority'), { value: true })

  for (const candidate of [
    {},
    structural,
    serialized,
    inherited,
    copiedOwnProperties,
    prototypeManipulated,
    copiedSymbol,
  ]) {
    assert.throws(() => createPreviewCapabilityProjection(candidate), /opaque validated/i)
  }

  let getterReads = 0
  const getterBearing = {}
  Object.defineProperty(getterBearing, 'resourceOutcomes', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('hostile getter ran') },
  })
  assert.throws(() => createPreviewCapabilityProjection(getterBearing), /opaque validated/i)
  assert.equal(getterReads, 0)

  let proxyTraps = 0
  const hostileProxy = new Proxy({}, {
    get() { proxyTraps += 1; throw new Error('hostile get trap ran') },
    getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('hostile descriptor trap ran') },
    getPrototypeOf() { proxyTraps += 1; throw new Error('hostile prototype trap ran') },
    ownKeys() { proxyTraps += 1; throw new Error('hostile ownKeys trap ran') },
  })
  assert.throws(() => createPreviewCapabilityProjection(hostileProxy), /opaque validated/i)
  assert.equal(proxyTraps, 0)
})

test('authority creation is inseparable from validation, exposes no registration primitive, and fails closed across module instances', async () => {
  const authorityPath = path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-capability-projection-authority.mjs',
  )
  const authority = await import(pathToFileURL(authorityPath))
  const exportNames = Object.keys(authority).sort()
  assert.deepEqual(exportNames, [
    'PREVIEW_RESOURCE_OUTCOME_STATES',
    'PREVIEW_SINGLE_READ_KIND',
    'PREVIEW_SINGLE_READ_SCHEMA_VERSION',
    'createAndAuthorizePreviewSingleReadSnapshot',
    'resolveValidatedPreviewCapabilityProjectionInput',
    'validateAndAuthorizePreviewSingleReadSnapshot',
  ])
  assert.equal(exportNames.some((name) => /register|marker|symbol|token|weakmap/iu.test(name)), false)

  let getterReads = 0
  const hostile = {}
  Object.defineProperty(hostile, 'capturedAtMs', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('hostile getter ran') },
  })
  for (const name of exportNames) {
    if (typeof authority[name] !== 'function') continue
    assert.throws(() => authority[name](hostile), /refused/i, name)
    assert.equal(getterReads, 0, name)
  }

  const valid = snapshot()
  const duplicateAuthority = await import(`${pathToFileURL(authorityPath).href}?duplicate-authority=1`)
  const foreign = duplicateAuthority.validateAndAuthorizePreviewSingleReadSnapshot(
    structuredClone(valid),
  )
  assert.throws(() => createPreviewCapabilityProjection(foreign), /opaque validated/i)

  const duplicateProjection = await import(
    `${pathToFileURL(path.join(ROOT, 'scripts/lib/release-inspection/preview-capability-projection.mjs')).href}?duplicate-projection=1`
  )
  assert.deepEqual(duplicateProjection.createPreviewCapabilityProjection(valid), project())
})

test('every public projection export is explicit and no callable reads hostile data before rejection', async () => {
  const runtime = await import(pathToFileURL(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-capability-projection.mjs',
  )))
  assert.deepEqual(Object.keys(runtime).sort(), [
    'PREVIEW_CANDIDATE_GATE_MODES',
    'PREVIEW_CANDIDATE_STATES',
    'PREVIEW_CAPABILITY_PROJECTION_KIND',
    'PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES',
    'PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION',
    'createPreviewCapabilityProjection',
    'renderPreviewCapabilityProjection',
    'validatePreviewCapabilityProjection',
  ])
  let getterReads = 0
  const hostile = {}
  Object.defineProperty(hostile, 'capabilities', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('hostile getter ran') },
  })
  for (const value of Object.values(runtime)) {
    if (typeof value !== 'function') continue
    assert.throws(() => value(hostile), /refused/i)
    assert.equal(getterReads, 0)
  }
})

test('validated authority is frozen, mutation-isolated, and remains valid only by identity', () => {
  const raw = structuredClone(snapshot())
  const validated = createPreviewSingleReadSnapshot({
    capturedAtMs: raw.capturedAtMs,
    resourceOutcomes: raw.resourceOutcomes,
  })
  const before = createPreviewCapabilityProjection(validated)
  raw.capturedAtMs += 1
  raw.resourceOutcomes.length = 0
  assert.deepEqual(createPreviewCapabilityProjection(validated), before)
  assert.throws(() => { validated.resourceOutcomes.length = 0 }, TypeError)
  assert.throws(() => { validated.capturedAtMs += 1 }, TypeError)
  assertDeepFrozen(validated)
})

function localModuleGraph(entry) {
  const visited = new Map()
  const visit = (filePath) => {
    const resolved = path.resolve(filePath)
    if (visited.has(resolved)) return
    const source = readFileSync(resolved, 'utf8')
    visited.set(resolved, source)
    for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu)) {
      if (!match[1].startsWith('.')) continue
      visit(path.resolve(path.dirname(resolved), match[1]))
    }
  }
  visit(entry)
  return visited
}

function exportNames(source) {
  return [...source.matchAll(/export\s+(?:const|function|type|interface)\s+([A-Za-z0-9_]+)/gu)]
    .map((match) => match[1])
    .sort()
}

test('pure projection source graph has no transport, network, credential, filesystem, or execution path', () => {
  const graph = localModuleGraph(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-capability-projection.mjs',
  ))
  const graphSource = [...graph.values()].join('\n')
  for (const forbidden of [
    'node:fs',
    'node:child_process',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'remote-transport',
    'preview-http-transport',
    'preview-resource-observer',
    'fetch(',
    'credential',
    'wrangler deploy',
    'release-execution',
    'preview-plan',
    'reporting.mjs',
    'artifacts.mjs',
    'rollback',
    'writeFile',
    'appendFile',
  ]) assert.equal(graphSource.includes(forbidden), false, forbidden)
})

test('runtime and declaration exports remain in exact parity', () => {
  const runtime = readFileSync(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-capability-projection.mjs',
  ), 'utf8')
  const declaration = readFileSync(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-capability-projection.d.mts',
  ), 'utf8')
  assert.deepEqual(exportNames(runtime), exportNames(declaration).filter((name) => ![
    'PreviewCandidateState',
    'PreviewCandidateSurface',
    'PreviewCandidateSurfaceRecord',
    'PreviewCapabilityCandidateProjection',
  ].includes(name)))
})
