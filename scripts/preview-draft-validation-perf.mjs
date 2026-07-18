import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const url = process.env.PREVIEW_URL
if (!url) throw new Error('Set PREVIEW_URL to an already authorized Pages preview origin, for example https://example.pages.dev.')
const origin = new URL(url).origin
const concurrency = Math.min(Math.max(Number(process.env.PREVIEW_CONCURRENCY ?? 5), 1), 5)
const perWorkload = Math.min(Math.max(Number(process.env.PREVIEW_REQUESTS_PER_WORKLOAD ?? 20), 1), 100)
const fixture = JSON.parse(readFileSync(new URL('./fixtures/transcripts/ordinary-no-rerolls.json', import.meta.url), 'utf8'))
const ticketResponse = await fetch(`${origin}/api/v1/draft-ticket`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticketRequestSchemaVersion: 'pennant-draft-ticket-request-v1', gameMode: 'classic' }),
})
if (ticketResponse.status !== 201) throw new Error(`Preview ticket issuance returned HTTP ${ticketResponse.status}.`)
const ticketResult = await ticketResponse.json()
if (
  ticketResult?.ok !== true
  || typeof ticketResult.ticket?.value !== 'string'
  || typeof ticketResult.ticket.ticketId !== 'string'
  || typeof ticketResult.ticket.draftSeed !== 'string'
  || typeof ticketResult.ticket.issuedAt !== 'number'
) throw new Error('Preview ticket issuance returned an invalid response.')
const transcript = structuredClone(fixture.transcript)
Object.assign(transcript.header, {
  draftId: ticketResult.ticket.ticketId,
  gameplaySeed: ticketResult.ticket.draftSeed,
  createdAt: new Date(ticketResult.ticket.issuedAt).toISOString(),
})
const validBody = JSON.stringify({ ticket: ticketResult.ticket.value, transcript })
const invalidTranscript = structuredClone(transcript)
invalidTranscript.events[0].combinationId = 'ana-1960s'
const invalidBody = JSON.stringify({ ticket: ticketResult.ticket.value, transcript: invalidTranscript })

function percentile(samples, percent) {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * percent) - 1]
}

async function fetchMeasured(path, options = {}) {
  const started = performance.now()
  const response = await fetch(`${origin}${path}`, options)
  const body = await response.arrayBuffer()
  return {
    ms: performance.now() - started,
    status: response.status,
    bytes: body.byteLength,
    cacheControl: response.headers.get('Cache-Control'),
    cfRay: response.headers.get('CF-Ray'),
    serverTiming: response.headers.get('Server-Timing'),
    cfCacheStatus: response.headers.get('CF-Cache-Status'),
  }
}

async function measure(label, path, options) {
  const coldLike = await fetchMeasured(path, options)
  const samples = []
  for (let offset = 0; offset < perWorkload; offset += concurrency) {
    const count = Math.min(concurrency, perWorkload - offset)
    samples.push(...await Promise.all(Array.from({ length: count }, () => fetchMeasured(path, options))))
  }
  const latencies = samples.map(({ ms }) => ms)
  const statuses = Object.fromEntries(Object.entries(Object.groupBy(samples, ({ status }) => String(status))).map(([status, values]) => [status, values.length]))
  return {
    label,
    coldLikeMs: Number(coldLike.ms.toFixed(2)),
    meanMs: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
    p95Ms: Number(percentile(latencies, .95).toFixed(2)),
    maxMs: Number(Math.max(...latencies).toFixed(2)),
    statuses,
    responseBytes: [...new Set(samples.map(({ bytes }) => bytes))],
    cacheControl: [...new Set(samples.map(({ cacheControl }) => cacheControl))],
    cfRaySamples: samples.slice(0, 3).map(({ cfRay }) => cfRay),
    serverTiming: [...new Set(samples.map(({ serverTiming }) => serverTiming))],
    cfCacheStatus: [...new Set(samples.map(({ cfCacheStatus }) => cfCacheStatus))],
  }
}

const health = await measure('health', '/api/v1/health')
const valid = await measure('valid transcript', '/api/v1/validate-draft', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: validBody,
})
const invalid = await measure('invalid transcript', '/api/v1/validate-draft', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: invalidBody,
})

console.log(JSON.stringify({
  origin,
  concurrency,
  requestsPerWorkload: perWorkload,
  totalRequests: 4 + perWorkload * 3,
  results: [health, valid, invalid],
}, null, 2))
