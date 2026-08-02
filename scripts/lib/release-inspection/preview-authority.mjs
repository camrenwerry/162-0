import { realpathSync } from 'node:fs'
import { types as utilTypes } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  immutablePlain,
} from '../preview-release/canonical.mjs'
import {
  loadReleaseManifest,
  productionDenylist,
} from '../preview-release/manifest.mjs'
import {
  assertReleaseInspectionIntrinsicIntegrity,
  createReleaseInspectionWeakMap,
  getReleaseInspectionWeakMapValue,
  setReleaseInspectionWeakMapValue,
} from './intrinsic-integrity.mjs'
import { assertNoProductionPoisoning } from './production-poisoning.mjs'
import {
  consumeRequestBudget,
  createPreviewOperationRequest,
  createRequestBudget,
  parseStrictRemoteJson,
  PREVIEW_OPERATION_REGISTRY,
  REMOTE_OBSERVATION_LIMITS,
  validateObservationCredentialEnvironment,
  validatePreviewOperationRequest,
} from './remote-transport.mjs'

const isProxy = utilTypes.isProxy
const trustedSetTimeout = globalThis.setTimeout
const trustedClearTimeout = globalThis.clearTimeout
const trustedNow = Date.now
const TrustedAbortController = globalThis.AbortController
const TrustedAbortSignal = globalThis.AbortSignal
const TrustedResponse = globalThis.Response
const TrustedURL = globalThis.URL
const bufferByteLength = Buffer.byteLength
const pathResolve = path.resolve
const authorityRepositoryRoot = realpathSync(pathResolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
))
const urlOriginGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'origin')?.get
const urlPathnameGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'pathname')?.get
const urlSearchGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'search')?.get
const urlHashGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'hash')?.get
const urlPasswordGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'password')?.get
const urlUsernameGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'username')?.get
const urlSearchParamsGetter = Object.getOwnPropertyDescriptor(TrustedURL.prototype, 'searchParams')?.get
const urlSearchParamsAppend = globalThis.URLSearchParams.prototype.append
const trustedEncodeURIComponent = globalThis.encodeURIComponent
const responseHeadersGetter = Object.getOwnPropertyDescriptor(TrustedResponse.prototype, 'headers')?.get
const responseBodyGetter = Object.getOwnPropertyDescriptor(TrustedResponse.prototype, 'body')?.get
const responseStatusGetter = Object.getOwnPropertyDescriptor(TrustedResponse.prototype, 'status')?.get
const headersGet = globalThis.Headers.prototype.get
const streamGetReader = globalThis.ReadableStream.prototype.getReader
const probeReader = new globalThis.ReadableStream().getReader()
const readerPrototype = Object.getPrototypeOf(probeReader)
const readerRead = readerPrototype.read
const readerCancel = readerPrototype.cancel
const readerReleaseLock = readerPrototype.releaseLock
probeReader.releaseLock()
const abortControllerAbort = TrustedAbortController.prototype.abort
const abortControllerSignalGetter = Object.getOwnPropertyDescriptor(
  TrustedAbortController.prototype,
  'signal',
)?.get

const identityAuthority = createReleaseInspectionWeakMap()
const DEPENDENCY_KEYS = Object.freeze(['clearTimer', 'fetchImplementation', 'now', 'setTimer'])
const VALID_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?$/iu
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/u
const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/u
const MOCK_FAULTS = new Set([
  'none',
  'timeout',
  'truncated',
  'redirect',
  'http-failure',
  'oversized-body',
  'never-read',
  'never-cancel',
  'abort-ignoring-read',
  'projection-mismatch',
  'projection-extra-header',
  'projection-missing-header',
  'projection-extra-option',
  'projection-changed-redirect',
  'projection-changed-method',
  'projection-fragment',
  'projection-url-credentials',
  'projection-added-query',
  'projection-altered-post-body',
  'projection-missing-body',
  'projection-extra-body',
  'projection-wrong-account',
  'projection-wrong-zone',
])
const SYNTHETIC_IDENTITY = immutablePlain({
  accountId: '1'.repeat(32),
  pagesProject: 'diamond-draft',
  workerName: 'pennant-pursuit-validation-preview',
  databaseId: 'ba6255b4-9425-4863-b10f-79149180f75a',
  routeZoneIds: ['2'.repeat(32)],
})

class PreviewHttpTransportError extends Error {
  constructor(code, operation, status = null) {
    const statusText = status === null ? '' : `; status ${status}`
    super(`Preview HTTP transport refused: ${operation}; ${code}${statusText}.`)
    this.name = 'PreviewHttpTransportError'
    this.code = code
    this.operation = operation
    this.status = status
  }
}

function fail(code, operation = 'transport', status = null) {
  throw new PreviewHttpTransportError(code, operation, status)
}

function identityFail(reason) {
  throw new TypeError(`Preview identity grounding refused: ${reason}`)
}

function exactDataKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)
    || ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))) return false
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length
    && keys.every((key) => typeof key === 'string' && expected.includes(key))
    && keys.every((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      return descriptor && Object.hasOwn(descriptor, 'value') && !descriptor.get && !descriptor.set
        && descriptor.enumerable === true
    })
}

function validatedRawIdentity(manifest) {
  if (manifest.cloudflare.account.status !== 'resolved') identityFail('account grounding is unresolved.')
  const zones = manifest.cloudflare.preview.worker.routeZoneIds
  if (zones.status !== 'resolved' || zones.values.length === 0) {
    identityFail('route-zone grounding is unresolved or empty.')
  }
  assertNoProductionPoisoning(manifest.cloudflare.preview, productionDenylist(manifest, {
    includeBranch: true,
  }), {
    label: 'checked-in Preview identity',
    error: (reason) => new TypeError(`Preview identity grounding refused: ${reason}`),
  })
  const raw = immutablePlain({
    accountId: manifest.cloudflare.account.id,
    pagesProject: manifest.cloudflare.preview.pages.project,
    workerName: manifest.cloudflare.preview.worker.name,
    databaseId: manifest.cloudflare.preview.d1.id,
    routeZoneIds: [...zones.values].sort(),
  })
  if (!ACCOUNT_ID_PATTERN.test(raw.accountId)
    || raw.routeZoneIds.some((zoneId) => !ZONE_ID_PATTERN.test(zoneId))) {
    identityFail('account or route-zone grounding is malformed.')
  }
  // The 3D-2B.1 request builder remains the authority for fixed Preview names,
  // the D1 UUID, Production poisoning, and reviewed route-zone bounds.
  createPreviewOperationRequest('account', { accountId: raw.accountId }, raw)
  return raw
}

function createOpaqueIdentity(rawIdentity, testing = false) {
  assertReleaseInspectionIntrinsicIntegrity()
  const identity = Object.freeze({})
  setReleaseInspectionWeakMapValue(
    identityAuthority,
    identity,
    Object.freeze({ rawIdentity, testing }),
  )
  return identity
}

function rawIdentityFor(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  if (!input || typeof input !== 'object' || isProxy(input)) {
    identityFail('identity provenance is absent.')
  }
  const authority = getReleaseInspectionWeakMapValue(identityAuthority, input)
  if (!authority) identityFail('identity provenance is absent.')
  return authority
}

export function validatePreviewObservationIdentity(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  rawIdentityFor(input)
  return input
}

export function loadPreviewObservationIdentity(repositoryRoot) {
  assertReleaseInspectionIntrinsicIntegrity()
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    identityFail('repository root is required.')
  }
  let requestedRoot
  try {
    requestedRoot = realpathSync(pathResolve(repositoryRoot))
  } catch {
    identityFail('repository root is not the checked-in authority root.')
  }
  if (requestedRoot !== authorityRepositoryRoot) {
    identityFail('repository root is not the checked-in authority root.')
  }
  let loaded
  try {
    loaded = loadReleaseManifest(authorityRepositoryRoot)
  } catch {
    identityFail('checked-in release identity data could not be loaded.')
  }
  if (!loaded.manifest.repository.allowedRoots.includes(authorityRepositoryRoot)) {
    identityFail('checked-in authority root is outside the reviewed root inventory.')
  }
  return createOpaqueIdentity(validatedRawIdentity(loaded.manifest))
}

function validateDependencies(input, { requireInjectedFetch = false } = {}) {
  if (input === undefined) {
    if (requireInjectedFetch) fail('test-fetch-required')
    return Object.freeze({
      fetchImplementation: globalThis.fetch,
      setTimer: trustedSetTimeout,
      clearTimer: trustedClearTimeout,
      now: trustedNow,
    })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || isProxy(input)
    || ![Object.prototype, null].includes(Reflect.getPrototypeOf(input))) {
    fail('invalid-dependencies')
  }
  const keys = Reflect.ownKeys(input)
  if (keys.some((key) => typeof key !== 'string' || !DEPENDENCY_KEYS.includes(key))) {
    fail('invalid-dependencies')
  }
  const defaults = {
    fetchImplementation: globalThis.fetch,
    setTimer: trustedSetTimeout,
    clearTimer: trustedClearTimeout,
    now: trustedNow,
  }
  const result = {}
  for (const key of DEPENDENCY_KEYS) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
    if (descriptor !== undefined && (!Object.hasOwn(descriptor, 'value') || descriptor.get
      || descriptor.set || typeof descriptor.value !== 'function')) {
      fail('invalid-dependencies')
    }
    result[key] = descriptor === undefined ? defaults[key] : descriptor.value
  }
  if (requireInjectedFetch && !Object.hasOwn(input, 'fetchImplementation')) fail('test-fetch-required')
  return Object.freeze(result)
}

function tokenFromValidatedEnvironment(environment) {
  const descriptor = Reflect.getOwnPropertyDescriptor(environment, 'PENNANT_PREVIEW_API_TOKEN')
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('credential-unavailable')
  return descriptor.value
}

function clockNow(dependencies, operation = 'transport') {
  let value
  try {
    value = dependencies.now()
  } catch {
    fail('clock-unavailable', operation)
  }
  assertReleaseInspectionIntrinsicIntegrity()
  if (!Number.isFinite(value)) fail('invalid-clock', operation)
  return value
}

function normalizeOperation(input) {
  let operation
  try {
    operation = immutablePlain(input)
  } catch {
    fail('invalid-operation')
  }
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)
    || typeof operation.operation !== 'string') fail('invalid-operation')
  if (['account-zones', 'pages-preview-deployments'].includes(operation.operation)) {
    if (!exactDataKeys(operation, ['operation', 'page'])
      || !Number.isSafeInteger(operation.page)
      || operation.page < 1
      || operation.page > REMOTE_OBSERVATION_LIMITS.maximumPaginationPages) {
      fail('invalid-operation', operation.operation)
    }
  } else if (operation.operation === 'worker-routes') {
    if (!exactDataKeys(operation, ['operation', 'routeZoneIndex'])
      || !Number.isSafeInteger(operation.routeZoneIndex)
      || operation.routeZoneIndex < 0) fail('invalid-operation', operation.operation)
  } else if (![
    'account',
    'pages-project',
    'worker-settings',
    'worker-deployments',
    'worker-subdomain',
    'worker-schedules',
    'worker-custom-domains',
    'd1-database',
    'migration-table-discovery',
    'migration-rows',
    'backend-schema-version',
  ].includes(operation.operation) || !exactDataKeys(operation, ['operation'])) {
    fail('invalid-operation', operation.operation)
  }
  return operation
}

function privateRequest(operation, identity) {
  const parameters = { accountId: identity.accountId }
  if (Object.hasOwn(operation, 'page')) parameters.page = operation.page
  if (operation.operation.startsWith('pages-')) parameters.pagesProject = identity.pagesProject
  if (operation.operation.startsWith('worker-')) parameters.workerName = identity.workerName
  if (operation.operation === 'worker-routes') {
    if (operation.routeZoneIndex >= identity.routeZoneIds.length) {
      fail('invalid-operation', operation.operation)
    }
    parameters.zoneId = identity.routeZoneIds[operation.routeZoneIndex]
  }
  if (operation.operation === 'd1-database'
    || operation.operation.startsWith('migration-')
    || operation.operation === 'backend-schema-version') parameters.databaseId = identity.databaseId
  return createPreviewOperationRequest(operation.operation, parameters, identity)
}

function requestUrl(request) {
  let url
  try {
    url = new TrustedURL(request.path, request.origin)
    const searchParams = Reflect.apply(urlSearchParamsGetter, url, [])
    for (const { name, value } of request.query) {
      Reflect.apply(urlSearchParamsAppend, searchParams, [name, value])
    }
  } catch {
    fail('invalid-request', request.operation)
  }
  const origin = Reflect.apply(urlOriginGetter, url, [])
  const pathname = Reflect.apply(urlPathnameGetter, url, [])
  if (origin !== request.origin || !pathname.startsWith('/client/v4/')) {
    fail('invalid-request', request.operation)
  }
  return url
}

function projectHttpRequest(request, token, signal) {
  const url = requestUrl(request)
  const body = request.body === null ? undefined : canonicalJson(request.body)
  return Object.freeze({
    url,
    options: Object.freeze({
      method: request.method,
      redirect: 'manual',
      signal,
      headers: Object.freeze({
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      }),
      ...(body === undefined ? {} : { body }),
    }),
  })
}

function responseHeader(response, name) {
  const headers = Reflect.apply(responseHeadersGetter, response, [])
  return Reflect.apply(headersGet, headers, [name])
}

function detached(promise) {
  void Promise.resolve(promise).catch(() => {})
}

function bestEffortCancel(reader) {
  let cancellation
  try {
    cancellation = Reflect.apply(readerCancel, reader, [])
  } catch {
    return
  }
  // Cancellation is initiated but never joins the refusal path. The resolved
  // cleanup boundary ensures a non-cooperative cancel promise cannot remain the
  // controlling branch, while Promise.race still observes any late rejection.
  detached(Promise.race([Promise.resolve(cancellation), Promise.resolve()]))
}

async function racePhase(promise, deadline, operation, failureCode) {
  try {
    return await Promise.race([Promise.resolve(promise), deadline])
  } catch (error) {
    if (error instanceof PreviewHttpTransportError && error.code === 'request-timeout') throw error
    fail(failureCode, operation)
  }
}

async function boundedResponseBytes(response, request, deadline) {
  const declared = responseHeader(response, 'content-length')
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared)
    || Number(declared) > request.responseLimitBytes)) {
    fail('response-size-exceeded', request.operation)
  }
  const stream = Reflect.apply(responseBodyGetter, response, [])
  if (!stream) fail('missing-response-body', request.operation)
  const reader = await racePhase(
    Promise.resolve().then(() => Reflect.apply(streamGetReader, stream, [])),
    deadline,
    request.operation,
    'response-reader-unavailable',
  )
  const chunks = []
  let total = 0
  let readIterations = 0
  try {
    while (true) {
      readIterations += 1
      if (readIterations > REMOTE_OBSERVATION_LIMITS.maximumResponseReadIterations) {
        fail('response-read-iterations-exceeded', request.operation)
      }
      let readPromise
      try {
        readPromise = Reflect.apply(readerRead, reader, [])
      } catch {
        fail('truncated-response', request.operation)
      }
      const part = await racePhase(readPromise, deadline, request.operation, 'truncated-response')
      assertReleaseInspectionIntrinsicIntegrity()
      if (!part || typeof part !== 'object' || typeof part.done !== 'boolean') {
        fail('malformed-response-stream', request.operation)
      }
      if (part.done) break
      if (!(part.value instanceof Uint8Array)) fail('malformed-response-stream', request.operation)
      if (part.value.byteLength === 0) {
        fail('non-progressing-response-stream', request.operation)
      }
      total += part.value.byteLength
      if (total > request.responseLimitBytes) {
        bestEffortCancel(reader)
        fail('response-size-exceeded', request.operation)
      }
      chunks.push(part.value)
    }
  } catch (error) {
    bestEffortCancel(reader)
    throw error
  } finally {
    try { Reflect.apply(readerReleaseLock, reader, []) } catch { /* bounded cleanup */ }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function containsCredential(value, token) {
  if (typeof value === 'string') return value.includes(token)
  if (Array.isArray(value)) {
    for (const entry of value) if (containsCredential(entry, token)) return true
    return false
  }
  if (!value || typeof value !== 'object') return false
  return Reflect.ownKeys(value).some((key) => (
    (typeof key === 'string' && key.includes(token))
    || containsCredential(Reflect.getOwnPropertyDescriptor(value, key)?.value, token)
  ))
}

function consumeEnvelope(envelope, request, byteLength) {
  if (envelope.success !== true || envelope.errors.length !== 0 || envelope.messages.length !== 0) {
    fail('provider-response-failure', request.operation)
  }
  // 3D-2B.2a deliberately consumes and discards provider data here. A later
  // milestone may add operation-specific normalizers inside this private
  // boundary without making provider envelopes or identifiers public.
  return immutablePlain({
    operation: request.operation,
    bodyBytes: byteLength,
    representation: 'private-provider-json-consumed',
  })
}

function createTransport(rawIdentity, credentialEnvironment, dependenciesInput, testing = false) {
  validateObservationCredentialEnvironment(credentialEnvironment)
  const token = tokenFromValidatedEnvironment(credentialEnvironment)
  const dependencies = validateDependencies(dependenciesInput, { requireInjectedFetch: testing })
  if (typeof dependencies.fetchImplementation !== 'function') fail('network-unavailable')

  let budget = createRequestBudget('full-read')
  let inFlight = false
  const startedAtMs = clockNow(dependencies)

  const request = async (operationInput) => {
    assertReleaseInspectionIntrinsicIntegrity()
    const operation = normalizeOperation(operationInput)
    const privateDescriptor = validatePreviewOperationRequest(
      privateRequest(operation, rawIdentity),
      rawIdentity,
    )
    if (inFlight) fail('concurrent-request-prohibited', operation.operation)
    const elapsedAtStart = clockNow(dependencies, operation.operation) - startedAtMs
    if (elapsedAtStart < 0 || elapsedAtStart >= REMOTE_OBSERVATION_LIMITS.fullReadTimeoutMs) {
      fail('full-read-timeout', operation.operation)
    }
    budget = consumeRequestBudget(budget, operation.operation)
    inFlight = true
    let timer = null
    let rejectDeadline
    const deadline = new Promise((resolve, reject) => { rejectDeadline = reject })
    const controller = new TrustedAbortController()
    const signal = Reflect.apply(abortControllerSignalGetter, controller, [])
    const timeoutError = new PreviewHttpTransportError('request-timeout', operation.operation)
    try {
      try {
        timer = dependencies.setTimer(() => {
          try { Reflect.apply(abortControllerAbort, controller, []) } catch { /* bounded abort */ }
          rejectDeadline(timeoutError)
        }, Math.min(
          privateDescriptor.timeoutMs,
          REMOTE_OBSERVATION_LIMITS.fullReadTimeoutMs - elapsedAtStart,
        ))
      } catch {
        fail('timer-unavailable', operation.operation)
      }
      assertReleaseInspectionIntrinsicIntegrity()
      const projection = projectHttpRequest(privateDescriptor, token, signal)
      const response = await racePhase(
        Promise.resolve().then(() => dependencies.fetchImplementation(projection.url, projection.options)),
        deadline,
        operation.operation,
        'network-failure',
      )
      assertReleaseInspectionIntrinsicIntegrity()
      if (!(response instanceof TrustedResponse)) fail('invalid-response-object', operation.operation)
      const elapsedAfterFetch = clockNow(dependencies, operation.operation) - startedAtMs
      if (elapsedAfterFetch < elapsedAtStart
        || elapsedAfterFetch >= REMOTE_OBSERVATION_LIMITS.fullReadTimeoutMs) {
        fail('full-read-timeout', operation.operation)
      }
      const status = Reflect.apply(responseStatusGetter, response, [])
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        fail('invalid-response-status', operation.operation)
      }
      if (status >= 300 && status < 400) fail('redirect-rejected', operation.operation, status)
      if (status < 200 || status >= 300) fail('http-status', operation.operation, status)
      const contentType = responseHeader(response, 'content-type')
      if (typeof contentType !== 'string' || !VALID_CONTENT_TYPE.test(contentType)) {
        fail('invalid-content-type', operation.operation)
      }
      const bytes = await boundedResponseBytes(response, privateDescriptor, deadline)
      const elapsedAfterBody = clockNow(dependencies, operation.operation) - startedAtMs
      if (elapsedAfterBody < elapsedAfterFetch
        || elapsedAfterBody >= REMOTE_OBSERVATION_LIMITS.fullReadTimeoutMs) {
        fail('full-read-timeout', operation.operation)
      }
      let envelope
      try {
        envelope = parseStrictRemoteJson(bytes)
      } catch {
        fail('malformed-response', operation.operation)
      }
      if (containsCredential(envelope, token)) fail('credential-echo-rejected', operation.operation)
      return consumeEnvelope(envelope, privateDescriptor, bytes.byteLength)
    } finally {
      if (timer !== null) {
        try { dependencies.clearTimer(timer) } catch { /* bounded cleanup */ }
        assertReleaseInspectionIntrinsicIntegrity()
      }
      inFlight = false
    }
  }

  return Object.freeze({ request, requestBudget: () => budget })
}

export function createPreviewHttpTransport(identityInput, credentialEnvironment, dependenciesInput) {
  assertReleaseInspectionIntrinsicIntegrity()
  // Provenance verification is intentionally first. Credential, dependency,
  // fetch, timer, and clock objects remain untouched for rejected identities.
  const authority = rawIdentityFor(identityInput)
  if (authority.testing) identityFail('test identity cannot construct the public transport.')
  return createTransport(
    authority.rawIdentity,
    credentialEnvironment,
    dependenciesInput,
    false,
  )
}

function syntheticTransportForTesting(credentialEnvironment, dependenciesInput) {
  assertReleaseInspectionIntrinsicIntegrity()
  return createTransport(SYNTHETIC_IDENTITY, credentialEnvironment, dependenciesInput, true)
}

function authoritativeMockRequest(operation) {
  const definition = PREVIEW_OPERATION_REGISTRY[operation.operation]
  if (!definition) fail('mock-projection-mismatch')
  const parameters = {}
  for (const key of definition.parameterKeys) {
    if (key === 'accountId') parameters.accountId = SYNTHETIC_IDENTITY.accountId
    else if (key === 'databaseId') parameters.databaseId = SYNTHETIC_IDENTITY.databaseId
    else if (key === 'pagesProject') parameters.pagesProject = SYNTHETIC_IDENTITY.pagesProject
    else if (key === 'workerName') parameters.workerName = SYNTHETIC_IDENTITY.workerName
    else if (key === 'page') parameters.page = operation.page
    else if (key === 'zoneId') parameters.zoneId = SYNTHETIC_IDENTITY.routeZoneIds[operation.routeZoneIndex]
    else fail('mock-projection-mismatch')
  }
  return createPreviewOperationRequest(operation.operation, parameters, SYNTHETIC_IDENTITY)
}

function encodedQuery(query) {
  if (query.length === 0) return ''
  return `?${query.map(({ name, value }) => (
    `${Reflect.apply(trustedEncodeURIComponent, undefined, [name])}=${Reflect.apply(
      trustedEncodeURIComponent,
      undefined,
      [value],
    )}`
  )).join('&')}`
}

function assertExactMockProjection(url, options, operation, token) {
  const request = authoritativeMockRequest(operation)
  if (!(url instanceof TrustedURL) || isProxy(url) || Reflect.ownKeys(url).length !== 0
    || Reflect.apply(urlOriginGetter, url, []) !== request.origin
    || Reflect.apply(urlPathnameGetter, url, []) !== request.path
    || Reflect.apply(urlSearchGetter, url, []) !== encodedQuery(request.query)
    || Reflect.apply(urlHashGetter, url, []) !== ''
    || Reflect.apply(urlUsernameGetter, url, []) !== ''
    || Reflect.apply(urlPasswordGetter, url, []) !== '') {
    fail('mock-projection-mismatch')
  }
  const expectedBody = request.body === null ? undefined : canonicalJson(request.body)
  const optionKeys = expectedBody === undefined
    ? ['headers', 'method', 'redirect', 'signal']
    : ['body', 'headers', 'method', 'redirect', 'signal']
  if (!exactDataKeys(options, optionKeys)
    || options.method !== request.method
    || options.redirect !== 'manual'
    || !(options.signal instanceof TrustedAbortSignal)
    || (expectedBody === undefined
      ? Object.hasOwn(options, 'body')
      : options.body !== expectedBody)) {
    fail('mock-projection-mismatch')
  }
  const expectedHeaderKeys = expectedBody === undefined
    ? ['accept', 'authorization']
    : ['accept', 'authorization', 'content-type']
  if (!exactDataKeys(options.headers, expectedHeaderKeys)
    || options.headers.accept !== 'application/json'
    || options.headers.authorization !== `Bearer ${token}`
    || (expectedBody === undefined
      ? Object.hasOwn(options.headers, 'content-type')
      : options.headers['content-type'] !== 'application/json')) {
    fail('mock-projection-mismatch')
  }
}

function mutatedMockProjection(url, options, fault) {
  if (!fault.startsWith('projection-') || fault === 'projection-mismatch') {
    return { url, options }
  }
  const mutatedUrl = new TrustedURL(url)
  const mutatedOptions = { ...options, headers: { ...options.headers } }
  if (fault === 'projection-extra-header') mutatedOptions.headers['x-review-extra'] = '1'
  else if (fault === 'projection-missing-header') delete mutatedOptions.headers.accept
  else if (fault === 'projection-extra-option') mutatedOptions.cache = 'no-store'
  else if (fault === 'projection-changed-redirect') mutatedOptions.redirect = 'follow'
  else if (fault === 'projection-changed-method') {
    mutatedOptions.method = options.method === 'GET' ? 'POST' : 'GET'
  } else if (fault === 'projection-fragment') mutatedUrl.hash = 'review-fragment'
  else if (fault === 'projection-url-credentials') {
    mutatedUrl.username = 'review-user'
    mutatedUrl.password = 'review-password'
  } else if (fault === 'projection-added-query') {
    mutatedUrl.searchParams.append('review-extra', '1')
  } else if (fault === 'projection-altered-post-body') mutatedOptions.body = '{"params":[],"sql":"SELECT 1"}'
  else if (fault === 'projection-missing-body') delete mutatedOptions.body
  else if (fault === 'projection-extra-body') mutatedOptions.body = '{}'
  else if (fault === 'projection-wrong-account') {
    mutatedUrl.pathname = mutatedUrl.pathname.replace(SYNTHETIC_IDENTITY.accountId, '3'.repeat(32))
  } else if (fault === 'projection-wrong-zone') {
    mutatedUrl.pathname = mutatedUrl.pathname.replace(SYNTHETIC_IDENTITY.routeZoneIds[0], '4'.repeat(32))
  } else fail('invalid-mock-exchange')
  return { url: mutatedUrl, options: mutatedOptions }
}

function normalizeExchange(input) {
  if (!exactDataKeys(input, ['bytes', 'contentType', 'fault', 'request', 'status'])) {
    fail('invalid-mock-exchange')
  }
  const request = normalizeOperation(input.request)
  if (!(input.bytes instanceof Uint8Array)
    || typeof input.contentType !== 'string'
    || !Number.isSafeInteger(input.status)
    || input.status < 100
    || input.status > 599
    || !MOCK_FAULTS.has(input.fault)) fail('invalid-mock-exchange')
  return Object.freeze({
    request,
    bytes: new Uint8Array(input.bytes),
    contentType: input.contentType,
    status: input.status,
    fault: input.fault,
  })
}

export function createMockPreviewTransport(credentialEnvironment, exchangesInput) {
  validateObservationCredentialEnvironment(credentialEnvironment)
  const token = tokenFromValidatedEnvironment(credentialEnvironment)
  if (!Array.isArray(exchangesInput) || isProxy(exchangesInput) || exchangesInput.length === 0) {
    fail('invalid-mock-exchanges')
  }
  const exchanges = exchangesInput.map((entry) => normalizeExchange(entry))
  let cursor = 0
  let active = null
  let scheduledTimeout = null

  const fetchImplementation = async (url, options) => {
    if (!active) fail('mock-fetch-without-request')
    const exchange = active
    const projectionFault = exchange.fault === 'projection-mismatch'
      ? 'projection-changed-method'
      : exchange.fault
    const projected = mutatedMockProjection(url, options, projectionFault)
    assertExactMockProjection(projected.url, projected.options, exchange.request, token)
    if (exchange.fault === 'timeout') {
      scheduledTimeout?.()
      return new Promise(() => {})
    }
    if (exchange.fault === 'truncated') {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(exchange.bytes.slice(0, Math.min(8, exchange.bytes.length)))
          controller.error(new Error('synthetic truncation'))
        },
      })
      return new Response(stream, {
        status: exchange.status,
        headers: { 'content-type': exchange.contentType },
      })
    }
    if (['never-read', 'never-cancel', 'abort-ignoring-read'].includes(exchange.fault)) {
      const stream = new ReadableStream({
        pull() { return new Promise(() => {}) },
        cancel() {
          return exchange.fault === 'never-cancel' ? new Promise(() => {}) : undefined
        },
      })
      queueMicrotask(() => scheduledTimeout?.())
      return new Response(stream, {
        status: exchange.status,
        headers: { 'content-type': exchange.contentType },
      })
    }
    const status = exchange.fault === 'redirect'
      ? 302
      : exchange.fault === 'http-failure'
        ? 503
        : exchange.status
    const headers = {
      'content-type': exchange.contentType,
      ...(exchange.fault === 'oversized-body'
        ? { 'content-length': String(REMOTE_OBSERVATION_LIMITS.maximumResponseBytes + 1) }
        : {}),
    }
    return new Response(exchange.bytes, { status, headers })
  }

  const transport = syntheticTransportForTesting(credentialEnvironment, {
    fetchImplementation,
    setTimer(callback) {
      scheduledTimeout = callback
      return 1
    },
    clearTimer() { scheduledTimeout = null },
  })

  return Object.freeze({
    async request(operationInput) {
      if (cursor >= exchanges.length) fail('unexpected-extra-mock-request')
      const operation = normalizeOperation(operationInput)
      const expected = exchanges[cursor]
      if (canonicalJson(operation) !== canonicalJson(expected.request)) fail('mock-request-mismatch')
      active = expected
      cursor += 1
      try {
        return await transport.request(operation)
      } finally {
        active = null
      }
    },
    requestBudget: transport.requestBudget,
    assertExhausted() {
      if (cursor !== exchanges.length) fail('unconsumed-mock-exchange')
      return true
    },
  })
}

export function createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, dependenciesInput) {
  return syntheticTransportForTesting(credentialEnvironment, dependenciesInput)
}

export function loadSyntheticPreviewObservationIdentityForTesting() {
  return createOpaqueIdentity(SYNTHETIC_IDENTITY, true)
}
