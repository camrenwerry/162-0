import type { PreviewObservationIdentity } from './lib/release-inspection/preview-identity.mjs'
import type { PreviewSingleReadSnapshot } from './lib/release-inspection/preview-observation-contracts.mjs'
import {
  orchestratePreviewDoubleRead,
  type PreviewDoubleReadDependencies,
  type PreviewDoubleReadExecutionInput,
  type PreviewDoubleReadExecutionResult,
  type PreviewDoubleReadFailureClassification,
  type PreviewDoubleReadReceipt,
} from './lib/release-inspection/preview-double-read-orchestration.mjs'

declare const identity: PreviewObservationIdentity
declare const snapshot: PreviewSingleReadSnapshot

const success: PreviewDoubleReadExecutionResult = {
  identityAuthority: identity,
  requestCount: 64,
  outcomeClassification: 'snapshot-available',
  snapshot,
  failureClassification: null,
}
const boundedFailure: PreviewDoubleReadExecutionResult = {
  identityAuthority: identity,
  requestCount: 0,
  outcomeClassification: 'bounded-failure',
  snapshot: null,
  failureClassification: 'single-read-unavailable',
}
const failureVocabulary: readonly PreviewDoubleReadFailureClassification[] = [
  'single-read-contradictory',
  'single-read-malformed',
  'single-read-missing',
  'single-read-partial',
  'single-read-timeout',
  'single-read-transport-failure',
  'single-read-unavailable',
]
const dependencies: PreviewDoubleReadDependencies = {
  executeSingleRead(input: Readonly<PreviewDoubleReadExecutionInput>) {
    const exactIndex: 1 | 2 = input.attemptIndex
    const exactIdentity: PreviewObservationIdentity = input.identityAuthority
    const capture: number = input.capturedAtMs
    void [exactIndex, exactIdentity, capture]
    return input.attemptIndex === 1 ? success : boundedFailure
  },
  monotonicNow: () => 0,
  wallClockNow: () => 0,
  delay: (requestedMs: 2000) => requestedMs,
}

const result = orchestratePreviewDoubleRead(identity, dependencies)
result.then(({ receipt, readOne, readTwo }) => {
  const typedReceipt: PreviewDoubleReadReceipt = receipt
  const attempts: 2 = typedReceipt.authorizedAttemptCount
  const delay: 2000 = typedReceipt.requestedDelayMs
  const authorizationProof: true = typedReceipt.identityContinuous
  const first: PreviewSingleReadSnapshot | null = readOne
  const second: PreviewSingleReadSnapshot | null = readTwo
  void [attempts, delay, authorizationProof, first, second]
})

// @ts-expect-error Structural objects cannot create opaque Preview identity authority.
orchestratePreviewDoubleRead({}, dependencies)
// @ts-expect-error The required delay dependency must accept exactly the locked 2,000ms request.
const wrongDelay: PreviewDoubleReadDependencies = { ...dependencies, delay: (ms: 3000) => void ms }
// @ts-expect-error Available outcomes cannot carry a bounded failure classification.
const contradictoryAvailable: PreviewDoubleReadExecutionResult = {
  ...success,
  failureClassification: 'single-read-unavailable',
}
// @ts-expect-error Bounded failures cannot carry an authorized snapshot.
const contradictoryFailure: PreviewDoubleReadExecutionResult = {
  ...boundedFailure,
  snapshot,
}

void [
  failureVocabulary,
  wrongDelay,
  contradictoryAvailable,
  contradictoryFailure,
]
