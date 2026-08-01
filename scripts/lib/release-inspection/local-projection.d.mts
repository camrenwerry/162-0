import type {
  ReleaseInspectionCapabilityTarget,
  ReleaseInspectionLocalProjection,
  ReleaseInspectionManifest,
} from './contracts.mjs'

export const RELEASE_INSPECTION_MANIFEST_PATH: 'config/release-inspection-manifest.json'
export const EXPECTED_RELEASE_INSPECTION_SURFACES: Readonly<Record<string, readonly string[]>>
export function loadReleaseInspectionManifest(repositoryRoot: string): ReleaseInspectionManifest
export function loadLocalReleaseInspectionSources(
  repositoryRoot: string,
  manifest: ReleaseInspectionManifest,
  nowMs: number,
): Readonly<Record<string, unknown>>
export function createLocalReleaseInspectionProjection(options: Readonly<{
  repositoryRoot: string
  requestedCapabilities?: ReleaseInspectionCapabilityTarget
  nowMs?: number
  sourceLoader?: typeof loadLocalReleaseInspectionSources
}>): ReleaseInspectionLocalProjection
export function renderLocalReleaseInspectionProjection(projection: unknown): string
