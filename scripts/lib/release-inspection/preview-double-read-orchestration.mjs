import { Buffer } from 'node:buffer'
import { types as utilTypes } from 'node:util'
import { canonicalJson, immutablePlain } from '../preview-release/canonical-data.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import { validatePreviewSingleReadSnapshot } from './preview-observation-contracts.mjs'
import {
  PREVIEW_OBSERVATION_LIMITS,
} from './preview-observation-limits.mjs'
import {
  resolvePreviewObservationIdentityContinuity,
} from './preview-authority.mjs'

export const PREVIEW_DOUBLE_READ_RECEIPT_SCHEMA_VERSION = 1
export const PREVIEW_DOUBLE_READ_RECEIPT_KIND =
  'pennant-pursuit-preview-double-read-orchestration-receipt'
export const PREVIEW_DOUBLE_READ_ATTEMPT_RECEIPT_KIND =
  'pennant-pursuit-preview-double-read-attempt-receipt'
export const PREVIEW_DOUBLE_READ_MAX_RECEIPT_BYTES = 16_384
export const PREVIEW_DOUBLE_READ_FAILURE_CLASSIFICATIONS = Object.freeze([
  'single-read-contradictory',
  'single-read-malformed',
  'single-read-missing',
  'single-read-partial',
  'single-read-timeout',
  'single-read-transport-failure',
  'single-read-unavailable',
])

const isProxy = utilTypes.isProxy
// Capture the byte-measurement function before any injected authority can run.
// The intrinsic-integrity graph separately pins Buffer and this exact method.
const trustedReceiptByteLength = Buffer.byteLength
const DEPENDENCY_KEYS = Object.freeze([
  'delay',
  'executeSingleRead',
  'monotonicNow',
  'wallClockNow',
])
const RESULT_KEYS = Object.freeze([
  'failureClassification',
  'identityAuthority',
  'outcomeClassification',
  'requestCount',
  'snapshot',
])
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

export class PreviewDoubleReadOrchestrationError extends TypeError {
  constructor(code) {
    super(`Preview double-read orchestration refused: ${code}.`)
    this.name = 'PreviewDoubleReadOrchestrationError'
    this.code = code
  }
}

function fail(code) {
  throw new PreviewDoubleReadOrchestrationError(code)
}

function assertOrchestrationIntrinsicIntegrity() {
  try {
    assertReleaseInspectionIntrinsicIntegrity()
  } catch {
    fail('intrinsic-integrity-untrustworthy')
  }
}

function exactDataObject(input, expectedKeys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || isProxy(input)
    || ![Object.prototype, null].includes(Reflect.getPrototypeOf(input))) return false
  const keys = Reflect.ownKeys(input)
  return keys.length === expectedKeys.length
    && keys.every((key) => typeof key === 'string' && expectedKeys.includes(key))
    && keys.every((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      return descriptor && Object.hasOwn(descriptor, 'value') && !descriptor.get && !descriptor.set
        && descriptor.enumerable === true
    })
}

function validateDependencies(input) {
  if (!exactDataObject(input, DEPENDENCY_KEYS)) fail('dependencies-malformed')
  const dependencies = {}
  for (const key of DEPENDENCY_KEYS) {
    const value = Reflect.getOwnPropertyDescriptor(input, key).value
    if (typeof value !== 'function' || isProxy(value)) fail('dependencies-malformed')
    dependencies[key] = value
  }
  return Object.freeze(dependencies)
}

function validateMonotonicValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < 0 || value > Number.MAX_SAFE_INTEGER) fail('monotonic-clock-invalid')
  return value
}

function createMonotonicSampler(monotonicNow) {
  let last = null
  return () => {
    let value
    try {
      value = monotonicNow()
    } catch {
      fail('monotonic-clock-unavailable')
    }
    assertOrchestrationIntrinsicIntegrity()
    value = validateMonotonicValue(value)
    if (last !== null && value < last) fail('monotonic-clock-rollback')
    last = value
    return value
  }
}

function captureWallClock(wallClockNow) {
  let value
  try {
    value = wallClockNow()
  } catch {
    fail('wall-clock-unavailable')
  }
  assertOrchestrationIntrinsicIntegrity()
  if (!Number.isSafeInteger(value) || value < 0) fail('wall-clock-invalid')
  return value
}

function validateIdentityContinuity(continuity) {
  if (!continuity || typeof continuity !== 'object' || isProxy(continuity)
    || !Object.isFrozen(continuity)
    || !exactDataObject(continuity, ['continuityDigest', 'identity'])
    || !SHA256_PATTERN.test(continuity.continuityDigest)
    || !continuity.identity || typeof continuity.identity !== 'object'
    || isProxy(continuity.identity) || !Object.isFrozen(continuity.identity)) {
    fail('identity-continuity-unproven')
  }
  return continuity
}

function validatedAttemptResult(input, identity) {
  if (!exactDataObject(input, RESULT_KEYS)) fail('attempt-result-malformed')
  if (input.identityAuthority !== identity) fail('identity-discontinuity')
  if (!Number.isSafeInteger(input.requestCount) || input.requestCount < 0) {
    fail('request-accounting-malformed')
  }
  if (!['snapshot-available', 'bounded-failure'].includes(input.outcomeClassification)) {
    fail('attempt-result-malformed')
  }
  if (input.outcomeClassification === 'snapshot-available') {
    if (input.failureClassification !== null) fail('attempt-result-contradictory')
    let snapshot
    try {
      snapshot = validatePreviewSingleReadSnapshot(input.snapshot)
    } catch {
      fail('attempt-snapshot-invalid')
    }
    return Object.freeze({
      outcomeClassification: 'snapshot-available',
      failureClassification: null,
      requestCount: input.requestCount,
      snapshot,
    })
  }
  if (input.snapshot !== null
    || !PREVIEW_DOUBLE_READ_FAILURE_CLASSIFICATIONS.includes(input.failureClassification)) {
    fail('attempt-result-contradictory')
  }
  return Object.freeze({
    outcomeClassification: 'bounded-failure',
    failureClassification: input.failureClassification,
    requestCount: input.requestCount,
    snapshot: null,
  })
}

function attemptReceipt({
  attemptIndex,
  capturedAtMs,
  continuityDigest,
  result,
  startedAtMs,
  settledAtMs,
}) {
  return immutablePlain({
    schemaVersion: PREVIEW_DOUBLE_READ_RECEIPT_SCHEMA_VERSION,
    kind: PREVIEW_DOUBLE_READ_ATTEMPT_RECEIPT_KIND,
    attemptIndex,
    identityContinuityDigest: continuityDigest,
    monotonicStartedAtMs: startedAtMs,
    monotonicSettledAtMs: settledAtMs,
    capturedAtMs,
    requestCount: result.requestCount,
    outcomeClassification: result.outcomeClassification,
    singleReadResultAvailable: result.snapshot !== null,
    failureClassification: result.failureClassification,
  })
}

function assertReceiptBounded(receipt) {
  let byteLength
  try {
    byteLength = trustedReceiptByteLength(canonicalJson(receipt), 'utf8')
  } catch {
    fail('receipt-bound-unavailable')
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) fail('receipt-bound-unavailable')
  if (byteLength > PREVIEW_DOUBLE_READ_MAX_RECEIPT_BYTES) fail('receipt-size-exceeded')
  return receipt
}

function validateRequestCount(requestCount, attemptIndex) {
  if (requestCount > PREVIEW_OBSERVATION_LIMITS.maximumRequestsPerFullRead) {
    fail(`attempt-${attemptIndex}-request-budget-exceeded`)
  }
}

export async function orchestratePreviewDoubleRead(identityInput, dependenciesInput) {
  assertOrchestrationIntrinsicIntegrity()
  if (arguments.length !== 2) fail('exactly-one-identity-and-one-dependency-set-required')
  const dependencies = validateDependencies(dependenciesInput)

  let continuity
  try {
    continuity = resolvePreviewObservationIdentityContinuity(identityInput)
  } catch {
    fail('identity-continuity-unproven')
  }
  continuity = validateIdentityContinuity(continuity)
  const { identity, continuityDigest } = continuity
  const monotonicSample = createMonotonicSampler(dependencies.monotonicNow)
  let observerInvocationCount = 0
  let delayRequestCount = 0
  let activeAttempt = false

  const executeAttempt = async (attemptIndex) => {
    if (observerInvocationCount >= 2) fail('observer-invocation-limit-exceeded')
    if (activeAttempt) fail('read-overlap-detected')
    if (!Object.isFrozen(identity)) fail('identity-mutation-detected')
    const startedAtMs = monotonicSample()
    const capturedAtMs = captureWallClock(dependencies.wallClockNow)
    observerInvocationCount += 1
    activeAttempt = true
    let rawResult
    try {
      rawResult = await dependencies.executeSingleRead(Object.freeze({
        attemptIndex,
        capturedAtMs,
        identityAuthority: identity,
      }))
    } catch {
      const settledAtMs = monotonicSample()
      activeAttempt = false
      if (settledAtMs < startedAtMs) fail('monotonic-clock-rollback')
      fail('single-read-execution-untrustworthy')
    }
    const settledAtMs = monotonicSample()
    activeAttempt = false
    assertOrchestrationIntrinsicIntegrity()
    if (!Object.isFrozen(identity)) fail('identity-mutation-detected')
    const result = validatedAttemptResult(rawResult, identity)
    if (attemptIndex === 1) validateRequestCount(result.requestCount, attemptIndex)
    const receipt = assertReceiptBounded(attemptReceipt({
      attemptIndex,
      capturedAtMs,
      continuityDigest,
      result,
      startedAtMs,
      settledAtMs,
    }))
    return Object.freeze({ receipt, snapshot: result.snapshot })
  }

  const readOne = await executeAttempt(1)
  if (delayRequestCount >= 1) fail('delay-invocation-limit-exceeded')
  delayRequestCount += 1
  try {
    await dependencies.delay(PREVIEW_OBSERVATION_LIMITS.stableReadDelayMs)
  } catch {
    monotonicSample()
    fail('delay-execution-untrustworthy')
  }
  const delaySettledAtMs = monotonicSample()
  const readOneSettledAtMs = readOne.receipt.monotonicSettledAtMs
  const observedDelayElapsedMs = delaySettledAtMs - readOneSettledAtMs
  if (observedDelayElapsedMs < PREVIEW_OBSERVATION_LIMITS.stableReadDelayMs) {
    fail('required-delay-shortened')
  }

  const readTwo = await executeAttempt(2)
  const readTwoStartedAtMs = readTwo.receipt.monotonicStartedAtMs
  if (readTwoStartedAtMs - readOneSettledAtMs
    < PREVIEW_OBSERVATION_LIMITS.stableReadDelayMs) fail('read-two-started-early')
  if (readTwoStartedAtMs < delaySettledAtMs) fail('sequencing-authority-contradictory')
  if (observerInvocationCount !== 2) fail('observer-invocation-count-contradictory')
  if (delayRequestCount !== 1) fail('delay-invocation-count-contradictory')

  const requestCounts = [readOne.receipt.requestCount, readTwo.receipt.requestCount]
  const aggregateRequestCount = requestCounts[0] + requestCounts[1]
  if (!Number.isSafeInteger(aggregateRequestCount)
    || aggregateRequestCount > PREVIEW_OBSERVATION_LIMITS.maximumRequestsPerDoubleRead) {
    fail('aggregate-request-budget-exceeded')
  }
  validateRequestCount(requestCounts[1], 2)
  const outcomeClassification = readOne.snapshot !== null && readTwo.snapshot !== null
    ? 'two-snapshots-available'
    : 'completed-with-bounded-read-failure'
  const receipt = assertReceiptBounded(immutablePlain({
    schemaVersion: PREVIEW_DOUBLE_READ_RECEIPT_SCHEMA_VERSION,
    kind: PREVIEW_DOUBLE_READ_RECEIPT_KIND,
    environment: 'preview',
    authorizedAttemptCount: 2,
    observerInvocationCount,
    readTwoAttempted: true,
    identityContinuityDigest: continuityDigest,
    identityContinuous: true,
    requestedDelayMs: PREVIEW_OBSERVATION_LIMITS.stableReadDelayMs,
    delayRequestCount,
    monotonicDelaySettledAtMs: delaySettledAtMs,
    observedDelayElapsedMs,
    readTwoBeganEarly: false,
    readsOverlapped: false,
    requestCounts,
    aggregateRequestCount,
    attemptReceipts: [readOne.receipt, readTwo.receipt],
    outcomeClassification,
  }))
  return Object.freeze({
    receipt,
    readOne: readOne.snapshot,
    readTwo: readTwo.snapshot,
  })
}
