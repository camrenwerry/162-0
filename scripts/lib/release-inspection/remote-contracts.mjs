import {
  canonicalHash,
  canonicalJson,
  immutablePlain,
  parseStrictJson,
} from '../preview-release/canonical.mjs'
import { types as utilTypes } from 'node:util'
import {
  RELEASE_INSPECTION_CAPABILITIES,
  RELEASE_INSPECTION_MANIFEST_SOURCES,
  RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES,
  RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS,
  RELEASE_INSPECTION_SURFACES,
} from './contracts.mjs'
import {
  RELEASE_INSPECTION_KINDS,
  RELEASE_INSPECTION_REMOTE_TOOL_CONTRACT_VERSION,
} from './markers.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import {
  assertSerializedObservationBudget,
  PREVIEW_ENDPOINT_FAMILIES,
  PREVIEW_OPERATION_NAMES,
  PREVIEW_OPERATION_REGISTRY,
  REMOTE_OBSERVATION_LIMITS,
} from './remote-transport.mjs'

const isProxy = utilTypes.isProxy
const bufferByteLength = Buffer.byteLength
let intrinsicValidationDepth = 0

function assertCurrentIntrinsicIntegrity() {
  if (intrinsicValidationDepth === 0) assertReleaseInspectionIntrinsicIntegrity()
}

function withIntrinsicIntegrity(operation) {
  assertCurrentIntrinsicIntegrity()
  intrinsicValidationDepth += 1
  try {
    return operation()
  } finally {
    intrinsicValidationDepth -= 1
  }
}

export const REMOTE_OBSERVATION_SCHEMA_VERSION = 1
export const REMOTE_OBSERVATION_KIND = RELEASE_INSPECTION_KINDS.remoteObservation
export const REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION = RELEASE_INSPECTION_REMOTE_TOOL_CONTRACT_VERSION
export const REMOTE_OBSERVATION_COMPARISONS = Object.freeze([
  'MATCH',
  'DRIFT',
  'UNKNOWN',
  'UNAVAILABLE',
])
export const REMOTE_EVIDENCE_AVAILABILITY = Object.freeze([
  'available',
  'unavailable',
  'not-applicable',
])
export const REMOTE_EVIDENCE_COMPLETENESS = Object.freeze([
  'complete',
  'partial',
  'not-attempted',
  'not-applicable',
])
export const REMOTE_EVIDENCE_REASONS = Object.freeze([
  'observed-match',
  'observed-drift',
  'unknown-observation',
  'offline-observation-not-attempted',
  'identity-grounding-required',
  'secret-presence-contract-unavailable',
  'not-applicable',
  'partial-response',
  'unstable-double-read',
  'prerequisite-unavailable',
  'malformed-response',
  'pagination-incomplete',
  'request-budget-exhausted',
  'response-limit-exceeded',
  'freshness-expired',
])

export const REMOTE_RESOURCE_KEYS = Object.freeze([
  'account',
  'accountZones',
  'pagesProject',
  'pagesPreviewDeployments',
  'workerSettings',
  'workerDeployments',
  'workerPublicUrl',
  'workerSchedules',
  'workerCustomDomains',
  'workerRoutes',
  'd1Database',
  'secretPresence',
])

export const REMOTE_MIGRATION_KEYS = Object.freeze([
  'tableDiscovery',
  'migrationRows',
  'backendSchemaVersion',
  'appliedSourceHashes',
])

const EVIDENCE_KEYS = Object.freeze([
  'availability',
  'capturedAtMs',
  'comparison',
  'completeness',
  'endpointFamily',
  'expected',
  'httpMethod',
  'observed',
  'operation',
  'readOrdinals',
  'reason',
])
const COMPARISONS = new Set(REMOTE_OBSERVATION_COMPARISONS)
const AVAILABILITY = new Set(REMOTE_EVIDENCE_AVAILABILITY)
const COMPLETENESS = new Set(REMOTE_EVIDENCE_COMPLETENESS)
const REASONS = new Set(REMOTE_EVIDENCE_REASONS)
const UNAVAILABLE_REASONS = new Set([
  'offline-observation-not-attempted',
  'identity-grounding-required',
  'secret-presence-contract-unavailable',
  'prerequisite-unavailable',
])
const UNKNOWN_REASONS = new Set([
  'unknown-observation',
  'partial-response',
  'unstable-double-read',
  'malformed-response',
  'pagination-incomplete',
  'request-budget-exhausted',
  'response-limit-exceeded',
  'freshness-expired',
])
const OPERATIONS = new Set(PREVIEW_OPERATION_NAMES)
const ENDPOINT_FAMILIES = new Set(PREVIEW_ENDPOINT_FAMILIES)
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SENSITIVE_VALUE_TEXT_PATTERN = /(?:authorization\s*:|bearer\s+|\b(?:secret|token|password|private[-_ ]?key|api[-_ ]?key)\b|\bcf(?:ut|at|k)_[A-Za-z0-9_-]+)/iu
const VALUE_MAX_DEPTH = 16
const VALUE_MAX_NODES = 2_048
const VALUE_MAX_STRING_LENGTH = 4_096
const VALUE_MAX_BYTES = 64 * 1_024
const EXACT_TIME_INTEGER_FIELDS = new Set([
  'captureStartedAtMs', 'captureCompletedAtMs', 'expiresAtMs', 'firstReadCompletedAtMs',
  'secondReadStartedAtMs', 'secondReadCompletedAtMs', 'firstRead', 'secondRead',
])

const EXPECTED_CAPABILITY_SURFACES = immutablePlain({
  leaderboardRead: ['frontend', 'pages'],
  identityClaim: ['frontend', 'pages', 'worker'],
  identityStatus: ['frontend', 'pages', 'worker'],
  identityRename: ['frontend', 'pages', 'worker'],
  draftSubmission: ['frontend', 'pages', 'worker'],
  identityRecovery: ['frontend', 'pages', 'worker'],
  cleanupCron: ['worker', 'schedule'],
})
const RESOURCE_OPERATION = immutablePlain({
  account: 'account',
  accountZones: 'account-zones',
  pagesProject: 'pages-project',
  pagesPreviewDeployments: 'pages-preview-deployments',
  workerSettings: 'worker-settings',
  workerDeployments: 'worker-deployments',
  workerPublicUrl: 'worker-subdomain',
  workerSchedules: 'worker-schedules',
  workerCustomDomains: 'worker-custom-domains',
  workerRoutes: 'worker-routes',
  d1Database: 'd1-database',
})
const MIGRATION_OPERATION = immutablePlain({
  tableDiscovery: 'migration-table-discovery',
  migrationRows: 'migration-rows',
  backendSchemaVersion: 'backend-schema-version',
})
const CAPABILITY_SURFACE_OPERATION = immutablePlain({
  frontend: 'pages-project',
  pages: 'pages-project',
  worker: 'worker-settings',
  schedule: 'worker-schedules',
})
const SENSITIVE_KEY_CONCEPTS = Object.freeze([
  'authorization', 'accesstoken', 'apitoken', 'clientsecret', 'privatekey', 'signingkey',
  'credential', 'password', 'secret', 'token', 'keybase64', 'keyjwk', 'payload', 'digest',
  'preview', 'content', 'response', 'cookie', 'value', 'text', 'raw', 'body', 'data', 'auth', 'key',
])

function fail(message) {
  throw new TypeError(`Remote observation contract refused: ${message}`)
}

function snapshotPlain(value, label) {
  assertCurrentIntrinsicIntegrity()
  try {
    return immutablePlain(value)
  } catch {
    fail(`${label} must be deeply plain, accessor-free JSON-compatible data.`)
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Reflect.ownKeys(value)
  return actual.every((key) => typeof key === 'string')
    && actual.length === expected.length
    && expected.every((key) => actual.includes(key))
}

function validTimeMs(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function normalizedKeySkeleton(key, label) {
  const normalized = key.normalize('NFKC').toLowerCase().normalize('NFKD')
  const withoutMarks = normalized.replace(/\p{M}+/gu, '')
  if (/[^\x00-\x7F]/u.test(withoutMarks)) fail(`${label} contains a non-ASCII or mixed-script field name.`)
  return withoutMarks.replace(/[\p{P}\p{S}\p{Z}\s_]+/gu, '')
}

function hasSensitiveKeyConcept(key, label) {
  const skeleton = normalizedKeySkeleton(key, label)
  for (const concept of SENSITIVE_KEY_CONCEPTS) {
    if (skeleton.includes(concept)) return true
  }
  return false
}

function assertSafeEvidenceValue(value, label) {
  assertCurrentIntrinsicIntegrity()
  let nodes = 0
  const seen = new Set()
  const visit = (entry, depth) => {
    nodes += 1
    if (nodes > VALUE_MAX_NODES || depth > VALUE_MAX_DEPTH) fail(`${label} exceeds the safe evidence-value bound.`)
    if (entry === null || typeof entry === 'boolean') return
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) fail(`${label} contains a non-finite number.`)
      return
    }
    if (typeof entry === 'string') {
      if (entry.length > VALUE_MAX_STRING_LENGTH || /[\u0000-\u001F\u007F]/u.test(entry)
        || SENSITIVE_VALUE_TEXT_PATTERN.test(entry)) {
        fail(`${label} contains unsafe or potentially secret-bearing text.`)
      }
      return
    }
    if (!entry || typeof entry !== 'object' || isProxy(entry) || seen.has(entry)) {
      fail(`${label} contains an unsupported, proxied, or cyclic value.`)
    }
    seen.add(entry)
    const isArray = Array.isArray(entry)
    const prototype = Reflect.getPrototypeOf(entry)
    if (isArray) {
      if (prototype !== Array.prototype) fail(`${label} contains an exotic array.`)
    } else if (prototype !== Object.prototype) fail(`${label} contains an exotic object.`)
    const keys = Reflect.ownKeys(entry)
    for (const key of keys) {
      if (typeof key !== 'string') fail(`${label} contains a symbol field.`)
      if (!isArray && hasSensitiveKeyConcept(key, label)) {
        fail(`${label} contains a prohibited secret-bearing field.`)
      }
      if (isArray && key === 'length') continue
      const descriptor = Reflect.getOwnPropertyDescriptor(entry, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set
        || descriptor.enumerable !== true) fail(`${label} contains a non-data field.`)
      visit(descriptor.value, depth + 1)
    }
    seen.delete(entry)
    if (!isArray) {
      fail(`${label} is not an approved closed evidence-value shape.`)
    }
    if (keys.length !== entry.length + 1) {
      fail(`${label} contains a sparse or named array field.`)
    }
    for (let index = 0; index < entry.length; index += 1) {
      if (keys[index] !== String(index)) fail(`${label} contains a sparse or named array field.`)
    }
  }
  visit(value, 0)
  if (bufferByteLength(canonicalJson(value), 'utf8') > VALUE_MAX_BYTES) {
    fail(`${label} exceeds the safe serialized evidence-value bound.`)
  }
}

function assertEvidenceFieldsBeforeSnapshot(input, label) {
  assertCurrentIntrinsicIntegrity()
  if (!input || typeof input !== 'object' || isProxy(input)) return
  const seen = new Set()
  const visit = (entry, depth) => {
    if (!entry || typeof entry !== 'object' || isProxy(entry) || seen.has(entry) || depth > 64) {
      fail(`${label} contains an unsafe descriptor graph.`)
    }
    seen.add(entry)
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key !== 'string') fail(`${label} contains symbol keys.`)
      const descriptor = Reflect.getOwnPropertyDescriptor(entry, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        fail(`${label} contains accessors or descriptor failures.`)
      }
      if (key === 'expected' || key === 'observed') {
        assertSafeEvidenceValue(descriptor.value, `${label} evidence value`)
      } else if (descriptor.value && typeof descriptor.value === 'object') visit(descriptor.value, depth + 1)
    }
    seen.delete(entry)
  }
  visit(input, 0)
}

function exactDoubleRead(readOrdinals) {
  return Array.isArray(readOrdinals)
    && readOrdinals.length === 2
    && readOrdinals[0] === 1
    && readOrdinals[1] === 2
}

function validateRemoteEvidenceInternal(input) {
  assertEvidenceFieldsBeforeSnapshot(input, 'Remote evidence')
  const evidence = snapshotPlain(input, 'Remote evidence')
  if (!exactKeys(evidence, EVIDENCE_KEYS)
    || !AVAILABILITY.has(evidence.availability)
    || !COMPLETENESS.has(evidence.completeness)
    || !COMPARISONS.has(evidence.comparison)
    || !REASONS.has(evidence.reason)
    || !Array.isArray(evidence.readOrdinals)
    || evidence.readOrdinals.length > 2
    || evidence.readOrdinals.some((ordinal, index) => (
      ![1, 2].includes(ordinal) || (index > 0 && ordinal <= evidence.readOrdinals[index - 1])
    ))) {
    fail('evidence has missing keys, unknown keys, or an unsupported closed-vocabulary value.')
  }
  assertSafeEvidenceValue(evidence.expected, 'evidence.expected')
  assertSafeEvidenceValue(evidence.observed, 'evidence.observed')

  const noOperation = evidence.operation === 'not-applicable'
  if (!noOperation && !OPERATIONS.has(evidence.operation)) fail('evidence operation is not allowlisted.')
  if (noOperation) {
    if (evidence.endpointFamily !== 'not-applicable' || evidence.httpMethod !== 'not-applicable') {
      fail('not-attempted evidence must not claim an endpoint family or HTTP method.')
    }
  } else {
    const definition = PREVIEW_OPERATION_REGISTRY[evidence.operation]
    if (!ENDPOINT_FAMILIES.has(evidence.endpointFamily)
      || evidence.endpointFamily !== definition.endpointFamily
      || evidence.httpMethod !== definition.method) {
      fail('evidence endpoint family or HTTP method contradicts the closed operation registry.')
    }
  }
  if (!exactKeys(evidence.capturedAtMs, ['firstRead', 'secondRead'])) {
    fail('evidence capturedAtMs must use the exact two-read timestamp shape.')
  }
  const hasFirstCapture = validTimeMs(evidence.capturedAtMs.firstRead)
  const hasSecondCapture = validTimeMs(evidence.capturedAtMs.secondRead)
  const hasCapture = hasFirstCapture || hasSecondCapture
  if (hasFirstCapture !== evidence.readOrdinals.includes(1)
    || hasSecondCapture !== evidence.readOrdinals.includes(2)) {
    fail('evidence read ordinals and capturedAtMs values contradict each other.')
  }

  if (evidence.availability === 'not-applicable') {
    if (evidence.completeness !== 'not-applicable'
      || evidence.comparison !== 'UNAVAILABLE'
      || evidence.expected !== null
      || evidence.observed !== null
      || evidence.reason !== 'not-applicable'
      || !noOperation
      || hasCapture) fail('not-applicable evidence semantics are contradictory.')
    return evidence
  }

  if (evidence.availability === 'unavailable') {
    if (!['partial', 'not-attempted'].includes(evidence.completeness)
      || !['UNKNOWN', 'UNAVAILABLE'].includes(evidence.comparison)
      || evidence.observed !== null) fail('unavailable evidence semantics are contradictory.')
    if (evidence.completeness === 'not-attempted') {
      if (evidence.comparison !== 'UNAVAILABLE' || !noOperation || hasCapture
        || !UNAVAILABLE_REASONS.has(evidence.reason)) {
        fail('not-attempted evidence must be unavailable and must not claim an operation or capture.')
      }
    } else if (evidence.comparison !== 'UNKNOWN' || noOperation || !hasCapture
      || !UNKNOWN_REASONS.has(evidence.reason)) {
      fail('partial unavailable evidence must be an attempted UNKNOWN observation.')
    }
    return evidence
  }

  if (!['complete', 'partial'].includes(evidence.completeness)
    || noOperation
    || !hasCapture
    || evidence.observed === null
    || !['MATCH', 'DRIFT', 'UNKNOWN'].includes(evidence.comparison)) {
    fail('available evidence semantics are contradictory.')
  }
  if (evidence.completeness === 'partial' && evidence.comparison !== 'UNKNOWN') {
    fail('partial evidence cannot claim MATCH or DRIFT.')
  }
  if (evidence.completeness === 'complete' && !exactDoubleRead(evidence.readOrdinals)) {
    fail('complete online evidence requires exact read ordinals [1, 2].')
  }
  if (evidence.comparison === 'MATCH') {
    if (evidence.completeness !== 'complete'
      || evidence.reason !== 'observed-match'
      || canonicalJson(evidence.expected) !== canonicalJson(evidence.observed)) {
      fail('MATCH requires complete equal expected and observed values.')
    }
  }
  if (evidence.comparison === 'DRIFT') {
    if (evidence.completeness !== 'complete'
      || evidence.reason !== 'observed-drift'
      || canonicalJson(evidence.expected) === canonicalJson(evidence.observed)) {
      fail('DRIFT requires complete unequal expected and observed values.')
    }
  }
  if (evidence.comparison === 'UNKNOWN' && !UNKNOWN_REASONS.has(evidence.reason)) {
    fail('UNKNOWN evidence reason is unsupported.')
  }
  return evidence
}

export function validateRemoteEvidence(input) {
  return withIntrinsicIntegrity(() => validateRemoteEvidenceInternal(input))
}

export function createUnavailableRemoteEvidence(reason = 'offline-observation-not-attempted') {
  return withIntrinsicIntegrity(() => {
    if (!UNAVAILABLE_REASONS.has(reason)) fail('unavailable evidence reason is unsupported.')
    return validateRemoteEvidence({
      availability: 'unavailable',
      completeness: 'not-attempted',
      comparison: 'UNAVAILABLE',
      expected: null,
      observed: null,
      reason,
      endpointFamily: 'not-applicable',
      operation: 'not-applicable',
      httpMethod: 'not-applicable',
      readOrdinals: [],
      capturedAtMs: { firstRead: null, secondRead: null },
    })
  })
}

function expectedLocalExpectations() {
  const protectedSourceHashes = RELEASE_INSPECTION_PROTECTED_SOURCE_PATHS.map((path) => ({
    path,
    sha256: RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES[path],
  }))
  const basis = {
    authorityHash: RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES[RELEASE_INSPECTION_MANIFEST_SOURCES.authority],
    manifestHash: RELEASE_INSPECTION_PROTECTED_SOURCE_HASHES['config/release-inspection-manifest.json'],
    protectedSourceHashes,
  }
  return immutablePlain({ ...basis, expectationHash: canonicalHash(basis) })
}

export const REMOTE_OBSERVATION_LOCAL_EXPECTATIONS = expectedLocalExpectations()

function validateLocalExpectations(input) {
  const expectations = snapshotPlain(input, 'Local expectations')
  if (!exactKeys(expectations, [
    'authorityHash', 'expectationHash', 'manifestHash', 'protectedSourceHashes',
  ]) || canonicalJson(expectations) !== canonicalJson(REMOTE_OBSERVATION_LOCAL_EXPECTATIONS)) {
    fail('local expectation hashes differ from the immutable protected-source declaration.')
  }
  return expectations
}

function validatePaginationCapture(input) {
  const pagination = snapshotPlain(input, 'Pagination capture')
  if (!exactKeys(pagination, ['accountZones', 'pagesPreviewDeployments', 'workerCustomDomains'])) {
    fail('pagination capture must contain the exact paginated operation families.')
  }
  for (const [family, maximumPages] of [
    ['accountZones', REMOTE_OBSERVATION_LIMITS.maximumPaginationPages],
    ['pagesPreviewDeployments', REMOTE_OBSERVATION_LIMITS.maximumPaginationPages],
    ['workerCustomDomains', 1],
  ]) {
    const entry = pagination[family]
    const pageSize = PREVIEW_OPERATION_REGISTRY[RESOURCE_OPERATION[family]].pagination.pageSize
      ?? REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily
    if (!exactKeys(entry, ['completeness', 'pagesRead', 'recordsRead'])
      || !['complete', 'partial', 'not-attempted'].includes(entry.completeness)
      || !Number.isSafeInteger(entry.pagesRead)
      || entry.pagesRead < 0
      || entry.pagesRead > maximumPages
      || !Number.isSafeInteger(entry.recordsRead)
      || entry.recordsRead < 0
      || entry.recordsRead > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily
      || entry.recordsRead > entry.pagesRead * pageSize
      || (entry.completeness === 'not-attempted' && (entry.pagesRead !== 0 || entry.recordsRead !== 0))
      || (entry.completeness === 'complete' && entry.pagesRead < 1)) {
      fail(`${family} pagination capture is contradictory or outside the approved budget.`)
    }
  }
  return pagination
}

function expectedFullReadRequestCount(capture) {
  let requests = 0
  for (const [resource, operation] of Object.entries(RESOURCE_OPERATION)) {
    const multiplier = resource === 'accountZones'
      ? capture.pagination.accountZones.pagesRead
      : resource === 'pagesPreviewDeployments'
        ? capture.pagination.pagesPreviewDeployments.pagesRead
        : resource === 'workerCustomDomains'
          ? capture.pagination.workerCustomDomains.pagesRead
          : resource === 'workerRoutes'
            ? capture.reviewedRouteZoneCount
            : 1
    requests += PREVIEW_OPERATION_REGISTRY[operation].requestBudgetWeight * multiplier
  }
  for (const operation of Object.values(MIGRATION_OPERATION)) {
    requests += PREVIEW_OPERATION_REGISTRY[operation].requestBudgetWeight
  }
  return requests
}

function validateCaptureMetadata(input) {
  const capture = snapshotPlain(input, 'Capture metadata')
  if (!exactKeys(capture, [
    'captureCompletedAtMs', 'captureStartedAtMs', 'credentialScope', 'expiresAtMs',
    'freshnessStatus', 'mode', 'pagination', 'requestCounts', 'responseCompleteness',
    'reviewedRouteZoneCount', 'stableRead',
  ])
    || !['offline', 'online-preview'].includes(capture.mode)
    || capture.credentialScope !== 'unverified'
    || !Number.isSafeInteger(capture.reviewedRouteZoneCount)
    || capture.reviewedRouteZoneCount < 0
    || capture.reviewedRouteZoneCount > REMOTE_OBSERVATION_LIMITS.maximumReviewedRouteZones
    || !['not-applicable', 'fresh', 'stale', 'unknown'].includes(capture.freshnessStatus)
    || !['not-attempted', 'complete', 'partial'].includes(capture.responseCompleteness)) {
    fail('capture metadata has missing keys, extra keys, or unsupported vocabulary.')
  }
  const counts = capture.requestCounts
  if (!exactKeys(counts, ['firstRead', 'secondRead', 'total'])
    || !Number.isSafeInteger(counts.firstRead)
    || !Number.isSafeInteger(counts.secondRead)
    || !Number.isSafeInteger(counts.total)
    || counts.firstRead < 0
    || counts.secondRead < 0
    || counts.firstRead > REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead
    || counts.secondRead > REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead
    || counts.total !== counts.firstRead + counts.secondRead
    || counts.total > REMOTE_OBSERVATION_LIMITS.maximumRequestsPerDoubleRead) {
    fail('capture request counts exceed the approved full-read or double-read budget.')
  }
  const stableRead = capture.stableRead
  if (!exactKeys(stableRead, [
    'delayMs', 'firstReadCompletedAtMs', 'firstSemanticHash', 'secondReadCompletedAtMs',
    'secondReadStartedAtMs', 'secondSemanticHash', 'status',
  ])
    || stableRead.delayMs !== REMOTE_OBSERVATION_LIMITS.stableReadDelayMs
    || !['not-attempted', 'stable', 'unstable', 'incomplete'].includes(stableRead.status)) {
    fail('stable-read metadata is malformed.')
  }
  validatePaginationCapture(capture.pagination)
  if (capture.mode === 'offline') {
    if (capture.captureStartedAtMs !== null
      || capture.captureCompletedAtMs !== null
      || capture.expiresAtMs !== null
      || capture.freshnessStatus !== 'not-applicable'
      || capture.responseCompleteness !== 'not-attempted'
      || counts.total !== 0
      || capture.reviewedRouteZoneCount !== 0
      || stableRead.status !== 'not-attempted'
      || stableRead.firstReadCompletedAtMs !== null
      || stableRead.secondReadStartedAtMs !== null
      || stableRead.secondReadCompletedAtMs !== null
      || stableRead.firstSemanticHash !== null
      || stableRead.secondSemanticHash !== null
      || Object.values(capture.pagination).some(({ completeness }) => completeness !== 'not-attempted')) {
      fail('offline capture metadata must be deterministic and entirely not attempted.')
    }
    return capture
  }
  if (!validTimeMs(capture.captureStartedAtMs)
    || !validTimeMs(capture.captureCompletedAtMs)
    || !validTimeMs(stableRead.firstReadCompletedAtMs)
    || capture.captureStartedAtMs > stableRead.firstReadCompletedAtMs
    || stableRead.firstReadCompletedAtMs > capture.captureCompletedAtMs
    || capture.freshnessStatus === 'not-applicable'
    || counts.firstRead < 1
    || capture.responseCompleteness === 'not-attempted') {
    fail('online Preview capture timestamps, freshness, or request counts are contradictory.')
  }
  if (stableRead.status === 'not-attempted') {
    if (counts.secondRead !== 0
      || stableRead.secondReadStartedAtMs !== null
      || stableRead.secondReadCompletedAtMs !== null
      || capture.expiresAtMs !== null
      || capture.freshnessStatus !== 'unknown'
      || stableRead.firstSemanticHash !== null
      || stableRead.secondSemanticHash !== null) fail('not-attempted stable-read metadata is contradictory.')
  } else if (stableRead.status === 'stable' || stableRead.status === 'unstable') {
    if (counts.secondRead < 1
      || !validTimeMs(stableRead.secondReadStartedAtMs)
      || !validTimeMs(stableRead.secondReadCompletedAtMs)
      || !validTimeMs(capture.expiresAtMs)
      || stableRead.secondReadStartedAtMs - stableRead.firstReadCompletedAtMs
        < REMOTE_OBSERVATION_LIMITS.stableReadDelayMs
      || stableRead.secondReadCompletedAtMs < stableRead.secondReadStartedAtMs
      || capture.captureCompletedAtMs < stableRead.secondReadCompletedAtMs
      || capture.expiresAtMs - stableRead.secondReadCompletedAtMs
        !== REMOTE_OBSERVATION_LIMITS.freshnessWindowMs
      || !SHA256_PATTERN.test(stableRead.firstSemanticHash)
      || !SHA256_PATTERN.test(stableRead.secondSemanticHash)
      || (stableRead.status === 'stable'
        && stableRead.firstSemanticHash !== stableRead.secondSemanticHash)
      || (stableRead.status === 'unstable'
        && stableRead.firstSemanticHash === stableRead.secondSemanticHash)) {
      fail('stable-read hashes, timestamps, or ordinals are contradictory.')
    }
  } else if (stableRead.secondReadCompletedAtMs !== null
    || stableRead.firstSemanticHash !== null
    || stableRead.secondSemanticHash !== null) {
    fail('incomplete stable-read metadata must not retain semantic hashes or completed capture timestamps.')
  } else if (counts.secondRead === 0) {
    if (stableRead.secondReadStartedAtMs !== null
      || capture.expiresAtMs !== null
      || capture.freshnessStatus !== 'unknown') {
      fail('incomplete first-read-only metadata is contradictory.')
    }
  } else if (!validTimeMs(stableRead.secondReadStartedAtMs)
    || stableRead.secondReadStartedAtMs - stableRead.firstReadCompletedAtMs
      < REMOTE_OBSERVATION_LIMITS.stableReadDelayMs
    || capture.captureCompletedAtMs < stableRead.secondReadStartedAtMs
    || capture.expiresAtMs !== null
    || capture.freshnessStatus !== 'unknown') {
    fail('incomplete second-read metadata is contradictory.')
  }
  return capture
}

function validateObservationTimeContext(input, capture) {
  if (capture.mode === 'offline') {
    if (input !== undefined) fail('offline observation validation must not receive a clock context.')
    return null
  }
  if (input === undefined) {
    fail('online observation validation requires the exact injected nowMs clock context.')
  }
  const context = snapshotPlain(input, 'Observation validation context')
  if (!exactKeys(context, ['nowMs']) || !validTimeMs(context.nowMs)) {
    fail('online observation validation requires the exact injected nowMs clock context.')
  }
  if (capture.captureStartedAtMs > context.nowMs + REMOTE_OBSERVATION_LIMITS.maximumFutureClockSkewMs
    || capture.captureCompletedAtMs > context.nowMs + REMOTE_OBSERVATION_LIMITS.maximumFutureClockSkewMs) {
    fail('online observation contains future-dated capture evidence beyond the allowed clock tolerance.')
  }
  if (capture.expiresAtMs === null) {
    if (capture.freshnessStatus !== 'unknown') fail('incomplete capture freshness must remain unknown.')
  } else {
    const expectedFreshness = context.nowMs <= capture.expiresAtMs ? 'fresh' : 'stale'
    if (capture.freshnessStatus !== expectedFreshness) {
      fail('online observation freshness contradicts the injected clock and exact expiration.')
    }
  }
  return context.nowMs
}

function assertEvidenceTimeline(evidence, capture) {
  const firstReadAtMs = evidence.capturedAtMs.firstRead
  const secondReadAtMs = evidence.capturedAtMs.secondRead
  if (capture.mode === 'offline') {
    if (firstReadAtMs !== null || secondReadAtMs !== null) {
      fail('offline evidence cannot contain capture timestamps.')
    }
    return
  }
  if (firstReadAtMs !== null && (
    firstReadAtMs < capture.captureStartedAtMs
    || firstReadAtMs > capture.stableRead.firstReadCompletedAtMs
  )) fail('first-read evidence timestamp is outside the first-read capture window.')
  if (secondReadAtMs !== null && (
    !validTimeMs(capture.stableRead.secondReadStartedAtMs)
    || !validTimeMs(capture.stableRead.secondReadCompletedAtMs)
    || secondReadAtMs < capture.stableRead.secondReadStartedAtMs
    || secondReadAtMs > capture.stableRead.secondReadCompletedAtMs
  )) fail('second-read evidence timestamp is outside the second-read capture window.')
}

function assertExactTimeIntegerLexemes(source) {
  let offset = 0
  while (offset < source.length) {
    if (source[offset] !== '"') {
      offset += 1
      continue
    }
    const start = offset
    offset += 1
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2
        continue
      }
      if (source[offset] === '"') {
        offset += 1
        break
      }
      offset += 1
    }
    let key
    try {
      key = JSON.parse(source.slice(start, offset))
    } catch {
      return
    }
    let cursor = offset
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1
    if (source[cursor] !== ':' || !EXACT_TIME_INTEGER_FIELDS.has(key)) continue
    cursor += 1
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1
    if (source.startsWith('null', cursor)) {
      cursor += 4
    } else {
      const token = source.slice(cursor).match(/^(?:0|[1-9]\d*)/u)?.[0]
      if (!token) fail('timeline fields require exact nonnegative integer tokens or null.')
      cursor += token.length
    }
    if (!/[\s,}\]]/u.test(source[cursor] ?? '')) {
      fail('timeline fields require exact nonnegative integer tokens or null.')
    }
  }
}

function validateResourceEvidence(input, capture) {
  const resources = snapshotPlain(input, 'Preview resources')
  if (!exactKeys(resources, REMOTE_RESOURCE_KEYS)) fail('Preview resources must use the exact closed inventory.')
  for (const key of REMOTE_RESOURCE_KEYS) {
    const evidence = validateRemoteEvidence(resources[key])
    assertEvidenceTimeline(evidence, capture)
    if (key !== 'secretPresence' && resources[key].operation !== 'not-applicable'
      && resources[key].operation !== RESOURCE_OPERATION[key]) {
      fail(`${key} evidence is not bound to its exact operation.`)
    }
  }
  if (resources.secretPresence.availability !== 'unavailable'
    || resources.secretPresence.comparison !== 'UNAVAILABLE'
    || resources.secretPresence.reason !== 'secret-presence-contract-unavailable') {
    fail('secret-name/type presence must remain UNAVAILABLE in 3D-2B.1.')
  }
  return resources
}

function validateCapabilities(input, capture) {
  const capabilities = snapshotPlain(input, 'Preview capabilities')
  if (!exactKeys(capabilities, RELEASE_INSPECTION_CAPABILITIES)) {
    fail('Preview capabilities must contain the exact seven-capability vocabulary.')
  }
  for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
    const record = capabilities[capability]
    if (!exactKeys(record, ['comparison', 'surfaces']) || !COMPARISONS.has(record.comparison)
      || !exactKeys(record.surfaces, RELEASE_INSPECTION_SURFACES)) {
      fail(`${capability} must contain one comparison and the exact four-surface vocabulary.`)
    }
    const applicableSurfaces = new Set(EXPECTED_CAPABILITY_SURFACES[capability])
    const applicable = []
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const evidence = record.surfaces[surface]
      assertEvidenceTimeline(validateRemoteEvidence(evidence), capture)
      if (!applicableSurfaces.has(surface)) {
        if (canonicalJson(evidence) !== canonicalJson({
          availability: 'not-applicable',
          capturedAtMs: { firstRead: null, secondRead: null },
          comparison: 'UNAVAILABLE',
          completeness: 'not-applicable',
          endpointFamily: 'not-applicable',
          expected: null,
          httpMethod: 'not-applicable',
          observed: null,
          operation: 'not-applicable',
          readOrdinals: [],
          reason: 'not-applicable',
        })) fail(`${capability}.${surface} must use the exact non-applicable representation.`)
      } else {
        applicable.push(evidence)
        if (evidence.operation !== 'not-applicable'
          && evidence.operation !== CAPABILITY_SURFACE_OPERATION[surface]) {
          fail(`${capability}.${surface} evidence is not bound to its exact operation.`)
        }
      }
    }
    if (record.comparison === 'MATCH' && !applicable.every(({ comparison }) => comparison === 'MATCH')) {
      fail(`${capability} MATCH requires every required observable surface to match.`)
    }
    if (record.comparison === 'DRIFT' && (!applicable.some(({ comparison }) => comparison === 'DRIFT')
      || applicable.some(({ comparison }) => !['MATCH', 'DRIFT'].includes(comparison)))) {
      fail(`${capability} DRIFT requires at least one required observable surface drift.`)
    }
    if (record.comparison === 'UNKNOWN' && !applicable.some(({ comparison }) => (
      ['UNKNOWN', 'UNAVAILABLE'].includes(comparison)
    ))) {
      fail(`${capability} UNKNOWN requires at least one required observable surface unknown.`)
    }
    if (record.comparison === 'UNAVAILABLE' && applicable.some(({ comparison }) => comparison !== 'UNAVAILABLE')) {
      fail(`${capability} UNAVAILABLE cannot contain available surface comparisons.`)
    }
  }
  return capabilities
}

function validateMigrationObservation(input, capture) {
  const migrations = snapshotPlain(input, 'Migration observation')
  if (!exactKeys(migrations, REMOTE_MIGRATION_KEYS)) {
    fail('migration observation must contain the exact four-field inventory.')
  }
  for (const key of REMOTE_MIGRATION_KEYS) {
    const evidence = validateRemoteEvidence(migrations[key])
    assertEvidenceTimeline(evidence, capture)
    if (key !== 'appliedSourceHashes' && migrations[key].operation !== 'not-applicable'
      && migrations[key].operation !== MIGRATION_OPERATION[key]) {
      fail(`${key} migration evidence is not bound to its exact operation.`)
    }
  }
  if (migrations.appliedSourceHashes.availability !== 'unavailable'
    || migrations.appliedSourceHashes.comparison !== 'UNAVAILABLE') {
    fail('applied migration source hashes must remain explicitly unavailable.')
  }
  return migrations
}

function requiredPreviewEvidence(preview) {
  const resourceEvidence = REMOTE_RESOURCE_KEYS
    .filter((key) => key !== 'secretPresence')
    .map((key) => preview.resources[key])
  const capabilityEvidence = RELEASE_INSPECTION_CAPABILITIES.flatMap((capability) => (
    EXPECTED_CAPABILITY_SURFACES[capability].map((surface) => (
      preview.capabilities[capability].surfaces[surface]
    ))
  ))
  const migrationEvidence = ['tableDiscovery', 'migrationRows', 'backendSchemaVersion']
    .map((key) => preview.migrationObservation[key])
  return [...resourceEvidence, ...capabilityEvidence, ...migrationEvidence]
}

function validatePreviewEnvironment(input, capture) {
  const preview = snapshotPlain(input, 'Preview environment observation')
  if (!exactKeys(preview, [
    'capabilities', 'comparison', 'completeness', 'contactStatus', 'migrationObservation',
    'reason', 'resources',
  ])
    || !['not-attempted', 'attempted'].includes(preview.contactStatus)
    || !COMPARISONS.has(preview.comparison)
    || !['not-attempted', 'complete', 'partial'].includes(preview.completeness)
    || !REASONS.has(preview.reason)) {
    fail('Preview observation envelope has unsupported keys or vocabulary.')
  }
  validateResourceEvidence(preview.resources, capture)
  validateCapabilities(preview.capabilities, capture)
  validateMigrationObservation(preview.migrationObservation, capture)
  const required = requiredPreviewEvidence(preview)
  const paginationComplete = Object.values(capture.pagination).every(({ completeness }) => completeness === 'complete')
  const expectedFullReadRequests = expectedFullReadRequestCount(capture)
  const exactCompleteRequestCounts = capture.requestCounts.firstRead === expectedFullReadRequests
    && capture.requestCounts.secondRead === expectedFullReadRequests
    && capture.requestCounts.total === expectedFullReadRequests * 2
  if (preview.contactStatus === 'not-attempted') {
    if (preview.comparison !== 'UNAVAILABLE'
      || preview.completeness !== 'not-attempted'
      || !['offline-observation-not-attempted', 'identity-grounding-required'].includes(preview.reason)
      || capture.mode !== 'offline'
      || required.some(({ comparison }) => comparison !== 'UNAVAILABLE')) {
      fail('not-attempted Preview observation semantics are contradictory.')
    }
  } else if (capture.mode !== 'online-preview') {
    fail('attempted Preview observation requires online-preview capture metadata.')
  }
  if (preview.comparison === 'UNAVAILABLE' && preview.contactStatus !== 'not-attempted') {
    fail('Preview UNAVAILABLE cannot claim authenticated contact.')
  }
  if (preview.comparison === 'MATCH') {
    if (preview.contactStatus !== 'attempted'
      || preview.completeness !== 'complete'
      || preview.reason !== 'observed-match'
      || capture.stableRead.status !== 'stable'
      || capture.freshnessStatus !== 'fresh'
      || capture.responseCompleteness !== 'complete'
      || !paginationComplete
      || !exactCompleteRequestCounts
      || required.some(({ comparison }) => comparison !== 'MATCH')) {
      fail('Preview MATCH requires stable complete matching required observable fields.')
    }
  }
  if (preview.comparison === 'DRIFT' && (
    preview.contactStatus !== 'attempted'
    || preview.completeness !== 'complete'
    || preview.reason !== 'observed-drift'
    || capture.stableRead.status !== 'stable'
    || capture.freshnessStatus !== 'fresh'
    || capture.responseCompleteness !== 'complete'
    || !paginationComplete
    || !exactCompleteRequestCounts
    || !required.some(({ comparison }) => comparison === 'DRIFT')
    || required.some(({ comparison }) => !['MATCH', 'DRIFT'].includes(comparison))
  )) fail('Preview DRIFT requires stable complete evidence with at least one drift.')
  if (preview.comparison === 'UNKNOWN' && (
    preview.contactStatus !== 'attempted'
    || !['complete', 'partial'].includes(preview.completeness)
    || !UNKNOWN_REASONS.has(preview.reason)
    || !required.some(({ comparison }) => comparison === 'UNKNOWN')
  )) {
    fail('Preview UNKNOWN requires attempted observation and at least one unknown required observable field.')
  }
  return preview
}

function validateProductionExclusion(input) {
  const production = snapshotPlain(input, 'Production exclusion')
  if (!exactKeys(production, [
    'comparison', 'completeness', 'contactStatus', 'reason', 'remoteEvidence',
  ]) || canonicalJson(production) !== canonicalJson({
    contactStatus: 'not-attempted',
    comparison: 'UNAVAILABLE',
    completeness: 'not-attempted',
    reason: 'production-remote-inspection-excluded',
    remoteEvidence: 'excluded',
  })) fail('Production must remain exactly excluded and not contacted.')
  return production
}

function validateRemoteObservationArtifactInternal(input, timeContext) {
  assertEvidenceFieldsBeforeSnapshot(input, 'Remote observation artifact')
  const artifact = snapshotPlain(input, 'Remote observation artifact')
  if (!exactKeys(artifact, [
    'capture', 'environments', 'executionAuthorization', 'kind', 'localExpectations',
    'noFilesystemWrites', 'noRemoteMutation', 'noSecretValues', 'productionContacted',
    'releaseCurrentness', 'schemaVersion', 'toolContractVersion',
  ])
    || artifact.kind !== REMOTE_OBSERVATION_KIND
    || artifact.schemaVersion !== REMOTE_OBSERVATION_SCHEMA_VERSION
    || artifact.toolContractVersion !== REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION
    || artifact.releaseCurrentness !== 'UNKNOWN'
    || artifact.executionAuthorization !== 'prohibited'
    || artifact.noRemoteMutation !== true
    || artifact.noFilesystemWrites !== true
    || artifact.noSecretValues !== true
    || artifact.productionContacted !== false
    || !exactKeys(artifact.environments, ['preview', 'production'])) {
    fail('artifact kind, version, boundary flags, or top-level shape is unsupported.')
  }
  validateLocalExpectations(artifact.localExpectations)
  const capture = validateCaptureMetadata(artifact.capture)
  validateObservationTimeContext(timeContext, capture)
  validatePreviewEnvironment(artifact.environments.preview, capture)
  validateProductionExclusion(artifact.environments.production)
  assertSerializedObservationBudget(canonicalJson(artifact))
  return artifact
}

export function validateRemoteObservationArtifact(input, timeContext) {
  return withIntrinsicIntegrity(() => validateRemoteObservationArtifactInternal(input, timeContext))
}

function unavailableInventory(reason) {
  return createUnavailableRemoteEvidence(reason)
}

function notApplicableEvidence() {
  return validateRemoteEvidence({
    availability: 'not-applicable',
    completeness: 'not-applicable',
    comparison: 'UNAVAILABLE',
    expected: null,
    observed: null,
    reason: 'not-applicable',
    endpointFamily: 'not-applicable',
    operation: 'not-applicable',
    httpMethod: 'not-applicable',
    readOrdinals: [],
    capturedAtMs: { firstRead: null, secondRead: null },
  })
}

function createOfflineRemoteObservationInternal() {
  const offline = unavailableInventory('offline-observation-not-attempted')
  const secretPresence = unavailableInventory('secret-presence-contract-unavailable')
  const notApplicable = notApplicableEvidence()
  const resources = Object.fromEntries(REMOTE_RESOURCE_KEYS.map((key) => [
    key,
    key === 'secretPresence' ? secretPresence : offline,
  ]))
  const capabilities = Object.fromEntries(RELEASE_INSPECTION_CAPABILITIES.map((capability) => [
    capability,
    {
      comparison: 'UNAVAILABLE',
      surfaces: Object.fromEntries(RELEASE_INSPECTION_SURFACES.map((surface) => [
        surface,
        EXPECTED_CAPABILITY_SURFACES[capability].includes(surface) ? offline : notApplicable,
      ])),
    },
  ]))
  const migrationObservation = Object.fromEntries(REMOTE_MIGRATION_KEYS.map((key) => [key, offline]))
  const paginationNotAttempted = {
    completeness: 'not-attempted',
    pagesRead: 0,
    recordsRead: 0,
  }
  return validateRemoteObservationArtifact({
    schemaVersion: REMOTE_OBSERVATION_SCHEMA_VERSION,
    kind: REMOTE_OBSERVATION_KIND,
    toolContractVersion: REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION,
    localExpectations: REMOTE_OBSERVATION_LOCAL_EXPECTATIONS,
    capture: {
      mode: 'offline',
      captureStartedAtMs: null,
      captureCompletedAtMs: null,
      expiresAtMs: null,
      freshnessStatus: 'not-applicable',
      credentialScope: 'unverified',
      reviewedRouteZoneCount: 0,
      requestCounts: { firstRead: 0, secondRead: 0, total: 0 },
      stableRead: {
        status: 'not-attempted',
        delayMs: REMOTE_OBSERVATION_LIMITS.stableReadDelayMs,
        firstReadCompletedAtMs: null,
        secondReadStartedAtMs: null,
        secondReadCompletedAtMs: null,
        firstSemanticHash: null,
        secondSemanticHash: null,
      },
      pagination: {
        accountZones: paginationNotAttempted,
        pagesPreviewDeployments: paginationNotAttempted,
        workerCustomDomains: paginationNotAttempted,
      },
      responseCompleteness: 'not-attempted',
    },
    environments: {
      preview: {
        contactStatus: 'not-attempted',
        comparison: 'UNAVAILABLE',
        completeness: 'not-attempted',
        reason: 'offline-observation-not-attempted',
        resources,
        capabilities,
        migrationObservation,
      },
      production: {
        contactStatus: 'not-attempted',
        comparison: 'UNAVAILABLE',
        completeness: 'not-attempted',
        reason: 'production-remote-inspection-excluded',
        remoteEvidence: 'excluded',
      },
    },
    releaseCurrentness: 'UNKNOWN',
    executionAuthorization: 'prohibited',
    noRemoteMutation: true,
    noFilesystemWrites: true,
    noSecretValues: true,
    productionContacted: false,
  })
}

export function createOfflineRemoteObservation() {
  return withIntrinsicIntegrity(createOfflineRemoteObservationInternal)
}

function parseRemoteObservationArtifactInternal(source, timeContext) {
  if (typeof source !== 'string') fail('artifact parser input must be text.')
  assertExactTimeIntegerLexemes(source)
  let parsed
  try {
    parsed = parseStrictJson(source, {
      label: 'Remote observation artifact',
      limits: {
        maxBytes: REMOTE_OBSERVATION_LIMITS.maximumSerializedObservationBytes,
        maxDepth: 64,
        maxNodes: 100_000,
      },
      exactIntegerTokens: { schemaVersion: String(REMOTE_OBSERVATION_SCHEMA_VERSION) },
      error: (message) => new TypeError(message),
    })
  } catch (error) {
    throw error instanceof Error ? error : new TypeError('Remote observation artifact parsing failed.')
  }
  return validateRemoteObservationArtifact(parsed, timeContext)
}

export function parseRemoteObservationArtifact(source, timeContext) {
  return withIntrinsicIntegrity(() => parseRemoteObservationArtifactInternal(source, timeContext))
}

function renderRemoteObservationJsonInternal(input, timeContext) {
  const serialized = `${canonicalJson(validateRemoteObservationArtifact(input, timeContext))}\n`
  return assertSerializedObservationBudget(serialized)
}

export function renderRemoteObservationJson(input, timeContext) {
  return withIntrinsicIntegrity(() => renderRemoteObservationJsonInternal(input, timeContext))
}
