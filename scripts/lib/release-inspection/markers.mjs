import { types as utilTypes } from 'node:util'
import { immutablePlain } from '../preview-release/canonical.mjs'

export const RELEASE_INSPECTION_TOOL_CONTRACT_VERSION = 'release-inspection-local-only-v1'

export const RELEASE_INSPECTION_KINDS = Object.freeze({
  manifest: 'pennant-pursuit-release-inspection-manifest',
  capabilityMatrix: 'pennant-pursuit-release-inspection-capability-matrix',
  bindingPolicy: 'pennant-pursuit-release-inspection-binding-policy',
  observationPlaceholder: 'pennant-pursuit-release-inspection-observation-placeholder',
  localProjection: 'pennant-pursuit-release-inspection-local-projection',
})

const normalizeMarker = (value) => value.normalize('NFKC').toLowerCase()
const RELEASE_INSPECTION_MARKERS = new Set([
  ...Object.values(RELEASE_INSPECTION_KINDS),
  RELEASE_INSPECTION_TOOL_CONTRACT_VERSION,
].map(normalizeMarker))
const UNAMBIGUOUS_INSPECTION_KEYS = new Set([
  'artifactKind',
  'toolContract',
  'capabilityMatrix',
  'bindingPolicy',
  'remoteObservation',
  'executionAuthorization',
  'remoteCurrentness',
  'authorityHash',
  'protectedSourceHashes',
  'noNetworkAccess',
  'noFilesystemWrites',
  'policy',
  'result',
].map(normalizeMarker))
const CONTEXTUAL_INSPECTION_KEYS = new Set([
  'schemaVersion',
  'toolContractVersion',
  'provenance',
  'manifestHash',
].map(normalizeMarker))
const INSPECTION_FRAGMENT_KEYS = new Set([
  ...UNAMBIGUOUS_INSPECTION_KEYS,
  ...CONTEXTUAL_INSPECTION_KEYS,
])
const MARKER_BEARING_KEYS = new Set([
  'kind',
  ...INSPECTION_FRAGMENT_KEYS,
].map(normalizeMarker))
const MAX_DEPTH = 64
const MAX_NODES = 50_000
const MAX_PROPERTIES = 100_000

const LEGACY_ROOT_KEYSETS = Object.freeze({
  releasePackage: Object.freeze([
    'approval', 'artifactHash', 'bindingHash', 'createdAt', 'evidence', 'expirationPolicy',
    'expiresAt', 'kind', 'plan', 'planHash', 'schemaVersion',
  ]),
  releasePlan: Object.freeze([
    'approvalCheckpoints', 'artifactEvidence', 'deploymentOutcome', 'executionContract',
    'expectedFinalTopology', 'futureStages', 'gitHead', 'hashes', 'manifestContract', 'migration',
    'noRemoteMutation', 'observedState', 'operationalVerificationRequired', 'outcome', 'phase',
    'planId', 'planSchemaVersion', 'remoteBefore', 'repository', 'rollbackImplications',
    'satisfiedStages', 'serverDevelopHead', 'statement', 'targetState', 'toolContractVersion',
    'unresolvedItems',
  ]),
  executionContract: Object.freeze([
    'finalValidation', 'mutationBoundary', 'orderedStages', 'releaseBoundary', 'version',
  ]),
  releasePlanBuilder: Object.freeze([
    'compiled', 'hashes', 'local', 'manifest', 'manifestHash', 'migration', 'remote',
    'serverHead', 'targetState',
  ]),
  executionContractBuilder: Object.freeze([
    'futureStages', 'gitHead', 'manifest', 'previewOrigin', 'targetState',
  ]),
  checkReport: Object.freeze([
    'checks', 'command', 'mode', 'noRemoteMutation', 'schemaVersion', 'status',
  ]),
  failureReport: Object.freeze([
    'checks', 'command', 'error', 'exitCode', 'noRemoteMutation', 'schemaVersion', 'status',
  ]),
  validationReport: Object.freeze(['checks', 'kind', 'schemaVersion', 'status']),
  rollbackGuidance: Object.freeze([
    'automaticRollbackPerformed', 'd1MigrationMayHaveAdvanced', 'd1RollbackAvailable',
    'failedStageId', 'kind', 'nextAction', 'publicGateMayBeEnabled', 'schemaVersion',
    'urgency', 'warning',
  ]),
  executionReport: Object.freeze([
    'artifactHash', 'completedAt', 'error', 'gitHead', 'kind', 'mutationAttempted',
    'planId', 'productionMutationAttempted', 'rollback', 'schemaVersion', 'stages',
    'startedAt', 'status', 'summary', 'targetState', 'validation',
  ]),
})

const LEGACY_ALLOWED_CONTEXTUAL_PATHS = Object.freeze({
  releasePackage: Object.freeze([
    'schemaVersion',
    'evidence.schemaVersion',
    'plan.toolContractVersion',
    'plan.manifestContract.schemaVersion',
    'plan.manifestContract.toolContractVersion',
    'plan.remoteBefore.schemaVersion',
    'plan.artifactEvidence.pages.provenance',
    'plan.artifactEvidence.worker.provenance',
    'plan.executionContract.releaseBoundary.toolContractVersion',
  ]),
  releasePlan: Object.freeze([
    'toolContractVersion',
    'manifestContract.schemaVersion',
    'manifestContract.toolContractVersion',
    'remoteBefore.schemaVersion',
    'artifactEvidence.pages.provenance',
    'artifactEvidence.worker.provenance',
    'executionContract.releaseBoundary.toolContractVersion',
  ]),
  executionContract: Object.freeze(['releaseBoundary.toolContractVersion']),
  releasePlanBuilder: Object.freeze([
    'manifestHash',
    'manifest.schemaVersion',
    'manifest.toolContractVersion',
    'remote.schemaVersion',
    'compiled.schemaVersion',
    'compiled.disabled.schemaVersion',
  ]),
  executionContractBuilder: Object.freeze([
    'manifest.schemaVersion',
    'manifest.toolContractVersion',
  ]),
  checkReport: Object.freeze(['schemaVersion']),
  failureReport: Object.freeze(['schemaVersion']),
  validationReport: Object.freeze(['schemaVersion']),
  rollbackGuidance: Object.freeze(['schemaVersion']),
  executionReport: Object.freeze(['schemaVersion']),
})

function exactOwnDataKeys(value, expected) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return false
  let keys
  let prototype
  try {
    keys = Reflect.ownKeys(value)
    prototype = Reflect.getPrototypeOf(value)
  } catch {
    return false
  }
  if (prototype !== Object.prototype || keys.some((key) => typeof key !== 'string')) return false
  if (keys.length !== expected.length || [...expected].some((key) => !keys.includes(key))) return false
  return keys.every((key) => {
    let descriptor
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    } catch {
      return false
    }
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true
  })
}

function classifyLegacyRoot(root) {
  for (const [shape, keys] of Object.entries(LEGACY_ROOT_KEYSETS)) {
    if (exactOwnDataKeys(root, keys)) return shape
  }
  return null
}

function allowedContextualPaths(shape) {
  return new Set((LEGACY_ALLOWED_CONTEXTUAL_PATHS[shape] ?? []).map((entry) => (
    entry.split('.').map(normalizeMarker).join('.')
  )))
}

function barrierError() {
  return new TypeError(
    'Release-inspection contract refused: release-inspection artifacts are evidence only and are prohibited from legacy deployment and execution paths.',
  )
}

function assertNoMarkerInDescriptorGraph(root) {
  const active = new WeakSet()
  const seen = new WeakSet()
  const legacyShape = classifyLegacyRoot(root)
  const allowedPaths = allowedContextualPaths(legacyShape)
  let nodes = 0
  let properties = 0

  const visit = (value, depth, trail = []) => {
    if (typeof value === 'string') {
      if (RELEASE_INSPECTION_MARKERS.has(normalizeMarker(value))) throw barrierError()
      return
    }
    if (value === null || ['undefined', 'boolean', 'number'].includes(typeof value)) return
    if (typeof value !== 'object') throw barrierError()
    if (utilTypes.isProxy(value) || depth > MAX_DEPTH || nodes >= MAX_NODES
      || active.has(value) || seen.has(value)) throw barrierError()
    active.add(value)
    seen.add(value)
    nodes += 1

    let current = value
    while (current !== null && current !== Object.prototype && current !== Array.prototype) {
      let keys
      let prototype
      try {
        keys = Reflect.ownKeys(current)
        prototype = Reflect.getPrototypeOf(current)
      } catch {
        throw barrierError()
      }
      properties += keys.length
      if (properties > MAX_PROPERTIES) throw barrierError()
      for (const key of keys) {
        if (typeof key !== 'string') throw barrierError()
        const normalizedKey = normalizeMarker(key)
        const normalizedPath = [...trail, normalizedKey].join('.')
        let descriptor
        try {
          descriptor = Reflect.getOwnPropertyDescriptor(current, key)
        } catch {
          throw barrierError()
        }
        if (!descriptor) throw barrierError()
        if (!Object.hasOwn(descriptor, 'value')) {
          if (MARKER_BEARING_KEYS.has(normalizedKey)) throw barrierError()
          throw new TypeError(Array.isArray(value)
            ? 'Plain arrays require standard data elements.'
            : 'Plain objects cannot contain accessors.')
        }
        if (UNAMBIGUOUS_INSPECTION_KEYS.has(normalizedKey)
          || (CONTEXTUAL_INSPECTION_KEYS.has(normalizedKey) && !allowedPaths.has(normalizedPath))) {
          throw barrierError()
        }
        visit(descriptor.value, depth + 1, [...trail, normalizedKey])
      }
      current = prototype
    }
    active.delete(value)
  }

  visit(root, 0)
}

export function assertNoReleaseInspectionArtifactForLegacyExecution(input) {
  assertNoMarkerInDescriptorGraph(input)
  try {
    immutablePlain(input)
  } catch {
    throw barrierError()
  }
  return input
}
