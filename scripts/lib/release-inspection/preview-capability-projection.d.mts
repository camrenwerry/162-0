import type { PreviewSingleReadSnapshot } from './preview-observation-contracts.mjs'

export type PreviewCandidateState = 'disabled' | 'enabled' | 'unknown'
export type PreviewCandidateSurface = 'frontend' | 'pages' | 'worker' | 'schedule'
type PreviewApplicableSurfaceRecord = Readonly<{
  applicability: 'applicable'
  candidateState: PreviewCandidateState
}>
type PreviewNotApplicableSurfaceRecord = Readonly<{
  applicability: 'not-applicable'
  candidateState: 'not-applicable'
}>
export type PreviewCandidateSurfaceRecord =
  | PreviewApplicableSurfaceRecord
  | PreviewNotApplicableSurfaceRecord

type PreviewThreeRuntimeSurfaces = Readonly<{
  frontend: PreviewApplicableSurfaceRecord
  pages: PreviewApplicableSurfaceRecord
  worker: PreviewApplicableSurfaceRecord
  schedule: PreviewNotApplicableSurfaceRecord
}>

export interface PreviewCapabilityCandidateProjection {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-capability-candidate-projection'
  readonly environment: 'preview'
  readonly sourceCapturedAtMs: PreviewSingleReadSnapshot['capturedAtMs']
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
  readonly capabilities: Readonly<{
    leaderboardRead: Readonly<{ surfaces: Readonly<{
      frontend: PreviewApplicableSurfaceRecord
      pages: PreviewApplicableSurfaceRecord
      worker: PreviewNotApplicableSurfaceRecord
      schedule: PreviewNotApplicableSurfaceRecord
    }> }>
    identityClaim: Readonly<{ surfaces: PreviewThreeRuntimeSurfaces }>
    identityStatus: Readonly<{ surfaces: PreviewThreeRuntimeSurfaces }>
    identityRename: Readonly<{ surfaces: PreviewThreeRuntimeSurfaces }>
    draftSubmission: Readonly<{ surfaces: PreviewThreeRuntimeSurfaces }>
    identityRecovery: Readonly<{ surfaces: PreviewThreeRuntimeSurfaces }>
    cleanupCron: Readonly<{ surfaces: Readonly<{
      frontend: PreviewNotApplicableSurfaceRecord
      pages: PreviewNotApplicableSurfaceRecord
      worker: PreviewApplicableSurfaceRecord
      schedule: PreviewApplicableSurfaceRecord
    }> }>
  }>
  readonly releaseCurrentness: 'UNKNOWN'
  readonly executionAuthorization: 'prohibited'
  readonly noRemoteMutation: true
  readonly productionContacted: false
}

export const PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION: 1
export const PREVIEW_CAPABILITY_PROJECTION_KIND: 'pennant-pursuit-preview-capability-candidate-projection'
export const PREVIEW_CANDIDATE_GATE_MODES: readonly ['disabled', 'enabled']
export const PREVIEW_CANDIDATE_STATES: readonly ['disabled', 'enabled', 'unknown']
export const PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES: 16384
export function validatePreviewCapabilityProjection(input: unknown): PreviewCapabilityCandidateProjection
export function createPreviewCapabilityProjection(
  validatedInput: PreviewSingleReadSnapshot,
): PreviewCapabilityCandidateProjection
export function renderPreviewCapabilityProjection(input: unknown): string
