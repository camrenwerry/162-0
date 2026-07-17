import { performance } from 'node:perf_hooks'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import allTime145Data from './fixtures/transcripts/all-time-145.json'
import { handleValidateDraftRequest } from '../functions/api/v1/validate-draft'
import type { BackendEnv } from '../functions/lib/env'

const ENDPOINT = 'https://preview.example.test/api/v1/validate-draft'
const ITERATIONS = 10_000
const WARMUPS = 200
const enabledEnv = { DRAFT_VALIDATION_MODE: 'enabled' } as BackendEnv

function serialize(transcript: unknown) {
  return JSON.stringify({ transcript })
}

function request(body: string) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

async function invoke(body: string, expectedStatus: number) {
  const response = await handleValidateDraftRequest(request(body), enabledEnv)
  if (response.status !== expectedStatus) throw new Error(`Unexpected validation status ${response.status}.`)
}

async function measure(label: string, body: string, expectedStatus: number) {
  for (let index = 0; index < WARMUPS; index += 1) await invoke(body, expectedStatus)
  const timings = new Float64Array(ITERATIONS)
  for (let index = 0; index < ITERATIONS; index += 1) {
    const start = performance.now()
    await invoke(body, expectedStatus)
    timings[index] = performance.now() - start
  }
  const sorted = Array.from(timings).sort((left, right) => left - right)
  const percentile = (percent: number) => sorted[Math.ceil((percent / 100) * sorted.length) - 1]
  return {
    label,
    iterations: ITERATIONS,
    meanMs: Array.from(timings).reduce((total, value) => total + value, 0) / ITERATIONS,
    p95Ms: percentile(95),
    p99Ms: percentile(99),
  }
}

const invalidFirstEvent = structuredClone(noRerollsData.transcript)
invalidFirstEvent.events[0].combinationId = 'ana-1960s'

const results = []
results.push(await measure('ordinary', serialize(noRerollsData.transcript), 200))
results.push(await measure('two-reroll', serialize(twoRerollsData.transcript), 200))
results.push(await measure('145-17', serialize(allTime145Data.transcript), 200))
results.push(await measure('invalid-first-event', serialize(invalidFirstEvent), 422))

console.log(JSON.stringify({ warmups: WARMUPS, results }, null, 2))
