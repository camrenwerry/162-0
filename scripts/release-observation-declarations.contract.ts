import {
  createOfflineRemoteObservation,
  createUnavailableRemoteEvidence,
  parseRemoteObservationArtifact,
  renderRemoteObservationJson,
  validateRemoteEvidence,
  validateRemoteObservationArtifact,
} from './lib/release-inspection/remote-contracts.mjs'
import {
  assertPaginationBudget,
  assertReviewedRouteZoneBudget,
  assertSerializedObservationBudget,
  consumeRequestBudget,
  createPreviewOperationRequest,
  createRequestBudget,
  parseStrictRemoteJson,
  REMOTE_OBSERVATION_LIMITS,
  validateD1SelectBody,
  validateObservationCredentialEnvironment,
  validatePreviewOperationRequest,
  validateRemoteObservationLimits,
  type PreviewObservationIdentity,
} from './lib/release-inspection/remote-transport.mjs'

const identity: PreviewObservationIdentity = {
  accountId: 'a'.repeat(32),
  pagesProject: 'diamond-draft',
  workerName: 'pennant-pursuit-validation-preview',
  databaseId: 'ba6255b4-9425-4863-b10f-79149180f75a',
  routeZoneIds: ['b'.repeat(32)],
}
const unavailable = createUnavailableRemoteEvidence()
createUnavailableRemoteEvidence('identity-grounding-required')
createUnavailableRemoteEvidence('secret-presence-contract-unavailable')
createUnavailableRemoteEvidence('prerequisite-unavailable')
// @ts-expect-error MATCH reasons are not accepted by the runtime unavailable helper.
createUnavailableRemoteEvidence('observed-match')
validateRemoteEvidence(unavailable)
const offline = createOfflineRemoteObservation()
validateRemoteObservationArtifact(offline)
const serialized = renderRemoteObservationJson(offline)
parseRemoteObservationArtifact(serialized)
// @ts-expect-error The strict artifact parser requires source text.
parseRemoteObservationArtifact(1)
// @ts-expect-error The strict artifact parser requires one argument.
parseRemoteObservationArtifact()

validateD1SelectBody('migration-rows', { sql: 'runtime validates exact SQL', params: [] })
// @ts-expect-error GET operations are not accepted by the runtime D1 helper.
validateD1SelectBody('account', { sql: 'SELECT 1', params: [] })
const request = createPreviewOperationRequest('account', { accountId: identity.accountId }, identity)
validatePreviewOperationRequest(request, identity)
// @ts-expect-error The request builder requires its grounded Preview identity.
createPreviewOperationRequest('account', { accountId: identity.accountId })
parseStrictRemoteJson(new Uint8Array())
// @ts-expect-error The remote parser accepts bytes, not source text.
parseStrictRemoteJson('{}')
validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: 'compile-time-only-placeholder' })
// @ts-expect-error The runtime requires the exact dedicated Preview credential key.
validateObservationCredentialEnvironment({})
// @ts-expect-error Additional credential aliases are rejected by the runtime.
validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: 'compile-time-only-placeholder', CLOUDFLARE_API_TOKEN: 'compile-time-only-placeholder' })
// @ts-expect-error The runtime rejects a Production Worker identity substitution.
createPreviewOperationRequest('worker-settings', { accountId: identity.accountId, workerName: 'pennant-pursuit-validation-production' }, { ...identity, workerName: 'pennant-pursuit-validation-production' })
validateRemoteObservationLimits(REMOTE_OBSERVATION_LIMITS)
let budget = createRequestBudget('full-read')
budget = consumeRequestBudget(budget, 'account')
createRequestBudget('double-read')
// @ts-expect-error Unsupported request-budget kinds fail at runtime.
createRequestBudget('single-read')
// @ts-expect-error Unknown operations fail at runtime.
consumeRequestBudget(budget, 'arbitrary-operation')
assertPaginationBudget({ page: 1, pages: 1, records: 0 })
assertReviewedRouteZoneBudget(identity.routeZoneIds)
assertSerializedObservationBudget(serialized)
// @ts-expect-error Serialized observation budget input must be text.
assertSerializedObservationBudget(new Uint8Array())
