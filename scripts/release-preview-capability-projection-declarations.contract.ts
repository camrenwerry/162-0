import {
  createPreviewCapabilityProjection,
  PREVIEW_CAPABILITY_PROJECTION_KIND,
  PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES,
  PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION,
  PREVIEW_CANDIDATE_GATE_MODES,
  PREVIEW_CANDIDATE_STATES,
  renderPreviewCapabilityProjection,
  validatePreviewCapabilityProjection,
  type PreviewCandidateState,
  type PreviewCandidateSurface,
  type PreviewCandidateSurfaceRecord,
  type PreviewCapabilityCandidateProjection,
} from './lib/release-inspection/preview-capability-projection.mjs'
import {
  createPreviewSingleReadSnapshot,
  type PreviewSingleReadSnapshot,
} from './lib/release-inspection/preview-observation-contracts.mjs'

const snapshot = createPreviewSingleReadSnapshot({ capturedAtMs: 1 })
const projection: PreviewCapabilityCandidateProjection = createPreviewCapabilityProjection(snapshot)
const exactInventory: readonly [
  'leaderboardRead',
  'identityClaim',
  'identityStatus',
  'identityRename',
  'draftSubmission',
  'identityRecovery',
  'cleanupCron',
] = projection.capabilityInventory
const exactSurfaces: readonly ['frontend', 'pages', 'worker', 'schedule'] = projection.surfaceInventory
const exactTimestamp: PreviewSingleReadSnapshot['capturedAtMs'] = projection.sourceCapturedAtMs
const candidate: PreviewCandidateState = projection.capabilities.leaderboardRead.surfaces.frontend.candidateState
const surface: PreviewCandidateSurface = 'schedule'
const applicableRecord: PreviewCandidateSurfaceRecord = {
  applicability: 'applicable',
  candidateState: 'unknown',
}
const nonApplicableRecord: PreviewCandidateSurfaceRecord = {
  applicability: 'not-applicable',
  candidateState: 'not-applicable',
}
validatePreviewCapabilityProjection(projection)
renderPreviewCapabilityProjection(projection)
PREVIEW_CAPABILITY_PROJECTION_KIND satisfies 'pennant-pursuit-preview-capability-candidate-projection'
PREVIEW_CAPABILITY_PROJECTION_SCHEMA_VERSION satisfies 1
PREVIEW_CAPABILITY_PROJECTION_MAX_BYTES satisfies 16384
PREVIEW_CANDIDATE_GATE_MODES satisfies readonly ['disabled', 'enabled']
PREVIEW_CANDIDATE_STATES satisfies readonly ['disabled', 'enabled', 'unknown']
void exactInventory
void exactSurfaces
void exactTimestamp
void candidate
void surface
void applicableRecord
void nonApplicableRecord

const structuralSnapshot = {
  schemaVersion: 1 as const,
  kind: 'pennant-pursuit-preview-single-read-observation' as const,
  environment: 'preview' as const,
  capturedAtMs: 1,
  observationState: 'unavailable' as const,
  resourceOutcomes: [],
  freshnessStatus: 'unknown' as const,
  releaseCurrentness: 'UNKNOWN' as const,
  executionAuthorization: 'prohibited' as const,
  noRemoteMutation: true as const,
  noSecretValues: true as const,
  productionContacted: false as const,
}
// @ts-expect-error Hand-authored structural snapshots are not opaque validated authority.
createPreviewCapabilityProjection(structuralSnapshot)
const clonedSnapshot = { ...snapshot }
// @ts-expect-error Structural clones lose the declaration-private nominal authority.
createPreviewCapabilityProjection(clonedSnapshot)
// @ts-expect-error Unbranded input cannot claim the opaque snapshot type.
const unbrandedSnapshot: PreviewSingleReadSnapshot = structuralSnapshot
void unbrandedSnapshot

type LeaderboardSurfaces = PreviewCapabilityCandidateProjection['capabilities']['leaderboardRead']['surfaces']
type CleanupSurfaces = PreviewCapabilityCandidateProjection['capabilities']['cleanupCron']['surfaces']
type IdentitySurfaces = PreviewCapabilityCandidateProjection['capabilities']['identityClaim']['surfaces']

// @ts-expect-error leaderboardRead.worker is permanently non-applicable.
const leaderboardWorkerApplicable: LeaderboardSurfaces = { ...projection.capabilities.leaderboardRead.surfaces, worker: applicableRecord }
// @ts-expect-error leaderboardRead.schedule is permanently non-applicable.
const leaderboardScheduleApplicable: LeaderboardSurfaces = { ...projection.capabilities.leaderboardRead.surfaces, schedule: applicableRecord }
// @ts-expect-error cleanupCron.frontend is permanently non-applicable.
const cleanupFrontendApplicable: CleanupSurfaces = { ...projection.capabilities.cleanupCron.surfaces, frontend: applicableRecord }
// @ts-expect-error cleanupCron.pages is permanently non-applicable.
const cleanupPagesApplicable: CleanupSurfaces = { ...projection.capabilities.cleanupCron.surfaces, pages: applicableRecord }
void leaderboardWorkerApplicable
void leaderboardScheduleApplicable
void cleanupFrontendApplicable
void cleanupPagesApplicable

const { cleanupCron: _missingCapability, ...missingCapability } = projection.capabilities
// @ts-expect-error The exact capability inventory cannot omit cleanupCron.
const missingCapabilityProjection: PreviewCapabilityCandidateProjection['capabilities'] = missingCapability
// @ts-expect-error The exact capability inventory cannot contain extras.
const extraCapabilityProjection: PreviewCapabilityCandidateProjection['capabilities'] = { ...projection.capabilities, extraCapability: projection.capabilities.identityClaim }
const { schedule: _missingSurface, ...missingSurface } = projection.capabilities.identityClaim.surfaces
// @ts-expect-error Every capability requires the exact four-surface inventory.
const missingSurfaceProjection: IdentitySurfaces = missingSurface
// @ts-expect-error Surface records cannot contain extra surfaces.
const extraSurfaceProjection: IdentitySurfaces = { ...projection.capabilities.identityClaim.surfaces, production: applicableRecord }
void _missingCapability
void _missingSurface
void missingCapabilityProjection
void extraCapabilityProjection
void missingSurfaceProjection
void extraSurfaceProjection

// @ts-expect-error Candidate state vocabulary is closed.
const match: PreviewCandidateState = 'MATCH'
// @ts-expect-error Surface vocabulary is closed.
const production: PreviewCandidateSurface = 'production'
// @ts-expect-error Applicable surfaces accept only disabled, enabled, or unknown.
const invalidCandidate: LeaderboardSurfaces['frontend'] = { applicability: 'applicable', candidateState: 'not-applicable' }
// @ts-expect-error Non-applicable surfaces require the exact non-applicable representation.
const malformedNonApplicable: LeaderboardSurfaces['worker'] = { applicability: 'not-applicable', candidateState: 'disabled' }
void match
void production
void invalidCandidate
void malformedNonApplicable

// @ts-expect-error Capability inventory values and ordering are exact.
const wrongCapabilityOrder: PreviewCapabilityCandidateProjection['capabilityInventory'] = ['identityClaim', 'leaderboardRead', 'identityStatus', 'identityRename', 'draftSubmission', 'identityRecovery', 'cleanupCron']
// @ts-expect-error Surface inventory values and ordering are exact.
const wrongSurfaceOrder: PreviewCapabilityCandidateProjection['surfaceInventory'] = ['pages', 'frontend', 'worker', 'schedule']
// @ts-expect-error sourceCapturedAtMs accepts only validator-produced non-negative safe timestamps.
const invalidSourceCapturedAtMs: PreviewCapabilityCandidateProjection['sourceCapturedAtMs'] = -1
// @ts-expect-error Currentness is permanently UNKNOWN.
const changedCurrentness: PreviewCapabilityCandidateProjection['releaseCurrentness'] = 'CURRENT'
// @ts-expect-error Execution authorization is permanently prohibited.
const changedAuthorization: PreviewCapabilityCandidateProjection['executionAuthorization'] = 'approved'
// @ts-expect-error Remote mutation is permanently forbidden.
const changedNoRemoteMutation: PreviewCapabilityCandidateProjection['noRemoteMutation'] = false
// @ts-expect-error Production contact is permanently false.
const changedProductionContacted: PreviewCapabilityCandidateProjection['productionContacted'] = true
void wrongCapabilityOrder
void wrongSurfaceOrder
void invalidSourceCapturedAtMs
void changedCurrentness
void changedAuthorization
void changedNoRemoteMutation
void changedProductionContacted
