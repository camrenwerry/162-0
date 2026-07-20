import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  loadActivationInputs,
  materializeActivationState,
  validateAllActivationStates,
} from './prepare-d1c4-activation.mjs'
import {
  commonTargetFromArguments,
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  parseStrictArguments,
  readConfiguredPreviewIdentities,
  validatePreviewSmokeTarget,
} from './lib/d1c4-preview-guard'
import { submissionSmokeCli } from './d1c4-submission-smoke'
import { retentionSmokeCli } from './d1c4-retention-smoke'

function sectionFromProduction(source: string) {
  const index = source.indexOf('\n[env.production]')
  assert.notEqual(index, -1)
  return source.slice(index)
}

function lineChanges(before: string, after: string) {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  assert.equal(beforeLines.length, afterLines.length)
  return beforeLines.flatMap((line, index) => line === afterLines[index]
    ? []
    : [{ before: line, after: afterLines[index] }])
}

const inputs = loadActivationInputs()
const states = validateAllActivationStates(inputs)
const disabled = states.disabled
const submission = states['submission-enabled']
const cron = states['cron-enabled']

assert.equal(disabled.pagesConfig, inputs.pagesConfig)
assert.equal(disabled.workerConfig, inputs.workerConfig)
assert.match(disabled.pagesConfig, /^DRAFT_SUBMISSION_MODE = "disabled"$/m)
assert.match(disabled.workerConfig, /^\[triggers\]\ncrons = \[\]$/m)
assert.match(submission.pagesConfig, /^DRAFT_SUBMISSION_MODE = "enabled"$/m)
assert.match(submission.workerConfig, /^\[vars\][\s\S]*?^DRAFT_SUBMISSION_MODE = "enabled"$/m)
assert.match(submission.workerConfig, /^\[triggers\]\ncrons = \[\]$/m)
assert.match(cron.pagesConfig, /^DRAFT_SUBMISSION_MODE = "enabled"$/m)
assert.match(cron.workerConfig, /^\[triggers\]\ncrons = \["17 \* \* \* \*"\]$/m)
assert.doesNotMatch(disabled.pagesConfig, /^\[triggers\]$|^crons\s*=/m)
assert.doesNotMatch(submission.pagesConfig, /^\[triggers\]$|^crons\s*=/m)
assert.doesNotMatch(cron.pagesConfig, /^\[triggers\]$|^crons\s*=/m)

assert.deepEqual(lineChanges(submission.pagesConfig, cron.pagesConfig), [])
assert.deepEqual(lineChanges(submission.workerConfig, cron.workerConfig), [{
  before: 'crons = []',
  after: 'crons = ["17 * * * *"]',
}])

for (const generated of [disabled, submission, cron]) {
  assert.equal(sectionFromProduction(generated.pagesConfig), sectionFromProduction(inputs.pagesConfig))
  assert.equal(sectionFromProduction(generated.workerConfig), sectionFromProduction(inputs.workerConfig))
  assert.match(sectionFromProduction(generated.pagesConfig), /^DRAFT_SUBMISSION_MODE = "disabled"$/m)
  assert.match(sectionFromProduction(generated.workerConfig), /^DRAFT_SUBMISSION_MODE = "disabled"$/m)
  assert.match(sectionFromProduction(generated.workerConfig), /^\[env\.production\.triggers\]\ncrons = \[\]$/m)
}
assert.throws(() => materializeActivationState('production'), /Unknown D1C\.4 activation state/)

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
assert.equal(contacts, 0)
assert.equal(d1Creations, 0)

const cleanupSource = readFileSync('workers/draft-validation/src/retention-cleanup.ts', 'utf8')
assert.match(cleanupSource, /LIMIT \$\{RETENTION_CLEANUP_BATCH_SIZE\}/)
assert.doesNotMatch(cleanupSource, /LIMIT 500/)
assert.match(readFileSync('workers/draft-validation/wrangler.toml', 'utf8'), /^\[triggers\]\ncrons = \[\]$/m)
assert.doesNotMatch(readFileSync('wrangler.toml', 'utf8'), /^\[triggers\]$|^crons\s*=/m)

console.log('D1C.4 activation tests passed: exact three-state generation, byte-identical production sections, strict preview guards, token-free dry runs, and constant-derived cleanup SQL are verified offline.')
