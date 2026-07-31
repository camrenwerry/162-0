import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertIndependentSchema4AuthorityModel,
  createDisabledSchema4Authority,
  evaluateSchema4ActivationAuthority,
  parseSchema4CapabilityModel,
  SCHEMA4_AUTHORITY_MAX_TTL_MS,
  SCHEMA4_CAPABILITIES,
} from './lib/schema4-activation-authority.mjs'
import {
  decodeStrictUtf8,
  immutablePlain,
  parseStrictJson,
  readStrictPackageMetadataFile,
  readStrictJsonFile,
  STRICT_JSON_LIMITS,
} from './lib/preview-release/canonical.mjs'

const NOW = Date.UTC(2026, 6, 31, 12)
const EXPECTED_CAPABILITIES = Object.freeze([
  'leaderboardRead',
  'identityClaim',
  'identityStatus',
  'identityRename',
  'draftSubmission',
  'identityRecovery',
  'cleanupCron',
])
assert.equal(SCHEMA4_CAPABILITIES.length, 7)
assert.deepEqual(SCHEMA4_CAPABILITIES, EXPECTED_CAPABILITIES)

function capabilities(mode = 'disabled') {
  return Object.fromEntries(SCHEMA4_CAPABILITIES.map((capability) => [capability, mode]))
}

function authority(overrides = {}) {
  return {
    schemaVersion: 1,
    environment: 'preview',
    reviewedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    emergencyStop: 'clear',
    identityCompatibilityMode: 'enabled',
    capabilities: capabilities(),
    ...overrides,
  }
}

const model = assertIndependentSchema4AuthorityModel(NOW)
assert.deepEqual(model.environments, ['preview', 'production'])
assert.deepEqual(model.capabilities, SCHEMA4_CAPABILITIES)

const protectedModelSource = readFileSync('workers/draft-validation/d1c4-activation-states.json', 'utf8')
const protectedModel = parseSchema4CapabilityModel(protectedModelSource, NOW)
assert.equal(protectedModel.modelVersion, 2)
assert.deepEqual(Object.keys(protectedModel.environments), ['preview', 'production'])
assert.equal(Object.isFrozen(protectedModel.environments.preview.capabilities), true)
for (const environment of ['preview', 'production']) {
  assert.deepEqual(protectedModel.environments[environment], createDisabledSchema4Authority(environment))
}

for (const mutate of [
  (value) => { delete value.maximumReviewWindowMs },
  (value) => { value.extra = true },
  (value) => { value.modelVersion = 3 },
  (value) => { value.authoritySchemaVersion = 2 },
  (value) => { value.maximumReviewWindowMs += 1 },
  (value) => { value.canonicalState = 'enabled' },
  (value) => { delete value.environments.production },
  (value) => { value.environments.staging = createDisabledSchema4Authority('preview') },
  (value) => { value.environments.preview.environment = 'production' },
]) {
  const candidate = JSON.parse(protectedModelSource)
  mutate(candidate)
  assert.throws(() => parseSchema4CapabilityModel(JSON.stringify(candidate), NOW), /capability model|checked-in authority/i)
}
assert.throws(
  () => parseSchema4CapabilityModel(protectedModelSource.replace('"modelVersion": 2,', '"modelVersion": 2,\n  "modelVersion": 2,'), NOW),
  /duplicate object key/,
)

for (const environment of ['preview', 'production']) {
  const disabled = evaluateSchema4ActivationAuthority(
    createDisabledSchema4Authority(environment),
    { expectedEnvironment: environment, nowMs: NOW },
  )
  assert.equal(disabled.valid, true)
  assert.equal(disabled.reason, 'emergency_stop_engaged')
  assert.deepEqual(disabled.capabilities, capabilities())
}

const partial = authority({
  capabilities: {
    ...capabilities(),
    leaderboardRead: 'enabled',
    identityStatus: 'enabled',
    draftSubmission: 'enabled',
  },
})
const partialResult = evaluateSchema4ActivationAuthority(partial, {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(partialResult.valid, true)
assert.equal(partialResult.capabilities.leaderboardRead, 'enabled')
assert.equal(partialResult.capabilities.identityClaim, 'disabled')
assert.equal(partialResult.capabilities.identityStatus, 'enabled')
assert.equal(partialResult.capabilities.identityRename, 'disabled')
assert.equal(partialResult.capabilities.draftSubmission, 'enabled')
assert.equal(partialResult.capabilities.identityRecovery, 'disabled')
assert.equal(partialResult.capabilities.cleanupCron, 'disabled')

for (const enabledCapability of SCHEMA4_CAPABILITIES) {
  const enabled = capabilities()
  enabled[enabledCapability] = 'enabled'
  const evaluated = evaluateSchema4ActivationAuthority(authority({ capabilities: enabled }), {
    expectedEnvironment: 'preview',
    nowMs: NOW,
  })
  assert.equal(evaluated.valid, true, enabledCapability)
  for (const capability of SCHEMA4_CAPABILITIES) {
    assert.equal(evaluated.capabilities[capability], capability === enabledCapability ? 'enabled' : 'disabled')
  }
}

const broadOnly = evaluateSchema4ActivationAuthority(authority(), {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(broadOnly.valid, true)
assert.deepEqual(broadOnly.capabilities, capabilities())

const recoveryWithoutCompatibility = evaluateSchema4ActivationAuthority(authority({
  identityCompatibilityMode: 'disabled',
  capabilities: { ...capabilities(), identityRecovery: 'enabled' },
}), {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(recoveryWithoutCompatibility.valid, false)
assert.equal(recoveryWithoutCompatibility.reason, 'identity_compatibility_ceiling_disabled')
assert.deepEqual(recoveryWithoutCompatibility.capabilities, capabilities())

for (const identityCapability of ['identityClaim', 'identityStatus', 'identityRename', 'identityRecovery']) {
  const identityModes = capabilities()
  identityModes[identityCapability] = 'enabled'
  const evaluated = evaluateSchema4ActivationAuthority(authority({
    identityCompatibilityMode: 'disabled',
    capabilities: identityModes,
  }), { expectedEnvironment: 'preview', nowMs: NOW })
  assert.equal(evaluated.valid, false, identityCapability)
  assert.equal(evaluated.reason, 'identity_compatibility_ceiling_disabled', identityCapability)
  assert.deepEqual(evaluated.capabilities, capabilities(), identityCapability)
}

for (const [label, input, options, reason] of [
  ['missing', undefined, { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['partial object', { schemaVersion: 1 }, { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['unknown field', { ...authority(), unknown: true }, { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['missing capability', authority({ capabilities: Object.fromEntries(Object.entries(capabilities()).slice(1)) }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['extra capability', authority({ capabilities: { ...capabilities(), futureCapability: 'disabled' } }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['unsupported version', authority({ schemaVersion: 2 }), { expectedEnvironment: 'preview', nowMs: NOW }, 'unsupported_schema_version'],
  ['unknown mode', authority({ capabilities: { ...capabilities(), identityClaim: 'yes' } }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_authority'],
  ['Preview to Production', authority(), { expectedEnvironment: 'production', nowMs: NOW }, 'environment_mismatch'],
  ['Production to Preview', authority({ environment: 'production' }), { expectedEnvironment: 'preview', nowMs: NOW }, 'environment_mismatch'],
  ['stale', authority({ expiresAtMs: NOW }), { expectedEnvironment: 'preview', nowMs: NOW }, 'stale_authority'],
  ['future review', authority({ reviewedAtMs: NOW + 1 }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_freshness_window'],
  ['oversized TTL', authority({ expiresAtMs: NOW - 1_000 + SCHEMA4_AUTHORITY_MAX_TTL_MS + 1 }), { expectedEnvironment: 'preview', nowMs: NOW }, 'malformed_freshness_window'],
  ['invalid expected environment', authority(), { expectedEnvironment: 'test', nowMs: NOW }, 'invalid_expected_environment'],
  ['invalid evaluation time', authority(), { expectedEnvironment: 'preview', nowMs: Number.NaN }, 'invalid_evaluation_time'],
]) {
  const evaluated = evaluateSchema4ActivationAuthority(input, options)
  assert.equal(evaluated.valid, false, label)
  assert.equal(evaluated.reason, reason, label)
  assert.deepEqual(evaluated.capabilities, capabilities(), label)
}

const contradictoryStop = evaluateSchema4ActivationAuthority({
  ...createDisabledSchema4Authority('preview'),
  capabilities: { ...capabilities(), cleanupCron: 'enabled' },
}, {
  expectedEnvironment: 'preview',
  nowMs: NOW,
})
assert.equal(contradictoryStop.valid, false)
assert.equal(contradictoryStop.reason, 'contradictory_emergency_state')
assert.deepEqual(contradictoryStop.capabilities, capabilities())

const exactMaximumWindow = evaluateSchema4ActivationAuthority(authority({
  reviewedAtMs: NOW,
  expiresAtMs: NOW + SCHEMA4_AUTHORITY_MAX_TTL_MS,
}), { expectedEnvironment: 'preview', nowMs: NOW })
assert.equal(exactMaximumWindow.valid, true)
assert.equal(exactMaximumWindow.reason, 'reviewed_authority')

let accessorInvocations = 0
const accessorCapabilities = capabilities()
Object.defineProperty(accessorCapabilities, 'identityClaim', {
  enumerable: true,
  configurable: true,
  get() {
    accessorInvocations += 1
    return accessorInvocations === 1 ? 'disabled' : 'enabled'
  },
})
const accessorResult = evaluateSchema4ActivationAuthority(
  authority({ capabilities: accessorCapabilities }),
  { expectedEnvironment: 'preview', nowMs: NOW },
)
assert.equal(accessorResult.valid, false)
assert.equal(accessorResult.reason, 'malformed_authority')
assert.deepEqual(accessorResult.capabilities, capabilities())
assert.equal(accessorInvocations, 0)

let throwingGetterInvocations = 0
const throwingGetter = authority()
Object.defineProperty(throwingGetter, 'emergencyStop', {
  enumerable: true,
  get() {
    throwingGetterInvocations += 1
    throw new Error('must not execute')
  },
})
assert.equal(evaluateSchema4ActivationAuthority(throwingGetter, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).valid, false)
assert.equal(throwingGetterInvocations, 0)

const nullPrototype = Object.assign(Object.create(null), authority())
assert.equal(evaluateSchema4ActivationAuthority(nullPrototype, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).reason, 'malformed_authority')
const customPrototype = Object.create({ inherited: 'state' })
Object.assign(customPrototype, authority())
assert.equal(evaluateSchema4ActivationAuthority(customPrototype, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).reason, 'malformed_authority')
const inheritedCapabilities = Object.create({ identityClaim: 'enabled' })
Object.assign(inheritedCapabilities, capabilities())
delete inheritedCapabilities.identityClaim
assert.equal(evaluateSchema4ActivationAuthority(authority({ capabilities: inheritedCapabilities }), {
  expectedEnvironment: 'preview', nowMs: NOW,
}).reason, 'malformed_authority')
const symbolAuthority = authority()
symbolAuthority[Symbol('hidden')] = 'enabled'
assert.equal(evaluateSchema4ActivationAuthority(symbolAuthority, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).reason, 'malformed_authority')
let proxyTrapInvocations = 0
const unstableProxy = new Proxy(authority(), {
  ownKeys(target) {
    proxyTrapInvocations += 1
    return Reflect.ownKeys(target)
  },
  get(target, property, receiver) {
    proxyTrapInvocations += 1
    return Reflect.get(target, property, receiver)
  },
})
assert.equal(evaluateSchema4ActivationAuthority(unstableProxy, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).reason, 'malformed_authority')
assert.equal(proxyTrapInvocations, 0)
const frozenValidAuthority = immutablePlain(authority())
assert.equal(Object.isFrozen(frozenValidAuthority.capabilities), true)
assert.equal(evaluateSchema4ActivationAuthority(frozenValidAuthority, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).valid, true)
const parsedValidAuthority = JSON.parse(JSON.stringify(authority()))
assert.equal(evaluateSchema4ActivationAuthority(parsedValidAuthority, {
  expectedEnvironment: 'preview', nowMs: NOW,
}).valid, true)

const parserLimits = (maxBytes, maxDepth = 4, maxNodes = 16) => ({ maxBytes, maxDepth, maxNodes })
const exactSizedJson = '{"a":1}'
assert.deepEqual(parseStrictJson(exactSizedJson, { limits: parserLimits(7) }), { a: 1 })
assert.throws(() => parseStrictJson(exactSizedJson, { limits: parserLimits(6) }), /byte limit/)
assert.deepEqual(parseStrictJson('{"a":{"b":0}}', { limits: parserLimits(64, 2, 3) }), { a: { b: 0 } })
assert.throws(() => parseStrictJson('{"a":{"b":0}}', { limits: parserLimits(64, 1, 3) }), /nesting depth/)
assert.throws(() => parseStrictJson('{"a":{"b":0}}', { limits: parserLimits(64, 2, 2) }), /node count/)
for (const [source, pattern] of [
  ['\uFEFF{}', /BOM/],
  ['{"a":"\0"}', /NUL/],
  ['{"a":"\uFFFD"}', /replacement character/],
  [String.raw`{"value":"\u0000"}`, /NUL/],
  [String.raw`{"\u0000":1}`, /NUL/],
  [String.raw`{"value":"\uFFFD"}`, /replacement character/],
  [String.raw`{"\uFFFD":1}`, /replacement character/],
  [String.raw`{"a":"\uD800"}`, /surrogate|malformed string/],
  [String.raw`{"a":"\uDC00"}`, /surrogate|malformed string/],
  ['{"a":{"b":1,"b":2}}', /duplicate object key/],
  ['{"a":{"constructor":1}}', /dangerous object key/],
  ['{"a":{"prototype":1}}', /dangerous object key/],
  ['{"a":{"__proto__":1}}', /dangerous object key/],
  ['{} true', /trailing content/],
  ['{"a":}', /unexpected token/],
]) assert.throws(() => parseStrictJson(source, { limits: parserLimits(256) }), pattern)
assert.deepEqual(
  parseStrictJson(String.raw`{"text":"baseball ⚾ \uD83D\uDE00"}`, { limits: parserLimits(128) }),
  { text: 'baseball ⚾ 😀' },
)
for (const [category, limits] of Object.entries(STRICT_JSON_LIMITS)) {
  const bytePrefix = '{"padding":"'
  const byteSuffix = '"}'
  const exactByteSource = `${bytePrefix}${'a'.repeat(
    limits.maxBytes - Buffer.byteLength(bytePrefix + byteSuffix),
  )}${byteSuffix}`
  assert.equal(Buffer.byteLength(exactByteSource), limits.maxBytes, `${category} exact bytes`)
  assert.doesNotThrow(() => parseStrictJson(exactByteSource, { limits }), `${category} exact bytes`)
  assert.throws(() => parseStrictJson(`${exactByteSource} `, { limits }), /byte limit/, `${category} bytes + 1`)

  const exactDepthSource = `${'['.repeat(limits.maxDepth)}0${']'.repeat(limits.maxDepth)}`
  const excessiveDepthSource = `[${exactDepthSource}]`
  assert.doesNotThrow(() => parseStrictJson(exactDepthSource, { limits }), `${category} exact depth`)
  assert.throws(
    () => parseStrictJson(excessiveDepthSource, { limits }),
    /nesting depth/,
    `${category} depth + 1`,
  )

  const exactNodeSource = `[${Array(limits.maxNodes - 1).fill('0').join(',')}]`
  const excessiveNodeSource = `[${Array(limits.maxNodes).fill('0').join(',')}]`
  assert.doesNotThrow(() => parseStrictJson(exactNodeSource, { limits }), `${category} exact nodes`)
  assert.throws(
    () => parseStrictJson(excessiveNodeSource, { limits }),
    /node count/,
    `${category} nodes + 1`,
  )
}

const parserDirectory = mkdtempSync(path.join(tmpdir(), 'pp-strict-json-'))
try {
  const validPath = path.join(parserDirectory, 'valid.json')
  writeFileSync(validPath, exactSizedJson)
  assert.deepEqual(readStrictJsonFile(validPath, {
    limits: parserLimits(7),
  }).value, { a: 1 })
  assert.throws(() => readStrictJsonFile(validPath, {
    limits: parserLimits(6),
  }), /byte limit/)
  const invalidUtf8Path = path.join(parserDirectory, 'invalid-utf8.json')
  writeFileSync(invalidUtf8Path, new Uint8Array([0x7B, 0xFF, 0x7D]))
  assert.throws(() => readStrictJsonFile(invalidUtf8Path, {
    limits: parserLimits(3),
  }), /valid UTF-8/)
  assert.throws(() => decodeStrictUtf8(new Uint8Array([0xEF, 0xBB, 0xBF, 0x7B, 0x7D])), /BOM/)

  const packageMetadataPath = path.join(parserDirectory, 'package-metadata.json')
  writeFileSync(packageMetadataPath, '{"name":"pennant ⚾","version":"1.0.0","scripts":{"test":"node test.mjs"}}')
  assert.deepEqual(
    readStrictPackageMetadataFile(packageMetadataPath, { requireScripts: true }).value,
    { name: 'pennant ⚾', scripts: { test: 'node test.mjs' }, version: '1.0.0' },
  )
  for (const [name, source, pattern] of [
    ['malformed', '{', /strict grammar/],
    ['duplicate', '{"name":"p","name":"q","version":"1"}', /duplicate object key/],
    ['dangerous', '{"name":"p","version":"1","constructor":{}}', /dangerous object key/],
    ['escaped-nul', String.raw`{"name":"p\u0000","version":"1"}`, /NUL/],
    ['release-replay', '{"schemaVersion":2,"kind":"preview-release-package"}', /package metadata object/],
  ]) {
    const candidate = path.join(parserDirectory, `${name}.json`)
    writeFileSync(candidate, source)
    assert.throws(() => readStrictPackageMetadataFile(candidate), pattern, name)
  }
  const metadataPrefix = '{"name":"p","padding":"'
  const metadataSuffix = '","version":"1"}'
  const exactMetadataSource = `${metadataPrefix}${'a'.repeat(
    STRICT_JSON_LIMITS.packageMetadata.maxBytes - Buffer.byteLength(metadataPrefix + metadataSuffix),
  )}${metadataSuffix}`
  assert.equal(Buffer.byteLength(exactMetadataSource), STRICT_JSON_LIMITS.packageMetadata.maxBytes)
  const exactMetadataPath = path.join(parserDirectory, 'exact-package-metadata.json')
  writeFileSync(exactMetadataPath, exactMetadataSource)
  assert.equal(readStrictPackageMetadataFile(exactMetadataPath).value.name, 'p')
  const oversizedMetadataPath = path.join(parserDirectory, 'oversized-package-metadata.json')
  writeFileSync(oversizedMetadataPath, `${exactMetadataSource} `)
  assert.throws(() => readStrictPackageMetadataFile(oversizedMetadataPath), /byte limit/)

  const depthAtBoundary = `${'{"name":"p","version":"1","nested":'}${'['.repeat(15)}null${']'.repeat(15)}}`
  const depthPastBoundary = `${'{"name":"p","version":"1","nested":'}${'['.repeat(16)}null${']'.repeat(16)}}`
  assert.doesNotThrow(() => parseStrictJson(depthAtBoundary, {
    limits: STRICT_JSON_LIMITS.packageMetadata,
  }))
  assert.throws(() => parseStrictJson(depthPastBoundary, {
    limits: STRICT_JSON_LIMITS.packageMetadata,
  }), /nesting depth/)
  const nodesAtBoundary = `[${Array(STRICT_JSON_LIMITS.packageMetadata.maxNodes - 1).fill('0').join(',')}]`
  const nodesPastBoundary = `[${Array(STRICT_JSON_LIMITS.packageMetadata.maxNodes).fill('0').join(',')}]`
  assert.doesNotThrow(() => parseStrictJson(nodesAtBoundary, {
    limits: STRICT_JSON_LIMITS.packageMetadata,
  }))
  assert.throws(() => parseStrictJson(nodesPastBoundary, {
    limits: STRICT_JSON_LIMITS.packageMetadata,
  }), /node count/)

  const directoryPath = path.join(parserDirectory, 'directory.json')
  mkdirSync(directoryPath)
  assert.throws(() => readStrictPackageMetadataFile(directoryPath), /regular/)
  const symlinkPath = path.join(parserDirectory, 'symlink.json')
  symlinkSync(packageMetadataPath, symlinkPath)
  assert.throws(() => readStrictPackageMetadataFile(symlinkPath), /regular|symbolic/)

  assert.equal(
    readStrictPackageMetadataFile(path.resolve('package.json'), { requireScripts: true }).value.name,
    'pennant-pursuit',
  )
  assert.equal(
    readStrictPackageMetadataFile(path.resolve('package-lock.json'), { requireLockfile: true }).value.lockfileVersion,
    3,
  )
  assert.equal(
    readStrictPackageMetadataFile(path.resolve('node_modules/wrangler/package.json')).value.name,
    'wrangler',
  )
} finally {
  rmSync(parserDirectory, { recursive: true, force: true })
}

for (const timestamps of [
  { reviewedAtMs: NOW - 1_000, expiresAtMs: null },
  { reviewedAtMs: null, expiresAtMs: NOW + 1_000 },
  { reviewedAtMs: NOW - 1_000, expiresAtMs: NOW + 1_000 },
]) {
  const evaluated = evaluateSchema4ActivationAuthority({
    ...createDisabledSchema4Authority('preview'),
    ...timestamps,
  }, { expectedEnvironment: 'preview', nowMs: NOW })
  assert.equal(evaluated.valid, false)
  assert.equal(evaluated.reason, 'contradictory_emergency_state')
  assert.deepEqual(evaluated.capabilities, capabilities())
}

const authorityDocuments = [
  'README.md',
  'docs/BACKEND_OPERATIONS.md',
  'docs/LEADERBOARD_BACKEND.md',
  'docs/MILESTONE_3C1_LOCAL_RUNTIME.md',
  'docs/MILESTONE_3C3_SCHEMA4_AUTHORITY.md',
  'docs/MILESTONE_3D1_PROTECTED_CAPABILITY_MODEL.md',
]
for (const document of authorityDocuments) {
  const source = readFileSync(document, 'utf8')
  for (const capability of SCHEMA4_CAPABILITIES) {
    assert(
      source.includes(`\`${capability}\``),
      `${document} is missing canonical capability ${capability}`,
    )
  }
  assert.doesNotMatch(source, /\?capability=recovery\b/)
}
const healthSource = readFileSync('functions/api/v1/health.ts', 'utf8')
const privateWorkerSource = readFileSync('workers/draft-validation/src/index.ts', 'utf8')
assert.match(healthSource, /\?capability=\$\{capability\}/)
assert.match(healthSource, /'claim' \| 'recover' \| 'rename' \| 'status'/)
assert.match(privateWorkerSource, /\?\? 'status'/)
assert.match(privateWorkerSource, /requestedCapability === 'availability'/)
assert.match(
  readFileSync('docs/MILESTONE_3C1_LOCAL_RUNTIME.md', 'utf8'),
  /\?capability=recover/,
)

console.log('Schema-4 activation authority tests passed: all 256 environment/capability combinations remain independent, exact fail-closed parsing is enforced, stale and unsupported state is refused, and emergency rollback disables every capability.')
