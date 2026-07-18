import { performance } from 'node:perf_hooks'
import os from 'node:os'
import fixed113Data from './fixtures/transcripts/fixed-113.json'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import allTime145Data from './fixtures/transcripts/all-time-145.json'
import { handleAuthoritativeValidationRequest } from '../workers/draft-validation/src/authoritative-validation'
import { MAX_DRAFT_VALIDATION_BODY_BYTES } from '../functions/lib/bounded-json'
import type { BackendEnv } from '../functions/lib/env'
import {
  createBoundValidationFixture,
  TEST_DRAFT_TICKET_SIGNING_KEY,
} from './lib/draft-ticket-fixtures'

const ENDPOINT = 'https://preview.example.test/api/v1/validate-draft'
const ITERATIONS = 10_000
const WARMUPS = 10_000
const CONCURRENCY = 5
const enabledEnv = {
  DRAFT_VALIDATION_MODE: 'enabled',
  DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY,
} as BackendEnv
const disabledEnv = { DRAFT_VALIDATION_MODE: 'disabled' } as BackendEnv

interface Workload {
  readonly label: string
  readonly expectedStatus: number
  readonly env?: BackendEnv
  request(): Request
}

function serialize(ticket: string, transcript: unknown) {
  return JSON.stringify({ ticket, transcript })
}

function request(body: string, options: { method?: string, headers?: Record<string, string> } = {}) {
  const method = options.method ?? 'POST'
  return new Request(ENDPOINT, {
    method,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  })
}

async function invoke(workload: Workload) {
  const response = await handleAuthoritativeValidationRequest(workload.request(), workload.env ?? enabledEnv)
  if (response.status !== workload.expectedStatus) {
    throw new Error(`${workload.label}: expected ${workload.expectedStatus}, received ${response.status}.`)
  }
  await response.arrayBuffer()
}

function summarize(samples: Float64Array) {
  const sorted = Array.from(samples).sort((left, right) => left - right)
  const percentile = (percent: number) => sorted[Math.ceil((percent / 100) * sorted.length) - 1]
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const meanMs = total / sorted.length
  return {
    iterations: sorted.length,
    meanMs: Number(meanMs.toFixed(4)),
    medianMs: Number(percentile(50).toFixed(4)),
    p90Ms: Number(percentile(90).toFixed(4)),
    p95Ms: Number(percentile(95).toFixed(4)),
    p99Ms: Number(percentile(99).toFixed(4)),
    maxMs: Number(sorted.at(-1)!.toFixed(4)),
    requestsPerSecond: Number((1_000 / meanMs).toFixed(1)),
  }
}

async function measure(workload: Workload) {
  for (let index = 0; index < WARMUPS; index += 1) await invoke(workload)
  const beforeHeap = process.memoryUsage().heapUsed
  const samples = new Float64Array(ITERATIONS)
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now()
    await invoke(workload)
    samples[index] = performance.now() - started
  }
  const afterHeap = process.memoryUsage().heapUsed
  return {
    label: workload.label,
    ...summarize(samples),
    approximateHeapDeltaKiB: Number(((afterHeap - beforeHeap) / 1024).toFixed(1)),
  }
}

async function measureConcurrent(workload: Workload) {
  for (let index = 0; index < WARMUPS; index += CONCURRENCY) {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => invoke(workload)))
  }
  const beforeHeap = process.memoryUsage().heapUsed
  const samples = new Float64Array(ITERATIONS / CONCURRENCY)
  for (let index = 0; index < ITERATIONS; index += CONCURRENCY) {
    const started = performance.now()
    await Promise.all(Array.from({ length: CONCURRENCY }, () => invoke(workload)))
    samples[index / CONCURRENCY] = (performance.now() - started) / CONCURRENCY
  }
  const afterHeap = process.memoryUsage().heapUsed
  return {
    label: `${workload.label} (concurrency ${CONCURRENCY})`,
    ...summarize(samples),
    approximateHeapDeltaKiB: Number(((afterHeap - beforeHeap) / 1024).toFixed(1)),
  }
}

const fixed113 = await createBoundValidationFixture(fixed113Data.transcript)
const noRerolls = await createBoundValidationFixture(noRerollsData.transcript)
const twoRerolls = await createBoundValidationFixture(twoRerollsData.transcript)
const allTime145 = await createBoundValidationFixture(allTime145Data.transcript)
const invalidFirst = structuredClone(noRerolls.transcript)
invalidFirst.events[0].combinationId = 'ana-1960s'
const invalidFinal = structuredClone(noRerolls.transcript)
const finalEvent = invalidFinal.events.at(-1)
if (!finalEvent || finalEvent.type !== 'pick') throw new Error('Fixture final event must be a pick.')
finalEvent.canonicalCardId = 'not-a-canonical-card'
const ordinaryBody = serialize(noRerolls.ticket, noRerolls.transcript)
const maximumSizeValidBody = `${ordinaryBody}${' '.repeat(MAX_DRAFT_VALIDATION_BODY_BYTES - ordinaryBody.length)}`

const workloads: readonly Workload[] = [
  { label: 'disabled production request', expectedStatus: 404, env: disabledEnv, request: () => request(ordinaryBody) },
  { label: 'unsupported method', expectedStatus: 405, request: () => request('', { method: 'GET' }) },
  { label: 'wrong content type', expectedStatus: 415, request: () => request('{}', { headers: { 'Content-Type': 'text/plain' } }) },
  { label: 'oversized body', expectedStatus: 413, request: () => request('{}', { headers: { 'Content-Length': String(MAX_DRAFT_VALIDATION_BODY_BYTES + 1) } }) },
  { label: 'malformed JSON', expectedStatus: 400, request: () => request('{') },
  { label: 'invalid schema', expectedStatus: 400, request: () => request('{}') },
  { label: 'invalid first event', expectedStatus: 422, request: () => request(serialize(noRerolls.ticket, invalidFirst)) },
  { label: 'invalid final event', expectedStatus: 422, request: () => request(serialize(noRerolls.ticket, invalidFinal)) },
  { label: 'ordinary valid transcript', expectedStatus: 200, request: () => request(ordinaryBody) },
  { label: 'two-reroll valid transcript', expectedStatus: 200, request: () => request(serialize(twoRerolls.ticket, twoRerolls.transcript)) },
  { label: '145-17 valid transcript', expectedStatus: 200, request: () => request(serialize(allTime145.ticket, allTime145.transcript)) },
  { label: 'fixed 113-49 transcript', expectedStatus: 200, request: () => request(serialize(fixed113.ticket, fixed113.transcript)) },
  { label: 'maximum-size valid request', expectedStatus: 200, request: () => request(maximumSizeValidBody) },
]

const results = []
for (const workload of workloads) results.push(await measure(workload))
const ordinary = workloads.find((workload) => workload.label === 'ordinary valid transcript')
if (!ordinary) throw new Error('Missing ordinary validation workload.')
results.push(await measureConcurrent(ordinary))

console.log(JSON.stringify({
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
  },
  warmupsPerFocusedWorkload: WARMUPS,
  measuredRequestsPerSequentialWorkload: ITERATIONS,
  concurrentRequestCount: ITERATIONS,
  results,
}, null, 2))
