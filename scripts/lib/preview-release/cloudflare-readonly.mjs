import { TextDecoder } from 'node:util'
import { performance } from 'node:perf_hooks'
import { assertExactBindings, expectedPagesBindings, expectedWorkerBindings } from './binding-inventory.mjs'
import { immutablePlain } from './canonical.mjs'
import { PreviewWorkflowError, refusalError, remoteError } from './errors.mjs'
import { assertSelectOnlySql, BACKEND_VERSION_SQL, MIGRATION_ROWS_SQL, MIGRATION_TABLES_SQL } from './migrations.mjs'
import { productionDenylist } from './manifest.mjs'
import { safeErrorMessage } from './redaction.mjs'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 1_048_576
const MAX_PAGES = 10
const PAGE_SIZE = 25
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/
const BINDING_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const ACCOUNT_PATTERN = /^[0-9a-f]{32}$/
const ZONE_PATTERN = /^[0-9a-f]{32}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PUBLIC_GATE_BINDINGS = new Set(['DRAFT_SUBMISSION_MODE', 'DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE'])
const OPERATION_PARAMETER_KEYS = Object.freeze({
  account: ['accountId'],
  'account-zones': ['accountId', 'page'],
  'pages-project': ['accountId', 'project'],
  'pages-deployments': ['accountId', 'page', 'project'],
  'worker-settings': ['accountId', 'worker'],
  'worker-deployments': ['accountId', 'worker'],
  'worker-subdomain': ['accountId', 'worker'],
  'worker-schedules': ['accountId', 'worker'],
  'worker-domains': ['accountId', 'worker'],
  'worker-routes': ['accountId', 'worker', 'zoneId'],
  'd1-database': ['accountId', 'databaseId'],
  'migration-tables': ['accountId', 'databaseId'],
  'migration-rows': ['accountId', 'databaseId'],
  'backend-version': ['accountId', 'databaseId'],
})

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw remoteError(`${label} has an unexpected JSON shape.`, 'unexpected_json_shape')
  return value
}

function array(value, label) {
  if (!Array.isArray(value)) throw remoteError(`${label} has an unexpected JSON shape.`, 'unexpected_json_shape')
  return immutablePlain(value)
}

function immutableParameterSnapshot(operation, parameters) {
  const required = OPERATION_PARAMETER_KEYS[operation]
  if (!required) throw refusalError(`Read-only Cloudflare operation is not allowlisted: ${operation}.`, 'remote.request-allowlist')
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || ![Object.prototype, null].includes(Object.getPrototypeOf(parameters))) {
    throw refusalError('Read-only request parameters must be one plain object.', 'remote.request-allowlist')
  }
  for (const key in parameters) {
    if (!Object.hasOwn(parameters, key)) throw refusalError('Read-only request parameters must not contain inherited properties.', 'remote.request-allowlist')
  }
  const ownKeys = Reflect.ownKeys(parameters)
  if (ownKeys.some((key) => typeof key === 'symbol')) throw refusalError('Read-only request parameters must not contain symbol keys.', 'remote.request-allowlist')
  const actual = ownKeys.map(String).sort()
  const expected = [...required].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw refusalError(`Read-only request requires exactly: ${expected.join(', ')}.`, 'remote.request-allowlist')
  }
  const snapshot = {}
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(parameters, key)
    if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
      throw refusalError('Read-only request parameters must not contain accessors or non-enumerable properties.', 'remote.request-allowlist')
    }
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return immutablePlain(snapshot)
}

function decodedVariants(value) {
  const variants = [value]
  let current = value
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) break
      variants.push(decoded)
      current = decoded
    } catch {
      throw refusalError('Read-only request parameter contains malformed percent encoding.', 'remote.request-allowlist')
    }
  }
  return variants
}

function rejectProductionValues(parameters, denied) {
  for (const value of Object.values(parameters)) {
    if (typeof value !== 'string') continue
    for (const variant of decodedVariants(value)) {
      const collision = denied.find((identity) => variant.toLowerCase().includes(identity.toLowerCase()))
      if (collision) throw refusalError(`Read-only request contains prohibited Production identity ${collision}.`, 'remote.production-contact')
    }
  }
}

function requireIdentity(actual, expected, label, pattern = IDENTIFIER_PATTERN) {
  if (typeof actual !== 'string' || !pattern.test(actual) || actual !== expected) {
    throw refusalError(`${label} does not match the immutable Preview release manifest.`, 'remote.identity')
  }
}

function operationDefinition(operation, parameters, manifest, denied) {
  const safeParameters = immutableParameterSnapshot(operation, parameters)
  rejectProductionValues(safeParameters, denied)
  const accountId = manifest.cloudflare.account.id
  const preview = manifest.cloudflare.preview
  const prefix = `/client/v4/accounts/${accountId}`
  const account = () => requireIdentity(safeParameters.accountId, accountId, 'Cloudflare account ID', ACCOUNT_PATTERN)

  if (operation === 'account') {
    account()
    return { method: 'GET', path: prefix }
  }
  if (operation === 'account-zones') {
    account()
    if (!Number.isInteger(safeParameters.page) || safeParameters.page < 1 || safeParameters.page > MAX_PAGES) {
      throw refusalError('Account zone page is outside the reviewed pagination bound.', 'remote.request-allowlist')
    }
    return {
      method: 'GET',
      path: `/client/v4/zones?account.id=${accountId}&page=${safeParameters.page}&per_page=${PAGE_SIZE}`,
      paginated: true,
      page: safeParameters.page,
    }
  }
  if (operation === 'pages-project') {
    account()
    requireIdentity(safeParameters.project, preview.pages.project, 'Preview Pages project')
    return { method: 'GET', path: `${prefix}/pages/projects/${preview.pages.project}` }
  }
  if (operation === 'pages-deployments') {
    account()
    requireIdentity(safeParameters.project, preview.pages.project, 'Preview Pages project')
    if (!Number.isInteger(safeParameters.page) || safeParameters.page < 1 || safeParameters.page > MAX_PAGES) {
      throw refusalError('Pages deployment page is outside the reviewed pagination bound.', 'remote.request-allowlist')
    }
    return {
      method: 'GET',
      path: `${prefix}/pages/projects/${preview.pages.project}/deployments?env=preview&page=${safeParameters.page}&per_page=${PAGE_SIZE}`,
      paginated: true,
      page: safeParameters.page,
    }
  }
  if (['worker-settings', 'worker-deployments', 'worker-subdomain', 'worker-schedules'].includes(operation)) {
    account()
    requireIdentity(safeParameters.worker, preview.worker.name, 'Preview Worker')
    const suffix = {
      'worker-settings': '/settings',
      'worker-deployments': '/deployments',
      'worker-subdomain': '/subdomain',
      'worker-schedules': '/schedules',
    }[operation]
    return { method: 'GET', path: `${prefix}/workers/scripts/${preview.worker.name}${suffix}` }
  }
  if (operation === 'worker-domains') {
    account()
    requireIdentity(safeParameters.worker, preview.worker.name, 'Preview Worker')
    return { method: 'GET', path: `${prefix}/workers/domains`, optionalSinglePageMetadata: true }
  }
  if (operation === 'worker-routes') {
    account()
    requireIdentity(safeParameters.worker, preview.worker.name, 'Preview Worker')
    requireIdentity(safeParameters.zoneId, safeParameters.zoneId, 'Preview Worker route zone', ZONE_PATTERN)
    if (!preview.worker.routeZoneIds.values.includes(safeParameters.zoneId)) {
      throw refusalError('Worker route zone is not in the immutable Preview allowlist.', 'remote.identity.routes')
    }
    return { method: 'GET', path: `/client/v4/zones/${safeParameters.zoneId}/workers/routes`, arrayResult: true }
  }
  if (operation === 'd1-database') {
    account()
    requireIdentity(safeParameters.databaseId, preview.d1.id, 'Preview D1 database', UUID_PATTERN)
    return { method: 'GET', path: `${prefix}/d1/database/${preview.d1.id}` }
  }
  const querySql = { 'migration-tables': MIGRATION_TABLES_SQL, 'migration-rows': MIGRATION_ROWS_SQL, 'backend-version': BACKEND_VERSION_SQL }[operation]
  if (querySql) {
    account()
    requireIdentity(safeParameters.databaseId, preview.d1.id, 'Preview D1 database', UUID_PATTERN)
    assertSelectOnlySql(querySql)
    return { method: 'POST', path: `${prefix}/d1/database/${preview.d1.id}/query`, body: JSON.stringify({ sql: querySql, params: [] }) }
  }
  throw refusalError(`Read-only Cloudflare operation is not allowlisted: ${operation}.`, 'remote.request-allowlist')
}

function validateResultInfo(value, expectedPage, resultLength) {
  const info = assertObject(value, 'Cloudflare pagination metadata')
  for (const key of ['count', 'page', 'per_page', 'total_count', 'total_pages']) {
    if (!Number.isInteger(info[key]) || info[key] < 0) throw remoteError('Cloudflare pagination metadata is malformed.', 'ambiguous_remote_state', 'remote.pagination')
  }
  if (info.page !== expectedPage || info.per_page !== PAGE_SIZE || info.count !== resultLength || info.total_pages < expectedPage
    || info.total_pages > MAX_PAGES || info.total_count < resultLength) {
    throw remoteError('Cloudflare pagination metadata is incomplete or inconsistent.', 'ambiguous_remote_state', 'remote.pagination')
  }
  return immutablePlain({ count: info.count, page: info.page, perPage: info.per_page, totalCount: info.total_count, totalPages: info.total_pages })
}

function validateOptionalSinglePageInfo(value, resultLength) {
  if (value === undefined) return null
  const info = assertObject(value, 'Cloudflare optional pagination metadata')
  const allowed = new Set(['count', 'page', 'per_page', 'total_count', 'total_pages'])
  if (Object.keys(info).some((key) => !allowed.has(key))) {
    throw remoteError('Cloudflare optional pagination metadata contains an unknown field.', 'ambiguous_remote_state', 'remote.pagination')
  }
  for (const key of allowed) {
    if (info[key] !== undefined && (!Number.isInteger(info[key]) || info[key] < 0)) {
      throw remoteError('Cloudflare optional pagination metadata is malformed.', 'ambiguous_remote_state', 'remote.pagination')
    }
  }
  const count = info.count ?? resultLength
  const page = info.page ?? 1
  const perPage = info.per_page ?? resultLength
  const totalCount = info.total_count ?? resultLength
  const totalPages = info.total_pages ?? 1
  if (count !== resultLength || page !== 1 || totalCount !== resultLength || totalPages !== 1
    || (resultLength > 0 && perPage < resultLength)) {
    throw remoteError('Cloudflare single-page inventory is incomplete or inconsistent.', 'ambiguous_remote_state', 'remote.pagination')
  }
  return immutablePlain({ count, page, perPage, totalCount, totalPages })
}

function assertEnvelope(value, definition) {
  const envelope = assertObject(value, 'Cloudflare response')
  if (envelope.success !== true || !('result' in envelope)) throw remoteError('Cloudflare response did not report success.', 'remote_api_failure')
  if (definition.arrayResult) return immutablePlain(array(envelope.result, 'Cloudflare array result'))
  if (definition.optionalSinglePageMetadata) {
    const items = array(envelope.result, 'Cloudflare single-page result')
    return immutablePlain({ items, resultInfo: validateOptionalSinglePageInfo(envelope.result_info, items.length) })
  }
  if (!definition.paginated) return immutablePlain(envelope.result)
  const items = array(envelope.result, 'Cloudflare paginated result')
  return immutablePlain({ items, resultInfo: validateResultInfo(envelope.result_info, definition.page, items.length) })
}

function readWithAbort(reader, signal) {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('Request deadline exceeded.'), { name: 'AbortError' }))
  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel('Request deadline exceeded.').catch(() => {})
      reject(Object.assign(new Error('Request deadline exceeded.'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', abort, { once: true })
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function readBoundedBody(response, maximumBytes, signal, assertDeadline) {
  assertDeadline('body-start')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw remoteError('Cloudflare response declared an invalid or oversized content length.', 'response_too_large')
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw remoteError('Cloudflare response did not provide a readable body.', 'unexpected_response_body')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    assertDeadline('body-read', reader)
    const { done, value } = await readWithAbort(reader, signal)
    assertDeadline('body-read', reader)
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel('Response size limit exceeded.')
      throw remoteError('Cloudflare response exceeded the streaming size limit.', 'response_too_large')
    }
    chunks.push(value)
  }
  assertDeadline('body-complete', reader)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    throw remoteError('Cloudflare JSON response contains a prohibited UTF-8 BOM.', 'invalid_utf8')
  }
  assertDeadline('decode-start', reader)
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    assertDeadline('decode-complete', reader)
    return decoded
  } catch {
    assertDeadline('decode-complete', reader)
    if (signal.aborted) throw remoteError('Cloudflare read exceeded its complete operation deadline.', 'request_timeout')
    throw remoteError('Cloudflare response is not valid UTF-8.', 'invalid_utf8')
  }
}

export function createReadOnlyCloudflareClient({
  manifest,
  token,
  fetchImplementation = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumBytes = DEFAULT_MAX_BYTES,
  monotonicNow = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof token !== 'string' || token.length === 0) throw remoteError('Online mode requires PENNANT_PREVIEW_API_TOKEN.', 'missing_preview_token', 'remote.credential')
  if (manifest.cloudflare.account.status !== 'resolved' || !ACCOUNT_PATTERN.test(manifest.cloudflare.account.id ?? '')) {
    throw refusalError(`Cloudflare account identity is unresolved: ${manifest.cloudflare.account.reason}`, 'remote.identity.account')
  }
  if (typeof fetchImplementation !== 'function') throw remoteError('No read-only network implementation is available.', 'network_unavailable')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || typeof monotonicNow !== 'function') throw remoteError('Read-only request deadline is invalid.', 'request_timeout')
  const denied = productionDenylist(manifest, { includeBranch: true })
  const pathDenied = productionDenylist(manifest)
  return Object.freeze({
    async request(operation, parameters = {}, validateEndpoint = (value) => value) {
      const controller = new AbortController()
      const deadline = monotonicNow('operation-deadline-start') + timeoutMs
      let cleaned = false
      const timeout = setTimer(() => controller.abort(), timeoutMs)
      const assertDeadline = (stage, reader) => {
        if (monotonicNow(stage) < deadline) return
        controller.abort()
        if (reader) void reader.cancel('Request deadline exceeded.').catch(() => {})
        throw remoteError('Cloudflare read exceeded its complete operation deadline.', 'request_timeout')
      }
      try {
        assertDeadline('operation-start')
        const definition = operationDefinition(operation, parameters, manifest, denied)
        if (typeof validateEndpoint !== 'function') throw refusalError('Read-only endpoint validator must be a function.', 'remote.request-allowlist')
        assertDeadline('request-validation-complete')
        const prohibited = pathDenied.find((identity) => definition.path.includes(identity) || definition.body?.includes(identity))
        if (prohibited) throw refusalError(`Read-only request contains prohibited Production identity ${prohibited}.`, 'remote.production-contact')
        const url = new URL(definition.path, manifest.cloudflare.apiOrigin)
        if (url.origin !== manifest.cloudflare.apiOrigin || !url.pathname.startsWith('/client/v4/')) {
          throw refusalError('Read-only request escaped the approved Cloudflare API origin or path prefix.', 'remote.request-allowlist')
        }
        assertDeadline('url-validation-complete')
        const response = await fetchImplementation(url, {
          method: definition.method,
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(definition.body ? { 'content-type': 'application/json' } : {}) },
          ...(definition.body ? { body: definition.body } : {}),
        })
        assertDeadline('fetch-complete')
        if (response.status >= 300 && response.status < 400) throw remoteError('Cloudflare redirect responses are prohibited.', 'redirect_rejected')
        if (!response.ok) throw remoteError(`Cloudflare read returned HTTP ${response.status}.`, 'remote_http_failure')
        const contentType = response.headers.get('content-type')
        if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
          throw remoteError('Cloudflare response is missing the required application/json content type.', 'unexpected_content_type')
        }
        assertDeadline('headers-validated')
        const text = await readBoundedBody(response, maximumBytes, controller.signal, assertDeadline)
        assertDeadline('parse-start')
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          assertDeadline('parse-complete')
          throw remoteError('Cloudflare response contains malformed JSON.', 'malformed_json')
        }
        assertDeadline('parse-complete')
        let enveloped
        try {
          enveloped = assertEnvelope(parsed, definition)
        } catch (error) {
          assertDeadline('envelope-validation-complete')
          throw error
        }
        assertDeadline('envelope-validation-complete')
        let validated
        try {
          validated = validateEndpoint(enveloped, assertDeadline)
        } catch (error) {
          assertDeadline('endpoint-validation-complete')
          throw error
        }
        assertDeadline('endpoint-validation-complete')
        const normalized = immutablePlain(validated)
        assertDeadline('result-normalization-complete')
        return normalized
      } catch (error) {
        if (error instanceof PreviewWorkflowError && error.classification === 'request_timeout') throw error
        assertDeadline('operation-failure')
        if (error instanceof PreviewWorkflowError) throw error
        const classification = controller.signal.aborted ? 'request_timeout' : 'network_failure'
        throw remoteError(`Cloudflare read failed: ${safeErrorMessage(error, [token])}`, classification)
      } finally {
        if (!cleaned) {
          cleaned = true
          clearTimer(timeout)
        }
      }
    },
  })
}

function queryRows(result, label, assertDeadline = () => {}) {
  const pages = array(result, label)
  assertDeadline('d1-query-result-shape')
  if (pages.length !== 1) throw remoteError(`${label} must contain exactly one query result.`, 'ambiguous_migration_state')
  const page = assertObject(pages[0], label)
  if (page.success !== true) throw remoteError(`${label} did not report query success.`, 'ambiguous_migration_state')
  assertDeadline('d1-query-success')
  const rows = array(page.results, `${label} rows`)
  assertDeadline('d1-query-rows-normalized')
  return rows
}

function safeBindings(settings, assertDeadline = () => {}) {
  const names = new Set()
  const normalized = array(settings.bindings ?? [], 'Worker bindings').map((binding) => {
    const item = assertObject(binding, 'Worker binding')
    const name = String(item.name ?? '')
    const type = String(item.type ?? '')
    if (!BINDING_NAME_PATTERN.test(name) || type.length === 0) throw refusalError('Worker binding has a malformed name or type.', 'remote.worker.bindings')
    if (names.has(name)) throw refusalError(`Worker binding name ${name} is duplicated.`, 'remote.worker.bindings')
    names.add(name)
    const safe = { name, type }
    if (type === 'd1') safe.id = String(item.id ?? item.database_id ?? '')
    else if (type === 'ratelimit') safe.namespaceId = String(item.namespace_id ?? item.namespace ?? '')
    else if (type === 'plain_text' && PUBLIC_GATE_BINDINGS.has(name)) safe.text = String(item.text ?? '')
    else if (type === 'service') safe.service = String(item.service ?? '')
    else if (type === 'kv_namespace') safe.namespaceId = String(item.namespace_id ?? '')
    else if (type === 'r2_bucket') safe.bucket = String(item.bucket_name ?? '')
    else if (type === 'durable_object_namespace') safe.className = String(item.class_name ?? '')
    else if (type === 'queue') safe.queue = String(item.queue_name ?? item.queue ?? '')
    else if (type === 'analytics_engine') safe.dataset = String(item.dataset ?? '')
    else if (type === 'hyperdrive') safe.id = String(item.id ?? '')
    else if (type === 'vectorize') safe.index = String(item.index_name ?? '')
    assertDeadline('worker-settings-binding-normalized')
    return safe
  }).sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
  assertDeadline('worker-settings-bindings-complete')
  return normalized
}

const PAGES_METADATA_KEYS = new Set([
  'always_use_latest_compatibility_date',
  'build_image_major_version',
  'compatibility_date',
  'compatibility_flags',
  'fail_open',
  'limits',
  'placement',
  'usage_model',
  'wrangler_config_hash',
])
const PAGES_BINDING_CATEGORIES = Object.freeze({
  env_vars: 'env', kv_namespaces: 'kv_namespace', durable_object_namespaces: 'durable_object_namespace',
  d1_databases: 'd1', r2_buckets: 'r2_bucket', services: 'service', queue_producers: 'queue',
  analytics_engine_datasets: 'analytics_engine', ai_bindings: 'ai', browsers: 'browser',
  hyperdrive_bindings: 'hyperdrive', mtls_certificates: 'mtls_certificate', vectorize_bindings: 'vectorize',
})

function validatePagesMetadata(pagesPreview, assertDeadline = () => {}) {
  const optionalBoolean = (key) => {
    if (pagesPreview[key] !== undefined && typeof pagesPreview[key] !== 'boolean') throw remoteError(`Pages ${key} metadata is malformed.`, 'ambiguous_remote_state', 'remote.pages.metadata')
  }
  optionalBoolean('always_use_latest_compatibility_date')
  optionalBoolean('fail_open')
  if (pagesPreview.build_image_major_version !== undefined
    && (!Number.isInteger(pagesPreview.build_image_major_version) || pagesPreview.build_image_major_version < 1)) {
    throw remoteError('Pages build_image_major_version metadata is malformed.', 'ambiguous_remote_state', 'remote.pages.metadata')
  }
  if (pagesPreview.compatibility_date !== undefined && typeof pagesPreview.compatibility_date !== 'string') throw remoteError('Pages compatibility_date metadata is malformed.', 'ambiguous_remote_state', 'remote.pages.metadata')
  if (pagesPreview.compatibility_flags !== undefined
    && (!Array.isArray(pagesPreview.compatibility_flags) || pagesPreview.compatibility_flags.some((flag) => typeof flag !== 'string'))) {
    throw remoteError('Pages compatibility_flags metadata is malformed.', 'ambiguous_remote_state', 'remote.pages.metadata')
  }
  if (pagesPreview.usage_model !== undefined && typeof pagesPreview.usage_model !== 'string') throw remoteError('Pages usage_model metadata is malformed.', 'ambiguous_remote_state', 'remote.pages.metadata')
  for (const key of ['limits', 'placement']) if (pagesPreview[key] !== undefined) assertObject(pagesPreview[key], `Pages ${key} metadata`)
  if (pagesPreview.wrangler_config_hash !== undefined && typeof pagesPreview.wrangler_config_hash !== 'string') throw remoteError('Pages wrangler_config_hash metadata is malformed.', 'ambiguous_remote_state', 'remote.pages.metadata')
  assertDeadline('pages-project-metadata-normalized')
}

function pagesBindings(pagesPreview, assertDeadline = () => {}) {
  const knownKeys = new Set([...PAGES_METADATA_KEYS, ...Object.keys(PAGES_BINDING_CATEGORIES)])
  const unexpected = Object.keys(pagesPreview).filter((key) => !knownKeys.has(key))
  if (unexpected.length > 0) throw refusalError(`Pages Preview configuration contains unknown category: ${unexpected.join(', ')}.`, 'remote.pages.bindings')
  validatePagesMetadata(pagesPreview, assertDeadline)
  const result = []
  const names = new Set()
  const add = (name, type, details = {}) => {
    if (!BINDING_NAME_PATTERN.test(name)) throw refusalError('Pages binding has a malformed name.', 'remote.pages.bindings')
    if (names.has(name)) throw refusalError(`Pages binding name ${name} is duplicated.`, 'remote.pages.bindings')
    names.add(name)
    result.push({ name, type, ...details })
  }
  for (const [category, type] of Object.entries(PAGES_BINDING_CATEGORIES)) {
    const collection = pagesPreview[category] ?? {}
    assertObject(collection, `Pages ${category}`)
    for (const [name, raw] of Object.entries(collection)) {
      const value = typeof raw === 'string' ? { type: 'plain_text', value: raw } : assertObject(raw, `Pages ${category} binding`)
      if (category === 'env_vars') {
        const variableType = String(value.type ?? 'plain_text')
        add(name, variableType, variableType === 'plain_text' && PUBLIC_GATE_BINDINGS.has(name) ? { text: String(value.value ?? '') } : {})
      } else if (type === 'd1') add(name, type, { id: String(value.id ?? value.database_id ?? '') })
      else if (type === 'service') add(name, type, { service: String(value.service ?? value.service_name ?? ''), environment: String(value.environment ?? '') })
      else if (type === 'kv_namespace') add(name, type, { namespaceId: String(value.namespace_id ?? '') })
      else if (type === 'r2_bucket') add(name, type, { bucket: String(value.name ?? value.bucket_name ?? '') })
      else if (type === 'durable_object_namespace') add(name, type, { namespaceId: String(value.namespace_id ?? ''), className: String(value.class_name ?? '') })
      else if (type === 'queue') add(name, type, { queue: String(value.name ?? value.queue_name ?? '') })
      else if (type === 'analytics_engine') add(name, type, { dataset: String(value.dataset ?? '') })
      else if (type === 'hyperdrive') add(name, type, { id: String(value.id ?? '') })
      else if (type === 'vectorize') add(name, type, { index: String(value.index_name ?? '') })
      else if (type === 'mtls_certificate') add(name, type, { certificateId: String(value.certificate_id ?? '') })
      else add(name, type)
      assertDeadline('pages-project-binding-normalized')
    }
  }
  const normalized = result.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
  assertDeadline('pages-project-bindings-complete')
  return normalized
}

function hostnameMatchesPattern(hostname, pattern) {
  if (!pattern.startsWith('*.')) return hostname === pattern
  const suffix = pattern.slice(1)
  return hostname.endsWith(suffix) && hostname.length > suffix.length
}

function deploymentHostname(value, label) {
  let url
  try { url = new URL(value) } catch { throw remoteError(`${label} is not a valid URL.`, 'ambiguous_remote_state', 'remote.pages.deployment') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw remoteError(`${label} is not an exact HTTPS origin.`, 'ambiguous_remote_state', 'remote.pages.deployment')
  }
  return url.hostname
}

async function completePaginatedInventory(client, operation, parameters, label, finalize = (items) => items) {
  const all = []
  let totalPages
  let totalCount
  let complete
  for (let page = 1; totalPages === undefined || page <= totalPages; page += 1) {
    const pageResult = await client.request(operation, { ...parameters, page }, (response, assertDeadline) => {
      const result = assertObject(response, `${label} paginated result`)
      const items = array(result.items, `${label} page`)
      const info = assertObject(result.resultInfo, `${label} pagination metadata`)
      assertDeadline(`${operation}-page-shape`)
      if (page === 1) {
        totalPages = info.totalPages
        totalCount = info.totalCount
      }
      if (info.page !== page || info.totalPages !== totalPages || info.totalCount !== totalCount
        || (totalPages > 1 && items.length === 0) || (page < totalPages && items.length !== PAGE_SIZE)) {
        throw remoteError(`${label} pagination changed or truncated during inspection.`, 'ambiguous_remote_state', 'remote.pagination')
      }
      all.push(...items)
      assertDeadline(`${operation}-page-normalized`)
      let normalizedComplete = null
      if (page === totalPages) {
        if (all.length !== totalCount) throw remoteError(`${label} pagination did not return the declared complete inventory.`, 'ambiguous_remote_state', 'remote.pagination')
        assertDeadline(`${operation}-inventory-complete`)
        normalizedComplete = finalize(immutablePlain(all), assertDeadline)
        assertDeadline(`${operation}-inventory-normalized`)
      }
      return immutablePlain({ page, complete: normalizedComplete })
    })
    if (pageResult.complete !== null) complete = pageResult.complete
  }
  return complete
}

async function latestPagesDeployment(client, parameters, preview) {
  return completePaginatedInventory(client, 'pages-deployments', parameters, 'Pages deployments', (all, assertDeadline) => {
    const ids = new Set()
    for (const deployment of all) {
      const item = assertObject(deployment, 'Pages deployment')
      if (typeof item.id !== 'string' || item.id.length === 0 || ids.has(item.id)) throw remoteError('Pages deployments contain a missing or duplicate ID.', 'ambiguous_remote_state', 'remote.pages.deployment')
      ids.add(item.id)
      if (typeof item.created_on !== 'string' || !Number.isFinite(Date.parse(item.created_on))) throw remoteError('Pages deployment has a malformed timestamp.', 'ambiguous_remote_state', 'remote.pages.deployment')
      assertDeadline('pages-deployments-item-normalized')
    }
    const branchDeployments = all.filter((deployment) => deployment.deployment_trigger?.metadata?.branch === preview.pages.branch && deployment.environment === 'preview')
      .sort((left, right) => Date.parse(right.created_on) - Date.parse(left.created_on))
    assertDeadline('pages-deployments-branch-selection')
    if (branchDeployments.length > 1 && Date.parse(branchDeployments[0].created_on) === Date.parse(branchDeployments[1].created_on)) throw remoteError('Latest develop Preview deployment is ambiguous.', 'ambiguous_remote_state', 'remote.pages.deployment')
    const latest = branchDeployments[0]
    if (!latest) throw remoteError('No unambiguous Preview deployment exists for develop.', 'ambiguous_remote_state', 'remote.pages.deployment')
    const commitHash = latest.deployment_trigger?.metadata?.commit_hash
    if (!/^[0-9a-f]{40}$/.test(commitHash ?? '') || latest.latest_stage?.status !== 'success') throw remoteError('Latest develop Preview deployment is incomplete or has an invalid commit hash.', 'ambiguous_remote_state', 'remote.pages.deployment')
    assertDeadline('pages-deployments-status-normalized')
    const aliases = latest.aliases === undefined ? [] : array(latest.aliases, 'Pages deployment aliases')
    const deploymentOrigins = [latest.url, ...aliases]
    if (deploymentOrigins.length === 0 || deploymentOrigins.some((value) => !preview.pages.domainPatterns.some((pattern) => hostnameMatchesPattern(deploymentHostname(value, 'Pages Preview deployment origin'), pattern)))) throw refusalError('Pages develop deployment origin is outside approved Preview domain patterns.', 'remote.pages.deployment')
    assertDeadline('pages-deployments-origins-normalized')
    return immutablePlain({
      id: latest.id,
      createdOn: latest.created_on,
      branch: preview.pages.branch,
      commitHash,
      status: latest.latest_stage.status,
    })
  })
}

function activeWorkerDeployment(value, assertDeadline = () => {}) {
  const result = assertObject(value, 'Worker deployment inventory')
  const deployments = array(result.deployments, 'Worker deployments')
  if (deployments.length === 0) throw remoteError('Worker has no active deployment identity.', 'ambiguous_remote_state', 'remote.worker.deployment')
  const ids = new Set()
  for (const raw of deployments) {
    const deployment = assertObject(raw, 'Worker deployment')
    if (!UUID_PATTERN.test(deployment.id ?? '') || ids.has(deployment.id)) throw remoteError('Worker deployment inventory has a malformed or duplicate ID.', 'ambiguous_remote_state', 'remote.worker.deployment')
    ids.add(deployment.id)
    if (typeof deployment.created_on !== 'string' || !Number.isFinite(Date.parse(deployment.created_on))) throw remoteError('Worker deployment inventory has a malformed timestamp.', 'ambiguous_remote_state', 'remote.worker.deployment')
    const versions = array(deployment.versions, 'Worker deployment versions')
    if (versions.length === 0 || versions.length > 2) throw remoteError('Worker deployment has an ambiguous version set.', 'ambiguous_remote_state', 'remote.worker.deployment')
    const versionIds = new Set()
    let percentage = 0
    for (const rawVersion of versions) {
      const version = assertObject(rawVersion, 'Worker deployment version')
      if (!UUID_PATTERN.test(version.version_id ?? '') || versionIds.has(version.version_id)
        || typeof version.percentage !== 'number' || !Number.isFinite(version.percentage) || version.percentage <= 0) {
        throw remoteError('Worker deployment version evidence is malformed.', 'ambiguous_remote_state', 'remote.worker.deployment')
      }
      versionIds.add(version.version_id)
      percentage += version.percentage
      assertDeadline('worker-deployments-version-normalized')
    }
    if (percentage !== 100) throw remoteError('Worker deployment traffic allocation is incomplete.', 'ambiguous_remote_state', 'remote.worker.deployment')
    assertDeadline('worker-deployments-traffic-normalized')
  }
  const active = deployments[0]
  if (active.versions.length !== 1 || active.versions[0].percentage !== 100) {
    throw remoteError('Worker active deployment does not identify one authoritative version.', 'ambiguous_remote_state', 'remote.worker.deployment')
  }
  const normalized = immutablePlain({ deploymentId: active.id, versionId: active.versions[0].version_id, createdOn: active.created_on })
  assertDeadline('worker-deployments-active-normalized')
  return normalized
}

async function authoritativeRouteZones(client, base, preview) {
  return completePaginatedInventory(client, 'account-zones', base, 'Cloudflare account zones', (zones, assertDeadline) => {
    const observed = []
    const seen = new Set()
    for (const raw of zones) {
      const zone = assertObject(raw, 'Cloudflare account zone')
      if (!ZONE_PATTERN.test(zone.id ?? '') || seen.has(zone.id)) throw remoteError('Cloudflare account zone inventory is malformed or duplicated.', 'ambiguous_remote_state', 'remote.worker.routes')
      const account = assertObject(zone.account, 'Cloudflare account zone owner')
      requireIdentity(account.id, base.accountId, 'Cloudflare zone account', ACCOUNT_PATTERN)
      seen.add(zone.id)
      observed.push(zone.id)
      assertDeadline('account-zones-item-normalized')
    }
    observed.sort()
    const expected = [...preview.worker.routeZoneIds.values].sort()
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      throw refusalError('Authoritative Cloudflare account zones differ from the immutable route-zone inventory.', 'remote.identity.routes')
    }
    assertDeadline('account-zones-authoritative-inventory')
    return observed
  })
}

export async function inspectPreviewRemoteState({ manifest, client }) {
  const accountId = manifest.cloudflare.account.id
  const preview = manifest.cloudflare.preview
  if (preview.worker.routeZoneIds.status !== 'resolved' || preview.worker.routeZoneIds.values.length === 0) {
    throw refusalError('Complete Preview Worker route-zone inventory is unresolved.', 'remote.identity.routes')
  }
  const base = { accountId }
  await client.request('account', base, (value, assertDeadline) => {
    const account = assertObject(value, 'Cloudflare account')
    requireIdentity(account.id, accountId, 'Cloudflare account response', ACCOUNT_PATTERN)
    assertDeadline('account-identity-normalized')
    return { id: account.id }
  })
  const routeZoneIds = await authoritativeRouteZones(client, base, preview)
  const pages = await client.request('pages-project', { ...base, project: preview.pages.project }, (value, assertDeadline) => {
    const project = assertObject(value, 'Pages project')
    requireIdentity(project.name, preview.pages.project, 'Pages project response')
    assertDeadline('pages-project-identity-normalized')
    if (typeof project.production_branch !== 'string' || project.production_branch === preview.pages.branch) throw refusalError('Pages Preview branch equals or cannot be distinguished from the configured production branch.', 'remote.pages.production-branch')
    if (project.production_branch !== manifest.cloudflare.production.pages.branch.value) throw refusalError('Pages production branch differs from the immutable release manifest.', 'remote.pages.production-branch')
    const observedProductionDomains = array(project.domains, 'Pages Production domains').map(String).sort()
    if (JSON.stringify(observedProductionDomains) !== JSON.stringify([...manifest.cloudflare.production.pages.domains.values].sort())) throw refusalError('Pages Production domains differ from the immutable release manifest.', 'remote.pages.production-domains')
    assertDeadline('pages-project-production-isolation')
    const pagesPreview = assertObject(project.deployment_configs?.preview, 'Pages Preview deployment configuration')
    const bindings = pagesBindings(pagesPreview, assertDeadline)
    const pageSubmissionMode = bindings.find((binding) => binding.type === 'plain_text' && binding.name === 'DRAFT_SUBMISSION_MODE')?.text ?? ''
    assertExactBindings(bindings, expectedPagesBindings(preview, pageSubmissionMode), 'Pages Preview')
    assertDeadline('pages-project-binding-inventory')
    return {
      name: project.name,
      productionBranch: project.production_branch,
      bindings,
      configHash: typeof pagesPreview.wrangler_config_hash === 'string' ? pagesPreview.wrangler_config_hash : null,
      submissionMode: bindings.find((binding) => binding.type === 'plain_text' && binding.name === 'DRAFT_SUBMISSION_MODE')?.text ?? '',
      validationMode: bindings.find((binding) => binding.type === 'plain_text' && binding.name === 'DRAFT_VALIDATION_MODE')?.text ?? '',
      ticketMode: bindings.find((binding) => binding.type === 'plain_text' && binding.name === 'DRAFT_TICKET_MODE')?.text ?? '',
    }
  })

  const latestDeployment = await latestPagesDeployment(client, { ...base, project: preview.pages.project }, preview)
  const bindings = pages.bindings

  const workerBindings = await client.request('worker-settings', { ...base, worker: preview.worker.name }, (value, assertDeadline) => {
    const settings = assertObject(value, 'Worker settings')
    const bindings = safeBindings(settings, assertDeadline)
    const workerSubmissionMode = bindings.find((binding) => binding.type === 'plain_text' && binding.name === 'DRAFT_SUBMISSION_MODE')?.text ?? ''
    assertExactBindings(bindings, expectedWorkerBindings(preview, workerSubmissionMode), 'Worker Preview')
    assertDeadline('worker-settings-binding-inventory')
    return bindings
  })
  const workerDeployment = await client.request('worker-deployments', { ...base, worker: preview.worker.name }, activeWorkerDeployment)
  const workerPublicUrls = await client.request('worker-subdomain', { ...base, worker: preview.worker.name }, (value, assertDeadline) => {
    const subdomain = assertObject(value, 'Worker subdomain settings')
    if (subdomain.enabled !== false || subdomain.previews_enabled !== false) throw refusalError('Preview Worker workers.dev or Preview URLs are enabled.', 'remote.worker.public-urls')
    assertDeadline('worker-subdomain-settings-normalized')
    return { workersDev: false, previewUrls: false }
  })
  const schedules = await client.request('worker-schedules', { ...base, worker: preview.worker.name }, (value, assertDeadline) => {
    const scheduleResult = assertObject(value, 'Worker schedules')
    const normalized = array(scheduleResult.schedules, 'Worker schedules').map((entry) => String(entry?.cron ?? '')).sort()
    assertDeadline('worker-schedules-normalized')
    return normalized
  })

  const workerDomains = await client.request('worker-domains', { ...base, worker: preview.worker.name }, (value, assertDeadline) => {
    const domainResponse = assertObject(value, 'Worker custom-domain response')
    const domains = array(domainResponse.items, 'Worker custom domains')
    const domainKeys = new Set()
    const normalized = domains.map((domain) => {
      const item = assertObject(domain, 'Worker custom domain')
      const hostname = String(item.hostname ?? '')
      const service = String(item.service ?? '')
      if (!hostname || !service || domainKeys.has(hostname)) throw remoteError('Worker custom-domain inventory is malformed or duplicated.', 'ambiguous_remote_state', 'remote.worker.domains')
      domainKeys.add(hostname)
      assertDeadline('worker-domains-item-normalized')
      return { hostname, service, environment: String(item.environment ?? ''), zoneId: String(item.zone_id ?? '') }
    }).filter(({ service }) => service === preview.worker.name)
    if (normalized.length > 0) throw refusalError('Preview Worker has a custom domain.', 'remote.worker.domains')
    assertDeadline('worker-domains-inventory-normalized')
    return normalized
  })

  const routes = []
  for (const zoneId of routeZoneIds) {
    const zoneRoutes = await client.request('worker-routes', { ...base, worker: preview.worker.name, zoneId }, (value, assertDeadline) => {
      const routeKeys = new Set()
      const normalized = []
      for (const route of array(value, `Worker routes for zone ${zoneId}`)) {
        const item = assertObject(route, 'Worker route')
        const key = String(item.id ?? `${item.pattern ?? ''}:${item.script ?? ''}`)
        if (!key || routeKeys.has(key) || typeof item.script !== 'string' || typeof item.pattern !== 'string') throw remoteError('Worker route inventory is malformed or duplicated.', 'ambiguous_remote_state', 'remote.worker.routes')
        routeKeys.add(key)
        if (item.script === preview.worker.name) normalized.push({ pattern: item.pattern, zoneId })
        assertDeadline('worker-routes-item-normalized')
      }
      if (normalized.length > 0) throw refusalError('Preview Worker has a public route.', 'remote.worker.routes')
      assertDeadline('worker-routes-inventory-normalized')
      return normalized
    })
    routes.push(...zoneRoutes)
  }

  const database = await client.request('d1-database', { ...base, databaseId: preview.d1.id }, (value, assertDeadline) => {
    const result = assertObject(value, 'Preview D1 database')
    requireIdentity(result.uuid, preview.d1.id, 'Preview D1 response', UUID_PATTERN)
    requireIdentity(result.name, preview.d1.name, 'Preview D1 name')
    assertDeadline('d1-database-identity-normalized')
    return { id: result.uuid, name: result.name }
  })
  const tables = await client.request('migration-tables', { ...base, databaseId: preview.d1.id }, (value, assertDeadline) => {
    const normalized = queryRows(value, 'Migration table query', assertDeadline).map((row) => String(row?.name ?? ''))
    assertDeadline('d1-migration-tables-normalized')
    return normalized
  })
  let migrationRows = []
  if (tables.includes('d1_migrations')) migrationRows = await client.request('migration-rows', { ...base, databaseId: preview.d1.id }, (value, assertDeadline) => queryRows(value, 'Migration rows query', assertDeadline))
  let backendVersion = null
  if (tables.includes('backend_schema')) {
    backendVersion = await client.request('backend-version', { ...base, databaseId: preview.d1.id }, (value, assertDeadline) => {
      const versionRows = queryRows(value, 'Backend version query', assertDeadline)
      if (versionRows.length !== 1) throw remoteError('backend_schema must contain exactly one version row.', 'ambiguous_migration_state')
      assertDeadline('d1-backend-version-normalized')
      return versionRows[0]?.version
    })
  }

  return immutablePlain({
    schemaVersion: 2,
    accountId,
    pages: {
      project: pages.name,
      previewBranch: preview.pages.branch,
      productionBranch: pages.productionBranch,
      deployment: latestDeployment,
      artifactHash: null,
      configHash: pages.configHash,
      submissionMode: pages.submissionMode, validationMode: pages.validationMode, ticketMode: pages.ticketMode,
      bindings,
    },
    worker: {
      name: preview.worker.name,
      bindings: workerBindings,
      artifactHash: null,
      artifactProvenance: 'unproven',
      deploymentId: workerDeployment.deploymentId,
      versionId: workerDeployment.versionId,
      workersDev: workerPublicUrls.workersDev, previewUrls: workerPublicUrls.previewUrls, schedules, routes, customDomains: workerDomains,
    },
    d1: database,
    migrationObservation: { tables, rows: migrationRows, backendVersion },
  })
}
