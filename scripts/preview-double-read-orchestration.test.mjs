import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { inspect, TextEncoder } from 'node:util'
import { canonicalJson } from './lib/preview-release/canonical.mjs'
import {
  orchestratePreviewDoubleRead,
  PREVIEW_DOUBLE_READ_MAX_RECEIPT_BYTES,
  PreviewDoubleReadOrchestrationError,
} from './lib/release-inspection/preview-double-read-orchestration.mjs'
import {
  observePreviewResourcesWithTransport,
} from './lib/release-inspection/preview-resource-observer.mjs'
import {
  loadSyntheticPreviewObservationIdentityForTesting,
} from './lib/release-inspection/preview-authority.mjs'
import {
  createMockPreviewResourceTransport,
} from './lib/release-inspection/testing/mock-preview-transport.mjs'
import { runReleaseInspectionObserveCli } from './release-inspection-observe.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = path.join(ROOT, 'scripts/fixtures/release-observation/preview-single-read-v1')
const TOKEN = 'synthetic-double-read-token'

function fixture(name) {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)))
}

function operation(name) {
  if (name === 'account-zones' || name === 'pages-preview-deployments') {
    return { operation: name, page: 1 }
  }
  if (name === 'worker-routes') return { operation: name, routeZoneIndex: 0 }
  return { operation: name }
}

function exchange(name, fixtureName) {
  return {
    request: operation(name),
    bytes: fixture(fixtureName),
    status: 200,
    contentType: 'application/json',
    fault: 'none',
  }
}

function fullExchanges() {
  return [
    exchange('account', 'account.json'),
    exchange('account-zones', 'zones-page.json'),
    exchange('pages-project', 'pages-project.json'),
    exchange('pages-preview-deployments', 'pages-deployments-page.json'),
    exchange('worker-settings', 'worker-settings.json'),
    exchange('worker-deployments', 'worker-deployments.json'),
    exchange('worker-subdomain', 'worker-subdomain.json'),
    exchange('worker-schedules', 'worker-schedules.json'),
    exchange('worker-custom-domains', 'worker-custom-domains.json'),
    exchange('worker-routes', 'worker-routes.json'),
    exchange('d1-database', 'd1-database.json'),
    exchange('migration-table-discovery', 'migration-tables-query.json'),
    exchange('migration-rows', 'migration-rows-query.json'),
    exchange('backend-schema-version', 'backend-schema-version-query.json'),
  ]
}

async function observedSnapshot(capturedAtMs = 1_800_000_001_000) {
  const transport = createMockPreviewResourceTransport(
    { PENNANT_PREVIEW_API_TOKEN: TOKEN },
    fullExchanges(),
  )
  const snapshot = await observePreviewResourcesWithTransport(transport, { capturedAtMs })
  assert.equal(transport.assertExhausted(), true)
  return { snapshot, requestCount: transport.requestBudget().used }
}

const available = await observedSnapshot()

function availableResult(identityAuthority, requestCount = 0, snapshot = available.snapshot) {
  return {
    identityAuthority,
    requestCount,
    outcomeClassification: 'snapshot-available',
    snapshot,
    failureClassification: null,
  }
}

function boundedFailureResult(identityAuthority, requestCount = 0, failureClassification = 'single-read-unavailable') {
  return {
    identityAuthority,
    requestCount,
    outcomeClassification: 'bounded-failure',
    snapshot: null,
    failureClassification,
  }
}

function harness({
  clock = [0, 10, 2_010, 2_010, 2_020],
  wall = [1_900_000_000_000, 1_899_999_000_000],
  results,
  execute,
  delay,
} = {}) {
  const identity = loadSyntheticPreviewObservationIdentityForTesting()
  const events = []
  const identities = []
  let clockIndex = 0
  let wallIndex = 0
  let invocationCount = 0
  let delayCount = 0
  const dependencies = {
    monotonicNow() {
      const value = clock[clockIndex]
      clockIndex += 1
      return value
    },
    wallClockNow() {
      const value = wall[wallIndex]
      wallIndex += 1
      return value
    },
    async delay(requestedMs) {
      delayCount += 1
      events.push(`delay:${requestedMs}:start`)
      if (delay) await delay(requestedMs, events)
      events.push(`delay:${requestedMs}:settled`)
    },
    async executeSingleRead(input) {
      invocationCount += 1
      identities.push(input.identityAuthority)
      events.push(`read:${input.attemptIndex}:start`)
      const result = execute
        ? await execute(input, invocationCount, events)
        : (results?.[invocationCount - 1] ?? availableResult(input.identityAuthority))
      events.push(`read:${input.attemptIndex}:settled`)
      return result
    },
  }
  return {
    dependencies,
    events,
    identity,
    identities,
    counts: () => ({ invocationCount, delayCount, clockIndex, wallIndex }),
  }
}

function assertSecretFreeError(error, excluded = []) {
  const surfaces = [
    error?.name,
    error?.code,
    error?.message,
    error?.stack,
    error?.cause,
    String(error),
    JSON.stringify(error),
    inspect(error),
  ].map((value) => String(value))
  for (const secret of excluded) {
    for (const surface of surfaces) assert.equal(surface.includes(secret), false)
  }
  assert.equal(Object.hasOwn(error, 'cause'), false)
}

function assertBoundedError(error, code, excluded = []) {
  assert(error instanceof PreviewDoubleReadOrchestrationError)
  assert.equal(error.code, code)
  assert.equal(error.message, `Preview double-read orchestration refused: ${code}.`)
  assert.deepEqual(Reflect.ownKeys(error).sort(), ['code', 'message', 'name', 'stack'].sort())
  assertSecretFreeError(error, excluded)
}

async function captureRejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected orchestration rejection')
}

async function rejectsCode(promise, code, excluded = []) {
  await assert.rejects(promise, (error) => {
    assertBoundedError(error, code, excluded)
    return true
  })
}

test('successful orchestration invokes the real single-read observer twice with independent 64-request authorities', async () => {
  const run = harness({
    clock: [100, 110, 2_110, 2_111, 2_121],
    execute: async (input) => {
      const observed = await observedSnapshot(1_900_000_000_000 + input.attemptIndex)
      return availableResult(input.identityAuthority, observed.requestCount, observed.snapshot)
    },
  })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(run.counts().invocationCount, 2)
  assert.equal(run.counts().delayCount, 1)
  assert.equal(result.readOne.kind, 'pennant-pursuit-preview-single-read-observation')
  assert.equal(result.readTwo.kind, 'pennant-pursuit-preview-single-read-observation')
  assert.deepEqual(result.receipt.requestCounts, [14, 14])
  assert.equal(result.receipt.aggregateRequestCount, 28)
  assert.equal(result.receipt.observedDelayElapsedMs, 2_000)
  assert.equal(result.receipt.outcomeClassification, 'two-snapshots-available')
})

test('one frozen opaque identity is reused and the event order proves settlement, delay, and non-overlap', async () => {
  let active = 0
  const run = harness({
    execute: async (input) => {
      active += 1
      assert.equal(active, 1)
      await Promise.resolve()
      active -= 1
      return availableResult(input.identityAuthority, input.attemptIndex)
    },
  })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(run.identities.length, 2)
  assert.strictEqual(run.identities[0], run.identity)
  assert.strictEqual(run.identities[1], run.identity)
  assert(Object.isFrozen(run.identity))
  assert.deepEqual(run.events, [
    'read:1:start',
    'read:1:settled',
    'delay:2000:start',
    'delay:2000:settled',
    'read:2:start',
    'read:2:settled',
  ])
  assert.equal(result.receipt.authorizedAttemptCount, 2)
  assert.equal(result.receipt.observerInvocationCount, 2)
  assert.equal(result.receipt.delayRequestCount, 1)
  assert.equal(result.receipt.requestedDelayMs, 2_000)
  assert.equal(result.receipt.readTwoBeganEarly, false)
  assert.equal(result.receipt.readsOverlapped, false)
  assert.equal(result.receipt.identityContinuous, true)
  assert.match(result.receipt.identityContinuityDigest, /^[0-9a-f]{64}$/u)
})

test('scheduler overshoot is accepted when monotonic evidence proves at least 2,000ms', async () => {
  const run = harness({ clock: [0, 5, 2_505, 2_506, 2_510] })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(result.receipt.observedDelayElapsedMs, 2_500)
})

test('an early delay settlement rejects before read two', async () => {
  const run = harness({ clock: [0, 5, 2_004] })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'required-delay-shortened',
  )
  assert.deepEqual(run.counts(), { invocationCount: 1, delayCount: 1, clockIndex: 3, wallIndex: 1 })
})

for (const [label, clock] of [
  ['before delay', [10, 9]],
  ['during delay', [0, 10, 9]],
  ['after delay before read two', [0, 10, 2_010, 2_009]],
  ['after read two begins', [0, 10, 2_010, 2_011, 2_010]],
]) {
  test(`monotonic rollback ${label} fails closed`, async () => {
    const run = harness({ clock })
    await rejectsCode(
      orchestratePreviewDoubleRead(run.identity, run.dependencies),
      'monotonic-clock-rollback',
    )
  })
}

for (const invalid of [NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
  for (let boundary = 0; boundary < 5; boundary += 1) {
    test(`invalid monotonic sample ${String(invalid)} at boundary ${boundary + 1} fails closed`, async () => {
      const clock = [0, 10, 2_010, 2_010, 2_020]
      clock[boundary] = invalid
      const run = harness({ clock })
      await rejectsCode(
        orchestratePreviewDoubleRead(run.identity, run.dependencies),
        'monotonic-clock-invalid',
      )
    })
  }
}

test('a throwing monotonic authority fails closed without normalization', async () => {
  const run = harness()
  run.dependencies.monotonicNow = () => { throw new Error('clock secret') }
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'monotonic-clock-unavailable',
  )
})

test('wall-clock rollback is descriptive only and has no sequencing authority', async () => {
  const run = harness({ wall: [2_000, 1_000] })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(result.receipt.attemptReceipts[0].capturedAtMs, 2_000)
  assert.equal(result.receipt.attemptReceipts[1].capturedAtMs, 1_000)
  assert.equal(result.receipt.observedDelayElapsedMs, 2_000)
})

test('bounded read-one failure retains accounting and proceeds to read two', async () => {
  const run = harness({
    execute(input, invocation) {
      return invocation === 1
        ? boundedFailureResult(input.identityAuthority, 7, 'single-read-transport-failure')
        : availableResult(input.identityAuthority, 9)
    },
  })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(run.counts().invocationCount, 2)
  assert.equal(result.readOne, null)
  assert.deepEqual(result.readTwo, available.snapshot)
  assert.deepEqual(result.receipt.requestCounts, [7, 9])
  assert.equal(result.receipt.outcomeClassification, 'completed-with-bounded-read-failure')
  assert.equal(result.receipt.attemptReceipts[0].failureClassification, 'single-read-transport-failure')
})

test('bounded read-two failure is represented without a retry or third invocation', async () => {
  const run = harness({
    execute(input, invocation) {
      return invocation === 1
        ? availableResult(input.identityAuthority, 2)
        : boundedFailureResult(input.identityAuthority, 3, 'single-read-timeout')
    },
  })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(run.counts().invocationCount, 2)
  assert.deepEqual(result.readOne, available.snapshot)
  assert.equal(result.readTwo, null)
  assert.equal(result.receipt.attemptReceipts[1].failureClassification, 'single-read-timeout')
})

for (const [label, execute] of [
  ['synchronous throw', () => { throw new Error('credential-value') }],
  ['rejected promise', () => Promise.reject(new Error('credential-value'))],
]) {
  test(`read-one ${label} prevents delay and read two with a bounded deterministic authority error`, async () => {
    const run = harness({ execute })
    await rejectsCode(
      orchestratePreviewDoubleRead(run.identity, run.dependencies),
      'single-read-execution-untrustworthy',
    )
    assert.equal(run.counts().invocationCount, 1)
    assert.equal(run.counts().delayCount, 0)
  })
}

for (const [label, terminal] of [
  ['synchronous throw', () => { throw new Error('read-two details') }],
  ['rejected promise', () => Promise.reject(new Error('read-two details'))],
]) {
  test(`read-two ${label} fails closed without retry or third invocation`, async () => {
    const run = harness({
      execute(input, invocation) {
        return invocation === 1 ? availableResult(input.identityAuthority, 1) : terminal()
      },
    })
    await rejectsCode(
      orchestratePreviewDoubleRead(run.identity, run.dependencies),
      'single-read-execution-untrustworthy',
    )
    assert.equal(run.counts().invocationCount, 2)
    assert.equal(run.counts().delayCount, 1)
  })
}

test('a rejected delay prevents read two and is requested exactly once', async () => {
  const run = harness({ delay: () => Promise.reject(new Error('delay details')) })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'delay-execution-untrustworthy',
  )
  assert.equal(run.counts().invocationCount, 1)
  assert.equal(run.counts().delayCount, 1)
})

for (const [left, right, total] of [
  [0, 0, 0],
  [0, 1, 1],
  [0, 64, 64],
  [1, 64, 65],
  [63, 64, 127],
  [64, 64, 128],
]) {
  test(`separate request budgets accept structurally valid aggregate ${total}`, async () => {
    const run = harness({
      execute(input, invocation) {
        return availableResult(input.identityAuthority, invocation === 1 ? left : right)
      },
    })
    const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
    assert.deepEqual(result.receipt.requestCounts, [left, right])
    assert.equal(result.receipt.aggregateRequestCount, total)
  })
}

test('read-one accounting above 64 fails before delay or read two', async () => {
  const run = harness({ execute: (input) => availableResult(input.identityAuthority, 65) })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'attempt-1-request-budget-exceeded',
  )
  assert.equal(run.counts().invocationCount, 1)
  assert.equal(run.counts().delayCount, 0)
})

test('read-two accounting above its independent 64-request limit fails closed', async () => {
  const run = harness({
    execute(input, invocation) {
      return availableResult(input.identityAuthority, invocation === 1 ? 0 : 65)
    },
  })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'attempt-2-request-budget-exceeded',
  )
  assert.equal(run.counts().invocationCount, 2)
})

test('aggregate accounting above 128 fails closed before the read-two per-attempt diagnosis', async () => {
  const run = harness({
    execute(input, invocation) {
      return availableResult(input.identityAuthority, invocation === 1 ? 64 : 65)
    },
  })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'aggregate-request-budget-exceeded',
  )
  assert.equal(run.counts().invocationCount, 2)
})

for (const malformedCount of [undefined, null, -1, 1.5, NaN, Infinity, '1']) {
  test(`missing or malformed request accounting ${String(malformedCount)} fails closed`, async () => {
    const run = harness({
      execute(input) {
        const result = availableResult(input.identityAuthority)
        result.requestCount = malformedCount
        return result
      },
    })
    await rejectsCode(
      orchestratePreviewDoubleRead(run.identity, run.dependencies),
      'request-accounting-malformed',
    )
  })
}

test('contradictory bounded-failure accounting/result shape fails closed before read two', async () => {
  const run = harness({
    execute(input) {
      const result = boundedFailureResult(input.identityAuthority, 1)
      result.snapshot = available.snapshot
      return result
    },
  })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'attempt-result-contradictory',
  )
  assert.equal(run.counts().invocationCount, 1)
})

test('identity substitution on read two fails closed without a third attempt', async () => {
  const substitute = loadSyntheticPreviewObservationIdentityForTesting()
  const run = harness({
    execute(input, invocation) {
      return availableResult(invocation === 1 ? input.identityAuthority : substitute)
    },
  })
  await rejectsCode(
    orchestratePreviewDoubleRead(run.identity, run.dependencies),
    'identity-discontinuity',
  )
  assert.equal(run.counts().invocationCount, 2)
  assert.equal(run.counts().delayCount, 1)
})

test('identity mutation is prevented by the frozen opaque authority', async () => {
  const run = harness({
    execute(input) {
      assert.throws(() => Object.defineProperty(input.identityAuthority, 'replacement', {
        value: 'forbidden',
      }))
      return availableResult(input.identityAuthority)
    },
  })
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(Reflect.ownKeys(run.identity).length, 0)
  assert.equal(result.receipt.identityContinuous, true)
})

test('dependency accessors, extra keys, and function proxies are rejected before identity or clock use', async () => {
  const identity = loadSyntheticPreviewObservationIdentityForTesting()
  let touched = false
  const accessor = {
    delay() {},
    executeSingleRead() {},
    monotonicNow() { touched = true; return 0 },
  }
  Object.defineProperty(accessor, 'wallClockNow', { enumerable: true, get() { touched = true; return () => 0 } })
  await rejectsCode(orchestratePreviewDoubleRead(identity, accessor), 'dependencies-malformed')
  assert.equal(touched, false)

  const run = harness()
  await rejectsCode(orchestratePreviewDoubleRead(identity, {
    ...run.dependencies,
    extra: () => {},
  }), 'dependencies-malformed')
  await rejectsCode(orchestratePreviewDoubleRead(identity, {
    ...run.dependencies,
    delay: new Proxy(() => {}, {}),
  }), 'dependencies-malformed')
})

const ENCODER_SECRET = 'provider-secret-sentinel'

function replaceDataValue(target, key, value) {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
  assert(descriptor && Object.hasOwn(descriptor, 'value'))
  Object.defineProperty(target, key, { ...descriptor, value })
  return () => Object.defineProperty(target, key, descriptor)
}

for (const [phase, createRun, poison] of [
  [
    'before receipt construction',
    () => ({ ...harness(), beforeCall: true }),
    () => replaceDataValue(globalThis, 'TextEncoder', function PoisonedTextEncoder() {
      throw new Error(ENCODER_SECRET)
    }),
  ],
  [
    'during read one',
    () => harness({
      execute(input, invocation, events) {
        if (invocation === 1) events.mutate?.()
        return boundedFailureResult(input.identityAuthority)
      },
    }),
    () => replaceDataValue(TextEncoder.prototype, 'encode', function poisonedEncode() {
      throw new Error(ENCODER_SECRET)
    }),
  ],
  [
    'during the delay',
    () => harness({ delay: (_requestedMs, events) => events.mutate?.() }),
    () => replaceDataValue(Buffer, 'byteLength', function poisonedByteLength() {
      throw new Error(ENCODER_SECRET)
    }),
  ],
  [
    'during read two',
    () => harness({
      execute(input, invocation, events) {
        if (invocation === 2) events.mutate?.()
        return boundedFailureResult(input.identityAuthority)
      },
    }),
    () => replaceDataValue(TextEncoder.prototype, 'encode', function poisonedEncode() {
      throw new Error(ENCODER_SECRET)
    }),
  ],
  [
    'immediately before final receipt construction',
    () => {
      const run = harness({ results: [] })
      const original = run.dependencies.monotonicNow
      let sampleCount = 0
      run.dependencies.monotonicNow = () => {
        sampleCount += 1
        const value = original()
        if (sampleCount === 5) run.mutate?.()
        return value
      }
      return run
    },
    () => replaceDataValue(Buffer, 'byteLength', function poisonedByteLength() {
      throw new Error(ENCODER_SECRET)
    }),
  ],
]) {
  test(`secret-bearing encoder authority mutation ${phase} is rejected with a bounded error`, async () => {
    const run = createRun()
    const attachMutation = (mutate) => {
      run.mutate = mutate
      run.events.mutate = mutate
    }
    let restore = () => {}
    const mutate = () => { restore = poison() }
    attachMutation(mutate)
    let error
    try {
      if (run.beforeCall) mutate()
      error = await captureRejection(orchestratePreviewDoubleRead(run.identity, run.dependencies))
    } finally {
      restore()
      delete run.events.mutate
    }
    assertBoundedError(error, 'intrinsic-integrity-untrustworthy', [ENCODER_SECRET])
  })
}

test('the exact provider-secret-sentinel prototype reproduction is bounded and secret-free', async () => {
  const run = harness({
    execute(input, invocation, events) {
      if (invocation === 1) events.mutate()
      return boundedFailureResult(input.identityAuthority)
    },
  })
  let restore = () => {}
  run.events.mutate = () => {
    restore = replaceDataValue(TextEncoder.prototype, 'encode', function poisonedEncode() {
      throw new Error(ENCODER_SECRET)
    })
  }
  let error
  try {
    error = await captureRejection(orchestratePreviewDoubleRead(run.identity, run.dependencies))
  } finally {
    restore()
    delete run.events.mutate
  }
  assertBoundedError(error, 'intrinsic-integrity-untrustworthy', [ENCODER_SECRET])
})

test('an unrelated existing encoder instance cannot become receipt byte authority', async () => {
  const externalEncoder = new TextEncoder()
  externalEncoder.encode = () => { throw new Error(ENCODER_SECRET) }
  const run = harness()
  const result = await orchestratePreviewDoubleRead(run.identity, run.dependencies)
  assert.equal(canonicalJson(result.receipt).includes(ENCODER_SECRET), false)
  assert.equal(Object.isFrozen(result.receipt), true)
})

test('receipt byte authority and encoder objects are not exposed through the runtime surface', async () => {
  const module = await import('./lib/release-inspection/preview-double-read-orchestration.mjs')
  assert.equal(Object.hasOwn(module, 'trustedReceiptByteLength'), false)
  assert.equal(Object.hasOwn(module, 'textEncoder'), false)
  assert.equal(Object.values(module).some((value) => value instanceof TextEncoder), false)
})

test('source architecture pins capture, integrity, and bounded normalization without dynamic encoder lookup', () => {
  const orchestrationSource = readFileSync(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-double-read-orchestration.mjs',
  ), 'utf8')
  const intrinsicSource = readFileSync(path.join(
    ROOT,
    'scripts/lib/release-inspection/intrinsic-integrity.mjs',
  ), 'utf8')
  assert.match(orchestrationSource, /const trustedReceiptByteLength = Buffer\.byteLength/u)
  assert.match(orchestrationSource, /trustedReceiptByteLength\(canonicalJson\(receipt\), 'utf8'\)/u)
  assert.doesNotMatch(orchestrationSource, /new TextEncoder|textEncoder\.encode|Buffer\.byteLength\(/u)
  assert.match(orchestrationSource, /catch \{\s+fail\('receipt-bound-unavailable'\)\s+\}/u)
  assert.match(intrinsicSource, /^\s+"TextEncoder",$/mu)
  assert.equal(
    (orchestrationSource.match(/assertOrchestrationIntrinsicIntegrity\(\)/gu) ?? []).length >= 5,
    true,
  )
})

test('attempt receipts and orchestration receipt are deterministic, bounded, frozen, and secret-free', async () => {
  const secret = 'provider-secret-sentinel-do-not-serialize'
  const runOne = harness({
    execute(input, invocation) {
      if (invocation === 1) return boundedFailureResult(input.identityAuthority, 4, 'single-read-malformed')
      assert.notEqual(secret.length, 0)
      return availableResult(input.identityAuthority, 5)
    },
  })
  const runTwo = harness({
    execute(input, invocation) {
      return invocation === 1
        ? boundedFailureResult(input.identityAuthority, 4, 'single-read-malformed')
        : availableResult(input.identityAuthority, 5)
    },
  })
  const first = await orchestratePreviewDoubleRead(runOne.identity, runOne.dependencies)
  const second = await orchestratePreviewDoubleRead(runTwo.identity, runTwo.dependencies)
  assert.equal(canonicalJson(first.receipt), canonicalJson(second.receipt))
  const serialized = canonicalJson(first.receipt)
  assert.equal(
    createHash('sha256').update(serialized, 'utf8').digest('hex'),
    'a3d3e3cb6f15b60ecbe6ac42771efa893d6daa0bbb88ac78f1ec0e212b0a0ce8',
  )
  assert(!serialized.includes(secret))
  assert(!serialized.includes('PENNANT_PREVIEW_API_TOKEN'))
  assert(!serialized.includes('synthetic-double-read-token'))
  assert(!serialized.includes('resourceOutcomes'))
  assert(Buffer.byteLength(serialized, 'utf8') <= PREVIEW_DOUBLE_READ_MAX_RECEIPT_BYTES)
  assert(Object.isFrozen(first.receipt))
  assert(Object.isFrozen(first.receipt.attemptReceipts))
  assert(Object.isFrozen(first.receipt.attemptReceipts[0]))
})

function runPreloadedByteAuthority(mode) {
  const moduleUrl = pathToFileURL(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-double-read-orchestration.mjs',
  )).href
  const authorityUrl = pathToFileURL(path.join(
    ROOT,
    'scripts/lib/release-inspection/preview-authority.mjs',
  )).href
  const source = `
    import { Buffer } from 'node:buffer'
    const original = Buffer.byteLength
    const mode = ${JSON.stringify(mode)}
    Buffer.byteLength = (value, encoding) => {
      if (typeof value !== 'string' || !value.includes('double-read-attempt-receipt')) {
        return original(value, encoding)
      }
      if (mode === 'throw') throw new Error(${JSON.stringify(ENCODER_SECRET)})
      return mode === 'exact' ? 16384 : 16385
    }
    const orchestration = await import(${JSON.stringify(moduleUrl)} + '?preload=' + mode)
    const authority = await import(${JSON.stringify(authorityUrl)})
    const identity = authority.loadSyntheticPreviewObservationIdentityForTesting()
    const clock = [0, 10, 2010, 2010, 2020]
    const wall = [1900000000000, 1899999000000]
    const dependencies = {
      monotonicNow: () => clock.shift(),
      wallClockNow: () => wall.shift(),
      delay: () => {},
      executeSingleRead(input) {
        return {
          identityAuthority: input.identityAuthority,
          requestCount: 0,
          outcomeClassification: 'bounded-failure',
          snapshot: null,
          failureClassification: 'single-read-unavailable',
        }
      },
    }
    try {
      const result = await orchestration.orchestratePreviewDoubleRead(identity, dependencies)
      process.stdout.write(JSON.stringify({ ok: true, frozen: Object.isFrozen(result.receipt) }))
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        name: error?.name,
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause,
        serialized: JSON.stringify(error),
      }))
    } finally {
      Buffer.byteLength = original
    }
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}

test('the 16 KiB receipt boundary is inclusive and one byte above fails deterministically', () => {
  assert.deepEqual(runPreloadedByteAuthority('exact'), { ok: true, frozen: true })
  const above = runPreloadedByteAuthority('above')
  assert.equal(above.ok, false)
  assert.equal(above.name, 'PreviewDoubleReadOrchestrationError')
  assert.equal(above.code, 'receipt-size-exceeded')
  assert.equal(above.message, 'Preview double-read orchestration refused: receipt-size-exceeded.')
})

test('byte-measurement exceptions normalize without message, stack, cause, receipt, or diagnostics leakage', () => {
  const refused = runPreloadedByteAuthority('throw')
  assert.equal(refused.ok, false)
  assert.equal(refused.name, 'PreviewDoubleReadOrchestrationError')
  assert.equal(refused.code, 'receipt-bound-unavailable')
  assert.equal(refused.message, 'Preview double-read orchestration refused: receipt-bound-unavailable.')
  assert.equal(Object.hasOwn(refused, 'cause'), false)
  assert.equal(JSON.stringify({ ...refused, receipt: null, diagnostics: [] }).includes(ENCODER_SECRET), false)
})

test('trusted UTF-8 byte measurement counts multibyte text by bytes, not UTF-16 code units', () => {
  assert.equal(Buffer.byteLength('界', 'utf8'), 3)
  assert.equal(Buffer.byteLength('⚾️', 'utf8'), 6)
  assert.equal(Buffer.byteLength('界'.repeat(5_462), 'utf8'), 16_386)
})

test('online Preview CLI remains refusal-only before dependencies or network authority are touched', () => {
  let touched = false
  assert.throws(() => runReleaseInspectionObserveCli(['--online-preview'], {
    get output() { touched = true; return process.stdout },
    get createArtifact() { touched = true; return () => ({}) },
  }), /Authenticated Preview observation is unimplemented/)
  assert.equal(touched, false)
})

console.log('Preview double-read orchestration tests passed: exact two-read sequencing, one identity, monotonic delay, independent accounting, and bounded receipts remain fail-closed and offline.')
