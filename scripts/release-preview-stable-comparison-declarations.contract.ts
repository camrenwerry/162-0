import type { PreviewSingleReadSnapshot } from './lib/release-inspection/preview-observation-contracts.mjs'
import {
  comparePreviewSingleReadSnapshots,
  PREVIEW_STABILITY_COMPARISONS,
  type PreviewApplicableCapabilityStabilityRecord,
  type PreviewNotApplicableCapabilityStabilityRecord,
  type PreviewOverallStabilityResult,
  type PreviewResourceStabilityRecord,
  type PreviewStableComparisonResult,
} from './lib/release-inspection/preview-stable-comparison.mjs'
import {
  createPreviewStabilityProjection,
  type PreviewSemanticHash,
  type PreviewSemanticResourceValueByOperation,
  type PreviewSemanticStabilityProjection,
} from './lib/release-inspection/preview-stability-projection.mjs'

declare const readOne: PreviewSingleReadSnapshot
declare const readTwo: PreviewSingleReadSnapshot
declare const digest: PreviewSemanticHash

const comparison: PreviewStableComparisonResult = comparePreviewSingleReadSnapshots(readOne, readTwo)
const projection: PreviewSemanticStabilityProjection = createPreviewStabilityProjection(readOne)
const comparisonVocabulary: readonly ['MATCH', 'DRIFT', 'UNKNOWN'] = PREVIEW_STABILITY_COMPARISONS
const currentness: 'UNKNOWN' = comparison.releaseCurrentness
const authorization: 'prohibited' = comparison.executionAuthorization

declare const stableValues: PreviewSemanticResourceValueByOperation

type AccountRecord = PreviewResourceStabilityRecord<
  PreviewSemanticResourceValueByOperation['account']
>

const positiveResourceMatch: AccountRecord = {
  comparison: 'MATCH',
  reason: 'semantic-values-equal',
  readOneState: 'complete',
  readTwoState: 'complete',
  readOneSemanticHash: digest,
  readTwoSemanticHash: digest,
  stableValue: stableValues.account,
}
const positiveResourceDrift: AccountRecord = {
  comparison: 'DRIFT',
  reason: 'semantic-values-differ',
  readOneState: 'complete',
  readTwoState: 'complete',
  readOneSemanticHash: digest,
  readTwoSemanticHash: digest,
}
const positiveResourceUnknownOne: AccountRecord = {
  comparison: 'UNKNOWN',
  reason: 'incomplete-resource-evidence',
  readOneState: 'complete',
  readTwoState: 'missing',
  readOneSemanticHash: digest,
  readTwoSemanticHash: null,
}
const positiveResourceUnknownTwo: AccountRecord = {
  comparison: 'UNKNOWN',
  reason: 'incomplete-resource-evidence',
  readOneState: 'partial',
  readTwoState: 'complete',
  readOneSemanticHash: null,
  readTwoSemanticHash: digest,
}
const positiveResourceUnknownBoth: AccountRecord = {
  comparison: 'UNKNOWN',
  reason: 'incomplete-resource-evidence',
  readOneState: 'absent',
  readTwoState: 'contradictory',
  readOneSemanticHash: null,
  readTwoSemanticHash: null,
}

const positiveCapabilityVariants: readonly PreviewApplicableCapabilityStabilityRecord[] = [
  {
    applicability: 'applicable', comparison: 'MATCH', reason: 'candidate-states-equal',
    readOneState: 'disabled', readTwoState: 'disabled',
  },
  {
    applicability: 'applicable', comparison: 'MATCH', reason: 'candidate-states-equal',
    readOneState: 'enabled', readTwoState: 'enabled',
  },
  {
    applicability: 'applicable', comparison: 'DRIFT', reason: 'candidate-states-differ',
    readOneState: 'disabled', readTwoState: 'enabled',
  },
  {
    applicability: 'applicable', comparison: 'DRIFT', reason: 'candidate-states-differ',
    readOneState: 'enabled', readTwoState: 'disabled',
  },
  {
    applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state',
    readOneState: 'unknown', readTwoState: 'unknown',
  },
  {
    applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state',
    readOneState: 'unknown', readTwoState: 'enabled',
  },
  {
    applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state',
    readOneState: 'unknown', readTwoState: 'disabled',
  },
  {
    applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state',
    readOneState: 'disabled', readTwoState: 'unknown',
  },
  {
    applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state',
    readOneState: 'enabled', readTwoState: 'unknown',
  },
]
const positiveNonApplicable: PreviewNotApplicableCapabilityStabilityRecord = {
  applicability: 'not-applicable',
  comparison: 'not-applicable',
  reason: 'not-applicable',
  readOneState: 'not-applicable',
  readTwoState: 'not-applicable',
}
const positiveOverallVariants: readonly PreviewOverallStabilityResult[] = [
  {
    overallComparison: 'MATCH', overallCompleteness: 'complete',
    reasonCode: 'all-required-comparisons-match',
  },
  {
    overallComparison: 'DRIFT', overallCompleteness: 'complete',
    reasonCode: 'semantic-drift-detected',
  },
  {
    overallComparison: 'UNKNOWN', overallCompleteness: 'incomplete',
    reasonCode: 'unknown-required-comparison',
  },
]

if (projection.resources.account.state === 'complete') {
  const authorityProducedExactValue: PreviewSemanticResourceValueByOperation['account'] =
    projection.resources.account.value
  void authorityProducedExactValue
}

function authorityProducedClosureProbes(
  authorityProjection: PreviewSemanticStabilityProjection,
): void {
  const resources = authorityProjection.resources
  if (resources.account.state === 'complete') {
    const authorityAccount = resources.account.value
    const owned: true = authorityAccount.owned
    const spreadAccount = { ...authorityAccount, extra: 'provider-only' } as const
    // @ts-expect-error Concrete spread discards declaration-private nominal authority.
    const rejectedAuthorityAccountSpread:
      PreviewSemanticResourceValueByOperation['account'] = spreadAccount
    // @ts-expect-error An authority intersection cannot be constructed by spreading a value.
    const rejectedAuthorityAccountIntersection:
      PreviewSemanticResourceValueByOperation['account'] & { readonly extra: string } =
        { ...authorityAccount, extra: 'provider-only' }
    const identitySpread = { ...identity(authorityAccount), extra: 'provider-only' } as const
    // @ts-expect-error Generic identity does not make nominal authority spreadable.
    const rejectedIdentitySpread:
      PreviewSemanticResourceValueByOperation['account'] = identitySpread
    // TypeScript deliberately treats intersections as subtypes. This assignment
    // documents the compile-time escape boundary; it does not create runtime
    // provenance or make the widened clone an accepted snapshot input.
    const intentionallyWidened = deliberateGenericWiden(authorityAccount)
    const languagePermittedIntersectionAssignment:
      PreviewSemanticResourceValueByOperation['account'] = intentionallyWidened
    const driftSpread = {
      ...positiveResourceDrift,
      stableValue: authorityAccount,
    } as const
    // @ts-expect-error Spread-created DRIFT cannot expose an authority stable value.
    const rejectedAuthorityDriftSpread: AccountRecord = driftSpread
    const unknownSpread = {
      ...intermediateUnknownBase,
      stableValue: authorityAccount,
    } as const
    // @ts-expect-error Spread-created UNKNOWN cannot expose an authority stable value.
    const rejectedAuthorityUnknownSpread: AccountRecord = unknownSpread
    void [
      owned,
      rejectedAuthorityAccountSpread,
      rejectedAuthorityAccountIntersection,
      rejectedIdentitySpread,
      languagePermittedIntersectionAssignment,
      rejectedAuthorityDriftSpread,
      rejectedAuthorityUnknownSpread,
    ]
  }
  if (resources['account-zones'].state === 'complete') {
    const authorityZones = resources['account-zones'].value
    const zoneName: string = authorityZones.zones[0]!.name
    // @ts-expect-error Spread-created wrong-slot values lack the destination authority.
    const rejectedSpreadWrongSlot: PreviewSemanticResourceValueByOperation['account'] = {
      ...authorityZones,
      owned: true,
    }
    const wideZone = { ...authorityZones.zones[0]!, providerRaw: true }
    // @ts-expect-error Nested zone spread discards nominal authority.
    const rejectedWideZone: typeof authorityZones.zones[number] = wideZone
    void [zoneName, rejectedSpreadWrongSlot, rejectedWideZone]
  }
  if (resources['pages-project'].state === 'complete') {
    const authorityPagesProject = resources['pages-project'].value
    const identityValue: 'approved-preview-pages-project' = authorityPagesProject.identity
    const wideProject = { ...authorityPagesProject, providerRaw: true }
    // @ts-expect-error Pages-project spread cannot retain nominal authority.
    const rejectedWideProject: typeof authorityPagesProject = wideProject
    const wideVariable = { ...authorityPagesProject.variables[0]!, providerRaw: true }
    // @ts-expect-error Nested variable spread cannot retain nominal authority.
    const rejectedWideVariable: typeof authorityPagesProject.variables[number] = wideVariable
    const wideBinding = { ...authorityPagesProject.bindings[0]!, providerRaw: true }
    // @ts-expect-error Nested binding spread cannot retain nominal authority.
    const rejectedWideBinding: typeof authorityPagesProject.bindings[number] = wideBinding
    void [identityValue, rejectedWideProject, rejectedWideVariable, rejectedWideBinding]
  }
  if (resources['pages-preview-deployments'].state === 'complete') {
    const value = resources['pages-preview-deployments'].value
    const wideDeployment = { ...value.deployments[0]!, providerRaw: true }
    // @ts-expect-error Nested deployment spread cannot retain nominal authority.
    const rejectedWideDeployment: typeof value.deployments[number] = wideDeployment
    const wideStage = { ...value.deployments[0]!.stage, providerRaw: true }
    // @ts-expect-error Nested deployment-stage spread cannot retain nominal authority.
    const rejectedWideStage: typeof value.deployments[number]['stage'] = wideStage
    void [value.latestIdentity, rejectedWideDeployment, rejectedWideStage]
  }
  if (resources['worker-settings'].state === 'complete') {
    const value = resources['worker-settings'].value
    const wideBinding = { ...value.bindings[0]!, providerRaw: true }
    // @ts-expect-error Nested Worker binding spread cannot retain nominal authority.
    const rejectedWideBinding: typeof value.bindings[number] = wideBinding
    void [value.compatibilityDate, rejectedWideBinding]
  }
  if (resources['worker-deployments'].state === 'complete') {
    const value = resources['worker-deployments'].value
    const wideDeployment = { ...value.deployments[0]!, providerRaw: true }
    // @ts-expect-error Nested Worker deployment spread cannot retain nominal authority.
    const rejectedWideDeployment: typeof value.deployments[number] = wideDeployment
    const wideVersion = { ...value.deployments[0]!.versions[0]!, providerRaw: true }
    // @ts-expect-error Nested version spread cannot retain nominal authority.
    const rejectedWideVersion: typeof value.deployments[number]['versions'][number] = wideVersion
    void [value.activeDeploymentIdentity, rejectedWideDeployment, rejectedWideVersion]
  }
  if (resources['worker-subdomain'].state === 'complete') {
    const value = resources['worker-subdomain'].value
    void value.workersDev
  }
  if (resources['worker-schedules'].state === 'complete') {
    const value = resources['worker-schedules'].value
    void value.schedules
  }
  if (resources['worker-custom-domains'].state === 'complete') {
    const value = resources['worker-custom-domains'].value
    const wideDomain = { ...value.domains[0]!, providerRaw: true }
    // @ts-expect-error Nested domain spread cannot retain nominal authority.
    const rejectedWideDomain: typeof value.domains[number] = wideDomain
    void [value.domains, rejectedWideDomain]
  }
  if (resources['worker-routes'].state === 'complete') {
    const value = resources['worker-routes'].value
    const wideRoute = { ...value.routes[0]!, providerRaw: true }
    // @ts-expect-error Nested route spread cannot retain nominal authority.
    const rejectedWideRoute: typeof value.routes[number] = wideRoute
    void [value.routes, rejectedWideRoute]
  }
  if (resources['d1-database'].state === 'complete') {
    const value = resources['d1-database'].value
    void value.identity
  }
  if (resources['migration-table-discovery'].state === 'complete') {
    const value = resources['migration-table-discovery'].value
    void value.tables
  }
  if (resources['migration-rows'].state === 'complete') {
    const value = resources['migration-rows'].value
    const wideRow = { ...value.rows[0]!, providerRaw: true }
    // @ts-expect-error Nested migration-row spread cannot retain nominal authority.
    const rejectedWideRow: typeof value.rows[number] = wideRow
    void [value.rows, rejectedWideRow]
  }
  if (resources['backend-schema-version'].state === 'complete') {
    const value = resources['backend-schema-version'].value
    void value.version
  }
}

void [
  projection,
  comparisonVocabulary,
  currentness,
  authorization,
  positiveResourceMatch,
  positiveResourceDrift,
  positiveResourceUnknownOne,
  positiveResourceUnknownTwo,
  positiveResourceUnknownBoth,
  positiveCapabilityVariants,
  positiveNonApplicable,
  positiveOverallVariants,
]

// @ts-expect-error The comparison requires two validated opaque snapshots.
comparePreviewSingleReadSnapshots(readOne)
// @ts-expect-error Structural data cannot satisfy the opaque snapshot brand.
comparePreviewSingleReadSnapshots({}, {})
// @ts-expect-error UNKNOWN cannot have two complete resource reads.
const unknownWithCompleteReads: AccountRecord = { comparison: 'UNKNOWN', reason: 'incomplete-resource-evidence', readOneState: 'complete', readTwoState: 'complete', readOneSemanticHash: digest, readTwoSemanticHash: digest }
// @ts-expect-error A complete read requires its runtime semantic digest.
const unknownCompleteWithNullHash: AccountRecord = { comparison: 'UNKNOWN', reason: 'incomplete-resource-evidence', readOneState: 'complete', readTwoState: 'missing', readOneSemanticHash: null, readTwoSemanticHash: null }
// @ts-expect-error MATCH cannot use the UNKNOWN reason.
const matchWithUnknownReason: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'MATCH', reason: 'unknown-candidate-state', readOneState: 'disabled', readTwoState: 'disabled' }
// @ts-expect-error MATCH requires equal known candidate states.
const matchWithUnknownStates: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'MATCH', reason: 'candidate-states-equal', readOneState: 'unknown', readTwoState: 'unknown' }
// @ts-expect-error DRIFT requires opposite known candidate states.
const driftWithEqualStates: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'DRIFT', reason: 'candidate-states-differ', readOneState: 'enabled', readTwoState: 'enabled' }
// @ts-expect-error UNKNOWN requires at least one unknown candidate state.
const unknownWithKnownOpposites: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state', readOneState: 'enabled', readTwoState: 'disabled' }
// @ts-expect-error MATCH is always complete.
const matchIncomplete: PreviewOverallStabilityResult = { overallComparison: 'MATCH', overallCompleteness: 'incomplete', reasonCode: 'all-required-comparisons-match' }
// @ts-expect-error DRIFT is always complete.
const driftIncomplete: PreviewOverallStabilityResult = { overallComparison: 'DRIFT', overallCompleteness: 'incomplete', reasonCode: 'semantic-drift-detected' }
// @ts-expect-error UNKNOWN is always incomplete.
const unknownComplete: PreviewOverallStabilityResult = { overallComparison: 'UNKNOWN', overallCompleteness: 'complete', reasonCode: 'unknown-required-comparison' }
// @ts-expect-error Overall reasons are correlated with comparison and completeness.
const mismatchedOverallReason: PreviewOverallStabilityResult = { overallComparison: 'MATCH', overallCompleteness: 'complete', reasonCode: 'semantic-drift-detected' }
// @ts-expect-error Arbitrary strings are not opaque SHA-256 digests.
const arbitraryDigest: PreviewSemanticHash = 'digest'
// @ts-expect-error Uppercase, short, and malformed strings are not opaque SHA-256 digests.
const malformedDigest: PreviewSemanticHash = 'ABC123'
// @ts-expect-error DRIFT never exposes a stable value.
const driftWithStableValue: AccountRecord = { comparison: 'DRIFT', reason: 'semantic-values-differ', readOneState: 'complete', readTwoState: 'complete', readOneSemanticHash: digest, readTwoSemanticHash: digest, stableValue: stableValues.account }
// @ts-expect-error UNKNOWN never exposes a stable value.
const unknownWithStableValue: AccountRecord = { comparison: 'UNKNOWN', reason: 'incomplete-resource-evidence', readOneState: 'missing', readTwoState: 'missing', readOneSemanticHash: null, readTwoSemanticHash: null, stableValue: stableValues.account }
// @ts-expect-error MATCH always exposes its exact stable value.
const matchWithoutStableValue: AccountRecord = { comparison: 'MATCH', reason: 'semantic-values-equal', readOneState: 'complete', readTwoState: 'complete', readOneSemanticHash: digest, readTwoSemanticHash: digest }
// @ts-expect-error Account projection requires the literal owned state.
const wrongAccount: PreviewSemanticResourceValueByOperation['account'] = { owned: false }
// @ts-expect-error Zone projection requires ordinal and name.
const wrongZones: PreviewSemanticResourceValueByOperation['account-zones'] = { zones: [{ name: 'example.com' }] }
// @ts-expect-error Pages project projection requires the approved identity.
const wrongPagesProject: PreviewSemanticResourceValueByOperation['pages-project'] = { ...stableValues['pages-project'], identity: 'other' }
// @ts-expect-error Pages deployment projection requires Preview environment.
const wrongPagesDeployment: PreviewSemanticResourceValueByOperation['pages-preview-deployments'] = { latestIdentity: 'one', deployments: [{ ...stableValues['pages-preview-deployments'].deployments[0]!, environment: 'production' }] }
// @ts-expect-error Worker settings bindings use the closed binding shapes.
const wrongWorkerSettings: PreviewSemanticResourceValueByOperation['worker-settings'] = { compatibilityDate: null, compatibilityFlags: [], bindings: [{ category: 'secret', name: 'TOKEN' }] }
// @ts-expect-error Worker deployment versions require traffic percentage.
const wrongWorkerDeployments: PreviewSemanticResourceValueByOperation['worker-deployments'] = { activeDeploymentIdentity: 'one', activeVersionIdentity: 'v1', deployments: [{ identity: 'one', createdAtMs: 1, activeVersionIdentity: 'v1', versions: [{ identity: 'v1' }] }] }
// @ts-expect-error Worker subdomain projection contains exactly its two booleans.
const wrongWorkerSubdomain: PreviewSemanticResourceValueByOperation['worker-subdomain'] = { workersDev: false }
// @ts-expect-error Schedule entries are strings.
const wrongWorkerSchedules: PreviewSemanticResourceValueByOperation['worker-schedules'] = { schedules: [1] }
// @ts-expect-error Stable custom domains exclude certificate identity.
const wrongWorkerDomains: PreviewSemanticResourceValueByOperation['worker-custom-domains'] = { domains: [{ ...stableValues['worker-custom-domains'].domains[0]!, certificateIdentity: 'certificate-1' }] }
// @ts-expect-error Route projection requires the approved Worker identity.
const wrongWorkerRoutes: PreviewSemanticResourceValueByOperation['worker-routes'] = { routes: [{ ...stableValues['worker-routes'].routes[0]!, scriptIdentity: 'other-worker' }] }
// @ts-expect-error D1 projection requires the approved database identity.
const wrongD1: PreviewSemanticResourceValueByOperation['d1-database'] = { identity: 'other', name: 'pennant-pursuit-preview' }
// @ts-expect-error Migration discovery contains only reviewed table names.
const wrongMigrationTables: PreviewSemanticResourceValueByOperation['migration-table-discovery'] = { tables: ['users'] }
// @ts-expect-error Stable migration rows exclude unavailable source hashes.
const wrongMigrationRows: PreviewSemanticResourceValueByOperation['migration-rows'] = { rows: [{ id: 1, name: 'one.sql', appliedAtMs: 1, sourceHash: 'unavailable' }] }
// @ts-expect-error Backend schema projection requires the singleton identity.
const wrongBackendSchema: PreviewSemanticResourceValueByOperation['backend-schema-version'] = { singletonIdentity: 'other', version: 4 }
// @ts-expect-error A stable value cannot be assigned to the wrong resource slot.
const wrongResourceSlot: PreviewSemanticResourceValueByOperation['account'] = stableValues['account-zones']
// @ts-expect-error Non-applicable records have one exact closed form.
const invalidNonApplicable: PreviewNotApplicableCapabilityStabilityRecord = { applicability: 'not-applicable', comparison: 'MATCH', reason: 'candidate-states-equal', readOneState: 'disabled', readTwoState: 'disabled' }

const intermediateDriftWithStableValue = {
  comparison: 'DRIFT',
  reason: 'semantic-values-differ',
  readOneState: 'complete',
  readTwoState: 'complete',
  readOneSemanticHash: digest,
  readTwoSemanticHash: digest,
  stableValue: stableValues.account,
} as const
// @ts-expect-error stableValue?: never closes DRIFT through an as-const intermediate.
const rejectedIntermediateDrift: AccountRecord = intermediateDriftWithStableValue

const intermediateUnknownBase = {
  comparison: 'UNKNOWN',
  reason: 'incomplete-resource-evidence',
  readOneState: 'missing',
  readTwoState: 'missing',
  readOneSemanticHash: null,
  readTwoSemanticHash: null,
} as const
const spreadUnknownWithStableValue = {
  ...intermediateUnknownBase,
  stableValue: stableValues.account,
}
// @ts-expect-error stableValue?: never closes UNKNOWN through object spread.
const rejectedSpreadUnknown: AccountRecord = spreadUnknownWithStableValue

function identity<const Value>(value: Value): Value { return value }
function deliberateGenericWiden<Value extends object>(value: Value): Value & {
  readonly extra: 'intentional-compile-time-escape'
} {
  return { ...value, extra: 'intentional-compile-time-escape' }
}
const helperDriftWithStableValue = identity(intermediateDriftWithStableValue)
// @ts-expect-error Generic helper returns cannot re-open the DRIFT variant.
const rejectedHelperDrift: AccountRecord = helperDriftWithStableValue

// @ts-expect-error The never collision makes a DRIFT-plus-stableValue intersection uninhabitable.
const rejectedIntersectionDrift:
  typeof positiveResourceDrift & { readonly stableValue: typeof stableValues.account } =
    intermediateDriftWithStableValue

const intermediateUnknownWithStableValue = identity({
  ...intermediateUnknownBase,
  stableValue: stableValues.account,
} as const)
// @ts-expect-error Helper-returned UNKNOWN records cannot expose stableValue.
const rejectedHelperUnknown: AccountRecord = intermediateUnknownWithStableValue

const wrongSlotMatchIntermediate = {
  comparison: 'MATCH',
  reason: 'semantic-values-equal',
  readOneState: 'complete',
  readTwoState: 'complete',
  readOneSemanticHash: digest,
  readTwoSemanticHash: digest,
  stableValue: stableValues['account-zones'],
} as const
// @ts-expect-error MATCH stableValue remains correlated to the exact resource slot.
const rejectedWrongSlotMatch: AccountRecord = wrongSlotMatchIntermediate

const structurallyWideAccount = { owned: true, extra: 'not-runtime-data' } as const
// @ts-expect-error Authority-produced exact values reject wider top-level intermediates.
const rejectedWideAccount: PreviewSemanticResourceValueByOperation['account'] =
  structurallyWideAccount

const structurallyWideZones = {
  zones: [{ ordinal: 0, name: 'preview.example.com', extra: true }],
} as const
// @ts-expect-error Authority-produced exact values reject wider nested intermediates.
const rejectedWideNestedZone: PreviewSemanticResourceValueByOperation['account-zones'] =
  structurallyWideZones

const spreadWideWorkerSubdomain = {
  ...({ workersDev: false, previewUrls: false } as const),
  providerOnly: true,
}
// @ts-expect-error Spread-created semantic values cannot acquire provider-only fields.
const rejectedSpreadStableValue: PreviewSemanticResourceValueByOperation['worker-subdomain'] =
  spreadWideWorkerSubdomain

const helperWideMigrationRows = identity({
  rows: [{ id: 1, name: '0001_base.sql', appliedAtMs: 1, sourceHash: 'unavailable' }],
} as const)
// @ts-expect-error Generic helper returns cannot restore excluded nested provider fields.
const rejectedHelperNestedStableValue:
  PreviewSemanticResourceValueByOperation['migration-rows'] = helperWideMigrationRows

const matchDisabledEnabled = {
  applicability: 'applicable', comparison: 'MATCH', reason: 'candidate-states-equal',
  readOneState: 'disabled', readTwoState: 'enabled',
} as const
// @ts-expect-error MATCH rejects disabled versus enabled through an intermediate.
const rejectedMatchDisabledEnabled: PreviewApplicableCapabilityStabilityRecord =
  matchDisabledEnabled
// @ts-expect-error MATCH rejects enabled versus disabled.
const rejectedMatchEnabledDisabled: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'MATCH', reason: 'candidate-states-equal', readOneState: 'enabled', readTwoState: 'disabled' }
// @ts-expect-error DRIFT rejects equal disabled states.
const rejectedDriftDisabledDisabled: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'DRIFT', reason: 'candidate-states-differ', readOneState: 'disabled', readTwoState: 'disabled' }
const equalEnabledDrift = identity({ applicability: 'applicable', comparison: 'DRIFT', reason: 'candidate-states-differ', readOneState: 'enabled', readTwoState: 'enabled' } as const)
// @ts-expect-error DRIFT rejects helper-returned equal enabled states.
const rejectedDriftEnabledEnabled: PreviewApplicableCapabilityStabilityRecord = equalEnabledDrift
const knownUnknown = { applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state', readOneState: 'disabled', readTwoState: 'enabled' } as const
// @ts-expect-error UNKNOWN rejects two known states.
const rejectedUnknownKnownStates: PreviewApplicableCapabilityStabilityRecord = { ...knownUnknown }
// @ts-expect-error UNKNOWN also rejects two equal known states.
const rejectedUnknownEqualKnownStates: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'UNKNOWN', reason: 'unknown-candidate-state', readOneState: 'enabled', readTwoState: 'enabled' }
// @ts-expect-error DRIFT cannot use an UNKNOWN reason.
const rejectedDriftUnknownReason: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'DRIFT', reason: 'unknown-candidate-state', readOneState: 'disabled', readTwoState: 'enabled' }
// @ts-expect-error UNKNOWN cannot use the MATCH reason.
const rejectedUnknownMatchReason: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'UNKNOWN', reason: 'candidate-states-equal', readOneState: 'unknown', readTwoState: 'unknown' }
// @ts-expect-error UNKNOWN cannot use the DRIFT reason.
const rejectedUnknownDriftReason: PreviewApplicableCapabilityStabilityRecord = { applicability: 'applicable', comparison: 'UNKNOWN', reason: 'candidate-states-differ', readOneState: 'unknown', readTwoState: 'unknown' }

void [
  unknownWithCompleteReads,
  unknownCompleteWithNullHash,
  matchWithUnknownReason,
  matchWithUnknownStates,
  driftWithEqualStates,
  unknownWithKnownOpposites,
  matchIncomplete,
  driftIncomplete,
  unknownComplete,
  mismatchedOverallReason,
  arbitraryDigest,
  malformedDigest,
  driftWithStableValue,
  unknownWithStableValue,
  matchWithoutStableValue,
  wrongAccount,
  wrongZones,
  wrongPagesProject,
  wrongPagesDeployment,
  wrongWorkerSettings,
  wrongWorkerDeployments,
  wrongWorkerSubdomain,
  wrongWorkerSchedules,
  wrongWorkerDomains,
  wrongWorkerRoutes,
  wrongD1,
  wrongMigrationTables,
  wrongMigrationRows,
  wrongBackendSchema,
  wrongResourceSlot,
  invalidNonApplicable,
  rejectedIntermediateDrift,
  rejectedSpreadUnknown,
  rejectedHelperDrift,
  rejectedIntersectionDrift,
  rejectedHelperUnknown,
  rejectedWrongSlotMatch,
  rejectedWideAccount,
  rejectedWideNestedZone,
  rejectedSpreadStableValue,
  rejectedHelperNestedStableValue,
  rejectedMatchDisabledEnabled,
  rejectedMatchEnabledDisabled,
  rejectedDriftDisabledDisabled,
  rejectedDriftEnabledEnabled,
  rejectedUnknownKnownStates,
  rejectedUnknownEqualKnownStates,
  rejectedDriftUnknownReason,
  rejectedUnknownMatchReason,
  rejectedUnknownDriftReason,
]

authorityProducedClosureProbes(projection)
