import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { observePreviewOperation } from '../functions/lib/preview-observability'

const original = console.info
const lines: string[] = []
const tasks: Promise<void>[] = []
const schedule = (task: Promise<void>) => {
  tasks.push(task)
}

console.info = (...values: unknown[]) => lines.push(values.join(' '))
try {
  const cases = [
    ['submission', 201, 'accepted'],
    ['submission', 200, 'idempotent'],
    ['submission', 409, 'conflict'],
    ['claim', 409, 'conflict'],
    ['recovery', 422, 'invalid'],
    ['rename', 409, 'conflict'],
    ['leaderboard-read', 429, 'rate-limited'],
    ['ticket', 503, 'server-error'],
  ] as const
  for (const [operation, status, expected] of cases) {
    const response = new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'private_failure',
        message: 'Player Cedar ppd1_SECRET PP1-SECRET ppc1_SECRET raw-ticket-value raw-transcript-value 192.0.2.1',
      },
    }), { status, headers: { 'Content-Type': 'application/json' } })
    assert.equal(
      observePreviewOperation(operation, response, 1_000, () => 1_120, schedule),
      response,
      'observability must return the identical response synchronously',
    )
    assert.equal(response.bodyUsed, false)
    await tasks.at(-1)
    const observed = JSON.parse(lines.at(-1) ?? '{}')
    assert.deepEqual(Object.keys(observed).sort(), ['event', 'latency', 'operation', 'outcome'])
    assert.equal(observed.outcome, expected)
    assert.equal(response.bodyUsed, false, 'diagnostics must never inspect response bodies')
  }

  let streamCancelled = false
  const neverEnding = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"private":"credential'))
    },
    cancel() {
      streamCancelled = true
    },
  }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  assert.equal(observePreviewOperation('rename', neverEnding, 1_000, () => 1_120, schedule), neverEnding)
  await tasks.at(-1)
  assert.equal(neverEnding.bodyUsed, false)
  assert.equal(neverEnding.body?.locked, false)
  assert.equal(streamCancelled, false)

  const malformed = new Response(new Uint8Array([0xff, 0xfe, 0xfd]), {
    status: 422,
    headers: { 'Content-Type': 'application/json' },
  })
  observePreviewOperation('recovery', malformed, 1_000, () => 1_120, schedule)
  await tasks.at(-1)
  assert.equal(malformed.bodyUsed, false)

  const oversized = new Response(new Uint8Array(512 * 1024), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })
  observePreviewOperation('claim', oversized, 1_000, () => 1_120, schedule)
  await tasks.at(-1)
  assert.equal(oversized.bodyUsed, false)

  const scheduleFailureResponse = new Response(null, { status: 204 })
  assert.doesNotThrow(() => observePreviewOperation(
    'identity-status',
    scheduleFailureResponse,
    1_000,
    () => 1_120,
    () => { throw new Error('scheduler unavailable') },
  ))
  await Promise.resolve()

  console.info = () => { throw new Error('console unavailable') }
  const consoleFailureTask: Promise<void>[] = []
  const consoleFailureResponse = new Response(null, { status: 204 })
  assert.equal(observePreviewOperation(
    'identity-status',
    consoleFailureResponse,
    1_000,
    () => 1_120,
    (task) => consoleFailureTask.push(task),
  ), consoleFailureResponse)
  await assert.doesNotReject(consoleFailureTask[0])
  assert.equal(consoleFailureResponse.bodyUsed, false)
} finally {
  console.info = original
}

const serialized = lines.join('\n')
for (const forbidden of [
  'Player Cedar',
  'ppd1_',
  'PP1-',
  'ppc1_',
  'raw-ticket-value',
  'raw-transcript-value',
  '192.0.2.1',
]) assert.doesNotMatch(serialized, new RegExp(forbidden))
assert.equal(new Set(lines.map((line) => JSON.parse(line).latency)).size, 1)

const runbook = readFileSync('docs/MILESTONE_3C1_LOCAL_RUNTIME.md', 'utf8')
assert.match(runbook, /ephemeral log events, not retained counters/)
assert.match(runbook, /wrangler tail pennant-pursuit-validation-preview --format json --search preview\.operation/)
assert.match(runbook, /wrangler pages deployment tail --project-name diamond-draft --environment preview --format json --search preview\.operation/)
assert.match(runbook, /three consecutive `server-error` events/)
assert.match(runbook, /five `rate-limited` events/)
assert.match(runbook, /aggregate-only local per-session collector, not durable\s+remote telemetry/s)
assert.doesNotMatch(runbook, /above 10%|100 per hour|exceed 25%|fifteen minutes/)

console.log('Preview observability privacy tests passed: response delivery is synchronous and identity-preserving; bodies are never inspected; status-only diagnostic events are low-cardinality; logging and scheduler failures are isolated.')
