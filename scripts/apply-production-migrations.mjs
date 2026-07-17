import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const PRODUCTION_DATABASE_NAME = 'pennant-pursuit-production'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fail(message) {
  console.error(`Production migration refused: ${message}`)
  process.exit(1)
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

const branch = git('branch', '--show-current')
const head = git('rev-parse', 'HEAD')
console.log(`Branch: ${branch || '(detached HEAD)'}`)
console.log(`HEAD: ${head}`)

if (git('status', '--porcelain')) fail('the worktree is not clean')
if (process.env.CI && process.env.CI.toLowerCase() !== 'false') fail('CI is active')
if (!process.stdin.isTTY || !process.stdout.isTTY) fail('an interactive TTY is required')

const wrangler = readFileSync('wrangler.toml', 'utf8')
const productionBlocks = [
  ...wrangler.matchAll(/\[\[env\.production\.d1_databases\]\]([\s\S]*?)(?=\n\[|$)/g),
]
if (productionBlocks.length !== 1) fail('exactly one production D1 binding must be configured')

const productionBlock = productionBlocks[0][1]
const databaseName = productionBlock.match(/^database_name\s*=\s*"([^"]+)"$/m)?.[1]
const databaseId = productionBlock.match(/^database_id\s*=\s*"([^"]+)"$/m)?.[1]
if (databaseName !== PRODUCTION_DATABASE_NAME) fail('the production database name is missing or incorrect')
if (!databaseId || !UUID_PATTERN.test(databaseId)) fail('a valid production database UUID is required')
if (process.env.CONFIRM_PRODUCTION_D1 !== databaseId) {
  fail('CONFIRM_PRODUCTION_D1 must exactly match the configured production database UUID')
}

console.warn('WARNING: This will apply pending migrations to pennant-pursuit-production.')
console.warn('Pages deployment rollback will not roll back D1 schema or data.')
const prompt = createInterface({ input: process.stdin, output: process.stdout })
const confirmation = await prompt.question(`Type APPLY ${PRODUCTION_DATABASE_NAME} to continue: `)
prompt.close()
if (confirmation !== `APPLY ${PRODUCTION_DATABASE_NAME}`) fail('the final confirmation did not match')

const result = spawnSync('wrangler', [
  'd1',
  'migrations',
  'apply',
  PRODUCTION_DATABASE_NAME,
  '--remote',
  '--env',
  'production',
], { stdio: 'inherit' })

if (result.error) fail(result.error.message)
process.exit(result.status ?? 1)
