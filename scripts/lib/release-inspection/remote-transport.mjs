import { types as utilTypes } from 'node:util'
import {
  canonicalJson,
  decodeStrictUtf8,
  immutablePlain,
  parseStrictJson,
} from '../preview-release/canonical.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import {
  PREVIEW_OBSERVATION_LIMITS,
  PREVIEW_OPERATION_INVENTORY,
} from './preview-observation-limits.mjs'
import { assertNoProductionPoisoning } from './production-poisoning.mjs'

const isProxy = utilTypes.isProxy
const bufferByteLength = Buffer.byteLength
let intrinsicValidationDepth = 0

function assertCurrentIntrinsicIntegrity() {
  if (intrinsicValidationDepth === 0) assertReleaseInspectionIntrinsicIntegrity()
}

function withIntrinsicIntegrity(operation) {
  assertCurrentIntrinsicIntegrity()
  intrinsicValidationDepth += 1
  try {
    return operation()
  } finally {
    intrinsicValidationDepth -= 1
  }
}

export const REMOTE_OBSERVATION_ORIGIN = 'https://api.cloudflare.com'

export const REMOTE_OBSERVATION_LIMITS = PREVIEW_OBSERVATION_LIMITS

export const REMOTE_RESPONSE_JSON_LIMITS = Object.freeze({
  maxBytes: REMOTE_OBSERVATION_LIMITS.maximumResponseBytes,
  maxDepth: 48,
  maxNodes: 50_000,
})

export const MIGRATION_TABLE_DISCOVERY_SQL = [
  'SELECT name FROM sqlite_schema',
  "WHERE type = 'table'",
  "  AND name IN ('backend_schema', 'd1_migrations')",
  'ORDER BY name ASC',
].join('\n')

export const MIGRATION_ROWS_SQL = [
  'SELECT id, name, applied_at',
  'FROM d1_migrations',
  'ORDER BY id ASC',
].join('\n')

export const BACKEND_SCHEMA_VERSION_SQL = [
  'SELECT version',
  'FROM backend_schema',
  'WHERE id = 1',
].join('\n')

const NONE_PAGINATION = immutablePlain({
  kind: 'none',
  pageSize: null,
  maximumPages: 1,
  maximumRecords: REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily,
})
const PAGE_PAGINATION = immutablePlain({
  kind: 'page',
  pageSize: 25,
  maximumPages: REMOTE_OBSERVATION_LIMITS.maximumPaginationPages,
  maximumRecords: REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily,
})
const FILTERED_SINGLE_PAGE_PAGINATION = immutablePlain({
  kind: 'filtered-single-page',
  pageSize: null,
  maximumPages: 1,
  maximumRecords: REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily,
})

function operation({
  name,
  endpointFamily,
  method,
  pathTemplate,
  parameterKeys,
  pagination = NONE_PAGINATION,
  previewIdentityFields,
  sql = null,
}) {
  return immutablePlain({
    name,
    endpointFamily,
    method,
    origin: REMOTE_OBSERVATION_ORIGIN,
    pathTemplate,
    parameterKeys,
    pagination,
    responseLimitBytes: REMOTE_OBSERVATION_LIMITS.maximumResponseBytes,
    requestBudgetWeight: 1,
    previewIdentityFields,
    productionPoisoning: 'reject-raw-normalized-repeatedly-encoded',
    operationClass: method === 'GET' ? 'get' : 'exact-select-post',
    sql,
    params: method === 'POST' ? [] : null,
    secretPresenceContract: 'unavailable',
  })
}

const operations = [
  operation({
    name: 'account',
    endpointFamily: 'account',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}',
    parameterKeys: ['accountId'],
    previewIdentityFields: ['accountId'],
  }),
  operation({
    name: 'account-zones',
    endpointFamily: 'zones',
    method: 'GET',
    pathTemplate: '/client/v4/zones',
    parameterKeys: ['accountId', 'page'],
    pagination: PAGE_PAGINATION,
    previewIdentityFields: ['accountId'],
  }),
  operation({
    name: 'pages-project',
    endpointFamily: 'pages',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/pages/projects/{pagesProject}',
    parameterKeys: ['accountId', 'pagesProject'],
    previewIdentityFields: ['accountId', 'pagesProject'],
  }),
  operation({
    name: 'pages-preview-deployments',
    endpointFamily: 'pages',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/pages/projects/{pagesProject}/deployments',
    parameterKeys: ['accountId', 'page', 'pagesProject'],
    pagination: PAGE_PAGINATION,
    previewIdentityFields: ['accountId', 'pagesProject'],
  }),
  operation({
    name: 'worker-settings',
    endpointFamily: 'workers',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/settings',
    parameterKeys: ['accountId', 'workerName'],
    previewIdentityFields: ['accountId', 'workerName'],
  }),
  operation({
    name: 'worker-deployments',
    endpointFamily: 'workers',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/deployments',
    parameterKeys: ['accountId', 'workerName'],
    previewIdentityFields: ['accountId', 'workerName'],
  }),
  operation({
    name: 'worker-subdomain',
    endpointFamily: 'workers',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/subdomain',
    parameterKeys: ['accountId', 'workerName'],
    previewIdentityFields: ['accountId', 'workerName'],
  }),
  operation({
    name: 'worker-schedules',
    endpointFamily: 'workers',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/schedules',
    parameterKeys: ['accountId', 'workerName'],
    previewIdentityFields: ['accountId', 'workerName'],
  }),
  operation({
    name: 'worker-custom-domains',
    endpointFamily: 'workers',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/workers/domains',
    parameterKeys: ['accountId', 'workerName'],
    pagination: FILTERED_SINGLE_PAGE_PAGINATION,
    previewIdentityFields: ['accountId', 'workerName'],
  }),
  operation({
    name: 'worker-routes',
    endpointFamily: 'zones',
    method: 'GET',
    pathTemplate: '/client/v4/zones/{zoneId}/workers/routes',
    parameterKeys: ['accountId', 'workerName', 'zoneId'],
    previewIdentityFields: ['accountId', 'workerName', 'routeZoneIds'],
  }),
  operation({
    name: 'd1-database',
    endpointFamily: 'd1',
    method: 'GET',
    pathTemplate: '/client/v4/accounts/{accountId}/d1/database/{databaseId}',
    parameterKeys: ['accountId', 'databaseId'],
    previewIdentityFields: ['accountId', 'databaseId'],
  }),
  operation({
    name: 'migration-table-discovery',
    endpointFamily: 'd1',
    method: 'POST',
    pathTemplate: '/client/v4/accounts/{accountId}/d1/database/{databaseId}/query',
    parameterKeys: ['accountId', 'databaseId'],
    previewIdentityFields: ['accountId', 'databaseId'],
    sql: MIGRATION_TABLE_DISCOVERY_SQL,
  }),
  operation({
    name: 'migration-rows',
    endpointFamily: 'd1',
    method: 'POST',
    pathTemplate: '/client/v4/accounts/{accountId}/d1/database/{databaseId}/query',
    parameterKeys: ['accountId', 'databaseId'],
    previewIdentityFields: ['accountId', 'databaseId'],
    sql: MIGRATION_ROWS_SQL,
  }),
  operation({
    name: 'backend-schema-version',
    endpointFamily: 'd1',
    method: 'POST',
    pathTemplate: '/client/v4/accounts/{accountId}/d1/database/{databaseId}/query',
    parameterKeys: ['accountId', 'databaseId'],
    previewIdentityFields: ['accountId', 'databaseId'],
    sql: BACKEND_SCHEMA_VERSION_SQL,
  }),
]

export const PREVIEW_OPERATION_REGISTRY = immutablePlain(Object.fromEntries(
  operations.map((entry) => [entry.name, entry]),
))

export const PREVIEW_OPERATION_NAMES = PREVIEW_OPERATION_INVENTORY
if (canonicalJson(Object.keys(PREVIEW_OPERATION_REGISTRY)) !== canonicalJson(PREVIEW_OPERATION_NAMES)) {
  throw new TypeError('Preview operation registry differs from the pure operation inventory.')
}
export const PREVIEW_ENDPOINT_FAMILIES = Object.freeze([
  'account',
  'zones',
  'pages',
  'workers',
  'd1',
])

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/
const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/
const DATABASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DEDICATED_CREDENTIAL = 'PENNANT_PREVIEW_API_TOKEN'
const DEDICATED_CREDENTIAL_SKELETON = 'pennantpreviewapitoken'

// These literals are the immutable projection of the protected identities in
// config/preview-release.json. The caller never supplies or overrides them.
const REVIEWED_PREVIEW_IDENTITY_POLICY = immutablePlain({
  pagesProject: 'diamond-draft',
  workerName: 'pennant-pursuit-validation-preview',
  databaseId: 'ba6255b4-9425-4863-b10f-79149180f75a',
})
const TRUSTED_PRODUCTION_IDENTIFIERS = Object.freeze([
  'pennant-pursuit-validation-production',
  'pennant-pursuit-production',
  '4b821c17-b88b-462d-a2ed-c6a2113cc362',
  '16204021',
  '16204022',
])

function fail(message) {
  throw new TypeError(`Remote observation transport refused: ${message}`)
}

function snapshotPlain(value, label) {
  assertCurrentIntrinsicIntegrity()
  try {
    return immutablePlain(value)
  } catch {
    fail(`${label} must be deeply plain, accessor-free JSON-compatible data.`)
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Reflect.ownKeys(value)
  return actual.every((key) => typeof key === 'string')
    && actual.length === expected.length
    && expected.every((key) => actual.includes(key))
}

function rejectProductionPoisoning(input, label) {
  assertNoProductionPoisoning(input, TRUSTED_PRODUCTION_IDENTIFIERS, {
    label,
    error: (reason) => new TypeError(`Remote observation transport refused: ${label} ${reason}`),
  })
}

function validateIdentity(input) {
  rejectProductionPoisoning(input, 'Preview identity')
  const identity = snapshotPlain(input, 'Preview identity')
  if (!exactKeys(identity, [
    'accountId', 'databaseId', 'pagesProject', 'routeZoneIds', 'workerName',
  ])) fail('Preview identity must use the exact reviewed identity fields.')
  if (!ACCOUNT_ID_PATTERN.test(identity.accountId)
    || !RESOURCE_NAME_PATTERN.test(identity.pagesProject)
    || !RESOURCE_NAME_PATTERN.test(identity.workerName)
    || !DATABASE_ID_PATTERN.test(identity.databaseId)
    || !Array.isArray(identity.routeZoneIds)
    || identity.routeZoneIds.length > REMOTE_OBSERVATION_LIMITS.maximumReviewedRouteZones
    || identity.routeZoneIds.some((zoneId) => !ZONE_ID_PATTERN.test(zoneId))
    || new Set(identity.routeZoneIds).size !== identity.routeZoneIds.length
    || identity.pagesProject !== REVIEWED_PREVIEW_IDENTITY_POLICY.pagesProject
    || identity.workerName !== REVIEWED_PREVIEW_IDENTITY_POLICY.workerName
    || identity.databaseId !== REVIEWED_PREVIEW_IDENTITY_POLICY.databaseId) {
    fail('Preview identity is unresolved, malformed, duplicated, or outside the reviewed zone bound.')
  }
  rejectProductionPoisoning([
    identity.accountId,
    identity.databaseId,
    identity.pagesProject,
    identity.workerName,
    ...identity.routeZoneIds,
  ], 'Preview identity')
  return identity
}

function validateParameters(definition, input, identity) {
  rejectProductionPoisoning(input, `${definition.name} parameters`)
  const parameters = snapshotPlain(input, `${definition.name} parameters`)
  if (!exactKeys(parameters, definition.parameterKeys)) {
    fail(`${definition.name} requires exactly its declared parameter schema.`)
  }
  rejectProductionPoisoning(Object.values(parameters), `${definition.name} parameters`)
  if (parameters.accountId !== identity.accountId) fail('accountId does not equal the grounded Preview identity.')
  if (Object.hasOwn(parameters, 'pagesProject') && parameters.pagesProject !== identity.pagesProject) {
    fail('pagesProject does not equal the grounded Preview identity.')
  }
  if (Object.hasOwn(parameters, 'workerName') && parameters.workerName !== identity.workerName) {
    fail('workerName does not equal the grounded Preview identity.')
  }
  if (Object.hasOwn(parameters, 'databaseId') && parameters.databaseId !== identity.databaseId) {
    fail('databaseId does not equal the grounded Preview identity.')
  }
  if (Object.hasOwn(parameters, 'zoneId') && (
    !ZONE_ID_PATTERN.test(parameters.zoneId) || !identity.routeZoneIds.includes(parameters.zoneId)
  )) fail('zoneId is not in the exact grounded Preview route-zone allowlist.')
  if (Object.hasOwn(parameters, 'page') && (
    !Number.isSafeInteger(parameters.page)
    || parameters.page < 1
    || parameters.page > REMOTE_OBSERVATION_LIMITS.maximumPaginationPages
  )) fail('page is outside the reviewed pagination bound.')
  return parameters
}

function requestPathAndQuery(definition, parameters) {
  const accountPrefix = `/client/v4/accounts/${parameters.accountId}`
  switch (definition.name) {
    case 'account':
      return { path: accountPrefix, query: [] }
    case 'account-zones':
      return {
        path: '/client/v4/zones',
        query: [
          { name: 'account.id', value: parameters.accountId },
          { name: 'type', value: 'full,partial,secondary,internal' },
          { name: 'page', value: String(parameters.page) },
          { name: 'per_page', value: '25' },
        ],
      }
    case 'pages-project':
      return { path: `${accountPrefix}/pages/projects/${parameters.pagesProject}`, query: [] }
    case 'pages-preview-deployments':
      return {
        path: `${accountPrefix}/pages/projects/${parameters.pagesProject}/deployments`,
        query: [
          { name: 'env', value: 'preview' },
          { name: 'page', value: String(parameters.page) },
          { name: 'per_page', value: '25' },
        ],
      }
    case 'worker-settings':
    case 'worker-deployments':
    case 'worker-subdomain':
    case 'worker-schedules': {
      const suffix = {
        'worker-settings': 'settings',
        'worker-deployments': 'deployments',
        'worker-subdomain': 'subdomain',
        'worker-schedules': 'schedules',
      }[definition.name]
      return { path: `${accountPrefix}/workers/scripts/${parameters.workerName}/${suffix}`, query: [] }
    }
    case 'worker-custom-domains':
      return {
        path: `${accountPrefix}/workers/domains`,
        query: [{ name: 'service', value: parameters.workerName }],
      }
    case 'worker-routes':
      return { path: `/client/v4/zones/${parameters.zoneId}/workers/routes`, query: [] }
    case 'd1-database':
      return { path: `${accountPrefix}/d1/database/${parameters.databaseId}`, query: [] }
    default:
      return { path: `${accountPrefix}/d1/database/${parameters.databaseId}/query`, query: [] }
  }
}

export function validateD1SelectBody(operationName, input) {
  return withIntrinsicIntegrity(() => {
    const definition = PREVIEW_OPERATION_REGISTRY[operationName]
    if (!definition || definition.operationClass !== 'exact-select-post') {
      fail('D1 query operation is not one of the three exact SELECT-only operations.')
    }
    const body = snapshotPlain(input, `${operationName} body`)
    if (!exactKeys(body, ['params', 'sql'])
      || body.sql !== definition.sql
      || !Array.isArray(body.params)
      || body.params.length !== 0) {
      fail('D1 request body must contain the exact reviewed SQL and params: [].')
    }
    return body
  })
}

export function createPreviewOperationRequest(operationName, inputParameters, inputIdentity) {
  return withIntrinsicIntegrity(() => {
    if (typeof operationName !== 'string' || !Object.hasOwn(PREVIEW_OPERATION_REGISTRY, operationName)) {
      fail('operation name is not in the closed Preview-only registry.')
    }
    const definition = PREVIEW_OPERATION_REGISTRY[operationName]
    const identity = validateIdentity(inputIdentity)
    const parameters = validateParameters(definition, inputParameters, identity)
    const { path, query } = requestPathAndQuery(definition, parameters)
    const body = definition.operationClass === 'exact-select-post'
      ? validateD1SelectBody(operationName, { sql: definition.sql, params: [] })
      : null
    return immutablePlain({
      operation: operationName,
      endpointFamily: definition.endpointFamily,
      method: definition.method,
      origin: definition.origin,
      path,
      query,
      body,
      parameters,
      paginationPolicy: definition.pagination,
      redirectPolicy: REMOTE_OBSERVATION_LIMITS.redirectPolicy,
      timeoutMs: REMOTE_OBSERVATION_LIMITS.requestTimeoutMs,
      responseLimitBytes: definition.responseLimitBytes,
      requestBudgetWeight: definition.requestBudgetWeight,
      previewOnly: true,
      productionPoisoning: definition.productionPoisoning,
    })
  })
}

export function validatePreviewOperationRequest(input, identity) {
  return withIntrinsicIntegrity(() => {
    const request = snapshotPlain(input, 'Preview operation request')
    const expectedKeys = [
      'body', 'endpointFamily', 'method', 'operation', 'origin', 'paginationPolicy', 'parameters',
      'path', 'previewOnly', 'productionPoisoning', 'query', 'redirectPolicy',
      'requestBudgetWeight', 'responseLimitBytes', 'timeoutMs',
    ]
    if (!exactKeys(request, expectedKeys)) fail('request descriptor has missing, extra, or arbitrary fields.')
    const expected = createPreviewOperationRequest(request.operation, request.parameters, identity)
    if (canonicalJson(request) !== canonicalJson(expected)) {
      fail('request descriptor differs from the exact operation registry projection.')
    }
    return request
  })
}

function validateEnvelopeShape(input) {
  const envelope = snapshotPlain(input, 'Cloudflare response envelope')
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('Cloudflare response has an unsupported top-level shape.')
  }
  const allowed = new Set(['errors', 'messages', 'result', 'result_info', 'success'])
  const keys = Reflect.ownKeys(envelope)
  if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
    || !Object.hasOwn(envelope, 'success')
    || !Object.hasOwn(envelope, 'errors')
    || !Object.hasOwn(envelope, 'messages')
    || typeof envelope.success !== 'boolean'
    || !Array.isArray(envelope.errors)
    || !Array.isArray(envelope.messages)
    || (envelope.success && !Object.hasOwn(envelope, 'result'))) {
    fail('Cloudflare response envelope is missing required fields or contains unsupported fields.')
  }
  return envelope
}

export function parseStrictRemoteJson(bytes) {
  return withIntrinsicIntegrity(() => {
    if (!(bytes instanceof Uint8Array)) fail('Cloudflare response body must be bytes.')
    if (bytes.byteLength > REMOTE_OBSERVATION_LIMITS.maximumResponseBytes) {
      fail('Cloudflare response body exceeds the reviewed byte limit.')
    }
    let source
    try {
      source = decodeStrictUtf8(bytes, {
        label: 'Cloudflare response body',
        error: (message) => new TypeError(message),
      })
    } catch {
      fail('Cloudflare response body is not strict BOM-free UTF-8.')
    }
    let parsed
    try {
      parsed = parseStrictJson(source, {
        label: 'Cloudflare response body',
        limits: REMOTE_RESPONSE_JSON_LIMITS,
        error: (message) => new TypeError(message),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/duplicate object key/i.test(message)) fail('Cloudflare response contains a duplicate object key.')
      if (/dangerous object key/i.test(message)) fail('Cloudflare response contains a dangerous object key.')
      if (/nesting depth/i.test(message)) fail('Cloudflare response exceeds the reviewed nesting limit.')
      if (/structural node count/i.test(message)) fail('Cloudflare response exceeds the reviewed property/node limit.')
      if (/trailing content/i.test(message)) fail('Cloudflare response contains trailing content.')
      fail('Cloudflare response is malformed JSON.')
    }
    return validateEnvelopeShape(parsed)
  })
}

export function validateObservationCredentialEnvironment(environment) {
  return withIntrinsicIntegrity(() => {
    if (!environment || typeof environment !== 'object' || isProxy(environment)) {
      fail('observer environment must be one non-proxy plain object.')
    }
    const prototype = Reflect.getPrototypeOf(environment)
    if (![Object.prototype, null].includes(prototype)) fail('observer environment has a hostile prototype.')
    const keys = Reflect.ownKeys(environment)
    if (keys.length !== 1 || keys[0] !== DEDICATED_CREDENTIAL) {
      fail('observer environment must contain exactly the dedicated Preview credential data property.')
    }
    const tokenDescriptor = Reflect.getOwnPropertyDescriptor(environment, DEDICATED_CREDENTIAL)
    if (!tokenDescriptor || !Object.hasOwn(tokenDescriptor, 'value') || tokenDescriptor.get || tokenDescriptor.set) {
      fail('observer environment must contain only the dedicated credential data property.')
    }
    for (let cursor = prototype; cursor; cursor = Reflect.getPrototypeOf(cursor)) {
      for (const key of Reflect.ownKeys(cursor)) {
        if (typeof key !== 'string') fail('observer environment contains an inherited symbol key.')
        const normalized = key.normalize('NFKC').toLowerCase()
        if (/[^\x00-\x7F]/u.test(normalized)) {
          fail('observer environment contains an inherited non-ASCII credential or identity alias.')
        }
        const skeleton = normalized.replace(/[^a-z0-9]/gu, '')
        const credentialLike = skeleton === DEDICATED_CREDENTIAL_SKELETON
          || /(?:cloudflare|wrangler|token|apikey|secret|credential|oauth|email|accountid|identity|deploy|production)/u.test(skeleton)
        if (credentialLike) fail('observer environment contains an inherited credential or identity variable.')
      }
    }
    const token = tokenDescriptor.value
    if (typeof token !== 'string' || token.length === 0 || token.length > 4_096
      || /[\u0000-\u0020\u007F]/u.test(token)) {
      fail(`online Preview observation requires a non-empty ${DEDICATED_CREDENTIAL} value.`)
    }
    return immutablePlain({
      credentialName: DEDICATED_CREDENTIAL,
      available: true,
      scope: 'unverified',
    })
  })
}

export function validateRemoteObservationLimits(input) {
  return withIntrinsicIntegrity(() => {
    const limits = snapshotPlain(input, 'Remote observation limits')
    if (canonicalJson(limits) !== canonicalJson(REMOTE_OBSERVATION_LIMITS)) {
      fail('network, timeout, retry, redirect, or serialization limits differ from the approved contract.')
    }
    return limits
  })
}

export function createRequestBudget(kind) {
  return withIntrinsicIntegrity(() => {
    const maximum = kind === 'full-read'
      ? REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead
      : kind === 'double-read'
        ? REMOTE_OBSERVATION_LIMITS.maximumRequestsPerDoubleRead
        : null
    if (maximum === null) fail('request budget kind is unsupported.')
    return immutablePlain({ kind, used: 0, remaining: maximum, maximum })
  })
}

export function consumeRequestBudget(inputBudget, operationName, count = 1) {
  return withIntrinsicIntegrity(() => {
    const budget = snapshotPlain(inputBudget, 'Request budget')
    if (!exactKeys(budget, ['kind', 'maximum', 'remaining', 'used'])
      || !['full-read', 'double-read'].includes(budget.kind)
      || !Number.isSafeInteger(budget.maximum)
      || !Number.isSafeInteger(budget.used)
      || !Number.isSafeInteger(budget.remaining)
      || budget.used < 0
      || budget.remaining < 0
      || budget.used + budget.remaining !== budget.maximum
      || budget.maximum !== (budget.kind === 'full-read'
        ? REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead
        : REMOTE_OBSERVATION_LIMITS.maximumRequestsPerDoubleRead)) {
      fail('request budget state is malformed.')
    }
    const definition = PREVIEW_OPERATION_REGISTRY[operationName]
    if (!definition) fail('request budget operation is not allowlisted.')
    if (!Number.isSafeInteger(count) || count < 1) fail('request budget count is invalid.')
    const charge = definition.requestBudgetWeight * count
    if (charge > budget.remaining) fail('request budget is exhausted.')
    return immutablePlain({
      kind: budget.kind,
      used: budget.used + charge,
      remaining: budget.remaining - charge,
      maximum: budget.maximum,
    })
  })
}

export function assertPaginationBudget(input) {
  return withIntrinsicIntegrity(() => {
    const pagination = snapshotPlain(input, 'Pagination budget')
    if (!exactKeys(pagination, ['page', 'pages', 'records'])
      || !Number.isSafeInteger(pagination.page)
      || !Number.isSafeInteger(pagination.pages)
      || !Number.isSafeInteger(pagination.records)
      || pagination.page < 1
      || pagination.pages < pagination.page
      || pagination.pages > REMOTE_OBSERVATION_LIMITS.maximumPaginationPages
      || pagination.records < 0
      || pagination.records > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
      fail('pagination exceeds the approved page or record budget.')
    }
    return pagination
  })
}

export function assertReviewedRouteZoneBudget(routeZoneIds) {
  return withIntrinsicIntegrity(() => {
    const zones = snapshotPlain(routeZoneIds, 'Reviewed route zones')
    if (!Array.isArray(zones)
      || zones.length > REMOTE_OBSERVATION_LIMITS.maximumReviewedRouteZones
      || zones.some((zoneId) => !ZONE_ID_PATTERN.test(zoneId))
      || new Set(zones).size !== zones.length) {
      fail('reviewed route-zone inventory exceeds the approved bound or is malformed.')
    }
    return zones
  })
}

export function assertSerializedObservationBudget(serialized) {
  return withIntrinsicIntegrity(() => {
    if (typeof serialized !== 'string') fail('serialized observation must be text.')
    if (bufferByteLength(serialized, 'utf8')
      > REMOTE_OBSERVATION_LIMITS.maximumSerializedObservationBytes) {
      fail('serialized observation exceeds the approved byte limit.')
    }
    return serialized
  })
}
