import { TextEncoder, types as utilTypes } from 'node:util'
import { canonicalJson, immutablePlain } from '../preview-release/canonical-data.mjs'
import {
  SCHEMA4_CAPABILITIES,
  SCHEMA4_RUNTIME_GATE_REGISTRY,
} from '../../../shared/schema4-capabilities.mjs'
import {
  RELEASE_INSPECTION_CAPABILITY_SURFACES,
  RELEASE_INSPECTION_SURFACES,
} from './capability-model.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import { resolveValidatedPreviewCapabilityProjectionInput } from './preview-capability-projection-authority.mjs'

export const PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION = 1
export const PREVIEW_CAPABILITY_PROJECTION_KIND =
  'pennant-pursuit-preview-capability-candidate-projection'
export const PREVIEW_CANDIDATE_GATE_MODES = Object.freeze(['disabled', 'enabled'])
export const PREVIEW_CANDIDATE_STATES = Object.freeze(['disabled', 'enabled', 'unknown'])
export const PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES = 16_384

const GATE_MODES = new Set(PREVIEW_CANDIDATE_GATE_MODES)
const CANDIDATE_STATES = new Set(PREVIEW_CANDIDATE_STATES)
const isProxy = utilTypes.isProxy
const textEncoder = new TextEncoder()
const TOP_LEVEL_KEYS = Object.freeze([
  'capabilities',
  'capabilityInventory',
  'environment',
  'executionAuthorization',
  'kind',
  'noRemoteMutation',
  'productionContacted',
  'releaseCurrentness',
  'schemaVersion',
  'sourceCapturedAtMs',
  'surfaceInventory',
])

function fail(reason) {
  throw new TypeError(`Preview capability projection refused: ${reason}.`)
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function exactArray(value, expected) {
  return Array.isArray(value) && canonicalJson(value) === canonicalJson(expected)
}

function assertProjectionBudget(value) {
  const serialized = canonicalJson(value)
  if (textEncoder.encode(serialized).byteLength > PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES) {
    fail('canonical output exceeds the fixed byte limit')
  }
  return serialized
}

function assertBoundedProjectionInput(input) {
  let nodes = 0
  let bytes = 0
  const seen = new Set()
  const addText = (value) => {
    if (value.length > PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES) {
      fail('input exceeds the fixed byte limit')
    }
    bytes += textEncoder.encode(value).byteLength
    if (bytes > PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES) {
      fail('input exceeds the fixed byte limit')
    }
  }
  const visit = (value, depth = 0) => {
    nodes += 1
    if (nodes > 2_048 || depth > 32) fail('input exceeds the fixed structural limit')
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'string') { addText(value); return }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('input contains a non-finite number')
      return
    }
    if (!value || typeof value !== 'object' || isProxy(value) || seen.has(value)) {
      fail('input must be acyclic non-proxy JSON-compatible data')
    }
    seen.add(value)
    const keys = Reflect.ownKeys(value)
    if (keys.length > 1_024) fail('input exceeds the fixed structural limit')
    for (const key of keys) {
      if (typeof key !== 'string') fail('input contains a symbol key')
      addText(key)
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        fail('input contains an accessor')
      }
      visit(descriptor.value, depth + 1)
    }
    seen.delete(value)
  }
  visit(input)
}

function applicableSurfaceRecord(candidateState) {
  return { applicability: 'applicable', candidateState }
}

function notApplicableSurfaceRecord() {
  return { applicability: 'not-applicable', candidateState: 'not-applicable' }
}

function outcomeFor(snapshot, operation) {
  return snapshot.resourceOutcomes.find((outcome) => outcome.operation === operation) ?? null
}

function valueForGate(entries, variable) {
  const values = entries
    .filter((entry) => entry.name === variable)
    .map((entry) => entry.value)
  return values.length === 1 && GATE_MODES.has(values[0]) ? values[0] : null
}

function projectGate(outcome, entries, descriptor) {
  if (outcome === null || outcome.state !== 'complete' || descriptor === null
    || descriptor.variable === null) return 'unknown'
  const narrow = valueForGate(entries, descriptor.variable)
  if (narrow === null) return 'unknown'
  if (narrow === 'disabled') return 'disabled'
  if (descriptor.compatibilityCeiling === null) return 'enabled'
  const ceiling = valueForGate(entries, descriptor.compatibilityCeiling)
  if (ceiling === null) return 'unknown'
  return ceiling === 'enabled' ? 'enabled' : 'disabled'
}

function pagesEntries(outcome) {
  return outcome?.state === 'complete'
    && outcome.value.kind === 'preview-pages-project-observation'
    ? outcome.value.variables
    : []
}

function workerEntries(outcome) {
  return outcome?.state === 'complete'
    && outcome.value.kind === 'preview-worker-settings-observation'
    ? outcome.value.bindings.filter((binding) => binding.category === 'plain-text-gate')
    : []
}

function projectSchedule(outcome) {
  if (outcome === null || outcome.state !== 'complete'
    || outcome.value.kind !== 'preview-worker-schedules-observation') return 'unknown'
  return outcome.value.schedules.length === 0 ? 'disabled' : 'enabled'
}

function projectCapabilities(snapshot) {
  const pagesOutcome = outcomeFor(snapshot, 'pages-project')
  const workerOutcome = outcomeFor(snapshot, 'worker-settings')
  const scheduleOutcome = outcomeFor(snapshot, 'worker-schedules')
  const pageGateEntries = pagesEntries(pagesOutcome)
  const workerGateEntries = workerEntries(workerOutcome)
  const capabilities = {}

  for (const capability of SCHEMA4_CAPABILITIES) {
    const applicable = new Set(RELEASE_INSPECTION_CAPABILITY_SURFACES[capability])
    const descriptors = SCHEMA4_RUNTIME_GATE_REGISTRY.capabilities[capability]
    const surfaces = {}
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      if (!applicable.has(surface)) {
        surfaces[surface] = notApplicableSurfaceRecord()
      } else if (surface === 'schedule') {
        surfaces[surface] = applicableSurfaceRecord(projectSchedule(scheduleOutcome))
      } else if (surface === 'worker') {
        surfaces[surface] = applicableSurfaceRecord(projectGate(
          workerOutcome,
          workerGateEntries,
          descriptors.privateWorker,
        ))
      } else {
        // Frontend build input and Pages Functions are distinct surfaces, but
        // both are independently projected from the normalized Preview Pages
        // variable inventory. Neither inherits state from the other.
        surfaces[surface] = applicableSurfaceRecord(projectGate(
          pagesOutcome,
          pageGateEntries,
          descriptors.pagesFunctions,
        ))
      }
    }
    capabilities[capability] = { surfaces }
  }
  return capabilities
}

export function validatePreviewCapabilityProjection(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  assertBoundedProjectionInput(input)
  let projection
  try {
    projection = immutablePlain(input)
  } catch {
    fail('projection must be ordinary, accessor-free, acyclic JSON-compatible data')
  }
  if (!exactKeys(projection, TOP_LEVEL_KEYS)
    || projection.schemaVersion !== PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION
    || projection.kind !== PREVIEW_CAPABILITY_PROJECTION_KIND
    || projection.environment !== 'preview'
    || projection.releaseCurrentness !== 'UNKNOWN'
    || projection.executionAuthorization !== 'prohibited'
    || projection.noRemoteMutation !== true
    || projection.productionContacted !== false
    || !Number.isSafeInteger(projection.sourceCapturedAtMs)
    || projection.sourceCapturedAtMs < 0
    || !exactArray(projection.capabilityInventory, SCHEMA4_CAPABILITIES)
    || !exactArray(projection.surfaceInventory, RELEASE_INSPECTION_SURFACES)
    || !exactKeys(projection.capabilities, SCHEMA4_CAPABILITIES)) {
    fail('top-level identity, inventory, or permanent authority boundary is invalid')
  }
  for (const capability of SCHEMA4_CAPABILITIES) {
    const record = projection.capabilities[capability]
    if (!exactKeys(record, ['surfaces'])
      || !exactKeys(record.surfaces, RELEASE_INSPECTION_SURFACES)) {
      fail(`${capability} does not contain the exact surface inventory`)
    }
    const applicable = new Set(RELEASE_INSPECTION_CAPABILITY_SURFACES[capability])
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const surfaceRecord = record.surfaces[surface]
      if (!exactKeys(surfaceRecord, ['applicability', 'candidateState'])) {
        fail(`${capability}.${surface} is not a closed surface record`)
      }
      if (applicable.has(surface)) {
        if (surfaceRecord.applicability !== 'applicable'
          || !CANDIDATE_STATES.has(surfaceRecord.candidateState)) {
          fail(`${capability}.${surface} has invalid applicable-state semantics`)
        }
      } else if (surfaceRecord.applicability !== 'not-applicable'
        || surfaceRecord.candidateState !== 'not-applicable') {
        fail(`${capability}.${surface} must use the exact non-applicable representation`)
      }
    }
  }
  assertProjectionBudget(projection)
  return projection
}

export function createPreviewCapabilityProjection(validatedInput) {
  assertReleaseInspectionIntrinsicIntegrity()
  const snapshot = resolveValidatedPreviewCapabilityProjectionInput(validatedInput)
  return validatePreviewCapabilityProjection({
    schemaVersion: PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION,
    kind: PREVIEW_CAPABILITY_PROJECTION_KIND,
    environment: 'preview',
    sourceCapturedAtMs: snapshot.capturedAtMs,
    capabilityInventory: SCHEMA4_CAPABILITIES,
    surfaceInventory: RELEASE_INSPECTION_SURFACES,
    capabilities: projectCapabilities(snapshot),
    releaseCurrentness: 'UNKNOWN',
    executionAuthorization: 'prohibited',
    noRemoteMutation: true,
    productionContacted: false,
  })
}

export function renderPreviewCapabilityProjection(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  const serialized = `${assertProjectionBudget(validatePreviewCapabilityProjection(input))}\n`
  if (textEncoder.encode(serialized).byteLength > PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES) {
    fail('canonical output exceeds the fixed byte limit')
  }
  return serialized
}
