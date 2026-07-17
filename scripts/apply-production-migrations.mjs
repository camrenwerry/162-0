import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

const PREVIEW_DATABASE_NAME = 'pennant-pursuit-preview'
const PRODUCTION_DATABASE_NAME = 'pennant-pursuit-production'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const APPROVED_WRANGLER_COMMAND = Object.freeze([
  'd1',
  'migrations',
  'apply',
  PRODUCTION_DATABASE_NAME,
  '--remote',
  '--env',
  'production',
])

function fail(message) {
  throw new Error(`Production migration refused: ${message}`)
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function field(block, name) {
  const values = [...block.matchAll(new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, 'gm'))]
  if (values.length !== 1) fail(`${name} must occur exactly once in each D1 binding`)
  return values[0][1]
}

function singleBinding(wrangler, pattern, environment) {
  const blocks = [...wrangler.matchAll(pattern)]
  if (blocks.length !== 1) fail(`exactly one ${environment} D1 binding must be configured`)
  const block = blocks[0][1]
  if (field(block, 'binding') !== 'DB') fail(`${environment} must bind D1 exactly as DB`)
  return {
    databaseName: field(block, 'database_name'),
    databaseId: field(block, 'database_id'),
  }
}

export function validateProductionMigrationSafety({
  wrangler,
  worktreeStatus,
  env,
  stdinIsTTY,
  stdoutIsTTY,
}) {
  if (worktreeStatus) fail('the worktree is not clean')
  if (env.CI && env.CI.toLowerCase() !== 'false') fail('CI is active')
  if (!stdinIsTTY || !stdoutIsTTY) fail('an interactive TTY is required')

  const preview = singleBinding(
    wrangler,
    /\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|$)/g,
    'preview',
  )
  const production = singleBinding(
    wrangler,
    /\[\[env\.production\.d1_databases\]\]([\s\S]*?)(?=\n\[|$)/g,
    'production',
  )
  if (preview.databaseName !== PREVIEW_DATABASE_NAME) {
    fail('the preview database name is missing or incorrect')
  }
  if (!UUID_PATTERN.test(preview.databaseId)) fail('a valid preview database UUID is required')
  if (production.databaseName !== PRODUCTION_DATABASE_NAME) {
    fail('the production database name is missing or incorrect')
  }
  if (!UUID_PATTERN.test(production.databaseId)) fail('a valid production database UUID is required')
  if (preview.databaseId === production.databaseId) {
    fail('preview and production database UUIDs must differ')
  }
  if (env.CONFIRM_PRODUCTION_D1 !== production.databaseId) {
    fail('CONFIRM_PRODUCTION_D1 must exactly match the configured production database UUID')
  }
  return production
}

async function main() {
  try {
    const branch = git('branch', '--show-current')
    const head = git('rev-parse', 'HEAD')
    console.log(`Branch: ${branch || '(detached HEAD)'}`)
    console.log(`HEAD: ${head}`)

    validateProductionMigrationSafety({
      wrangler: readFileSync('wrangler.toml', 'utf8'),
      worktreeStatus: git('status', '--porcelain'),
      env: process.env,
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    })

    console.warn('FINAL WARNING: This will apply pending migrations to pennant-pursuit-production.')
    console.warn('Pages deployment rollback will not roll back D1 schema or data.')
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    const confirmation = await prompt.question(`Type APPLY ${PRODUCTION_DATABASE_NAME} to continue: `)
    prompt.close()
    if (confirmation !== `APPLY ${PRODUCTION_DATABASE_NAME}`) fail('the final confirmation did not match')

    const result = spawnSync('wrangler', APPROVED_WRANGLER_COMMAND, { stdio: 'inherit' })
    if (result.error) fail(result.error.message)
    process.exit(result.status ?? 1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
