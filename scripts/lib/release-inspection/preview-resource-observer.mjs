import { immutablePlain } from '../preview-release/canonical.mjs'
import {
  crossCheckD1Bindings,
} from './preview-d1-observer.mjs'
import { finalizePagesDeployments } from './preview-pages-observer.mjs'
import { createPreviewSingleReadSnapshot } from './preview-observation-contracts.mjs'
import { finalizeWorkerRoutes } from './preview-worker-observer.mjs'
import { resolvePreviewResourceTransportAuthority } from './preview-authority.mjs'
import { REMOTE_OBSERVATION_LIMITS } from './remote-transport.mjs'
import {
  normalizationFail,
  normalizedValue,
  PreviewResourceNormalizationError,
} from './preview-normalization.mjs'

const ISSUE_BY_STATE = Object.freeze({
  complete: null,
  missing: 'resource-missing',
  unavailable: 'resource-unavailable',
  partial: 'resource-partial',
  malformed: 'resource-malformed',
  contradictory: 'resource-contradictory',
})
const ALL_OPERATIONS = Object.freeze([
  'account',
  'account-zones',
  'pages-project',
  'pages-preview-deployments',
  'worker-settings',
  'worker-deployments',
  'worker-subdomain',
  'worker-schedules',
  'worker-custom-domains',
  'worker-routes',
  'd1-database',
  'migration-table-discovery',
  'migration-rows',
  'backend-schema-version',
])
const MAXIMUM_PAGES_PER_OPERATION = 10
const MAXIMUM_REVIEWED_ROUTE_ZONES = 32
const MAXIMUM_TOTAL_REQUESTS = 64

function orchestrationFail(code) {
  throw new TypeError(`Preview resource observation refused: ${code}.`)
}

function capturedAtFrom(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Reflect.getPrototypeOf(input))) {
    orchestrationFail('the timestamp input is malformed')
  }
  const keys = Reflect.ownKeys(input)
  const descriptor = Reflect.getOwnPropertyDescriptor(input, 'capturedAtMs')
  if (keys.length !== 1 || keys[0] !== 'capturedAtMs' || !descriptor
    || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set
    || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
    orchestrationFail('the timestamp input is malformed')
  }
  return descriptor.value
}

function locallyBoundedTransport(authority) {
  if (!Number.isSafeInteger(authority.reviewedRouteZoneCount)
    || authority.reviewedRouteZoneCount < 1
    || authority.reviewedRouteZoneCount > MAXIMUM_REVIEWED_ROUTE_ZONES) {
    orchestrationFail('the reviewed route-zone budget is invalid')
  }
  let requestCount = 0
  const routeZonesVisited = new Set()
  const pagesVisited = new Map([
    ['account-zones', new Set()],
    ['pages-preview-deployments', new Set()],
  ])
  return Object.freeze({
    reviewedRouteZoneCount: authority.reviewedRouteZoneCount,
    async request(operation) {
      if (requestCount >= MAXIMUM_TOTAL_REQUESTS) {
        orchestrationFail('the 64-request budget is exhausted')
      }
      if (pagesVisited.has(operation.operation)) {
        if (!Number.isSafeInteger(operation.page) || operation.page < 1
          || operation.page > MAXIMUM_PAGES_PER_OPERATION) {
          orchestrationFail('the 10-page budget is exhausted')
        }
        const visited = pagesVisited.get(operation.operation)
        if (visited.has(operation.page)) orchestrationFail('a pagination page was dispatched twice')
        visited.add(operation.page)
      }
      if (operation.operation === 'worker-routes') {
        if (!Number.isSafeInteger(operation.routeZoneIndex)
          || operation.routeZoneIndex < 0
          || operation.routeZoneIndex >= authority.reviewedRouteZoneCount
          || routeZonesVisited.size >= MAXIMUM_REVIEWED_ROUTE_ZONES) {
          orchestrationFail('the reviewed route-zone budget is exhausted')
        }
        if (routeZonesVisited.has(operation.routeZoneIndex)) {
          orchestrationFail('a reviewed route zone was dispatched twice')
        }
        routeZonesVisited.add(operation.routeZoneIndex)
      }
      requestCount += 1
      return authority.request(operation)
    },
    assertExhausted: authority.assertExhausted,
  })
}

function boundedCollectedCount(operation, pages, field) {
  let count = 0
  for (const page of pages) {
    if (!page || typeof page !== 'object' || !Array.isArray(page[field])) {
      normalizationFail(operation, 'malformed', 'invalid-normalized-page')
    }
    count += page[field].length
    if (count > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      orchestrationFail(
        `the ${REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily}-record budget is exhausted`,
      )
    }
  }
  return count
}

function placeholder() {
  return normalizedValue('preview-resource-observation-placeholder')
}

function outcome(operation, state, capturedAtMs, value = null) {
  return immutablePlain({
    operation,
    state,
    issueCode: ISSUE_BY_STATE[state],
    capturedAtMs,
    value: state === 'contradictory' && value === null ? placeholder() : value,
  })
}

function classifiedFailure(error) {
  if (error instanceof PreviewResourceNormalizationError) {
    return { state: error.state, code: error.code }
  }
  if (error?.name === 'PreviewHttpTransportError') {
    if (error.code === 'provider-response-failure'
      || (Number.isSafeInteger(error.status) && error.status >= 500)) {
      return { state: 'unavailable', code: 'provider-unavailable' }
    }
    if (error.code === 'http-status' && error.status === 404) {
      return { state: 'missing', code: 'provider-resource-missing' }
    }
  }
  return null
}

async function requestClassified(transport, operation, capturedAtMs) {
  try {
    return { value: await transport.request(operation), outcome: null }
  } catch (error) {
    const classified = classifiedFailure(error)
    if (!classified) throw error
    return {
      value: null,
      outcome: outcome(operation.operation, classified.state, capturedAtMs),
    }
  }
}

function finalizeZones(pages, expectedReviewedZoneCount) {
  const operation = 'account-zones'
  if (pages.length === 0) normalizationFail(operation, 'unavailable', 'zone-pages-absent')
  const first = pages[0].pageInfo
  if (pages.length !== first.totalPages
    || pages.some((entry, index) => entry.pageInfo.page !== index + 1
      || entry.pageInfo.perPage !== first.perPage
      || entry.pageInfo.totalCount !== first.totalCount
      || entry.pageInfo.totalPages !== first.totalPages)) {
    normalizationFail(operation, 'contradictory', 'zone-pagination-metadata-changed')
  }
  const records = pages.flatMap(({ records }) => records)
  if (records.length !== first.totalCount) {
    normalizationFail(operation, 'contradictory', 'truncated-zone-pagination')
  }
  if (new Set(records.map(({ providerIdentity }) => providerIdentity)).size !== records.length) {
    normalizationFail(operation, 'contradictory', 'duplicate-zone-identity')
  }
  const reviewed = records.filter(({ reviewedOrdinal }) => reviewedOrdinal >= 0)
  if (reviewed.length !== expectedReviewedZoneCount
    || new Set(reviewed.map(({ reviewedOrdinal }) => reviewedOrdinal)).size !== reviewed.length) {
    normalizationFail(operation, 'contradictory', 'reviewed-zone-ownership-mismatch')
  }
  reviewed.sort((left, right) => left.reviewedOrdinal - right.reviewedOrdinal)
  for (let index = 0; index < reviewed.length; index += 1) {
    if (reviewed[index].reviewedOrdinal !== index) {
      normalizationFail(operation, 'contradictory', 'reviewed-zone-ownership-mismatch')
    }
  }
  return normalizedValue('preview-account-zones-observation', {
    zones: reviewed.map(({ reviewedOrdinal: ordinal, name }) => ({ ordinal, name })),
  })
}

function failureOutcome(operation, error, capturedAtMs) {
  const classified = classifiedFailure(error)
  if (!classified) throw error
  return outcome(operation, classified.state, capturedAtMs)
}

function partialOrFailureOutcome(operation, failure, capturedAtMs, collectedCount) {
  if (collectedCount === 0 || !['missing', 'unavailable'].includes(failure.state)) return failure
  return outcome(
    operation,
    'partial',
    capturedAtMs,
    normalizedValue('preview-partial-resource-observation', { operation, collectedCount }),
  )
}

function resultByOperation(outcomes, operation) {
  return outcomes.find((entry) => entry.operation === operation)
}

function addUnobserved(outcomes, capturedAtMs) {
  const present = new Set(outcomes.map(({ operation }) => operation))
  for (const operation of ALL_OPERATIONS) {
    if (!present.has(operation)) outcomes.push(outcome(operation, 'unavailable', capturedAtMs))
  }
}

export async function observePreviewResourcesWithTransport(transportAuthority, input) {
  // Provenance is resolved before the timestamp object or any transport-facing
  // property can be observed.
  const authority = resolvePreviewResourceTransportAuthority(transportAuthority)
  const capturedAtMs = capturedAtFrom(input)
  const transport = locallyBoundedTransport(authority)
  const outcomes = []

  const account = await requestClassified(transport, { operation: 'account' }, capturedAtMs)
  outcomes.push(account.outcome ?? outcome('account', 'complete', capturedAtMs, account.value))
  if (account.outcome) {
    addUnobserved(outcomes, capturedAtMs)
    return createPreviewSingleReadSnapshot({ capturedAtMs, resourceOutcomes: outcomes })
  }

  const zonePages = []
  let zoneFailure = null
  let zonePage = 1
  do {
    const observed = await requestClassified(
      transport,
      { operation: 'account-zones', page: zonePage },
      capturedAtMs,
    )
    if (observed.outcome) { zoneFailure = observed.outcome; break }
    zonePages.push(observed.value)
    boundedCollectedCount('account-zones', zonePages, 'records')
    zonePage += 1
  } while (zonePage <= zonePages[0].pageInfo.totalPages)
  if (zoneFailure) {
    outcomes.push(partialOrFailureOutcome(
      'account-zones',
      zoneFailure,
      capturedAtMs,
      boundedCollectedCount('account-zones', zonePages, 'records'),
    ))
    addUnobserved(outcomes, capturedAtMs)
    return createPreviewSingleReadSnapshot({ capturedAtMs, resourceOutcomes: outcomes })
  }
  try {
    outcomes.push(outcome(
      'account-zones',
      'complete',
      capturedAtMs,
      finalizeZones(zonePages, transport.reviewedRouteZoneCount),
    ))
  } catch (error) {
    outcomes.push(failureOutcome('account-zones', error, capturedAtMs))
    addUnobserved(outcomes, capturedAtMs)
    return createPreviewSingleReadSnapshot({ capturedAtMs, resourceOutcomes: outcomes })
  }

  const workerOperations = [
    'worker-settings',
    'worker-deployments',
    'worker-subdomain',
    'worker-schedules',
    'worker-custom-domains',
  ]

  const pageProject = await requestClassified(transport, { operation: 'pages-project' }, capturedAtMs)
  outcomes.push(pageProject.outcome ?? outcome('pages-project', 'complete', capturedAtMs, pageProject.value))

  const deploymentPages = []
  let deploymentFailure = null
  let deploymentPage = 1
  do {
    const observed = await requestClassified(
      transport,
      { operation: 'pages-preview-deployments', page: deploymentPage },
      capturedAtMs,
    )
    if (observed.outcome) { deploymentFailure = observed.outcome; break }
    deploymentPages.push(observed.value)
    boundedCollectedCount('pages-preview-deployments', deploymentPages, 'providerIdentities')
    deploymentPage += 1
  } while (deploymentPage <= deploymentPages[0].pageInfo.totalPages)
  if (deploymentFailure) {
    outcomes.push(partialOrFailureOutcome(
      'pages-preview-deployments',
      deploymentFailure,
      capturedAtMs,
      boundedCollectedCount('pages-preview-deployments', deploymentPages, 'providerIdentities'),
    ))
  } else {
    try {
      outcomes.push(outcome(
        'pages-preview-deployments',
        'complete',
        capturedAtMs,
        finalizePagesDeployments(deploymentPages),
      ))
    } catch (error) {
      outcomes.push(failureOutcome('pages-preview-deployments', error, capturedAtMs))
    }
  }

  for (const operation of workerOperations) {
    const observed = await requestClassified(transport, { operation }, capturedAtMs)
    outcomes.push(observed.outcome ?? outcome(operation, 'complete', capturedAtMs, observed.value))
  }

  const routeInventories = []
  let routeFailure = null
  let aggregateRouteRecordCount = 0
  for (let routeZoneIndex = 0; routeZoneIndex < transport.reviewedRouteZoneCount; routeZoneIndex += 1) {
    const observed = await requestClassified(
      transport,
      { operation: 'worker-routes', routeZoneIndex },
      capturedAtMs,
    )
    if (observed.outcome) { routeFailure = observed.outcome; break }
    routeInventories.push(observed.value)
    aggregateRouteRecordCount += observed.value.inventory.length
    if (aggregateRouteRecordCount > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      routeFailure = outcome('worker-routes', 'malformed', capturedAtMs)
      break
    }
  }
  if (routeFailure) {
    outcomes.push(partialOrFailureOutcome(
      'worker-routes',
      routeFailure,
      capturedAtMs,
      aggregateRouteRecordCount,
    ))
  } else {
    try {
      outcomes.push(outcome('worker-routes', 'complete', capturedAtMs, finalizeWorkerRoutes(routeInventories)))
    } catch (error) {
      outcomes.push(failureOutcome('worker-routes', error, capturedAtMs))
    }
  }

  for (const operation of [
    'd1-database', 'migration-table-discovery', 'migration-rows', 'backend-schema-version',
  ]) {
    const observed = await requestClassified(transport, { operation }, capturedAtMs)
    outcomes.push(observed.outcome ?? outcome(operation, 'complete', capturedAtMs, observed.value))
  }

  const pagesOutcome = resultByOperation(outcomes, 'pages-project')
  const workerOutcome = resultByOperation(outcomes, 'worker-settings')
  const databaseOutcome = resultByOperation(outcomes, 'd1-database')
  if ([pagesOutcome, workerOutcome, databaseOutcome].every((entry) => entry.state === 'complete')) {
    try {
      crossCheckD1Bindings(pagesOutcome.value, workerOutcome.value, databaseOutcome.value)
    } catch (error) {
      const index = outcomes.indexOf(databaseOutcome)
      outcomes[index] = failureOutcome('d1-database', error, capturedAtMs)
    }
  } else if (databaseOutcome.state === 'complete') {
    const index = outcomes.indexOf(databaseOutcome)
    outcomes[index] = outcome(
      'd1-database',
      'partial',
      capturedAtMs,
      normalizedValue('preview-partial-resource-observation', {
        operation: 'd1-database',
        collectedCount: 1,
      }),
    )
  }

  const migrationRows = resultByOperation(outcomes, 'migration-rows')
  const backendSchema = resultByOperation(outcomes, 'backend-schema-version')
  const migrationTables = resultByOperation(outcomes, 'migration-table-discovery')
  if (migrationTables.state === 'complete') {
    const hasMigrationTable = migrationTables.value.tables.includes('d1_migrations')
    const hasBackendTable = migrationTables.value.tables.includes('backend_schema')
    // A failed dependent query is not evidence that a discovered table is
    // absent. Only a complete positive query can contradict complete discovery.
    if (!hasMigrationTable && migrationRows.state === 'complete') {
      const index = outcomes.indexOf(migrationRows)
      outcomes[index] = outcome('migration-rows', 'contradictory', capturedAtMs)
    }
    if (!hasBackendTable && backendSchema.state === 'complete') {
      const index = outcomes.indexOf(backendSchema)
      outcomes[index] = outcome('backend-schema-version', 'contradictory', capturedAtMs)
    }
  }
  if (migrationRows.state === 'complete' && backendSchema.state === 'complete'
    && migrationRows.value.rows.length !== backendSchema.value.version) {
    const index = outcomes.indexOf(backendSchema)
    outcomes[index] = outcome('backend-schema-version', 'contradictory', capturedAtMs)
  }

  transport.assertExhausted?.()
  return createPreviewSingleReadSnapshot({ capturedAtMs, resourceOutcomes: outcomes })
}
