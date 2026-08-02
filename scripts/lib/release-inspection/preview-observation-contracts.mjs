import { types as utilTypes } from 'node:util'
import {
  canonicalJson,
  immutablePlain,
} from '../preview-release/canonical.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import {
  assertSerializedObservationBudget,
  PREVIEW_OPERATION_NAMES,
  REMOTE_OBSERVATION_LIMITS,
} from './remote-transport.mjs'

const isProxy = utilTypes.isProxy

export const PREVIEW_SINGLE_READ_SCHEMA_VERSION = 1
export const PREVIEW_SINGLE_READ_KIND = 'pennant-pursuit-preview-single-read-observation'
export const PREVIEW_RESOURCE_OUTCOME_STATES = Object.freeze([
  'complete',
  'missing',
  'unavailable',
  'partial',
  'malformed',
  'contradictory',
])

const OUTCOME_STATES = new Set(PREVIEW_RESOURCE_OUTCOME_STATES)
const OPERATIONS = new Set(PREVIEW_OPERATION_NAMES)
const OPERATION_ORDER = new Map(PREVIEW_OPERATION_NAMES.map((operation, index) => [operation, index]))
const bufferByteLength = Buffer.byteLength
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const OUTCOME_KEYS = Object.freeze(['capturedAtMs', 'issueCode', 'operation', 'state', 'value'])
const VALUE_KEYS = Object.freeze(['kind', 'schemaVersion'])
const VALUE_KIND = 'preview-resource-observation-placeholder'
const ISSUE_CODE_BY_STATE = Object.freeze({
  complete: null,
  missing: 'resource-missing',
  unavailable: 'resource-unavailable',
  partial: 'resource-partial',
  malformed: 'resource-malformed',
  contradictory: 'resource-contradictory',
})
const VALUE_STATES = new Set(['complete', 'partial', 'contradictory'])
const SNAPSHOT_KEYS = Object.freeze([
  'capturedAtMs',
  'environment',
  'executionAuthorization',
  'freshnessStatus',
  'kind',
  'noRemoteMutation',
  'noSecretValues',
  'observationState',
  'productionContacted',
  'releaseCurrentness',
  'resourceOutcomes',
  'schemaVersion',
])

function fail(reason) {
  throw new TypeError(`Preview single-read contract refused: ${reason}`)
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return false
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length
    && keys.every((key) => typeof key === 'string' && expected.includes(key))
}

function safeTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function assertCanonicalBudget(input) {
  const maximum = REMOTE_OBSERVATION_LIMITS.maximumSerializedObservationBytes
  let total = 0
  const seen = new Set()
  const add = (bytes) => {
    total += bytes
    if (total > maximum) fail('serialized snapshot exceeds the approved byte limit.')
  }
  const visit = (value, depth = 0) => {
    if (depth > 128) fail('snapshot exceeds the supported nesting depth.')
    if (value === null) { add(4); return }
    if (typeof value === 'boolean') { add(value ? 4 : 5); return }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('snapshot contains a non-finite number.')
      add(bufferByteLength(JSON.stringify(value), 'utf8'))
      return
    }
    if (typeof value === 'string') {
      add(bufferByteLength(JSON.stringify(value), 'utf8'))
      return
    }
    if (!value || typeof value !== 'object' || isProxy(value) || seen.has(value)) {
      fail('snapshot must be acyclic, non-proxy JSON-compatible data.')
    }
    seen.add(value)
    if (Array.isArray(value)) {
      if (Reflect.getPrototypeOf(value) !== Array.prototype) fail('snapshot arrays must be ordinary.')
      const keys = Reflect.ownKeys(value)
      if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') {
        fail('snapshot arrays must be dense and contain no extra keys.')
      }
      add(2 + Math.max(0, value.length - 1))
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set
          || descriptor.enumerable !== true) {
          fail('snapshot arrays must contain enumerable data values only.')
        }
        visit(descriptor.value, depth + 1)
      }
      seen.delete(value)
      return
    }
    if (Reflect.getPrototypeOf(value) !== Object.prototype) fail('snapshot objects must be ordinary.')
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string' || DANGEROUS_KEYS.has(key))) {
      fail('snapshot object contains an unsupported key.')
    }
    add(2 + Math.max(0, keys.length - 1))
    for (const key of [...keys].sort()) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set
        || descriptor.enumerable !== true) {
        fail('snapshot objects must contain enumerable data values only.')
      }
      add(bufferByteLength(JSON.stringify(key), 'utf8') + 1)
      visit(descriptor.value, depth + 1)
    }
    seen.delete(value)
  }
  visit(input)
  return total
}

function validateNormalizedValue(input) {
  if (!exactKeys(input, VALUE_KEYS)) {
    fail('resource values must use the closed Preview placeholder schema.')
  }
  let value
  try {
    value = immutablePlain(input)
  } catch {
    fail('resource values must be plain, accessor-free data.')
  }
  if (value.kind !== VALUE_KIND || value.schemaVersion !== 1) {
    fail('resource value kind or schema version is unsupported.')
  }
  return value
}

function validateOutcome(input) {
  if (!exactKeys(input, OUTCOME_KEYS)) fail('resource outcomes must use the exact closed field inventory.')
  let outcome
  try {
    outcome = immutablePlain(input)
  } catch {
    fail('resource outcomes must be plain, accessor-free data.')
  }
  if (!OPERATIONS.has(outcome.operation)
    || !OUTCOME_STATES.has(outcome.state)
    || !safeTimestamp(outcome.capturedAtMs)) {
    fail('resource outcome operation, state, or timestamp is unsupported.')
  }
  if (outcome.issueCode !== ISSUE_CODE_BY_STATE[outcome.state]) {
    fail('resource outcome issue code contradicts its state.')
  }
  const value = outcome.value === null ? null : validateNormalizedValue(outcome.value)
  if (VALUE_STATES.has(outcome.state) !== (value !== null)) {
    fail(`${outcome.state} resource outcome has contradictory value semantics.`)
  }
  return immutablePlain({ ...outcome, value })
}

function aggregateState(outcomes) {
  if (outcomes.length === 0) return 'unavailable'
  for (const state of ['contradictory', 'malformed', 'partial', 'unavailable', 'missing']) {
    if (outcomes.some((outcome) => outcome.state === state)) return state
  }
  return 'complete'
}

export function validatePreviewSingleReadSnapshot(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  assertCanonicalBudget(input)
  if (!exactKeys(input, SNAPSHOT_KEYS)) fail('snapshot must use the exact closed field inventory.')
  let snapshot
  try {
    snapshot = immutablePlain(input)
  } catch {
    fail('snapshot must be plain, accessor-free JSON-compatible data.')
  }
  if (snapshot.schemaVersion !== PREVIEW_SINGLE_READ_SCHEMA_VERSION
    || snapshot.kind !== PREVIEW_SINGLE_READ_KIND
    || snapshot.environment !== 'preview'
    || snapshot.releaseCurrentness !== 'UNKNOWN'
    || snapshot.executionAuthorization !== 'prohibited'
    || snapshot.noRemoteMutation !== true
    || snapshot.noSecretValues !== true
    || snapshot.productionContacted !== false
    || snapshot.freshnessStatus !== 'unknown'
    || !safeTimestamp(snapshot.capturedAtMs)
    || !OUTCOME_STATES.has(snapshot.observationState)
    || !Array.isArray(snapshot.resourceOutcomes)) {
    fail('snapshot identity, boundary invariants, timestamp, or outcome state is unsupported.')
  }
  const outcomes = snapshot.resourceOutcomes.map(validateOutcome)
  const seen = new Set()
  for (const outcome of outcomes) {
    if (seen.has(outcome.operation)) fail('snapshot contains a duplicate operation outcome.')
    if (outcome.capturedAtMs > snapshot.capturedAtMs) {
      fail('resource outcome timestamp is later than the snapshot timestamp.')
    }
    seen.add(outcome.operation)
  }
  outcomes.sort((left, right) => OPERATION_ORDER.get(left.operation) - OPERATION_ORDER.get(right.operation))
  if (snapshot.observationState !== aggregateState(outcomes)) {
    fail('snapshot observation state contradicts its resource outcomes.')
  }
  return immutablePlain({ ...snapshot, resourceOutcomes: outcomes })
}

export function createPreviewSingleReadSnapshot(input = {}) {
  assertReleaseInspectionIntrinsicIntegrity()
  assertCanonicalBudget(input)
  if (!exactKeys(input, ['capturedAtMs', 'resourceOutcomes'])
    && !exactKeys(input, ['capturedAtMs'])) {
    fail('snapshot input must use only capturedAtMs and optional resourceOutcomes fields.')
  }
  let snapshotInput
  try {
    snapshotInput = immutablePlain(input)
  } catch {
    fail('snapshot input must be plain, accessor-free data.')
  }
  const { capturedAtMs, resourceOutcomes = [] } = snapshotInput
  if (!Array.isArray(resourceOutcomes)) fail('resource outcomes must be an array.')
  const outcomes = resourceOutcomes.map(validateOutcome)
  return validatePreviewSingleReadSnapshot({
    schemaVersion: PREVIEW_SINGLE_READ_SCHEMA_VERSION,
    kind: PREVIEW_SINGLE_READ_KIND,
    environment: 'preview',
    capturedAtMs,
    observationState: aggregateState(outcomes),
    resourceOutcomes: outcomes,
    freshnessStatus: 'unknown',
    releaseCurrentness: 'UNKNOWN',
    executionAuthorization: 'prohibited',
    noRemoteMutation: true,
    noSecretValues: true,
    productionContacted: false,
  })
}

export function renderPreviewSingleReadJson(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  const serialized = `${canonicalJson(validatePreviewSingleReadSnapshot(input))}\n`
  return assertSerializedObservationBudget(serialized)
}
