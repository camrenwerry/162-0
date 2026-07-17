import { performance } from 'node:perf_hooks'
import os from 'node:os'
import allTime145Data from './fixtures/transcripts/all-time-145.json'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import { handleHealthRequest } from '../functions/api/v1/health'
import {
  deriveTrustedRateKey,
  handleValidateDraftRequest,
} from '../functions/api/v1/validate-draft'
import { handleAuthoritativeValidationRequest } from '../workers/draft-validation/src/authoritative-validation'
import {
  handlePrivateValidationRequest,
  type PrivateValidationWorkerEnv,
  type RateLimitBinding,
} from '../workers/draft-validation/src/index'

const ENDPOINT = 'https://preview.example.test/api/v1/validate-draft'
const CLIENT_IP = '198.51.100.42'
const INTERNAL_RATE_KEY = await deriveTrustedRateKey(CLIENT_IP)
const WARMUPS = 10_000
const ITERATIONS = 10_000

interface Workload {
  readonly label: string
  readonly expectedStatus: number
  invoke(): Promise<Response>
}

class FixedRateLimit implements RateLimitBinding {
  calls = 0

  constructor(private readonly success: boolean) {}

  async limit() {
    this.calls += 1
    return { success: this.success }
  }
}

function serialize(transcript: unknown) {
  return JSON.stringify({ transcript })
}

function privateRequest(body: string) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pennant-Pursuit-Rate-Key': INTERNAL_RATE_KEY },
    body,
  })
}

function authoritativeRequest(body: string) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

function publicRequest(body: string) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': CLIENT_IP },
    body,
  })
}

function privateEnvironment(burst: RateLimitBinding, sustained: RateLimitBinding): PrivateValidationWorkerEnv {
  return {
    DRAFT_VALIDATION_MODE: 'enabled',
    RATE_LIMIT_BURST: burst,
    RATE_LIMIT_SUSTAINED: sustained,
  }
}

function summarize(samples: Float64Array) {
  const sorted = Array.from(samples).sort((left, right) => left - right)
  const percentile = (percent: number) => sorted[Math.ceil((percent / 100) * sorted.length) - 1]
  const meanMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  return {
    requests: sorted.length,
    meanMs: Number(meanMs.toFixed(4)),
    p95Ms: Number(percentile(95).toFixed(4)),
    p99Ms: Number(percentile(99).toFixed(4)),
    maxMs: Number(sorted.at(-1)!.toFixed(4)),
    requestsPerSecond: Number((1_000 / meanMs).toFixed(1)),
  }
}

async function invoke(workload: Workload) {
  const response = await workload.invoke()
  if (response.status !== workload.expectedStatus) {
    throw new Error(`${workload.label}: expected ${workload.expectedStatus}, received ${response.status}.`)
  }
  await response.arrayBuffer()
}

async function measure(workload: Workload) {
  for (let index = 0; index < WARMUPS; index += 1) await invoke(workload)
  const samples = new Float64Array(ITERATIONS)
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now()
    await invoke(workload)
    samples[index] = performance.now() - started
  }
  return { label: workload.label, ...summarize(samples) }
}

const ordinary = serialize(noRerollsData.transcript)
const twoRerolls = serialize(twoRerollsData.transcript)
const allTime145 = serialize(allTime145Data.transcript)
const privateBurst = new FixedRateLimit(true)
const privateSustained = new FixedRateLimit(true)
const privateEnv = privateEnvironment(privateBurst, privateSustained)
const authoritativeEnv = { DRAFT_VALIDATION_MODE: 'enabled' }
const proxiedBurst = new FixedRateLimit(true)
const proxiedSustained = new FixedRateLimit(true)
const proxiedEnv = privateEnvironment(proxiedBurst, proxiedSustained)
const pagesEnv = {
  DRAFT_VALIDATION_MODE: 'enabled',
  VALIDATION_SERVICE: {
    fetch(request: Request) {
      return handlePrivateValidationRequest(request, proxiedEnv)
    },
  },
}
const malformedBurst = new FixedRateLimit(true)
const malformedSustained = new FixedRateLimit(true)
const malformedEnv = privateEnvironment(malformedBurst, malformedSustained)
const rejectedBurst = new FixedRateLimit(false)
const rejectedSustained = new FixedRateLimit(true)
const rejectedEnv = privateEnvironment(rejectedBurst, rejectedSustained)

const workloads: readonly Workload[] = [
  {
    label: 'Pages health handler', expectedStatus: 200,
    invoke: () => handleHealthRequest(new Request('https://preview.example.test/api/v1/health'), authoritativeEnv),
  },
  {
    label: 'authoritative ordinary transcript without limiter', expectedStatus: 200,
    invoke: () => handleAuthoritativeValidationRequest(authoritativeRequest(ordinary), authoritativeEnv),
  },
  {
    label: 'private Worker ordinary transcript', expectedStatus: 200,
    invoke: () => handlePrivateValidationRequest(privateRequest(ordinary), privateEnv),
  },
  {
    label: 'Pages proxy ordinary transcript', expectedStatus: 200,
    invoke: () => handleValidateDraftRequest(publicRequest(ordinary), pagesEnv),
  },
  {
    label: 'private Worker two-reroll transcript', expectedStatus: 200,
    invoke: () => handlePrivateValidationRequest(privateRequest(twoRerolls), privateEnv),
  },
  {
    label: 'private Worker 145-17 transcript', expectedStatus: 200,
    invoke: () => handlePrivateValidationRequest(privateRequest(allTime145), privateEnv),
  },
  {
    label: 'private Worker malformed JSON', expectedStatus: 400,
    invoke: () => handlePrivateValidationRequest(privateRequest('{'), malformedEnv),
  },
  {
    label: 'private Worker burst rate limited', expectedStatus: 429,
    invoke: () => handlePrivateValidationRequest(privateRequest(ordinary), rejectedEnv),
  },
]

const results = []
for (const workload of workloads) results.push(await measure(workload))
const privateOrdinary = results.find((result) => result.label === 'private Worker ordinary transcript')
const proxiedOrdinary = results.find((result) => result.label === 'Pages proxy ordinary transcript')
const authoritativeOrdinary = results.find((result) => result.label === 'authoritative ordinary transcript without limiter')
if (!privateOrdinary || !proxiedOrdinary || !authoritativeOrdinary) throw new Error('Missing ordinary C4 benchmark results.')

console.log(JSON.stringify({
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
  },
  warmupsPerFocusedWorkload: WARMUPS,
  measuredRequestsPerFocusedWorkload: ITERATIONS,
  proxyOverheadEstimateMs: Number((proxiedOrdinary.meanMs - privateOrdinary.meanMs).toFixed(4)),
  rateLimitCheckOverheadEstimateMs: Number((privateOrdinary.meanMs - authoritativeOrdinary.meanMs).toFixed(4)),
  limiterChecks: {
    acceptedPrivate: { burst: privateBurst.calls, sustained: privateSustained.calls },
    acceptedProxied: { burst: proxiedBurst.calls, sustained: proxiedSustained.calls },
    malformed: { burst: malformedBurst.calls, sustained: malformedSustained.calls },
    rateLimited: { burst: rejectedBurst.calls, sustained: rejectedSustained.calls },
  },
  results,
}, null, 2))
