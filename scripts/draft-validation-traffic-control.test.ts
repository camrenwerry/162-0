import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import { handleHealthRequest } from '../functions/api/v1/health'
import {
  deriveTrustedRateKey,
  handleValidateDraftRequest,
  INTERNAL_RATE_KEY_HEADER,
} from '../functions/api/v1/validate-draft'
import { MAX_DRAFT_VALIDATION_BODY_BYTES } from '../functions/lib/bounded-json'
import {
  handlePrivateValidationRequest,
  type PrivateValidationWorkerEnv,
  type RateLimitBinding,
} from '../workers/draft-validation/src/index'

const ENDPOINT = 'https://preview.example.test/api/v1/validate-draft'
const CLIENT_IP = '198.51.100.42'
const JSON_HEADERS = { 'Content-Type': 'application/json', 'CF-Connecting-IP': CLIENT_IP }

class DeterministicRateLimit implements RateLimitBinding {
  calls = 0

  constructor(private readonly allowedCalls: number) {}

  async limit() {
    this.calls += 1
    return { success: this.calls <= this.allowedCalls }
  }
}

interface Harness {
  readonly burst: DeterministicRateLimit
  readonly sustained: DeterministicRateLimit
  readonly forwardedHeaders: Headers[]
  readonly serviceCalls: { value: number }
  readonly env: Parameters<typeof handleValidateDraftRequest>[1]
}

function createHarness(options: { burst?: number, sustained?: number, mode?: unknown } = {}): Harness {
  const burst = new DeterministicRateLimit(options.burst ?? Number.POSITIVE_INFINITY)
  const sustained = new DeterministicRateLimit(options.sustained ?? Number.POSITIVE_INFINITY)
  const forwardedHeaders: Headers[] = []
  const serviceCalls = { value: 0 }
  const privateEnv = {
    DRAFT_VALIDATION_MODE: options.mode ?? 'enabled',
    RATE_LIMIT_BURST: burst,
    RATE_LIMIT_SUSTAINED: sustained,
  } as PrivateValidationWorkerEnv
  const service = {
    async fetch(request: Request) {
      serviceCalls.value += 1
      forwardedHeaders.push(new Headers(request.headers))
      return handlePrivateValidationRequest(request, privateEnv)
    },
  }
  return {
    burst,
    sustained,
    forwardedHeaders,
    serviceCalls,
    env: { DRAFT_VALIDATION_MODE: options.mode ?? 'enabled', VALIDATION_SERVICE: service },
  }
}

function publicRequest(body: BodyInit | null, options: {
  readonly headers?: Record<string, string>
  readonly method?: string
  readonly origin?: string
} = {}) {
  const headers = new Headers({ ...JSON_HEADERS, ...options.headers })
  if (options.origin) headers.set('Origin', options.origin)
  return new Request(ENDPOINT, {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' || options.method === 'HEAD' ? undefined : body,
  })
}

function assertSafeHeaders(response: Response) {
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(response.headers.get('Set-Cookie'), null)
}

async function assertRateLimited(response: Response) {
  assert.equal(response.status, 429)
  assertSafeHeaders(response)
  assert.equal(response.headers.get('Retry-After'), '60')
  assert.deepEqual(await response.json(), {
    ok: false,
    verified: false,
    error: { code: 'rate_limited', message: 'Too Many Requests' },
  })
}

const validBody = JSON.stringify({ transcript: noRerollsData.transcript })

// The Pages boundary hashes only Cloudflare's connecting IP, replaces any
// browser-provided internal header, and does not forward raw IP metadata.
const metadataHarness = createHarness()
const maliciousKey = `v1:${'0'.repeat(64)}`
const metadataResponse = await handleValidateDraftRequest(publicRequest(validBody, {
  headers: {
    [INTERNAL_RATE_KEY_HEADER]: maliciousKey,
    'X-Forwarded-For': '203.0.113.3',
    Forwarded: 'for=203.0.113.4',
    Cookie: 'session=browser-value',
    Authorization: 'Bearer browser-value',
  },
}), metadataHarness.env)
assert.equal(metadataResponse.status, 200)
assertSafeHeaders(metadataResponse)
assert.equal(metadataHarness.serviceCalls.value, 1)
const forwarded = metadataHarness.forwardedHeaders[0]
assert.equal(forwarded.get(INTERNAL_RATE_KEY_HEADER), await deriveTrustedRateKey(CLIENT_IP))
assert.notEqual(forwarded.get(INTERNAL_RATE_KEY_HEADER), maliciousKey)
for (const header of ['CF-Connecting-IP', 'CF-Pseudo-IPv4', 'Forwarded', 'True-Client-IP', 'X-Forwarded-For', 'X-Real-IP', 'Cookie', 'Authorization']) {
  assert.equal(forwarded.get(header), null)
}

// Moving enforcement behind the Service Binding leaves the verified response
// contract unchanged for a successful public request.
const contractHarness = createHarness()
const proxiedContractResponse = await handleValidateDraftRequest(publicRequest(validBody), contractHarness.env)
const contractRate = new DeterministicRateLimit(Number.POSITIVE_INFINITY)
const directContractResponse = await handlePrivateValidationRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP),
  },
  body: validBody,
}), {
  DRAFT_VALIDATION_MODE: 'enabled', RATE_LIMIT_BURST: contractRate, RATE_LIMIT_SUSTAINED: contractRate,
})
assert.equal(proxiedContractResponse.status, directContractResponse.status)
assert.equal(await proxiedContractResponse.text(), await directContractResponse.text())

// The proxy preserves the established sanitized error contract too, and the
// private validation path remains independent of any accidental D1 binding.
const malformedContractHarness = createHarness()
const proxiedMalformedContract = await handleValidateDraftRequest(publicRequest('{'), malformedContractHarness.env)
const malformedContractRate = new DeterministicRateLimit(Number.POSITIVE_INFINITY)
const directMalformedContract = await handlePrivateValidationRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP),
  },
  body: '{',
}), {
  DRAFT_VALIDATION_MODE: 'enabled', RATE_LIMIT_BURST: malformedContractRate, RATE_LIMIT_SUSTAINED: malformedContractRate,
})
assert.equal(proxiedMalformedContract.status, directMalformedContract.status)
assertSafeHeaders(proxiedMalformedContract)
assertSafeHeaders(directMalformedContract)
assert.equal(await proxiedMalformedContract.text(), await directMalformedContract.text())
const noD1Rate = new DeterministicRateLimit(Number.POSITIVE_INFINITY)
const noD1Env = Object.defineProperty({
  DRAFT_VALIDATION_MODE: 'enabled', RATE_LIMIT_BURST: noD1Rate, RATE_LIMIT_SUSTAINED: noD1Rate,
}, 'DB', {
  get() { throw new Error('validation must not access D1') },
}) as PrivateValidationWorkerEnv
assert.equal((await handlePrivateValidationRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', [INTERNAL_RATE_KEY_HEADER]: await deriveTrustedRateKey(CLIENT_IP) },
  body: validBody,
}), noD1Env)).status, 200)

// No trusted Cloudflare IP means the Page proxy fails closed before it calls
// the service or reads/parses the body.
const missingIpHarness = createHarness()
const missingIpResponse = await handleValidateDraftRequest(new Request(ENDPOINT, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: validBody,
}), missingIpHarness.env)
assert.equal(missingIpResponse.status, 503)
assert.equal(missingIpHarness.serviceCalls.value, 0)

// The private Worker itself rejects non-Service-Binding-shaped requests.
const directRate = new DeterministicRateLimit(1)
const directResponse = await handlePrivateValidationRequest(new Request(ENDPOINT, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: validBody,
}), {
  DRAFT_VALIDATION_MODE: 'enabled', RATE_LIMIT_BURST: directRate, RATE_LIMIT_SUSTAINED: directRate,
})
assert.equal(directResponse.status, 503)
assert.equal(directRate.calls, 0)

// Five requests pass the burst limit; the sixth returns the fixed 429 without
// parsing its body. Sustained limits are evaluated only after a burst pass.
const burstHarness = createHarness({ burst: 5 })
for (let index = 0; index < 5; index += 1) {
  const response = await handleValidateDraftRequest(publicRequest(validBody), burstHarness.env)
  assert.equal(response.status, 200)
}
await assertRateLimited(await handleValidateDraftRequest(publicRequest('{'), burstHarness.env))
assert.equal(burstHarness.burst.calls, 6)
assert.equal(burstHarness.sustained.calls, 5)

// With an unrestrictive burst binding, the 21st request reaches the sustained
// limiter and gets the same public response.
const sustainedHarness = createHarness({ burst: 100, sustained: 20 })
for (let index = 0; index < 20; index += 1) {
  const response = await handleValidateDraftRequest(publicRequest(validBody), sustainedHarness.env)
  assert.equal(response.status, 200)
}
await assertRateLimited(await handleValidateDraftRequest(publicRequest(validBody), sustainedHarness.env))
assert.equal(sustainedHarness.burst.calls, 21)
assert.equal(sustainedHarness.sustained.calls, 21)

// Malformed and oversized enabled POSTs both consume quota before the Worker
// parses their body. Health remains outside the service boundary.
const malformedHarness = createHarness()
const malformed = await handleValidateDraftRequest(publicRequest('{'), malformedHarness.env)
assert.equal(malformed.status, 400)
const oversized = await handleValidateDraftRequest(publicRequest('{}', {
  headers: { 'Content-Length': String(MAX_DRAFT_VALIDATION_BODY_BYTES + 1) },
}), malformedHarness.env)
assert.equal(oversized.status, 413)
assert.equal(malformedHarness.burst.calls, 2)
assert.equal(malformedHarness.sustained.calls, 2)
const callsBeforeHealth = malformedHarness.serviceCalls.value
assert.equal((await handleHealthRequest(new Request('https://preview.example.test/api/v1/health'), {
  DRAFT_VALIDATION_MODE: 'enabled',
})).status, 200)
assert.equal(malformedHarness.serviceCalls.value, callsBeforeHealth)

// Same-origin and method checks remain public, deterministic, and do not
// forward a rejected request to the private Worker.
const boundaryHarness = createHarness()
assert.equal((await handleValidateDraftRequest(publicRequest(validBody, { origin: 'https://attacker.example' }), boundaryHarness.env)).status, 403)
assert.equal((await handleValidateDraftRequest(publicRequest('', { method: 'GET' }), boundaryHarness.env)).status, 405)
assert.equal(boundaryHarness.serviceCalls.value, 0)

// The production-equivalent enabled mode invokes its private binding for a
// valid POST, while rejected methods and malformed requests retain the public
// safe behavior. The Page proxy and private Worker both remain D1-free.
const productionHarness = createHarness()
const productionEnv = Object.defineProperty({ ...productionHarness.env }, 'DB', {
  get() { throw new Error('production validation must not access D1') },
})
assert.equal((await handleValidateDraftRequest(publicRequest(validBody), productionEnv)).status, 200)
assert.equal(productionHarness.serviceCalls.value, 1)
assert.equal((await handleValidateDraftRequest(publicRequest('', { method: 'GET' }), productionEnv)).status, 405)
assert.equal(productionHarness.serviceCalls.value, 1)
assert.equal((await handleValidateDraftRequest(publicRequest('{'), productionEnv)).status, 400)
assert.equal(productionHarness.serviceCalls.value, 2)
const pagesConfig = readFileSync('wrangler.toml', 'utf8')
assert.match(pagesConfig, /\[\[services\]\][\s\S]*binding = "VALIDATION_SERVICE"[\s\S]*service = "pennant-pursuit-validation-preview"/)
assert.match(pagesConfig, /\[env\.production\.vars\][\s\S]*DRAFT_VALIDATION_MODE = "enabled"/)
assert.match(pagesConfig, /\[\[env\.production\.services\]\][\s\S]*binding = "VALIDATION_SERVICE"[\s\S]*service = "pennant-pursuit-validation-production"/)
assert.doesNotMatch(pagesConfig, /\[\[env\.production\.ratelimits\]\]/)
assert.deepEqual(
  [...pagesConfig.matchAll(/^service = "([^"]+)"$/gm)].map(([, service]) => service),
  ['pennant-pursuit-validation-preview', 'pennant-pursuit-validation-production'],
)
assert.equal((pagesConfig.match(/^DRAFT_VALIDATION_MODE = "enabled"$/gm) ?? []).length, 2)
assert.equal((pagesConfig.match(/^DRAFT_VALIDATION_MODE = "disabled"$/gm) ?? []).length, 0)

// The shared source and its two explicit configurations guard the intended
// private, storage-free topology and separate rate-limit state.
const workerConfig = readFileSync('workers/draft-validation/wrangler.toml', 'utf8')
assert.match(workerConfig, /workers_dev = false/)
assert.match(workerConfig, /preview_urls = false/)
assert.match(workerConfig, /RATE_LIMIT_BURST[\s\S]*limit = 5[\s\S]*period = 10/)
assert.match(workerConfig, /RATE_LIMIT_SUSTAINED[\s\S]*limit = 20[\s\S]*period = 60/)
assert.match(workerConfig, /\[\[ratelimits\]\][\s\S]*name = "RATE_LIMIT_BURST"[\s\S]*namespace_id = "16204011"[\s\S]*limit = 5[\s\S]*period = 10/)
assert.match(workerConfig, /\[\[ratelimits\]\][\s\S]*name = "RATE_LIMIT_SUSTAINED"[\s\S]*namespace_id = "16204012"[\s\S]*limit = 20[\s\S]*period = 60/)
assert.match(workerConfig, /\[env\.production\][\s\S]*name = "pennant-pursuit-validation-production"[\s\S]*workers_dev = false[\s\S]*preview_urls = false/)
assert.match(workerConfig, /\[env\.production\.vars\][\s\S]*DRAFT_VALIDATION_MODE = "enabled"/)
assert.match(workerConfig, /\[\[env\.production\.ratelimits\]\][\s\S]*name = "RATE_LIMIT_BURST"[\s\S]*namespace_id = "16204021"[\s\S]*limit = 5[\s\S]*period = 10/)
assert.match(workerConfig, /\[\[env\.production\.ratelimits\]\][\s\S]*name = "RATE_LIMIT_SUSTAINED"[\s\S]*namespace_id = "16204022"[\s\S]*limit = 20[\s\S]*period = 60/)
assert.deepEqual(
  [...workerConfig.matchAll(/^namespace_id = "(\d+)"$/gm)].map(([, namespace]) => namespace),
  ['16204011', '16204012', '16204021', '16204022'],
)
const previewWorkerName = workerConfig.match(/^name = "([^"]+)"/m)?.[1]
const productionWorkerName = workerConfig.match(/\[env\.production\][\s\S]*?^name = "([^"]+)"/m)?.[1]
assert.equal(previewWorkerName, 'pennant-pursuit-validation-preview')
assert.equal(productionWorkerName, 'pennant-pursuit-validation-production')
assert.notEqual(previewWorkerName, productionWorkerName)
assert.doesNotMatch(workerConfig, /^(?:routes|route|custom_domain|d1_databases|kv_namespaces|r2_buckets|durable_objects|queues|analytics_engine_datasets|secrets_store_secrets)\s*=/m)
const proxySource = readFileSync('functions/api/v1/validate-draft.ts', 'utf8')
assert.doesNotMatch(proxySource, /createWorkerReplayCatalog|replayDraftWithCatalog|calculateDraftResult|readBoundedJson|env\.DB|waitUntil|console\./)
assert.match(proxySource, /service\.fetch/)

console.log('Draft validation traffic control passed: isolated private proxies, trusted key, distinct rate limits, production read-only validation, and no storage.')
