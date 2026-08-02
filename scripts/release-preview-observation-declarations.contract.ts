import {
  createPreviewSingleReadSnapshot,
  PREVIEW_RESOURCE_OUTCOME_STATES,
  PREVIEW_SINGLE_READ_KIND,
  renderPreviewSingleReadJson,
  validatePreviewSingleReadSnapshot,
  type PreviewResourceOutcome,
  type PreviewResourcePlaceholder,
  type PreviewPagesProjectObservation,
  type PreviewD1DatabaseObservation,
  type PreviewBackendSchemaObservation,
  type PreviewWorkerRoutesObservation,
  type PreviewBindingObservation,
} from './lib/release-inspection/preview-observation-contracts.mjs'
import {
  loadPreviewObservationIdentity,
  validatePreviewObservationIdentity,
  type PreviewObservationIdentity,
} from './lib/release-inspection/preview-identity.mjs'
import {
  createPreviewHttpTransport,
  type PreviewHttpTransportDependencies,
  type PreviewTransportOperation,
} from './lib/release-inspection/preview-http-transport.mjs'
import {
  observePreviewResourcesWithTransport,
  type PreviewResourceObservationAuthority,
} from './lib/release-inspection/preview-resource-observer.mjs'

const value: PreviewResourcePlaceholder = {
  kind: 'preview-resource-observation-placeholder',
  schemaVersion: 1,
}
const complete: PreviewResourceOutcome = {
  operation: 'account',
  state: 'complete',
  issueCode: null,
  capturedAtMs: 1,
  value,
}
const missing: PreviewResourceOutcome = {
  operation: 'account-zones',
  state: 'missing',
  issueCode: 'resource-missing',
  capturedAtMs: 1,
  value: null,
}
const snapshot = createPreviewSingleReadSnapshot({ capturedAtMs: 1, resourceOutcomes: [complete] })
validatePreviewSingleReadSnapshot(snapshot)
renderPreviewSingleReadJson(snapshot)
PREVIEW_RESOURCE_OUTCOME_STATES.includes('contradictory')
PREVIEW_SINGLE_READ_KIND satisfies 'pennant-pursuit-preview-single-read-observation'
void missing

// @ts-expect-error Double-read stability authority is not part of the single-read vocabulary.
PREVIEW_RESOURCE_OUTCOME_STATES.includes('stable')
// @ts-expect-error Complete outcomes require the typed placeholder value.
const completeWithNull: PreviewResourceOutcome = { ...complete, value: null }
// @ts-expect-error Missing outcomes require null rather than a value.
const missingWithValue: PreviewResourceOutcome = { ...missing, value }
// @ts-expect-error Issue codes are discriminated by state.
const wrongIssue: PreviewResourceOutcome = { ...missing, issueCode: 'resource-malformed' }
// @ts-expect-error Arbitrary normalized records are not a resource value.
const arbitraryValue: PreviewResourcePlaceholder = { approval: true }
void completeWithNull
void missingWithValue
void wrongIssue
void arbitraryValue

const pagesValue: PreviewPagesProjectObservation = {
  kind: 'preview-pages-project-observation',
  schemaVersion: 1,
  identity: 'approved-preview-pages-project',
  compatibilityDate: null,
  compatibilityFlags: [],
  wranglerConfigurationHash: null,
  variables: [],
  bindings: [],
}
void pagesValue
// @ts-expect-error Pages project identity is exact.
const forgedPagesIdentity: PreviewPagesProjectObservation = { ...pagesValue, identity: 'forged' }
// @ts-expect-error Pages cannot contain Worker-only rate-limit bindings.
const forgedPagesBinding: PreviewPagesProjectObservation = { ...pagesValue, bindings: [{ category: 'rate-limit', name: 'RATE_LIMIT_BURST', target: 'preview-rate-limit-burst', limit: 1, periodSeconds: 1 }] }
void forgedPagesIdentity
void forgedPagesBinding
// @ts-expect-error Resource values are discriminated by their registered operation.
const mismatchedPagesOutcome: PreviewResourceOutcome = {
  operation: 'account',
  state: 'complete',
  issueCode: null,
  capturedAtMs: 1,
  value: pagesValue,
}
void mismatchedPagesOutcome

const identity = loadPreviewObservationIdentity('/reviewed/repository')
validatePreviewObservationIdentity(identity)
// @ts-expect-error Repository roots must be text.
loadPreviewObservationIdentity(1)
// @ts-expect-error Opaque identity authority cannot be supplied structurally.
const forgedIdentity: PreviewObservationIdentity = {}
void forgedIdentity

const dependencies: PreviewHttpTransportDependencies = {
  fetchImplementation: globalThis.fetch,
  setTimer: globalThis.setTimeout,
  clearTimer: globalThis.clearTimeout,
}
const transport = createPreviewHttpTransport(
  identity,
  { PENNANT_PREVIEW_API_TOKEN: 'compile-time-placeholder' },
  dependencies,
)
const paged: PreviewTransportOperation = { operation: 'account-zones', page: 1 }
const routed: PreviewTransportOperation = { operation: 'worker-routes', routeZoneIndex: 0 }
transport.request({ operation: 'account' })
transport.request(paged)
transport.request(routed)
// @ts-expect-error Paginated operations require an explicit page.
transport.request({ operation: 'account-zones' })
// @ts-expect-error Production is not an operation or environment option.
transport.request({ operation: 'production' })
// @ts-expect-error Optional dependency functions may be absent but not explicitly undefined.
const explicitUndefined: PreviewHttpTransportDependencies = { fetchImplementation: undefined }
void explicitUndefined
// @ts-expect-error The dedicated Preview credential field is required.
createPreviewHttpTransport(identity, {}, dependencies)
declare const resourceAuthority: PreviewResourceObservationAuthority
observePreviewResourcesWithTransport(resourceAuthority, { capturedAtMs: 1 })
// @ts-expect-error Resource observation authority cannot be supplied structurally.
const forgedResourceAuthority: PreviewResourceObservationAuthority = {}
// @ts-expect-error A structurally plausible request object is not opaque authority.
observePreviewResourcesWithTransport({ request: async () => ({}), reviewedRouteZoneCount: 1 }, { capturedAtMs: 1 })
void forgedResourceAuthority

const exactD1: PreviewD1DatabaseObservation = { kind: 'preview-d1-database-observation', schemaVersion: 1, identity: 'approved-preview-d1', name: 'pennant-pursuit-preview' }
const exactBackend: PreviewBackendSchemaObservation = { kind: 'preview-backend-schema-observation', schemaVersion: 1, singletonIdentity: 'backend-schema-singleton', version: 4 }
const exactRoutes: PreviewWorkerRoutesObservation = { kind: 'preview-worker-routes-observation', schemaVersion: 1, routes: [{ identity: 'route', pattern: 'preview.invalid/*', zoneOrdinal: 0, scriptIdentity: 'approved-preview-worker' }] }
const exactBinding: PreviewBindingObservation = { category: 'd1', name: 'DB', target: 'approved-preview-d1' }
void exactD1
void exactBackend
void exactRoutes
void exactBinding
// @ts-expect-error D1 public identity is exact.
const forgedD1Identity: PreviewD1DatabaseObservation = { ...exactD1, identity: 'forged' }
// @ts-expect-error D1 public name is exact.
const forgedD1Name: PreviewD1DatabaseObservation = { ...exactD1, name: 'forged' }
// @ts-expect-error Backend singleton identity is exact.
const forgedBackend: PreviewBackendSchemaObservation = { ...exactBackend, singletonIdentity: 'forged' }
// @ts-expect-error Worker route script identity is exact.
const forgedRoute: PreviewWorkerRoutesObservation = { ...exactRoutes, routes: [{ ...exactRoutes.routes[0], scriptIdentity: 'forged' }] }
// @ts-expect-error Binding target is coupled to its category and name.
const forgedBinding: PreviewBindingObservation = { ...exactBinding, target: 'forged' }
void forgedD1Identity
void forgedD1Name
void forgedBackend
void forgedRoute
void forgedBinding
