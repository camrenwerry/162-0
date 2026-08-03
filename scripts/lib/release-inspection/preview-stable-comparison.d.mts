import type { PreviewSingleReadSnapshot } from './preview-observation-contracts.mjs'
import type {
  PreviewSemanticHash,
  PreviewSemanticResourceValue,
  PreviewSemanticResourceValueByOperation,
  PreviewStabilityResourceState,
} from './preview-stability-projection.mjs'

export type PreviewStabilityComparison = 'MATCH' | 'DRIFT' | 'UNKNOWN'
export type PreviewCapabilityStabilityState = 'disabled' | 'enabled' | 'unknown'
export type PreviewCapabilityName =
  | 'leaderboardRead'
  | 'identityClaim'
  | 'identityStatus'
  | 'identityRename'
  | 'draftSubmission'
  | 'identityRecovery'
  | 'cleanupCron'
export type PreviewCapabilitySurface = 'frontend' | 'pages' | 'worker' | 'schedule'

type PreviewIncompleteResourceState = Exclude<PreviewStabilityResourceState, 'complete'>

export type PreviewResourceMatchRecord<Value extends PreviewSemanticResourceValue> = Readonly<{
  comparison: 'MATCH'
  reason: 'semantic-values-equal'
  readOneState: 'complete'
  readTwoState: 'complete'
  readOneSemanticHash: PreviewSemanticHash
  readTwoSemanticHash: PreviewSemanticHash
  stableValue: Value
}>

export type PreviewResourceDriftRecord = Readonly<{
  comparison: 'DRIFT'
  reason: 'semantic-values-differ'
  readOneState: 'complete'
  readTwoState: 'complete'
  readOneSemanticHash: PreviewSemanticHash
  readTwoSemanticHash: PreviewSemanticHash
  stableValue?: never
}>

export type PreviewResourceUnknownRecord =
  | Readonly<{
      comparison: 'UNKNOWN'
      reason: 'incomplete-resource-evidence'
      readOneState: 'complete'
      readTwoState: PreviewIncompleteResourceState
      readOneSemanticHash: PreviewSemanticHash
      readTwoSemanticHash: null
      stableValue?: never
    }>
  | Readonly<{
      comparison: 'UNKNOWN'
      reason: 'incomplete-resource-evidence'
      readOneState: PreviewIncompleteResourceState
      readTwoState: 'complete'
      readOneSemanticHash: null
      readTwoSemanticHash: PreviewSemanticHash
      stableValue?: never
    }>
  | Readonly<{
      comparison: 'UNKNOWN'
      reason: 'incomplete-resource-evidence'
      readOneState: PreviewIncompleteResourceState
      readTwoState: PreviewIncompleteResourceState
      readOneSemanticHash: null
      readTwoSemanticHash: null
      stableValue?: never
    }>

export type PreviewResourceStabilityRecord<
  Value extends PreviewSemanticResourceValue = PreviewSemanticResourceValue,
> = PreviewResourceMatchRecord<Value> | PreviewResourceDriftRecord | PreviewResourceUnknownRecord

export type PreviewApplicableCapabilityMatchRecord =
  | Readonly<{
      applicability: 'applicable'
      comparison: 'MATCH'
      reason: 'candidate-states-equal'
      readOneState: 'disabled'
      readTwoState: 'disabled'
    }>
  | Readonly<{
      applicability: 'applicable'
      comparison: 'MATCH'
      reason: 'candidate-states-equal'
      readOneState: 'enabled'
      readTwoState: 'enabled'
    }>

export type PreviewApplicableCapabilityDriftRecord =
  | Readonly<{
      applicability: 'applicable'
      comparison: 'DRIFT'
      reason: 'candidate-states-differ'
      readOneState: 'disabled'
      readTwoState: 'enabled'
    }>
  | Readonly<{
      applicability: 'applicable'
      comparison: 'DRIFT'
      reason: 'candidate-states-differ'
      readOneState: 'enabled'
      readTwoState: 'disabled'
    }>

export type PreviewApplicableCapabilityUnknownRecord =
  | Readonly<{
      applicability: 'applicable'
      comparison: 'UNKNOWN'
      reason: 'unknown-candidate-state'
      readOneState: 'unknown'
      readTwoState: PreviewCapabilityStabilityState
    }>
  | Readonly<{
      applicability: 'applicable'
      comparison: 'UNKNOWN'
      reason: 'unknown-candidate-state'
      readOneState: 'disabled' | 'enabled'
      readTwoState: 'unknown'
    }>

export type PreviewApplicableCapabilityStabilityRecord =
  | PreviewApplicableCapabilityMatchRecord
  | PreviewApplicableCapabilityDriftRecord
  | PreviewApplicableCapabilityUnknownRecord

export type PreviewNotApplicableCapabilityStabilityRecord = Readonly<{
  applicability: 'not-applicable'
  comparison: 'not-applicable'
  reason: 'not-applicable'
  readOneState: 'not-applicable'
  readTwoState: 'not-applicable'
}>

type ThreeRuntimeSurfaceStability = Readonly<{
  frontend: PreviewApplicableCapabilityStabilityRecord
  pages: PreviewApplicableCapabilityStabilityRecord
  worker: PreviewApplicableCapabilityStabilityRecord
  schedule: PreviewNotApplicableCapabilityStabilityRecord
}>

export type PreviewOverallStabilityResult =
  | Readonly<{
      overallComparison: 'MATCH'
      overallCompleteness: 'complete'
      reasonCode: 'all-required-comparisons-match'
    }>
  | Readonly<{
      overallComparison: 'DRIFT'
      overallCompleteness: 'complete'
      reasonCode: 'semantic-drift-detected'
    }>
  | Readonly<{
      overallComparison: 'UNKNOWN'
      overallCompleteness: 'incomplete'
      reasonCode: 'unknown-required-comparison'
    }>

interface PreviewStableComparisonResultBase {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-stable-read-comparison'
  readonly environment: 'preview'
  readonly resourceInventory: readonly [
    'account',
    'account-zones',
    'backend-schema-version',
    'd1-database',
    'migration-rows',
    'migration-table-discovery',
    'pages-preview-deployments',
    'pages-project',
    'worker-custom-domains',
    'worker-deployments',
    'worker-routes',
    'worker-schedules',
    'worker-settings',
    'worker-subdomain',
  ]
  readonly capabilityInventory: readonly [
    'leaderboardRead',
    'identityClaim',
    'identityStatus',
    'identityRename',
    'draftSubmission',
    'identityRecovery',
    'cleanupCron',
  ]
  readonly surfaceInventory: readonly ['frontend', 'pages', 'worker', 'schedule']
  readonly readOneSemanticHash: PreviewSemanticHash
  readonly readTwoSemanticHash: PreviewSemanticHash
  readonly resources: Readonly<{
    [Operation in keyof PreviewSemanticResourceValueByOperation]:
      PreviewResourceStabilityRecord<PreviewSemanticResourceValueByOperation[Operation]>
  }>
  readonly capabilities: Readonly<{
    leaderboardRead: Readonly<{ surfaces: Readonly<{
      frontend: PreviewApplicableCapabilityStabilityRecord
      pages: PreviewApplicableCapabilityStabilityRecord
      worker: PreviewNotApplicableCapabilityStabilityRecord
      schedule: PreviewNotApplicableCapabilityStabilityRecord
    }> }>
    identityClaim: Readonly<{ surfaces: ThreeRuntimeSurfaceStability }>
    identityStatus: Readonly<{ surfaces: ThreeRuntimeSurfaceStability }>
    identityRename: Readonly<{ surfaces: ThreeRuntimeSurfaceStability }>
    draftSubmission: Readonly<{ surfaces: ThreeRuntimeSurfaceStability }>
    identityRecovery: Readonly<{ surfaces: ThreeRuntimeSurfaceStability }>
    cleanupCron: Readonly<{ surfaces: Readonly<{
      frontend: PreviewNotApplicableCapabilityStabilityRecord
      pages: PreviewNotApplicableCapabilityStabilityRecord
      worker: PreviewApplicableCapabilityStabilityRecord
      schedule: PreviewApplicableCapabilityStabilityRecord
    }> }>
  }>
  readonly releaseCurrentness: 'UNKNOWN'
  readonly executionAuthorization: 'prohibited'
  readonly noRemoteMutation: true
  readonly productionContacted: false
}

export type PreviewStableComparisonResult =
  PreviewStableComparisonResultBase & PreviewOverallStabilityResult

export const PREVIEW_STABLE_COMPARISON_SCHEMA_VERSION: 1
export const PREVIEW_STABLE_COMPARISON_KIND:
  'pennant-pursuit-preview-stable-read-comparison'
export const PREVIEW_STABILITY_COMPARISONS: readonly ['MATCH', 'DRIFT', 'UNKNOWN']
export const PREVIEW_STABLE_COMPARISON_MAX_BYTES: 2097152
export function comparePreviewSingleReadSnapshots(
  readOneInput: PreviewSingleReadSnapshot,
  readTwoInput: PreviewSingleReadSnapshot,
): PreviewStableComparisonResult
