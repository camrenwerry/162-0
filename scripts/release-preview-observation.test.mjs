import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { inspect } from 'node:util'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createPreviewSingleReadSnapshot,
  PREVIEW_RESOURCE_OUTCOME_STATES,
  PREVIEW_SINGLE_READ_KIND,
  renderPreviewSingleReadJson,
  validatePreviewSingleReadSnapshot,
} from './lib/release-inspection/preview-observation-contracts.mjs'
import {
  loadPreviewObservationIdentity,
  validatePreviewObservationIdentity,
} from './lib/release-inspection/preview-identity.mjs'
import { createPreviewHttpTransport } from './lib/release-inspection/preview-http-transport.mjs'
import {
  createSyntheticPreviewHttpTransportForTesting,
  loadSyntheticPreviewObservationIdentityForTesting,
} from './lib/release-inspection/preview-authority.mjs'
import { createMockPreviewTransport } from './lib/release-inspection/testing/mock-preview-transport.mjs'
import {
  canonicalJson,
  parseStrictJson,
} from './lib/preview-release/canonical.mjs'
import {
  PREVIEW_OPERATION_NAMES,
  REMOTE_OBSERVATION_LIMITS,
  parseStrictRemoteJson,
} from './lib/release-inspection/remote-transport.mjs'

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/fixtures/release-observation/preview-single-read-v1',
)
const ACCOUNT_ID = '1'.repeat(32)
const ZONE_ID = '2'.repeat(32)
const CREDENTIAL_VALUE = 'synthetic-read-credential-value'
const credentialEnvironment = Object.freeze({ PENNANT_PREVIEW_API_TOKEN: CREDENTIAL_VALUE })
const placeholder = Object.freeze({
  kind: 'preview-resource-observation-placeholder',
  schemaVersion: 1,
})

function fixtureBytes(name) {
  return new Uint8Array(readFileSync(path.join(FIXTURE_ROOT, name)))
}

function rawEnvelope(result = []) {
  return new TextEncoder().encode(JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result,
  }))
}

function operation(operationName) {
  if (operationName === 'account-zones' || operationName === 'pages-preview-deployments') {
    return { operation: operationName, page: 1 }
  }
  if (operationName === 'worker-routes') return { operation: operationName, routeZoneIndex: 0 }
  return { operation: operationName }
}

const issueByState = Object.freeze({
  complete: null,
  missing: 'resource-missing',
  unavailable: 'resource-unavailable',
  partial: 'resource-partial',
  malformed: 'resource-malformed',
  contradictory: 'resource-contradictory',
})

function outcome(state, operationName = 'account') {
  return {
    operation: operationName,
    state,
    issueCode: issueByState[state],
    capturedAtMs: 100,
    value: ['complete', 'partial', 'contradictory'].includes(state) ? placeholder : null,
  }
}

function exchange(request, bytes = rawEnvelope()) {
  return {
    request,
    bytes,
    contentType: 'application/json; charset=utf-8',
    status: 200,
    fault: 'none',
  }
}

function manualDeadlineDependencies(fetchImplementation) {
  const callbacks = []
  return {
    callbacks,
    dependencies: {
      fetchImplementation,
      setTimer(callback) { callbacks.push(callback); return callbacks.length },
      clearTimer() {},
    },
  }
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve))
}

function withTemporaryDirectory(prefix, operation) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix))
  let operationFailed = false
  let operationFailure
  let result
  try {
    result = operation(directory)
  } catch (error) {
    operationFailed = true
    operationFailure = error
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch (cleanupFailure) {
      if (!operationFailed) throw cleanupFailure
    }
  }
  if (operationFailed) throw operationFailure
  if (existsSync(directory)) throw new Error('Temporary Preview authority directory cleanup failed.')
  return result
}

async function withDescriptorMutation(target, key, descriptor, operation) {
  const original = Reflect.getOwnPropertyDescriptor(target, key)
  assert.ok(original)
  Object.defineProperty(target, key, descriptor)
  try {
    return await operation()
  } finally {
    Object.defineProperty(target, key, original)
  }
}

function assertSensitiveValuesAbsent(value) {
  const rendered = String(value)
  for (const sensitive of [ACCOUNT_ID, ZONE_ID, CREDENTIAL_VALUE, 'raw-provider-message']) {
    assert.equal(rendered.includes(sensitive), false)
  }
}

test('single-read snapshot is closed, immutable, canonical, and authority-free', () => {
  const mutable = [{ ...outcome('complete', 'worker-settings'), value: { ...placeholder } }]
  const snapshot = createPreviewSingleReadSnapshot({ capturedAtMs: 101, resourceOutcomes: mutable })
  mutable[0].value.kind = 'changed-after-validation'
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.kind, PREVIEW_SINGLE_READ_KIND)
  assert.equal(snapshot.environment, 'preview')
  assert.equal(snapshot.observationState, 'complete')
  assert.equal(snapshot.freshnessStatus, 'unknown')
  assert.equal(snapshot.releaseCurrentness, 'UNKNOWN')
  assert.equal(snapshot.executionAuthorization, 'prohibited')
  assert.equal(snapshot.noRemoteMutation, true)
  assert.equal(snapshot.noSecretValues, true)
  assert.equal(snapshot.productionContacted, false)
  assert.deepEqual(snapshot.resourceOutcomes[0].value, placeholder)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.resourceOutcomes[0].value), true)
  assert.equal(renderPreviewSingleReadJson(snapshot), `${canonicalJson(snapshot)}\n`)
})

test('single-read outcomes use exact discriminated value and issue-code semantics', () => {
  assert.deepEqual(PREVIEW_RESOURCE_OUTCOME_STATES, [
    'complete', 'missing', 'unavailable', 'partial', 'malformed', 'contradictory',
  ])
  for (const state of PREVIEW_RESOURCE_OUTCOME_STATES) {
    const snapshot = createPreviewSingleReadSnapshot({
      capturedAtMs: 100,
      resourceOutcomes: [outcome(state)],
    })
    assert.equal(snapshot.observationState, state)
  }
  for (const changed of [
    { ...outcome('complete'), value: null },
    { ...outcome('missing'), value: placeholder },
    { ...outcome('partial'), value: null },
    { ...outcome('malformed'), issueCode: 'resource-missing' },
    { ...outcome('complete'), issueCode: 'resource-complete' },
  ]) {
    assert.throws(() => createPreviewSingleReadSnapshot({
      capturedAtMs: 100,
      resourceOutcomes: [changed],
    }), /single-read contract refused/)
  }
})

test('single-read resource semantics are a closed allowlisted schema', () => {
  const probes = [
    { approval: true },
    { readiness: 'yes' },
    { executionPermission: true },
    { releaseCurrentness: 'current-with-caveat' },
    { credentialAlias: 'material' },
    { token_value: 'material' },
    { authorizationHeader: 'material' },
    { cookies: ['material'] },
    { secrets: { password: 'material', keyMaterial: 'material' } },
    { accountIdentifier: ACCOUNT_ID },
    { zoneIdentifiers: [ZONE_ID] },
    { request_id: '00000000-0000-4000-8000-000000000001' },
    { cf_ray: 'provider-request' },
    { renamed: { providerHeaders: {}, rawBody: '{}', opaqueProviderObject: {} } },
    { status: 'APPROVED WITH CONDITIONS' },
    { status: 'NO-OP candidate' },
    { status: 'ready for commit' },
    { '\uFF41pproval': true },
    { 'approval%2520state': true },
    { execution_permissions: [true] },
    { nested: [{ deploymentMutation: 'DRIFT candidate' }] },
  ]
  for (const value of probes) {
    assert.throws(() => createPreviewSingleReadSnapshot({
      capturedAtMs: 101,
      resourceOutcomes: [{ ...outcome('complete'), value }],
    }), /normalized resource value|closed Preview placeholder schema|resource value kind/)
  }
  for (const value of [
    { ...placeholder, extra: true },
    { ...placeholder, kind: 'provider-resource' },
    { ...placeholder, schemaVersion: 2 },
    new Proxy({ ...placeholder }, {}),
  ]) {
    assert.throws(() => createPreviewSingleReadSnapshot({
      capturedAtMs: 101,
      resourceOutcomes: [{ ...outcome('complete'), value }],
    }), /single-read contract refused/)
  }
})

test('single-read aggregation, duplicate, timestamp, and deterministic ordering rules remain exact', () => {
  const aggregate = createPreviewSingleReadSnapshot({
    capturedAtMs: 100,
    resourceOutcomes: [
      outcome('missing', 'account'),
      outcome('partial', 'worker-settings'),
      outcome('contradictory', 'd1-database'),
    ],
  })
  assert.equal(aggregate.observationState, 'contradictory')
  assert.equal(createPreviewSingleReadSnapshot({ capturedAtMs: 0 }).observationState, 'unavailable')
  assert.throws(() => createPreviewSingleReadSnapshot({
    capturedAtMs: 101,
    resourceOutcomes: [outcome('missing'), outcome('unavailable')],
  }), /duplicate operation/)
  assert.throws(() => createPreviewSingleReadSnapshot({
    capturedAtMs: 99,
    resourceOutcomes: [outcome('missing')],
  }), /later than the snapshot/)
  const left = createPreviewSingleReadSnapshot({
    capturedAtMs: 101,
    resourceOutcomes: [outcome('complete', 'worker-settings'), outcome('complete', 'account')],
  })
  const right = createPreviewSingleReadSnapshot({
    capturedAtMs: 101,
    resourceOutcomes: [...left.resourceOutcomes].reverse(),
  })
  assert.equal(renderPreviewSingleReadJson(left), renderPreviewSingleReadJson(right))
})

test('snapshot creation and validation enforce the authoritative UTF-8 byte budget before acceptance', () => {
  const maximum = REMOTE_OBSERVATION_LIMITS.maximumSerializedObservationBytes
  const valid = createPreviewSingleReadSnapshot({ capturedAtMs: 1 })
  const base = { ...valid, extra: '' }
  const baseBytes = Buffer.byteLength(canonicalJson(base), 'utf8')
  const exactlyAt = { ...base, extra: 'x'.repeat(maximum - baseBytes) }
  const justBelow = { ...base, extra: 'x'.repeat(maximum - baseBytes - 1) }
  const oneOver = { ...base, extra: 'x'.repeat(maximum - baseBytes + 1) }
  assert.equal(Buffer.byteLength(canonicalJson(exactlyAt), 'utf8'), maximum)
  assert.equal(Buffer.byteLength(canonicalJson(justBelow), 'utf8'), maximum - 1)
  assert.equal(Buffer.byteLength(canonicalJson(oneOver), 'utf8'), maximum + 1)
  assert.throws(() => validatePreviewSingleReadSnapshot(justBelow), /closed field inventory/)
  assert.throws(() => validatePreviewSingleReadSnapshot(exactlyAt), /closed field inventory/)
  assert.throws(() => validatePreviewSingleReadSnapshot(oneOver), /byte limit/)

  const oversizedCreate = { capturedAtMs: 1, extra: 'x'.repeat(maximum) }
  assert.throws(() => createPreviewSingleReadSnapshot(oversizedCreate), /byte limit/)
  assert.throws(() => renderPreviewSingleReadJson(oneOver), /byte limit/)
  assert.throws(() => createPreviewSingleReadSnapshot({
    capturedAtMs: 1,
    resourceOutcomes: [[{ nested: ['x'.repeat(maximum)] }]],
  }), /byte limit/)

  const multibyteBase = { ...valid, extra: '' }
  const remaining = maximum - Buffer.byteLength(canonicalJson(multibyteBase), 'utf8')
  const multibyte = { ...multibyteBase, extra: '界'.repeat(Math.floor(remaining / 3) + 1) }
  assert.ok(multibyte.extra.length < maximum)
  assert.throws(() => validatePreviewSingleReadSnapshot(multibyte), /byte limit/)
})

test('checked-in identity authority is root-anchored, opaque, and unresolved state fails closed', () => {
  assert.throws(() => loadPreviewObservationIdentity(REPOSITORY_ROOT), /account grounding is unresolved/)
  let alternate
  withTemporaryDirectory('preview-authority-', (directory) => {
    alternate = directory
    mkdirSync(path.join(directory, 'config'))
    const selfAuthorizing = parseStrictJson(
      readFileSync(path.join(REPOSITORY_ROOT, 'config/preview-release.json'), 'utf8'),
    )
    selfAuthorizing.repository.allowedRoots = [directory]
    selfAuthorizing.cloudflare.account = { status: 'resolved', id: ACCOUNT_ID, reason: '' }
    selfAuthorizing.cloudflare.preview.worker.routeZoneIds = {
      status: 'resolved', values: [ZONE_ID], reason: '',
    }
    writeFileSync(
      path.join(directory, 'config/preview-release.json'),
      `${JSON.stringify(selfAuthorizing)}\n`,
    )
    assert.throws(() => loadPreviewObservationIdentity(directory), /not the checked-in authority root/)
  })
  assert.equal(existsSync(alternate), false)
})

test('temporary authority cleanup preserves the original test failure', () => {
  let alternate
  assert.throws(() => withTemporaryDirectory('preview-authority-', (directory) => {
    alternate = directory
    writeFileSync(path.join(directory, 'review-only.txt'), 'review only\n')
    throw new Error('original review failure')
  }), /original review failure/)
  assert.equal(existsSync(alternate), false)
})

test('identity provenance cannot be forged, cloned, serialized, proxied, or reconstructed', async () => {
  const authentic = loadSyntheticPreviewObservationIdentityForTesting()
  assert.equal(validatePreviewObservationIdentity(authentic), authentic)
  assert.deepEqual(Reflect.ownKeys(authentic), [])
  assert.equal(JSON.stringify(authentic), '{}')
  assert.equal(canonicalJson(authentic), '{}')
  const attempts = [
    {},
    Object.assign({}, authentic),
    JSON.parse(JSON.stringify(authentic)),
    new Proxy(authentic, {}),
    Object.create(authentic),
    Object.create(null),
    Object.fromEntries(Reflect.ownKeys(authentic).map((key) => [key, authentic[key]])),
  ]
  for (const candidate of attempts) {
    assert.throws(() => validatePreviewObservationIdentity(candidate), /provenance is absent/)
    assert.throws(
      () => createPreviewHttpTransport(candidate, credentialEnvironment),
      /provenance is absent/,
    )
  }
  assert.throws(
    () => createPreviewHttpTransport(authentic, credentialEnvironment, {
      fetchImplementation: async () => new Response(),
    }),
    /test identity cannot construct the public transport/,
  )
  assert.equal(Reflect.ownKeys(await import('./lib/release-inspection/preview-identity.mjs')).includes('createPreviewObservationIdentityFromManifest'), false)
})

test('WeakMap constructor and prototype tampering fail before provenance, credentials, or fetch', async () => {
  const authentic = loadSyntheticPreviewObservationIdentityForTesting()
  const constructorDescriptor = Reflect.getOwnPropertyDescriptor(globalThis, 'WeakMap')
  assert.ok(constructorDescriptor)
  let credentialReads = 0
  let dependencyReads = 0
  const credential = new Proxy({}, {
    ownKeys() { credentialReads += 1; return [] },
  })
  const dependencies = new Proxy({}, {
    getPrototypeOf() { dependencyReads += 1; return Object.prototype },
  })
  await withDescriptorMutation(globalThis, 'WeakMap', {
    ...constructorDescriptor,
    value: class ReviewWeakMap extends constructorDescriptor.value {},
  }, async () => {
    let failure
    try { createPreviewHttpTransport({}, credential, dependencies) } catch (error) { failure = error }
    assert.match(String(failure), /intrinsic integrity refused/)
    assertSensitiveValuesAbsent(failure)
  })
  assert.equal(credentialReads, 0)
  assert.equal(dependencyReads, 0)

  const constructorPrototype = Reflect.getOwnPropertyDescriptor(WeakMap, 'prototype')
  assert.equal(constructorPrototype?.writable, false)
  assert.equal(constructorPrototype?.configurable, false)
  assert.equal(Reflect.set(WeakMap, 'prototype', {}), false)

  const originalPrototype = Reflect.getPrototypeOf(WeakMap.prototype)
  Reflect.setPrototypeOf(WeakMap.prototype, Object.freeze({ reviewPrototype: true }))
  try {
    assert.throws(
      () => validatePreviewObservationIdentity(authentic),
      /intrinsic integrity refused/,
    )
  } finally {
    Reflect.setPrototypeOf(WeakMap.prototype, originalPrototype)
  }
  assert.equal(validatePreviewObservationIdentity(authentic), authentic)
})

test('WeakMap method and accessor replacement cannot forge or capture private authority', async () => {
  const authentic = loadSyntheticPreviewObservationIdentityForTesting()
  const originalGet = WeakMap.prototype.get
  const originalSet = WeakMap.prototype.set
  let forgedGetCalls = 0
  let capturedSetCalls = 0
  let credentialReads = 0
  let fetches = 0
  await withDescriptorMutation(WeakMap.prototype, 'get', {
    configurable: true,
    enumerable: false,
    writable: true,
    value(key) {
      forgedGetCalls += 1
      return Reflect.apply(originalGet, this, [key]) ?? Object.freeze({
        rawIdentity: Object.freeze({
          accountId: ACCOUNT_ID,
          pagesProject: 'diamond-draft',
          workerName: 'pennant-pursuit-validation-preview',
          databaseId: 'ba6255b4-9425-4863-b10f-79149180f75a',
          routeZoneIds: Object.freeze([ZONE_ID]),
        }),
        testing: false,
      })
    },
  }, async () => {
    const hostileCredential = new Proxy({}, {
      ownKeys() { credentialReads += 1; return [] },
    })
    let failure
    try {
      createPreviewHttpTransport({}, hostileCredential, {
        fetchImplementation: async () => { fetches += 1; return new Response() },
      })
    } catch (error) {
      failure = error
    }
    assert.match(String(failure), /intrinsic integrity refused/)
    assertSensitiveValuesAbsent(failure)
  })
  assert.equal(forgedGetCalls, 0)
  assert.equal(credentialReads, 0)
  assert.equal(fetches, 0)

  await withDescriptorMutation(WeakMap.prototype, 'set', {
    configurable: true,
    enumerable: false,
    writable: true,
    value(key, value) {
      capturedSetCalls += 1
      return Reflect.apply(originalSet, this, [key, value])
    },
  }, async () => {
    let failure
    try { loadSyntheticPreviewObservationIdentityForTesting() } catch (error) { failure = error }
    assert.match(String(failure), /intrinsic integrity refused/)
    assertSensitiveValuesAbsent(failure)
  })
  assert.equal(capturedSetCalls, 0)

  for (const method of ['delete', 'has']) {
    const original = WeakMap.prototype[method]
    await withDescriptorMutation(WeakMap.prototype, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value(...args) { return Reflect.apply(original, this, args) },
    }, async () => {
      assert.throws(
        () => validatePreviewObservationIdentity(authentic),
        /intrinsic integrity refused/,
      )
    })
  }

  let getterReads = 0
  await withDescriptorMutation(WeakMap.prototype, 'get', {
    configurable: true,
    enumerable: false,
    get() { getterReads += 1; return originalGet },
  }, async () => {
    assert.throws(
      () => validatePreviewObservationIdentity(authentic),
      /intrinsic integrity refused/,
    )
  })
  assert.equal(getterReads, 0)
  assert.equal(validatePreviewObservationIdentity(authentic), authentic)
})

test('WeakMap tampering before authority import and between authority phases fails closed', async () => {
  const getDescriptor = Reflect.getOwnPropertyDescriptor(WeakMap.prototype, 'get')
  assert.ok(getDescriptor)
  await withDescriptorMutation(WeakMap.prototype, 'get', {
    ...getDescriptor,
    value() { return { rawIdentity: {}, testing: false } },
  }, async () => {
    await assert.rejects(
      import(`./lib/release-inspection/preview-authority.mjs?weakmap-before=${Date.now()}`),
      /intrinsic integrity refused/,
    )
  })

  const identity = loadSyntheticPreviewObservationIdentityForTesting()
  await withDescriptorMutation(WeakMap.prototype, 'get', {
    ...getDescriptor,
    value: getDescriptor.value,
    enumerable: true,
  }, async () => {
    let failure
    try { validatePreviewObservationIdentity(identity) } catch (error) { failure = error }
    assert.match(String(failure), /intrinsic integrity refused/)
    assertSensitiveValuesAbsent(failure)
  })

  let fetches = 0
  const transport = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async () => {
      fetches += 1
      return new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } })
    },
    setTimer: () => 1,
    clearTimer: () => {},
  })
  const hasDescriptor = Reflect.getOwnPropertyDescriptor(WeakMap.prototype, 'has')
  assert.ok(hasDescriptor)
  await withDescriptorMutation(WeakMap.prototype, 'has', {
    ...hasDescriptor,
    value() { return true },
  }, async () => {
    let failure
    try { await transport.request(operation('account')) } catch (error) { failure = error }
    assert.match(String(failure), /intrinsic integrity refused/)
    assertSensitiveValuesAbsent(failure)
  })
  assert.equal(fetches, 0)
  assert.equal((await transport.request(operation('account'))).operation, 'account')
  assert.equal(fetches, 1)
})

test('fresh-process WeakMap tampering before any authority import is rejected without invoking replacements', () => {
  const authorityUrl = pathToFileURL(path.join(
    REPOSITORY_ROOT,
    'scripts/lib/release-inspection/preview-authority.mjs',
  )).href
  for (const variant of [
    'constructor',
    'prototype-chain',
    'get',
    'set',
    'has',
    'get-accessor',
  ]) {
    const source = `
      const variant = ${JSON.stringify(variant)};
      const authorityUrl = ${JSON.stringify(authorityUrl)};
      const originals = {
        constructor: Object.getOwnPropertyDescriptor(globalThis, 'WeakMap'),
        get: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'get'),
        has: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'has'),
        prototype: Object.getPrototypeOf(WeakMap.prototype),
        set: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'set'),
      };
      let replacementCalls = 0;
      try {
        if (variant === 'constructor') {
          Object.defineProperty(globalThis, 'WeakMap', {
            ...originals.constructor,
            value: class ReviewWeakMap extends originals.constructor.value {},
          });
        } else if (variant === 'prototype-chain') {
          Object.setPrototypeOf(WeakMap.prototype, { reviewPrototype: true });
        } else if (variant === 'get-accessor') {
          Object.defineProperty(WeakMap.prototype, 'get', {
            configurable: true,
            enumerable: false,
            get() { replacementCalls += 1; return originals.get.value; },
          });
        } else {
          const original = originals[variant];
          Object.defineProperty(WeakMap.prototype, variant, {
            ...original,
            value(...args) {
              replacementCalls += 1;
              return Reflect.apply(original.value, this, args);
            },
          });
        }
        let refused = false;
        try { await import(authorityUrl + '?preimport=' + variant); }
        catch (error) { refused = /intrinsic integrity refused/u.test(String(error)); }
        if (!refused || replacementCalls !== 0) process.exitCode = 1;
        process.stdout.write(JSON.stringify({ refused, replacementCalls }));
      } finally {
        if (variant === 'constructor') Object.defineProperty(globalThis, 'WeakMap', originals.constructor);
        else if (variant === 'prototype-chain') Object.setPrototypeOf(WeakMap.prototype, originals.prototype);
        else if (variant === 'get-accessor') Object.defineProperty(WeakMap.prototype, 'get', originals.get);
        else Object.defineProperty(WeakMap.prototype, variant, originals[variant]);
      }
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, `${variant}: ${result.stderr}`)
    assert.deepEqual(JSON.parse(result.stdout), { refused: true, replacementCalls: 0 })
    assertSensitiveValuesAbsent(result.stderr)
  }
})

test('provenance refusal precedes credential, dependency, token, and fetch access', () => {
  let credentialReads = 0
  let dependencyReads = 0
  const hostileCredential = new Proxy({}, {
    ownKeys() { credentialReads += 1; throw new Error('credential read') },
  })
  const hostileDependencies = new Proxy({}, {
    getPrototypeOf() { dependencyReads += 1; throw new Error('dependency read') },
  })
  assert.throws(
    () => createPreviewHttpTransport({}, hostileCredential, hostileDependencies),
    /provenance is absent/,
  )
  assert.equal(credentialReads, 0)
  assert.equal(dependencyReads, 0)
})

test('public identity objects disclose no account or zone identifiers by any ordinary inspection path', () => {
  const identity = loadSyntheticPreviewObservationIdentityForTesting()
  const representations = [
    inspect(identity, { showHidden: true }),
    JSON.stringify(identity),
    canonicalJson(identity),
    String(identity),
    Reflect.ownKeys(identity).join(','),
    Object.getOwnPropertyNames(identity).join(','),
    Object.getOwnPropertySymbols(identity).map(String).join(','),
  ]
  for (const representation of representations) {
    assert.equal(representation.includes(ACCOUNT_ID), false)
    assert.equal(representation.includes(ZONE_ID), false)
  }
  assert.equal(identity.accountId, undefined)
  assert.equal(identity.routeZoneIds, undefined)
})

test('HTTP projection covers every operation while public receipts consume provider data privately', async () => {
  const calls = []
  const transport = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async (url, options) => {
      calls.push({ url, options })
      return new Response(rawEnvelope({
        id: ACCOUNT_ID,
        zone_id: ZONE_ID,
        provider_message: 'raw-provider-message',
      }), { headers: { 'content-type': 'application/json' } })
    },
    setTimer: () => 1,
    clearTimer: () => {},
  })
  for (const operationName of PREVIEW_OPERATION_NAMES) {
    const receipt = await transport.request(operation(operationName))
    assert.deepEqual(receipt, {
      operation: operationName,
      bodyBytes: calls.at(-1).options.method === 'POST'
        ? rawEnvelope({ id: ACCOUNT_ID, zone_id: ZONE_ID, provider_message: 'raw-provider-message' }).byteLength
        : rawEnvelope({ id: ACCOUNT_ID, zone_id: ZONE_ID, provider_message: 'raw-provider-message' }).byteLength,
      representation: 'private-provider-json-consumed',
    })
    const exposed = `${inspect(receipt)} ${JSON.stringify(receipt)} ${canonicalJson(receipt)}`
    assert.equal(exposed.includes(ACCOUNT_ID), false)
    assert.equal(exposed.includes(ZONE_ID), false)
    assert.equal(exposed.includes('raw-provider-message'), false)
  }
  assert.equal(calls.length, PREVIEW_OPERATION_NAMES.length)
  assert.equal(transport.requestBudget().used, PREVIEW_OPERATION_NAMES.length)
  for (const [index, operationName] of PREVIEW_OPERATION_NAMES.entries()) {
    const { url, options } = calls[index]
    assert.equal(url.origin, 'https://api.cloudflare.com')
    assert.ok(url.pathname.startsWith('/client/v4/'))
    assert.equal(options.method, ['migration-table-discovery', 'migration-rows', 'backend-schema-version'].includes(operationName) ? 'POST' : 'GET')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.accept, 'application/json')
    assert.equal(options.headers.authorization, `Bearer ${CREDENTIAL_VALUE}`)
    assert.equal(options.body === undefined, options.method === 'GET')
  }
  assert.ok(calls.some(({ url }) => url.pathname.includes(ACCOUNT_ID)))
  assert.ok(calls.some(({ url }) => url.pathname.includes(ZONE_ID)))
  assert.ok(calls.some(({ url }) => url.searchParams.get('account.id') === ACCOUNT_ID))
  assert.ok(calls.some(({ url }) => url.searchParams.get('page') === '1'))
})

test('mock verifies actual production HTTP projection and never exposes token or identifiers', async () => {
  const request = operation('account-zones')
  const mock = createMockPreviewTransport(credentialEnvironment, [
    exchange(request, fixtureBytes('zones-page.json')),
  ])
  const receipt = await mock.request(request)
  const exposed = `${inspect(receipt)} ${JSON.stringify(receipt)} ${canonicalJson(receipt)}`
  assert.equal(exposed.includes(ACCOUNT_ID), false)
  assert.equal(exposed.includes(ZONE_ID), false)
  assert.equal(exposed.includes(CREDENTIAL_VALUE), false)
  assert.equal(mock.assertExhausted(), true)

  const drift = createMockPreviewTransport(credentialEnvironment, [
    { ...exchange(operation('account')), fault: 'projection-mismatch' },
  ])
  let message = ''
  try { await drift.request(operation('account')) } catch (error) { message = String(error) }
  assert.match(message, /network-failure/)
  assert.equal(message.includes(CREDENTIAL_VALUE), false)
  assert.equal(message.includes(ACCOUNT_ID), false)
  assert.equal(message.includes(ZONE_ID), false)
})

test('mock independently rejects every URL and fetch-option projection mutation', async () => {
  const mutations = [
    ['projection-extra-header', operation('account')],
    ['projection-missing-header', operation('account')],
    ['projection-extra-option', operation('account')],
    ['projection-changed-redirect', operation('account')],
    ['projection-changed-method', operation('account')],
    ['projection-fragment', operation('account')],
    ['projection-url-credentials', operation('account')],
    ['projection-added-query', operation('account-zones')],
    ['projection-altered-post-body', operation('migration-rows')],
    ['projection-missing-body', operation('migration-table-discovery')],
    ['projection-extra-body', operation('account')],
    ['projection-wrong-account', operation('account')],
    ['projection-wrong-zone', operation('worker-routes')],
  ]
  for (const [fault, request] of mutations) {
    const mock = createMockPreviewTransport(credentialEnvironment, [
      { ...exchange(request), fault },
    ])
    let failure
    try { await mock.request(request) } catch (error) { failure = error }
    assert.match(String(failure), /network-failure/)
    assertSensitiveValuesAbsent(failure)
    assert.equal(mock.assertExhausted(), true)
  }
})

test('mock projection oracle is separate from the production HTTP projector', () => {
  const source = readFileSync(
    path.join(REPOSITORY_ROOT, 'scripts/lib/release-inspection/preview-authority.mjs'),
    'utf8',
  )
  const oracleStart = source.indexOf('function authoritativeMockRequest')
  const oracleEnd = source.indexOf('function normalizeExchange')
  assert.ok(oracleStart >= 0 && oracleEnd > oracleStart)
  const oracle = source.slice(oracleStart, oracleEnd)
  assert.doesNotMatch(oracle, /projectHttpRequest/u)
  assert.match(oracle, /PREVIEW_OPERATION_REGISTRY/u)
  assert.match(oracle, /createPreviewOperationRequest/u)
  assert.match(oracle, /Reflect\.ownKeys\(url\)\.length !== 0/u)
  assert.match(oracle, /exactDataKeys\(options, optionKeys\)/u)
  assert.match(oracle, /exactDataKeys\(options\.headers, expectedHeaderKeys\)/u)
})

test('transport rejects arbitrary operation fields before fetch and has no retry', async () => {
  let fetches = 0
  const transport = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async () => {
      fetches += 1
      return new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } })
    },
    setTimer: () => 1,
    clearTimer: () => {},
  })
  for (const invalid of [
    { operation: 'production' },
    { operation: 'account', environment: 'production' },
    { operation: 'account-zones' },
    { operation: 'account-zones', page: 0 },
    { operation: 'worker-routes', routeZoneIndex: 1 },
  ]) await assert.rejects(transport.request(invalid), /invalid-operation/)
  assert.equal(fetches, 0)
})

test('fetch and response-thenable phases are independently deadline raced', async () => {
  for (const fetchImplementation of [
    () => new Promise(() => {}),
    () => ({ then() {} }),
  ]) {
    const manual = manualDeadlineDependencies(fetchImplementation)
    const transport = createSyntheticPreviewHttpTransportForTesting(
      credentialEnvironment,
      manual.dependencies,
    )
    const pending = transport.request(operation('account'))
    await nextTurn()
    assert.equal(manual.callbacks.length, 1)
    manual.callbacks[0]()
    await assert.rejects(pending, /request-timeout/)
  }
})

test('body read, abort-ignoring stream, and never-settling cancel cannot outlive deadline', async () => {
  for (const cancelNeverSettles of [false, true]) {
    const stream = new ReadableStream({
      pull() { return new Promise(() => {}) },
      cancel() { return cancelNeverSettles ? new Promise(() => {}) : undefined },
    })
    const manual = manualDeadlineDependencies(async () => new Response(stream, {
      headers: { 'content-type': 'application/json' },
    }))
    const transport = createSyntheticPreviewHttpTransportForTesting(
      credentialEnvironment,
      manual.dependencies,
    )
    const pending = transport.request(operation('account'))
    await nextTurn()
    manual.callbacks[0]()
    await assert.rejects(Promise.race([
      pending,
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('deadline hung')), 250)),
    ]), /request-timeout/)
  }
})

test('zero-length non-terminal chunks reject immediately without retained empty-chunk growth', async () => {
  for (const mode of ['single-empty', 'endless-empty', 'alternating']) {
    let pulls = 0
    let cancels = 0
    let fetches = 0
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1
        if (mode === 'alternating' && pulls === 1) controller.enqueue(new Uint8Array([0x20]))
        else controller.enqueue(new Uint8Array(0))
        if (mode === 'single-empty') controller.close()
      },
      cancel() {
        cancels += 1
        return new Promise(() => {})
      },
    })
    const transport = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
      fetchImplementation: async () => {
        fetches += 1
        return new Response(stream, { headers: { 'content-type': 'application/json' } })
      },
    })
    await assert.rejects(Promise.race([
      transport.request(operation('account')),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('zero-byte rejection hung')), 250)),
    ]), /non-progressing-response-stream/)
    assert.equal(fetches, 1)
    assert.ok(pulls >= 1 && pulls <= 3)
    assert.ok(cancels === 0 || cancels === 1)
  }
})

test('response read-iteration budget accepts its exact gate and rejects one iteration beyond', async () => {
  const maximum = REMOTE_OBSERVATION_LIMITS.maximumResponseReadIterations
  const envelope = rawEnvelope()
  const byteStream = (byteLength) => {
    const bytes = new Uint8Array(byteLength)
    bytes.fill(0x20)
    bytes.set(envelope, byteLength - envelope.byteLength)
    let cursor = 0
    return new ReadableStream({
      pull(controller) {
        if (cursor === bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(cursor, cursor + 1))
        cursor += 1
      },
    })
  }
  const exactGate = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async () => new Response(byteStream(maximum - 1), {
      headers: { 'content-type': 'application/json' },
    }),
  })
  const accepted = await exactGate.request(operation('account'))
  assert.equal(accepted.bodyBytes, maximum - 1)

  let fetches = 0
  const oneBeyond = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async () => {
      fetches += 1
      return new Response(byteStream(maximum), {
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  await assert.rejects(
    oneBeyond.request(operation('account')),
    /response-read-iterations-exceeded/,
  )
  assert.equal(fetches, 1)
})

test('zero-progress rejection restores the sequential guard with no retry or unhandled rejection', async () => {
  let calls = 0
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const transport = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
      fetchImplementation: async () => {
        calls += 1
        if (calls === 1) {
          return new Response(new ReadableStream({
            pull(controller) { controller.enqueue(new Uint8Array(0)) },
            cancel() { return new Promise(() => {}) },
          }), { headers: { 'content-type': 'application/json' } })
        }
        return new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } })
      },
    })
    await assert.rejects(transport.request(operation('account')), /non-progressing-response-stream/)
    assert.equal((await transport.request(operation('pages-project'))).operation, 'pages-project')
    await nextTurn()
    assert.equal(calls, 2)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('late resolve and reject are contained, request guard recovers, and no retry occurs', async () => {
  let lateResolve
  let calls = 0
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const manual = manualDeadlineDependencies(() => {
      calls += 1
      if (calls === 1) return new Promise((resolve) => { lateResolve = resolve })
      return new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } })
    })
    const transport = createSyntheticPreviewHttpTransportForTesting(
      credentialEnvironment,
      manual.dependencies,
    )
    const first = transport.request(operation('account'))
    await nextTurn()
    manual.callbacks[0]()
    await assert.rejects(first, /request-timeout/)
    const second = await transport.request(operation('pages-project'))
    assert.equal(second.operation, 'pages-project')
    lateResolve(new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } }))

    let lateReject
    const rejectingManual = manualDeadlineDependencies(() => new Promise((resolve, reject) => {
      lateReject = reject
    }))
    const rejecting = createSyntheticPreviewHttpTransportForTesting(
      credentialEnvironment,
      rejectingManual.dependencies,
    )
    const pendingReject = rejecting.request(operation('account'))
    await nextTurn()
    rejectingManual.callbacks[0]()
    await assert.rejects(pendingReject, /request-timeout/)
    lateReject(new Error('late synthetic rejection'))
    await nextTurn()
    assert.equal(calls, 2)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('transport remains sequential and enforces request, total-time, status, content, and size bounds', async () => {
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const concurrent = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async () => {
      await waiting
      return new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } })
    },
    setTimer: () => 1,
    clearTimer: () => {},
  })
  const first = concurrent.request(operation('account'))
  await assert.rejects(concurrent.request(operation('pages-project')), /concurrent-request-prohibited/)
  release()
  await first

  for (const [fault, code] of [
    ['truncated', 'truncated-response'],
    ['redirect', 'redirect-rejected'],
    ['http-failure', 'http-status'],
    ['oversized-body', 'response-size-exceeded'],
  ]) {
    const mock = createMockPreviewTransport(credentialEnvironment, [
      { ...exchange(operation('account')), fault },
    ])
    await assert.rejects(mock.request(operation('account')), new RegExp(code))
  }
  const contentType = createMockPreviewTransport(credentialEnvironment, [
    { ...exchange(operation('account')), contentType: 'text/html' },
  ])
  await assert.rejects(contentType.request(operation('account')), /invalid-content-type/)

  let fetches = 0
  const budgeted = createSyntheticPreviewHttpTransportForTesting(credentialEnvironment, {
    fetchImplementation: async () => {
      fetches += 1
      return new Response(rawEnvelope(), { headers: { 'content-type': 'application/json' } })
    },
    setTimer: () => 1,
    clearTimer: () => {},
  })
  for (let index = 0; index < REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead; index += 1) {
    await budgeted.request(operation('account'))
  }
  await assert.rejects(budgeted.request(operation('account')), /request budget is exhausted/)
  assert.equal(fetches, REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead)
})

test('transport failures disclose no credential, account, zone, URL, body, or provider message', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    success: false,
    errors: [{ message: `${ACCOUNT_ID}-${ZONE_ID}-${CREDENTIAL_VALUE}` }],
    messages: [{ message: 'provider-private-message' }],
    result: null,
  }))
  const mock = createMockPreviewTransport(credentialEnvironment, [exchange(operation('worker-routes'), bytes)])
  let message = ''
  try { await mock.request(operation('worker-routes')) } catch (error) { message = String(error) }
  assert.notEqual(message, '')
  for (const secret of [ACCOUNT_ID, ZONE_ID, CREDENTIAL_VALUE, 'provider-private-message', '/client/v4/']) {
    assert.equal(message.includes(secret), false)
  }
})

test('raw-byte transport refuses malformed remote data and credential echo', async () => {
  const sources = [
    new Uint8Array([0xFF]),
    new TextEncoder().encode('{'),
    new TextEncoder().encode('{"success":true,"success":true,"errors":[],"messages":[],"result":[]}'),
    new TextEncoder().encode('{"success":true,"errors":[],"messages":[],"result":{"__proto__":{}}}'),
    new TextEncoder().encode('{"success":false,"errors":[{"code":1000}],"messages":[],"result":null}'),
  ]
  for (const bytes of sources) {
    const mock = createMockPreviewTransport(credentialEnvironment, [exchange(operation('account'), bytes)])
    await assert.rejects(mock.request(operation('account')), /malformed-response|provider-response-failure/)
  }
  const echo = createMockPreviewTransport(credentialEnvironment, [
    exchange(operation('account'), rawEnvelope({ echo: CREDENTIAL_VALUE })),
  ])
  await assert.rejects(echo.request(operation('account')), /credential-echo-rejected/)
})

test('fixture catalog is complete, synthetic, strict, and Preview-only', () => {
  const index = parseStrictJson(readFileSync(path.join(FIXTURE_ROOT, 'index.json'), 'utf8'), {
    label: 'Preview fixture index',
    error: (message) => new TypeError(message),
  })
  assert.equal(index.schemaVersion, 1)
  assert.deepEqual(Object.keys(index.fixtures).sort(), [
    'account',
    'account-zones',
    'backend-schema-version',
    'd1-database',
    'migration-rows',
    'migration-table-discovery',
    'pages-preview-deployments',
    'pages-project',
    'worker-custom-domains',
    'worker-deployments',
    'worker-routes',
    'worker-schedules',
    'worker-settings',
    'worker-subdomain',
  ])
  for (const file of Object.values(index.fixtures)) {
    const bytes = fixtureBytes(file)
    assert.ok(bytes.byteLength > 0 && bytes.byteLength < 4_096)
    assert.equal(parseStrictRemoteJson(bytes).success, true)
    const source = new TextDecoder().decode(bytes).toLowerCase()
    assert.equal(source.includes('pennant-pursuit-production'), false)
    assert.equal(source.includes('4b821c17-b88b-462d-a2ed-c6a2113cc362'), false)
    assert.equal(source.includes('bearer '), false)
  }
})

test('runtime and declaration public export surfaces remain exact', async () => {
  const inventories = [
    ['preview-observation-contracts', [
      'PREVIEW_RESOURCE_OUTCOME_STATES',
      'PREVIEW_SINGLE_READ_KIND',
      'PREVIEW_SINGLE_READ_SCHEMA_VERSION',
      'createPreviewSingleReadSnapshot',
      'renderPreviewSingleReadJson',
      'validatePreviewSingleReadSnapshot',
    ]],
    ['preview-identity', ['loadPreviewObservationIdentity', 'validatePreviewObservationIdentity']],
    ['preview-http-transport', ['createPreviewHttpTransport']],
    ['preview-resource-observer', ['observePreviewResourcesWithTransport']],
  ]
  for (const [name, expected] of inventories) {
    const runtime = await import(`./lib/release-inspection/${name}.mjs`)
    assert.deepEqual(Object.keys(runtime).sort(), [...expected].sort())
    const declaration = readFileSync(
      path.join(REPOSITORY_ROOT, `scripts/lib/release-inspection/${name}.d.mts`),
      'utf8',
    )
    const declared = [...declaration.matchAll(/export (?:const|function) ([A-Za-z0-9_]+)/gu)]
      .map((match) => match[1])
      .sort()
    assert.deepEqual(declared, [...expected].sort())
  }
})

test('new source graph is dormant, local-only, and avoids raw response convenience readers', () => {
  const files = [
    'scripts/lib/release-inspection/preview-observation-contracts.mjs',
    'scripts/lib/release-inspection/preview-identity.mjs',
    'scripts/lib/release-inspection/preview-http-transport.mjs',
    'scripts/lib/release-inspection/preview-authority.mjs',
    'scripts/lib/release-inspection/preview-d1-observer.mjs',
    'scripts/lib/release-inspection/preview-normalization.mjs',
    'scripts/lib/release-inspection/preview-pages-observer.mjs',
    'scripts/lib/release-inspection/preview-provider-normalizers.mjs',
    'scripts/lib/release-inspection/preview-resource-observer.mjs',
    'scripts/lib/release-inspection/preview-resource-schemas.mjs',
    'scripts/lib/release-inspection/preview-worker-observer.mjs',
    'scripts/lib/release-inspection/production-poisoning.mjs',
    'scripts/lib/release-inspection/testing/mock-preview-transport.mjs',
  ]
  for (const file of files) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8')
    assert.doesNotMatch(source, /(?:child_process|cloudflare-readonly|release-execution|preview-plan|reporting\.mjs|artifacts\.mjs)/u)
    assert.doesNotMatch(source, /(?:from|import)\s*['"][^'"]*wrangler/iu)
    assert.doesNotMatch(source, /(?:writeFile|appendFile|mkdir|rmSync|unlink|renameSync|spawn|execFile)/u)
  }
  const source = readFileSync(
    path.join(REPOSITORY_ROOT, 'scripts/lib/release-inspection/preview-authority.mjs'),
    'utf8',
  )
  assert.doesNotMatch(source, /await\s+(?:response\.)?(?:json|text|arrayBuffer)\(/u)
})

test('reviewed request and response budgets remain fixed', () => {
  assert.equal(REMOTE_OBSERVATION_LIMITS.maximumRequestsPerFullRead, 64)
  assert.equal(REMOTE_OBSERVATION_LIMITS.concurrency, 1)
  assert.equal(REMOTE_OBSERVATION_LIMITS.automaticRetries, 0)
  assert.equal(REMOTE_OBSERVATION_LIMITS.requestTimeoutMs, 10_000)
  assert.equal(REMOTE_OBSERVATION_LIMITS.maximumResponseBytes, 1_048_576)
  assert.equal(REMOTE_OBSERVATION_LIMITS.maximumResponseReadIterations, 4_096)
  assert.equal(REMOTE_OBSERVATION_LIMITS.maximumSerializedObservationBytes, 1_048_576)
})
