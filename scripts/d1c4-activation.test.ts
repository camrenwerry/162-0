import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  loadProtectedCapabilityInputs,
  validateProtectedCapabilityFoundation,
} from './prepare-d1c4-activation.mjs'
import { SCHEMA4_CAPABILITIES } from './lib/schema4-activation-authority.mjs'
import {
  commonTargetFromArguments,
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  parseStrictArguments,
  readConfiguredPreviewIdentities,
  validatePreviewSmokeTarget,
} from './lib/d1c4-preview-guard'
import { submissionSmokeCli } from './d1c4-submission-smoke'
import { retentionSmokeCli } from './d1c4-retention-smoke'

const inputs = loadProtectedCapabilityInputs()
const foundation = validateProtectedCapabilityFoundation(inputs)
assert.equal(foundation.capabilityModel.modelVersion, 2)
assert.deepEqual(Object.keys(foundation.capabilityModel.environments), ['preview', 'production'])
for (const environment of ['preview', 'production'] as const) {
  const authority = foundation.capabilityModel.environments[environment]
  assert.equal(authority.environment, environment)
  assert.equal(authority.emergencyStop, 'engaged')
  assert.equal(authority.identityCompatibilityMode, 'disabled')
  assert.equal(authority.reviewedAtMs, null)
  assert.equal(authority.expiresAtMs, null)
  for (const capability of SCHEMA4_CAPABILITIES) assert.equal(authority.capabilities[capability], 'disabled')
}
assert.match(inputs.workerConfig, /^\[triggers\]\ncrons = \[\]$/m)
assert.match(inputs.workerConfig, /^\[env\.production\.triggers\]\ncrons = \[\]$/m)
assert.doesNotMatch(inputs.pagesConfig, /^\[triggers\]$|^crons\s*=/m)

type MutableCapabilityModel = {
  modelVersion: number
  environments: Record<'preview' | 'production', {
    environment: string
    emergencyStop: string
    identityCompatibilityMode: string
    reviewedAtMs: number | null
    expiresAtMs: number | null
    capabilities: Record<string, string>
  }>
}

function changedModel(change: (model: MutableCapabilityModel) => void) {
  const model = JSON.parse(inputs.capabilityModelSource) as MutableCapabilityModel
  change(model)
  return { ...inputs, capabilityModelSource: JSON.stringify(model) }
}

for (const environment of ['preview', 'production'] as const) {
  for (const capability of SCHEMA4_CAPABILITIES) {
    assert.throws(() => validateProtectedCapabilityFoundation(changedModel((model) => {
      model.environments[environment].capabilities[capability] = 'enabled'
    })), /all-disabled/)
  }
}
for (const candidate of [
  changedModel((model) => { delete model.environments.preview.capabilities.identityClaim }),
  changedModel((model) => { model.environments.preview.capabilities.unknownCapability = 'disabled' }),
  changedModel((model) => { model.environments.preview.capabilities.identityClaim = 'ENABLED' }),
  changedModel((model) => { model.environments.preview.environment = 'production' }),
  changedModel((model) => { model.environments.preview.reviewedAtMs = Date.now() + 1_000 }),
  changedModel((model) => { model.environments.preview.expiresAtMs = Date.now() + 1_000 }),
  changedModel((model) => { model.modelVersion = 3 }),
]) assert.throws(() => validateProtectedCapabilityFoundation(candidate))

const duplicateCapability = inputs.capabilityModelSource.replace(
  '"leaderboardRead": "disabled",',
  '"leaderboardRead": "disabled",\n        "leaderboardRead": "disabled",',
)
assert.throws(
  () => validateProtectedCapabilityFoundation({ ...inputs, capabilityModelSource: duplicateCapability }),
  /duplicate object key/,
)

for (const candidate of [
  { ...inputs, pagesConfig: inputs.pagesConfig.replace('LEADERBOARD_READ_MODE = "disabled"\n', '') },
  { ...inputs, pagesConfig: inputs.pagesConfig.replace('LEADERBOARD_READ_MODE = "disabled"', 'LEADERBOARD_READ_MODE = "enabled"') },
  { ...inputs, pagesConfig: inputs.pagesConfig.replace('LEADERBOARD_READ_MODE = "disabled"', 'LEADERBOARD_READ_MODE = "disabled"\nFUTURE_CAPABILITY_MODE = "disabled"') },
  { ...inputs, pagesConfig: inputs.pagesConfig.replace('LEADERBOARD_ENVIRONMENT = "preview"', 'LEADERBOARD_ENVIRONMENT = "production"') },
  { ...inputs, workerConfig: inputs.workerConfig.replace('RETENTION_CLEANUP_MODE = "disabled"\n', '') },
  { ...inputs, workerConfig: inputs.workerConfig.replace('RETENTION_CLEANUP_MODE = "disabled"', 'RETENTION_CLEANUP_MODE = "enabled"') },
  { ...inputs, workerConfig: inputs.workerConfig.replace('crons = []', 'crons = ["17 * * * *"]') },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[[env.production.d1_databases]]\nbinding = "DB"\n` },
]) assert.throws(() => validateProtectedCapabilityFoundation(candidate))

const workerRootSetting = (setting: string) => inputs.workerConfig.replace(
  'preview_urls = false\n\n[vars]',
  `preview_urls = false\n${setting}\n\n[vars]`,
)
const unsafeTopologyCandidates = [
  { ...inputs, workerConfig: workerRootSetting('routes = []') },
  {
    ...inputs,
    workerConfig: workerRootSetting(
      'routes = [{ pattern = "validation.example.invalid/*", custom_domain = true }]',
    ),
  },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[[kv_namespaces]]\nbinding = "CACHE"\nid = "fixture"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[[r2_buckets]]\nbinding = "BUCKET"\nbucket_name = "fixture"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[durable_objects]\nbindings = []\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[queues]\nproducers = []\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[[analytics_engine_datasets]]\nbinding = "ANALYTICS"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[browser]\nbinding = "BROWSER"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[ai]\nbinding = "AI"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "fixture"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[[future_bindings]]\nbinding = "FUTURE"\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[env.staging]\nworkers_dev = true\n` },
  { ...inputs, workerConfig: `${inputs.workerConfig}\n[env.production.ai]\nbinding = "AI"\n` },
  {
    ...inputs,
    workerConfig: inputs.workerConfig.replace(
      'binding = "DB"',
      'binding = "DRAFT_VALIDATION_MODE"',
    ),
  },
  {
    ...inputs,
    workerConfig: inputs.workerConfig.replace('namespace_id = "16204011"', 'namespace_id = "16204021"'),
  },
  { ...inputs, workerConfig: inputs.workerConfig.replace('limit = 5', 'limit = 6') },
  { ...inputs, workerConfig: inputs.workerConfig.replace('main = "src/index.ts"', 'main = "src/alternate.ts"') },
  {
    ...inputs,
    pagesConfig: inputs.pagesConfig.replace(
      'compatibility_date = "2026-07-14"',
      'compatibility_date = "2026-07-14"\nroutes = []',
    ),
  },
  {
    ...inputs,
    pagesConfig: inputs.pagesConfig.replace(
      'service = "pennant-pursuit-validation-preview"',
      'service = "pennant-pursuit-validation-production"',
    ),
  },
  { ...inputs, pagesConfig: `${inputs.pagesConfig}\n[[env.production.kv_namespaces]]\nbinding = "CACHE"\nid = "fixture"\n` },
]
for (const candidate of unsafeTopologyCandidates) {
  assert.throws(
    () => validateProtectedCapabilityFoundation(candidate),
    /Wrangler topology validation refused/,
  )
}

const submissionOnly = changedModel((model) => {
  model.environments.preview.emergencyStop = 'clear'
  model.environments.preview.identityCompatibilityMode = 'enabled'
  model.environments.preview.reviewedAtMs = Date.now() - 1_000
  model.environments.preview.expiresAtMs = Date.now() + 60_000
  model.environments.preview.capabilities.draftSubmission = 'enabled'
})
assert.throws(() => validateProtectedCapabilityFoundation(submissionOnly), /all-disabled/)
const submissionAndCleanup = changedModel((model) => {
  model.environments.preview.emergencyStop = 'clear'
  model.environments.preview.identityCompatibilityMode = 'enabled'
  model.environments.preview.reviewedAtMs = Date.now() - 1_000
  model.environments.preview.expiresAtMs = Date.now() + 60_000
  model.environments.preview.capabilities.draftSubmission = 'enabled'
  model.environments.preview.capabilities.cleanupCron = 'enabled'
})
assert.throws(() => validateProtectedCapabilityFoundation(submissionAndCleanup), /all-disabled/)

for (const arguments_ of [
  ['--state', 'production', '--review'],
  ['--write'],
  ['--check', '--review'],
  ['--help', '--write'],
  ['--unknown'],
]) {
  const invocation = spawnSync(process.execPath, ['scripts/prepare-d1c4-activation.mjs', ...arguments_], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env },
  })
  assert.equal(invocation.status, 1, `${arguments_.join(' ')} must fail nonzero`)
  assert.doesNotMatch(`${invocation.stdout}\n${invocation.stderr}`, /wrangler deploy|CLOUDFLARE_API_TOKEN/)
}
assert.equal(spawnSync(process.execPath, ['scripts/prepare-d1c4-activation.mjs'], {
  cwd: process.cwd(), encoding: 'utf8', env: { ...process.env },
}).status, 0)
assert.equal(spawnSync(process.execPath, ['scripts/prepare-d1c4-activation.mjs', '--check'], {
  cwd: process.cwd(), encoding: 'utf8', env: { ...process.env },
}).status, 0)

const identities = readConfiguredPreviewIdentities()
const validTarget = {
  previewBaseUrl: `https://develop.${identities.pagesProject}.pages.dev`,
  previewWorker: identities.previewWorker,
  previewEnvironment: 'preview',
  accountId: 'a'.repeat(32),
  databaseId: identities.previewDatabaseId,
  acknowledgement: D1C4_PREVIEW_ACKNOWLEDGEMENT,
}
assert.equal(validatePreviewSmokeTarget(validTarget).previewBaseUrl, validTarget.previewBaseUrl)
for (const target of [
  { ...validTarget, previewBaseUrl: `https://${identities.pagesProject}.pages.dev` },
  { ...validTarget, previewBaseUrl: `https://main.${identities.pagesProject}.pages.dev` },
  { ...validTarget, previewBaseUrl: `https://release-production.${identities.pagesProject}.pages.dev` },
  { ...validTarget, previewBaseUrl: 'http://localhost:5174' },
  { ...validTarget, previewBaseUrl: 'https://ambiguous.pages.dev' },
  { ...validTarget, previewWorker: identities.productionWorker },
  { ...validTarget, previewEnvironment: 'production' },
  { ...validTarget, databaseId: identities.productionDatabaseId },
  { ...validTarget, accountId: 'invalid' },
  { ...validTarget, acknowledgement: '' },
]) assert.throws(() => validatePreviewSmokeTarget(target))

assert.throws(() => parseStrictArguments(['--execute', '--execute'], [], ['execute']), /Duplicate argument/)
assert.throws(() => parseStrictArguments(['--preview-base-url'], ['preview-base-url']), /Expected one value/)
assert.throws(() => parseStrictArguments(['--unknown'], []), /Unknown argument/)
assert.equal(commonTargetFromArguments({}).previewBaseUrl, '')

const validCliArguments = [
  '--preview-base-url', validTarget.previewBaseUrl,
  '--preview-worker', validTarget.previewWorker,
  '--preview-environment', 'preview',
  '--account-id', validTarget.accountId,
  '--database-id', validTarget.databaseId,
  '--ack', D1C4_PREVIEW_ACKNOWLEDGEMENT,
]
let contacts = 0
let d1Creations = 0
const forbiddenFetch: typeof fetch = async () => {
  contacts += 1
  throw new Error('dry run must not fetch')
}
const forbiddenD1 = () => {
  d1Creations += 1
  throw new Error('dry run must not construct D1 access')
}
const output = { log() {}, error() {} }
assert.equal(await submissionSmokeCli(validCliArguments, { fetcher: forbiddenFetch, createD1: forbiddenD1 }, {}, output), 0)
assert.equal(await retentionSmokeCli(validCliArguments, { fetcher: forbiddenFetch, createD1: forbiddenD1 }, {}, output), 0)
assert.equal(await submissionSmokeCli([...validCliArguments, '--execute'], {
  fetcher: forbiddenFetch,
  createD1: forbiddenD1,
}, { CLOUDFLARE_API_TOKEN: 'prohibited-live-token' }, output), 1)
assert.equal(await retentionSmokeCli([...validCliArguments, '--execute'], {
  fetcher: forbiddenFetch,
  createD1: forbiddenD1,
}, { CLOUDFLARE_API_TOKEN: 'prohibited-live-token' }, output), 1)
assert.equal(contacts, 0)
assert.equal(d1Creations, 0)

let prohibitedBoundaryReads = 0
const unreadableDependencies = new Proxy({}, {
  get() {
    prohibitedBoundaryReads += 1
    throw new Error('refusal-only CLI must not inspect adapters')
  },
})
const unreadableEnvironment = new Proxy({} as NodeJS.ProcessEnv, {
  get() {
    prohibitedBoundaryReads += 1
    throw new Error('refusal-only CLI must not inspect environment credentials')
  },
})
for (const cli of [submissionSmokeCli, retentionSmokeCli]) {
  assert.equal(await cli([...validCliArguments, '--execute'], unreadableDependencies, unreadableEnvironment, output), 1)
  assert.equal(await cli([...validCliArguments, '--run'], unreadableDependencies, unreadableEnvironment, output), 1)
  assert.equal(await cli([...validCliArguments, '--force'], unreadableDependencies, unreadableEnvironment, output), 1)
  assert.equal(await cli([...validCliArguments, '--enabled'], unreadableDependencies, {
    CLOUDFLARE_API_TOKEN: 'must-remain-unread',
    D1C4_EXECUTE: 'enabled',
  }, output), 1)
}
assert.equal(prohibitedBoundaryReads, 0)

for (const releaseModule of [
  'scripts/lib/preview-release/plan.mjs',
  'scripts/lib/preview-release/execution-contract.mjs',
  'scripts/lib/preview-release/release-execution.mjs',
  'scripts/preview-plan.mjs',
  'scripts/preview-readiness.mjs',
]) {
  assert.doesNotMatch(readFileSync(releaseModule, 'utf8'), /test-only\/d1c4-(?:submission|retention)-smoke-orchestration/)
}

const cleanupSource = readFileSync('workers/draft-validation/src/retention-cleanup.ts', 'utf8')
assert.match(cleanupSource, /LIMIT \$\{RETENTION_CLEANUP_BATCH_SIZE\}/)
assert.doesNotMatch(cleanupSource, /LIMIT 500/)
assert.match(readFileSync('workers/draft-validation/wrangler.toml', 'utf8'), /^\[triggers\]\ncrons = \[\]$/m)
assert.doesNotMatch(readFileSync('wrangler.toml', 'utf8'), /^\[triggers\]$|^crons\s*=/m)

console.log('Protected capability foundation tests passed: exact all-disabled environment authorities, strict capability inventories, Cron/D1 isolation, disabled-only CLI behavior, preview guards, and token-free dry runs are verified offline.')
