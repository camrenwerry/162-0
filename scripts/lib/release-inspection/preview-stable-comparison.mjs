import { createHash } from 'node:crypto'
import { TextEncoder } from 'node:util'
import { SCHEMA4_CAPABILITIES } from '../../../shared/schema4-capabilities.mjs'
import { canonicalJson, immutablePlain } from '../preview-release/canonical-data.mjs'
import {
  RELEASE_INSPECTION_CAPABILITY_SURFACES,
  RELEASE_INSPECTION_SURFACES,
} from './capability-model.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import {
  createPreviewCapabilityProjection,
} from './preview-capability-projection.mjs'
import {
  resolveValidatedPreviewCapabilityProjectionInput,
} from './preview-capability-projection-authority.mjs'
import { PREVIEW_OPERATION_INVENTORY } from './preview-observation-limits.mjs'
import {
  createPreviewStabilityProjection,
} from './preview-stability-projection.mjs'

export const PREVIEW_STABLE_COMPARISON_SCHEMA_VERSION = 1
export const PREVIEW_STABLE_COMPARISON_KIND =
  'pennant-pursuit-preview-stable-read-comparison'
export const PREVIEW_STABILITY_COMPARISONS = Object.freeze(['MATCH', 'DRIFT', 'UNKNOWN'])
export const PREVIEW_STABLE_COMPARISON_MAX_BYTES = 2_097_152

const textEncoder = new TextEncoder()

function fail(reason) {
  throw new TypeError(`Preview stable comparison refused: ${reason}.`)
}

function semanticHash(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function compareResource(readOne, readTwo) {
  if (readOne.state !== 'complete' || readTwo.state !== 'complete') {
    return {
      comparison: 'UNKNOWN',
      reason: 'incomplete-resource-evidence',
      readOneState: readOne.state,
      readTwoState: readTwo.state,
      readOneSemanticHash: readOne.semanticHash,
      readTwoSemanticHash: readTwo.semanticHash,
    }
  }
  if (canonicalJson(readOne.value) !== canonicalJson(readTwo.value)) {
    return {
      comparison: 'DRIFT',
      reason: 'semantic-values-differ',
      readOneState: 'complete',
      readTwoState: 'complete',
      readOneSemanticHash: readOne.semanticHash,
      readTwoSemanticHash: readTwo.semanticHash,
    }
  }
  return {
    comparison: 'MATCH',
    reason: 'semantic-values-equal',
    readOneState: 'complete',
    readTwoState: 'complete',
    readOneSemanticHash: readOne.semanticHash,
    readTwoSemanticHash: readTwo.semanticHash,
    stableValue: readOne.value,
  }
}

function compareCapabilitySurface(readOne, readTwo, applicable) {
  if (!applicable) {
    if (readOne.applicability !== 'not-applicable'
      || readTwo.applicability !== 'not-applicable'
      || readOne.candidateState !== 'not-applicable'
      || readTwo.candidateState !== 'not-applicable') {
      fail('candidate projection contains contradictory non-applicable surface evidence')
    }
    return {
      applicability: 'not-applicable',
      comparison: 'not-applicable',
      reason: 'not-applicable',
      readOneState: 'not-applicable',
      readTwoState: 'not-applicable',
    }
  }
  if (readOne.applicability !== 'applicable' || readTwo.applicability !== 'applicable') {
    fail('candidate projection contains an applicability mismatch')
  }
  if (readOne.candidateState === 'unknown' || readTwo.candidateState === 'unknown') {
    return {
      applicability: 'applicable',
      comparison: 'UNKNOWN',
      reason: 'unknown-candidate-state',
      readOneState: readOne.candidateState,
      readTwoState: readTwo.candidateState,
    }
  }
  const comparison = readOne.candidateState === readTwo.candidateState ? 'MATCH' : 'DRIFT'
  return {
    applicability: 'applicable',
    comparison,
    reason: comparison === 'MATCH' ? 'candidate-states-equal' : 'candidate-states-differ',
    readOneState: readOne.candidateState,
    readTwoState: readTwo.candidateState,
  }
}

function compareCapabilities(readOneProjection, readTwoProjection) {
  const capabilities = {}
  for (const capability of SCHEMA4_CAPABILITIES) {
    const applicable = new Set(RELEASE_INSPECTION_CAPABILITY_SURFACES[capability])
    const surfaces = {}
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      surfaces[surface] = compareCapabilitySurface(
        readOneProjection.capabilities[capability].surfaces[surface],
        readTwoProjection.capabilities[capability].surfaces[surface],
        applicable.has(surface),
      )
    }
    capabilities[capability] = { surfaces }
  }
  return capabilities
}

function readSemanticHash(resourceProjection, capabilityProjection) {
  return semanticHash({
    resources: Object.fromEntries(PREVIEW_OPERATION_INVENTORY.map((operation) => {
      const resource = resourceProjection.resources[operation]
      return [operation, { state: resource.state, semanticHash: resource.semanticHash }]
    })),
    capabilities: Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [
      capability,
      {
        surfaces: Object.fromEntries(RELEASE_INSPECTION_SURFACES.map((surface) => {
          const record = capabilityProjection.capabilities[capability].surfaces[surface]
          return [surface, {
            applicability: record.applicability,
            candidateState: record.candidateState,
          }]
        })),
      },
    ])),
  })
}

function aggregate(resources, capabilities) {
  const required = [
    ...Object.values(resources).map(({ comparison }) => comparison),
    ...SCHEMA4_CAPABILITIES.flatMap((capability) => RELEASE_INSPECTION_SURFACES
      .map((surface) => capabilities[capability].surfaces[surface])
      .filter(({ applicability }) => applicability !== 'not-applicable')
      .map(({ comparison }) => comparison)),
  ]
  if (required.includes('UNKNOWN')) {
    return {
      overallComparison: 'UNKNOWN',
      overallCompleteness: 'incomplete',
      reasonCode: 'unknown-required-comparison',
    }
  }
  if (required.includes('DRIFT')) {
    return {
      overallComparison: 'DRIFT',
      overallCompleteness: 'complete',
      reasonCode: 'semantic-drift-detected',
    }
  }
  return {
    overallComparison: 'MATCH',
    overallCompleteness: 'complete',
    reasonCode: 'all-required-comparisons-match',
  }
}

export function comparePreviewSingleReadSnapshots(readOneInput, readTwoInput) {
  assertReleaseInspectionIntrinsicIntegrity()
  if (arguments.length !== 2) fail('exactly two opaque validated snapshots are required')

  // Resolve both identities before any snapshot property is read. This makes
  // provenance rejection independent of getters, proxies, copied properties,
  // symbols, prototypes, or other caller-controlled structure.
  resolveValidatedPreviewCapabilityProjectionInput(readOneInput)
  resolveValidatedPreviewCapabilityProjectionInput(readTwoInput)

  const readOneResources = createPreviewStabilityProjection(readOneInput)
  const readTwoResources = createPreviewStabilityProjection(readTwoInput)
  const readOneCapabilities = createPreviewCapabilityProjection(readOneInput)
  const readTwoCapabilities = createPreviewCapabilityProjection(readTwoInput)
  const resources = Object.fromEntries(PREVIEW_OPERATION_INVENTORY.map((operation) => [
    operation,
    compareResource(
      readOneResources.resources[operation],
      readTwoResources.resources[operation],
    ),
  ]))
  const capabilities = compareCapabilities(readOneCapabilities, readTwoCapabilities)
  const aggregateResult = aggregate(resources, capabilities)
  const comparison = immutablePlain({
    schemaVersion: PREVIEW_STABLE_COMPARISON_SCHEMA_VERSION,
    kind: PREVIEW_STABLE_COMPARISON_KIND,
    environment: 'preview',
    resourceInventory: PREVIEW_OPERATION_INVENTORY,
    capabilityInventory: SCHEMA4_CAPABILITIES,
    surfaceInventory: RELEASE_INSPECTION_SURFACES,
    readOneSemanticHash: readSemanticHash(readOneResources, readOneCapabilities),
    readTwoSemanticHash: readSemanticHash(readTwoResources, readTwoCapabilities),
    resources,
    capabilities,
    ...aggregateResult,
    releaseCurrentness: 'UNKNOWN',
    executionAuthorization: 'prohibited',
    noRemoteMutation: true,
    productionContacted: false,
  })
  if (textEncoder.encode(canonicalJson(comparison)).byteLength > PREVIEW_STABLE_COMPARISON_MAX_BYTES) {
    fail('canonical comparison exceeds the fixed byte limit')
  }
  return comparison
}
