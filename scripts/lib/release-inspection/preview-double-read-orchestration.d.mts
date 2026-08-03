import type { PreviewObservationIdentity } from './preview-identity.mjs'
import type { PreviewSingleReadSnapshot } from './preview-observation-contracts.mjs'

export type PreviewDoubleReadFailureClassification =
  | 'single-read-contradictory'
  | 'single-read-malformed'
  | 'single-read-missing'
  | 'single-read-partial'
  | 'single-read-timeout'
  | 'single-read-transport-failure'
  | 'single-read-unavailable'

export interface PreviewDoubleReadExecutionInput {
  readonly attemptIndex: 1 | 2
  readonly capturedAtMs: number
  readonly identityAuthority: PreviewObservationIdentity
}

export type PreviewDoubleReadExecutionResult = Readonly<{
  identityAuthority: PreviewObservationIdentity
  requestCount: number
  outcomeClassification: 'snapshot-available'
  snapshot: PreviewSingleReadSnapshot
  failureClassification: null
}> | Readonly<{
  identityAuthority: PreviewObservationIdentity
  requestCount: number
  outcomeClassification: 'bounded-failure'
  snapshot: null
  failureClassification: PreviewDoubleReadFailureClassification
}>

export interface PreviewDoubleReadDependencies {
  readonly executeSingleRead: (
    input: Readonly<PreviewDoubleReadExecutionInput>,
  ) => Promise<PreviewDoubleReadExecutionResult> | PreviewDoubleReadExecutionResult
  readonly monotonicNow: () => number
  readonly wallClockNow: () => number
  readonly delay: (requestedMs: 2000) => Promise<unknown> | unknown
}

export interface PreviewDoubleReadAttemptReceipt {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-double-read-attempt-receipt'
  readonly attemptIndex: 1 | 2
  readonly identityContinuityDigest: string
  readonly monotonicStartedAtMs: number
  readonly monotonicSettledAtMs: number
  readonly capturedAtMs: number
  readonly requestCount: number
  readonly outcomeClassification: 'snapshot-available' | 'bounded-failure'
  readonly singleReadResultAvailable: boolean
  readonly failureClassification: PreviewDoubleReadFailureClassification | null
}

export interface PreviewDoubleReadReceipt {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-double-read-orchestration-receipt'
  readonly environment: 'preview'
  readonly authorizedAttemptCount: 2
  readonly observerInvocationCount: 2
  readonly readTwoAttempted: true
  readonly identityContinuityDigest: string
  readonly identityContinuous: true
  readonly requestedDelayMs: 2000
  readonly delayRequestCount: 1
  readonly monotonicDelaySettledAtMs: number
  readonly observedDelayElapsedMs: number
  readonly readTwoBeganEarly: false
  readonly readsOverlapped: false
  readonly requestCounts: readonly [number, number]
  readonly aggregateRequestCount: number
  readonly attemptReceipts: readonly [
    PreviewDoubleReadAttemptReceipt,
    PreviewDoubleReadAttemptReceipt,
  ]
  readonly outcomeClassification:
    | 'two-snapshots-available'
    | 'completed-with-bounded-read-failure'
}

export class PreviewDoubleReadOrchestrationError extends TypeError {
  readonly code: string
}

export const PREVIEW_DOUBLE_READ_RECEIPT_SCHEMA_VERSION: 1
export const PREVIEW_DOUBLE_READ_RECEIPT_KIND:
  'pennant-pursuit-preview-double-read-orchestration-receipt'
export const PREVIEW_DOUBLE_READ_ATTEMPT_RECEIPT_KIND:
  'pennant-pursuit-preview-double-read-attempt-receipt'
export const PREVIEW_DOUBLE_READ_MAX_RECEIPT_BYTES: 16384
export const PREVIEW_DOUBLE_READ_FAILURE_CLASSIFICATIONS:
  readonly PreviewDoubleReadFailureClassification[]

export function orchestratePreviewDoubleRead(
  identity: PreviewObservationIdentity,
  dependencies: PreviewDoubleReadDependencies,
): Promise<Readonly<{
  receipt: PreviewDoubleReadReceipt
  readOne: PreviewSingleReadSnapshot | null
  readTwo: PreviewSingleReadSnapshot | null
}>>
