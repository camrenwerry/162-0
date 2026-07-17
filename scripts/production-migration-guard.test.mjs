import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  APPROVED_WRANGLER_COMMAND,
  validateProductionMigrationSafety,
} from './apply-production-migrations.mjs'

const PREVIEW_DATABASE_ID = 'ba6255b4-9425-4863-b10f-79149180f75a'
const PRODUCTION_DATABASE_ID = '4b821c17-b88b-462d-a2ed-c6a2113cc362'
const wrangler = readFileSync('wrangler.toml', 'utf8')
const baseline = {
  wrangler,
  worktreeStatus: '',
  env: { CONFIRM_PRODUCTION_D1: PRODUCTION_DATABASE_ID },
  stdinIsTTY: true,
  stdoutIsTTY: true,
}

assert.deepEqual(validateProductionMigrationSafety(baseline), {
  databaseName: 'pennant-pursuit-production',
  databaseId: PRODUCTION_DATABASE_ID,
})

const refusal = (overrides, message) => assert.throws(
  () => validateProductionMigrationSafety({ ...baseline, ...overrides }),
  new RegExp(message),
)

refusal({ env: {} }, 'CONFIRM_PRODUCTION_D1 must exactly match')
refusal({ env: { CONFIRM_PRODUCTION_D1: '00000000-0000-4000-8000-000000000000' } }, 'CONFIRM_PRODUCTION_D1 must exactly match')
refusal({ worktreeStatus: ' M wrangler.toml' }, 'worktree is not clean')
refusal({ env: { ...baseline.env, CI: 'true' } }, 'CI is active')
refusal({ stdinIsTTY: false }, 'interactive TTY is required')
refusal({ stdoutIsTTY: false }, 'interactive TTY is required')
refusal({
  wrangler: wrangler.replace(PRODUCTION_DATABASE_ID, PREVIEW_DATABASE_ID),
  env: { CONFIRM_PRODUCTION_D1: PREVIEW_DATABASE_ID },
}, 'preview and production database UUIDs must differ')
refusal({
  wrangler: wrangler.replace('database_name = "pennant-pursuit-production"', 'database_name = "pennant-pursuit-prod"'),
}, 'production database name is missing or incorrect')
refusal({
  wrangler: wrangler.replace('database_name = "pennant-pursuit-preview"', 'database_name = "pennant-pursuit-staging"'),
}, 'preview database name is missing or incorrect')
refusal({
  wrangler: wrangler.replace(/\n\[\[env\.production\.d1_databases\]\][\s\S]*$/, ''),
}, 'exactly one production D1 binding')
refusal({
  wrangler: `${wrangler}\n\n[[env.production.d1_databases]]\nbinding = "DB"\ndatabase_name = "pennant-pursuit-production"\ndatabase_id = "${PRODUCTION_DATABASE_ID}"\nmigrations_dir = "migrations"\n`,
}, 'exactly one production D1 binding')
refusal({
  wrangler: wrangler.replace(/\n\[\[d1_databases\]\][\s\S]*?(?=\n\[env\.production\])/, ''),
}, 'exactly one preview D1 binding')
refusal({
  wrangler: wrangler.replace('[env.production]', `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "pennant-pursuit-preview"\ndatabase_id = "${PREVIEW_DATABASE_ID}"\nmigrations_dir = "migrations"\n\n[env.production]`),
}, 'exactly one preview D1 binding')

assert.deepEqual(APPROVED_WRANGLER_COMMAND, [
  'd1',
  'migrations',
  'apply',
  'pennant-pursuit-production',
  '--remote',
  '--env',
  'production',
])
assert.equal(Object.isFrozen(APPROVED_WRANGLER_COMMAND), true)

const wrapperSource = readFileSync('scripts/apply-production-migrations.mjs', 'utf8')
assert.equal((wrapperSource.match(/spawnSync\('wrangler'/g) ?? []).length, 1)
assert.doesNotMatch(wrapperSource, /execFileSync\('wrangler'|--local/)
assert.match(wrapperSource, /spawnSync\('wrangler', APPROVED_WRANGLER_COMMAND/)

console.log('Production migration guard passed: identity, isolation, clean-tree, TTY, CI, confirmation, and command safeguards are enforced.')
