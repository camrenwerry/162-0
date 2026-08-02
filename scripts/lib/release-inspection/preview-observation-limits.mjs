import { immutablePlain } from '../preview-release/canonical-data.mjs'

// Pure observation inventory and limits shared by transport, validation, and
// projection authority. This module has no transport or filesystem path.
export const PREVIEW_OBSERVATION_LIMITS = immutablePlain({
  maximumReviewedRouteZones: 32,
  maximumRequestsPerFullRead: 64,
  maximumRequestsPerDoubleRead: 128,
  maximumPaginationPages: 10,
  maximumRecordsPerFamily: 250,
  maximumResponseBytes: 1_048_576,
  maximumResponseReadIterations: 4_096,
  maximumSerializedObservationBytes: 1_048_576,
  requestTimeoutMs: 10_000,
  fullReadTimeoutMs: 120_000,
  doubleReadTimeoutMs: 300_000,
  stableReadDelayMs: 2_000,
  freshnessWindowMs: 300_000,
  maximumFutureClockSkewMs: 1_000,
  concurrency: 1,
  automaticRetries: 0,
  redirectPolicy: 'reject-every-3xx',
})

export const PREVIEW_OPERATION_INVENTORY = Object.freeze([
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
])
