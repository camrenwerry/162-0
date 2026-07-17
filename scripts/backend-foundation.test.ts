import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { handleApiNotFoundRequest } from '../functions/api/[[path]]'
import { handleHealthRequest } from '../functions/api/v1/health'
import type { BackendEnv } from '../functions/lib/env'
import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  LEADERBOARD_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
  SUBMISSION_SCHEMA_VERSION,
} from '../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION } from '../src/game/DraftTranscript'

const PREVIEW_DATABASE_ID = 'ba6255b4-9425-4863-b10f-79149180f75a'
const PRODUCTION_DATABASE_ID = '4b821c17-b88b-462d-a2ed-c6a2113cc362'
const CONNECTIVITY_SQL = 'SELECT 1 AS value'
const SCHEMA_SQL = 'SELECT version FROM backend_schema WHERE id = 1'
const RAW_DATABASE_ERROR = 'internal D1 failure: database-id=secret host=private.example'

const source = (path: string) => readFileSync(path, 'utf8')

const wrangler = source('wrangler.toml')
const auditedWranglerPhaseB = [
  'name = "diamond-draft"',
  'pages_build_output_dir = "dist"',
  'compatibility_date = "2026-07-14"',
  '',
  '[vars]',
  'DRAFT_VALIDATION_MODE = "enabled"',
  '',
  '[[d1_databases]]',
  'binding = "DB"',
  'database_name = "pennant-pursuit-preview"',
  `database_id = "${PREVIEW_DATABASE_ID}"`,
  'preview_database_id = "DB"',
  'migrations_dir = "migrations"',
  '',
  '[[services]]',
  'binding = "VALIDATION_SERVICE"',
  'service = "pennant-pursuit-validation-preview"',
  '',
  '[env.production]',
  '',
  '[env.production.vars]',
  'DRAFT_VALIDATION_MODE = "disabled"',
  '',
  '[[env.production.services]]',
  'binding = "VALIDATION_SERVICE"',
  'service = "pennant-pursuit-validation-production"',
  '',
  '[[env.production.d1_databases]]',
  'binding = "DB"',
  'database_name = "pennant-pursuit-production"',
  `database_id = "${PRODUCTION_DATABASE_ID}"`,
  'migrations_dir = "migrations"',
].join('\n')
const wranglerConfiguration = wrangler
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')
  .trim()
assert.equal(wranglerConfiguration, auditedWranglerPhaseB, 'Wrangler must preserve isolated D1 bindings, distinct private validation services, and the fail-closed production mode')
assert.equal((wrangler.match(/^\[\[d1_databases\]\]$/gm) ?? []).length, 1)
assert.equal((wrangler.match(/^\[\[env\.production\.d1_databases\]\]$/gm) ?? []).length, 1)
assert.equal((wrangler.match(/^binding = "DB"$/gm) ?? []).length, 2)
assert.equal((wrangler.match(/^database_name = "pennant-pursuit-preview"$/gm) ?? []).length, 1)
assert.equal((wrangler.match(/^database_name = "pennant-pursuit-production"$/gm) ?? []).length, 1)
assert.equal((wrangler.match(new RegExp(`^database_id = "${PREVIEW_DATABASE_ID}"$`, 'gm')) ?? []).length, 1)
assert.equal((wrangler.match(new RegExp(`^database_id = "${PRODUCTION_DATABASE_ID}"$`, 'gm')) ?? []).length, 1)
assert.match(wrangler, /^preview_database_id = "DB"$/m)
assert.equal((wrangler.match(/^migrations_dir = "migrations"$/gm) ?? []).length, 2)
assert.match(wrangler, /^\[env\.production\]\n\n\[env\.production\.vars\]\nDRAFT_VALIDATION_MODE = "disabled"\n\n\[\[env\.production\.services\]\]\nbinding = "VALIDATION_SERVICE"\nservice = "pennant-pursuit-validation-production"\n\n\[\[env\.production\.d1_databases\]\]$/m)
assert.match(wrangler, /^\[\[services\]\]\nbinding = "VALIDATION_SERVICE"\nservice = "pennant-pursuit-validation-preview"$/m)
assert.match(wrangler, /^\[\[env\.production\.services\]\]\nbinding = "VALIDATION_SERVICE"\nservice = "pennant-pursuit-validation-production"$/m)
assert.equal((wrangler.match(/^DRAFT_VALIDATION_MODE = "enabled"$/gm) ?? []).length, 1)
assert.equal((wrangler.match(/^DRAFT_VALIDATION_MODE = "disabled"$/gm) ?? []).length, 1)
assert.doesNotMatch(wrangler, /^\[env\.preview\]$/m)
assert.doesNotMatch(wrangler, /^remote\s*=/m)
assert.deepEqual(
  wrangler.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi),
  [PREVIEW_DATABASE_ID, PRODUCTION_DATABASE_ID],
  'exactly the preview and production UUIDs must be configured',
)
assert.notEqual(PREVIEW_DATABASE_ID, PRODUCTION_DATABASE_ID)
for (const forbidden of [
  'compatibility_flags', 'secrets', 'kv_namespaces', 'r2_buckets',
  'durable_objects', 'queues', 'vectorize', 'hyperdrive',
  'analytics_engine_datasets', 'ai',
]) {
  assert.doesNotMatch(
    wrangler,
    new RegExp(`^${forbidden}\\s*=|^\\[+${forbidden.replace('.', '\\.')}`, 'm'),
    `${forbidden} must remain absent`,
  )
}

const approvedMigration = [
  'CREATE TABLE backend_schema (',
  '  id INTEGER PRIMARY KEY CHECK (id = 1),',
  '  version INTEGER NOT NULL CHECK (version >= 1)',
  ');',
  '',
  'INSERT INTO backend_schema (id, version) VALUES (1, 1);',
].join('\n')
assert.equal(source('migrations/0001_backend_foundation.sql').trim(), approvedMigration)
assert.equal((source('migrations/0001_backend_foundation.sql').match(/CREATE TABLE/gi) ?? []).length, 1)
assert.equal((source('migrations/0001_backend_foundation.sql').match(/INSERT INTO/gi) ?? []).length, 1)

const generatedTypes = source('functions/types.d.ts')
assert.match(generatedTypes, /interface __BaseEnv_Env\s*\{[\s\S]*?DB: D1Database;/)
assert.match(generatedTypes, /interface __BaseEnv_Env\s*\{[\s\S]*?DRAFT_VALIDATION_MODE: "disabled" \| "enabled";/)
assert.match(generatedTypes, /interface __BaseEnv_Env\s*\{[\s\S]*?VALIDATION_SERVICE: Fetcher \/\* pennant-pursuit-validation-production \*\/ \| Fetcher \/\* pennant-pursuit-validation-preview \*\//)
assert.match(generatedTypes, /interface ProductionEnv\s*\{[\s\S]*?DB: D1Database;/)
assert.match(generatedTypes, /interface ProductionEnv\s*\{[\s\S]*?DRAFT_VALIDATION_MODE: "disabled";/)
assert.match(generatedTypes, /interface ProductionEnv\s*\{[\s\S]*?VALIDATION_SERVICE: Fetcher \/\* pennant-pursuit-validation-production \*\//)
const envSource = source('functions/lib/env.ts')
const databaseSource = source('functions/lib/database.ts')
assert.match(envSource, /export type BackendEnv = Partial<Env>/)
assert.doesNotMatch(envSource + databaseSource, /from ['"]node:/)
assert.doesNotMatch(databaseSource, /\.(?:run|batch|exec)\s*\(/)
assert.equal((databaseSource.match(/\.first</g) ?? []).length, 2)

const packageJson = JSON.parse(source('package.json'))
assert.equal(packageJson.devDependencies.wrangler, '4.111.0')
assert.equal(packageJson.scripts['functions:types'], 'wrangler types ./functions/types.d.ts')
assert.equal(packageJson.scripts['functions:types:check'], 'wrangler types ./functions/types.d.ts --check')
assert.equal(packageJson.scripts['db:migrations:list:local'], 'wrangler d1 migrations list pennant-pursuit-preview --local --persist-to .wrangler/state --env=""')
assert.equal(packageJson.scripts['db:migrations:apply:local'], 'wrangler d1 migrations apply pennant-pursuit-preview --local --persist-to .wrangler/state --env=""')
assert.equal(packageJson.scripts['db:migrations:list:preview'], 'wrangler d1 migrations list pennant-pursuit-preview --remote --env=""')
assert.equal(packageJson.scripts['db:migrations:apply:preview'], 'wrangler d1 migrations apply pennant-pursuit-preview --remote --env=""')
assert.equal(packageJson.scripts['db:migrations:list:production'], 'wrangler d1 migrations list pennant-pursuit-production --remote --env production')
assert.equal(packageJson.scripts['db:migrations:apply:production'], 'node scripts/apply-production-migrations.mjs')
assert.equal(packageJson.scripts['test:production-migration'], 'node scripts/production-migration-guard.test.mjs')
assert.match(packageJson.scripts['test:backend'], /backend-foundation\.test\.ts/)
assert.match(packageJson.scripts['test:draft-validation'], /draft-validation-route\.test\.ts/)
assert.match(packageJson.scripts['test:draft-validation-traffic-control'], /draft-validation-traffic-control\.test\.ts/)
assert.match(packageJson.scripts['validation-worker:typecheck'], /workers\/draft-validation\/tsconfig\.json/)
assert.match(packageJson.scripts['benchmark:draft-validation'], /draft-validation-benchmark\.ts/)
assert.equal(SUBMISSION_SCHEMA_VERSION, null)
assert.equal(LEADERBOARD_VERSION, null)

const operationsDocumentation = source('docs/BACKEND_OPERATIONS.md')
for (const requiredDocumentation of [
  'pennant-pursuit-preview',
  'pennant-pursuit-production',
  PREVIEW_DATABASE_ID,
  PRODUCTION_DATABASE_ID,
  'All Cloudflare Pages preview deployments share',
  'must not add `remote = true`',
  '`preview_database_id = "DB"`',
  'does not roll back D1 schema or data',
  'No user identity',
  'Leaderboard, submissions, and all runtime writes remain disabled',
  'Phase C checklist',
]) assert.match(operationsDocumentation, new RegExp(requiredDocumentation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

const productionGuard = source('scripts/apply-production-migrations.mjs')
for (const requiredGuard of [
  'pennant-pursuit-production',
  'CONFIRM_PRODUCTION_D1',
  "git('status', '--porcelain')",
  'process.stdin.isTTY',
  'process.stdout.isTTY',
  'env.CI',
  "git('branch', '--show-current')",
  "git('rev-parse', 'HEAD')",
  "'--remote'",
  "'--env'",
  "'production'",
  'preview and production database UUIDs must differ',
]) assert.match(productionGuard, new RegExp(requiredGuard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.equal((productionGuard.match(/spawnSync\('wrangler'/g) ?? []).length, 1)
assert.doesNotMatch(productionGuard, /execFileSync\('wrangler'|--local/)
assert.match(
  productionGuard,
  /spawnSync\('wrangler', APPROVED_WRANGLER_COMMAND/,
)

const apiImplementations = ['functions/api/[[path]].ts', 'functions/api/v1/health.ts', 'functions/api/v1/validate-draft.ts']
assert.deepEqual(apiImplementations.filter((path) => existsSync(path)), apiImplementations)
assert.doesNotMatch(apiImplementations.map(source).join('\n'), /\.run\s*\(|\.batch\s*\(|\.exec\s*\(/)
assert.deepEqual(readdirSync('functions/api').sort(), ['[[path]].ts', 'v1'])
assert.deepEqual(readdirSync('functions/api/v1').sort(), ['health.ts', 'validate-draft.ts'])
assert.deepEqual(readdirSync('migrations').sort(), ['0001_backend_foundation.sql'])
const validationRouteSource = source('functions/api/v1/validate-draft.ts')
assert.doesNotMatch(validationRouteSource, /\benv\.DB\b|\bgetOptionalDatabase\b|\bwaitUntil\b|\bconsole\.(?:log|warn|error)\b/)
assert.doesNotMatch(validationRouteSource, /\bcaches\.open\s*\(|\bSet-Cookie\b|\bAccess-Control-Allow-Origin\b/)
assert.match(validationRouteSource, /VALIDATION_SERVICE/)
assert.doesNotMatch(validationRouteSource, /createWorkerReplayCatalog|replayDraftWithCatalog|calculateDraftResult|readBoundedJson/)

const privateValidationWorkerConfig = source('workers/draft-validation/wrangler.toml')
assert.match(privateValidationWorkerConfig, /workers_dev = false/)
assert.match(privateValidationWorkerConfig, /preview_urls = false/)
assert.match(privateValidationWorkerConfig, /^name = "pennant-pursuit-validation-preview"$/m)
assert.match(privateValidationWorkerConfig, /\[env\.production\][\s\S]*?^name = "pennant-pursuit-validation-production"$/m)
assert.match(privateValidationWorkerConfig, /\[\[ratelimits\]\][\s\S]*?namespace_id = "16204011"[\s\S]*?\[\[ratelimits\]\][\s\S]*?namespace_id = "16204012"/)
assert.match(privateValidationWorkerConfig, /\[\[env\.production\.ratelimits\]\][\s\S]*?namespace_id = "16204021"[\s\S]*?\[\[env\.production\.ratelimits\]\][\s\S]*?namespace_id = "16204022"/)
assert.doesNotMatch(privateValidationWorkerConfig, /\broutes\b|custom_domain|d1_|kv_|r2_|durable_objects|queues|analytics|secrets/)
const privateValidationWorkerSource = source('workers/draft-validation/src/index.ts')
const authoritativeValidationSource = source('workers/draft-validation/src/authoritative-validation.ts')
// A module Worker must expose a `fetch` handler; guard against external fetches
// rather than the handler method itself.
assert.doesNotMatch(privateValidationWorkerSource, /\benv\.DB\b/)
assert.doesNotMatch(privateValidationWorkerSource, /\bwaitUntil\b/)
assert.doesNotMatch(privateValidationWorkerSource, /\bconsole\.(?:log|warn|error)\b/)
assert.doesNotMatch(privateValidationWorkerSource, /\bawait\s+fetch\s*\(/)
assert.doesNotMatch(privateValidationWorkerSource, /\bglobalThis\.fetch\s*\(/)
assert.doesNotMatch(authoritativeValidationSource, /\benv\.DB\b|\bgetOptionalDatabase\b|\bwaitUntil\b|\bconsole\.(?:log|warn|error)\b/)
assert.doesNotMatch(authoritativeValidationSource, /\.run\s*\(|\.batch\s*\(|\.exec\s*\(/)

const expectedHeaders = (response: Response) => {
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
}

const expectedMetadata = {
  ok: true,
  service: 'pennant-pursuit',
  runtime: 'cloudflare-pages-functions',
  versions: {
    app: APP_VERSION,
    gameRules: GAME_RULES_VERSION,
    rng: RNG_VERSION,
    scoring: SCORING_VERSION,
    data: {
      id: DATA_VERSION,
      label: DATA_VERSION.replace(/^lahman-/i, 'Lahman ').replace(/-v(\d+)$/i, ' (v$1)'),
    },
    canonicalDataDigest: DATA_DIGEST,
    transcriptSchema: TRANSCRIPT_SCHEMA_VERSION,
  },
}

interface MockOptions {
  connectivity?: { value: number } | Error | null
  schema?: { version: number } | Error | null
}

function createMockDatabase(options: MockOptions = {}) {
  const queries: string[] = []
  let writeCalls = 0
  const connectivity = options.connectivity === undefined ? { value: 1 } : options.connectivity
  const schema = options.schema === undefined ? { version: 1 } : options.schema
  const database = {
    prepare(query: string) {
      queries.push(query)
      const result = query === CONNECTIVITY_SQL
        ? connectivity
        : query === SCHEMA_SQL
          ? schema
          : new Error(`Unexpected query: ${query}`)
      return {
        async first<T>() {
          if (result instanceof Error) throw result
          return result as T | null
        },
        async run() {
          writeCalls += 1
          throw new Error('Runtime writes are forbidden')
        },
      }
    },
    async batch() {
      writeCalls += 1
      throw new Error('Runtime writes are forbidden')
    },
    async exec() {
      writeCalls += 1
      throw new Error('Runtime writes are forbidden')
    },
  }
  return {
    env: { DB: database } as unknown as BackendEnv,
    queries,
    writeCalls: () => writeCalls,
  }
}

const noDatabaseResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health'))
assert.equal(noDatabaseResponse.status, 200)
expectedHeaders(noDatabaseResponse)
assert.equal(noDatabaseResponse.headers.get('Allow'), 'GET, HEAD')
assert.deepEqual(await noDatabaseResponse.json(), {
  ...expectedMetadata,
  status: 'healthy',
  backend: { d1: { configured: false, reachable: false, schemaVersion: null } },
  features: {
    draftValidation: 'disabled',
    leaderboard: 'disabled',
    submissions: 'disabled',
    writes: 'disabled',
    d1: 'not-configured',
  },
})

const healthyDatabase = createMockDatabase()
const healthyResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health'), healthyDatabase.env)
assert.equal(healthyResponse.status, 200)
assert.deepEqual(await healthyResponse.json(), {
  ...expectedMetadata,
  status: 'healthy',
  backend: { d1: { configured: true, reachable: true, schemaVersion: 1 } },
  features: {
    draftValidation: 'disabled',
    leaderboard: 'disabled',
    submissions: 'disabled',
    writes: 'disabled',
    d1: 'read-only',
  },
})
assert.deepEqual(healthyDatabase.queries, [CONNECTIVITY_SQL, SCHEMA_SQL])
assert.equal(healthyDatabase.writeCalls(), 0)

const unavailableDatabase = createMockDatabase({ connectivity: new Error(RAW_DATABASE_ERROR) })
const unavailableResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health'), unavailableDatabase.env)
const unavailableBody = await unavailableResponse.text()
assert.equal(unavailableResponse.status, 200)
assert.deepEqual(JSON.parse(unavailableBody).backend.d1, { configured: true, reachable: false, schemaVersion: null })
assert.equal(JSON.parse(unavailableBody).status, 'degraded')
assert.deepEqual(JSON.parse(unavailableBody).features, {
  draftValidation: 'disabled',
  leaderboard: 'disabled',
  submissions: 'disabled',
  writes: 'disabled',
  d1: 'read-only',
})
assert.doesNotMatch(unavailableBody, /internal D1 failure|database-id|private\.example|SELECT/i)
assert.equal(unavailableDatabase.writeCalls(), 0)

const unmigratedDatabase = createMockDatabase({ schema: new Error(`no such table: ${RAW_DATABASE_ERROR}`) })
const unmigratedResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health'), unmigratedDatabase.env)
const unmigratedBody = await unmigratedResponse.text()
assert.equal(unmigratedResponse.status, 200)
assert.deepEqual(JSON.parse(unmigratedBody).backend.d1, { configured: true, reachable: true, schemaVersion: null })
assert.equal(JSON.parse(unmigratedBody).status, 'degraded')
assert.equal(JSON.parse(unmigratedBody).features.writes, 'disabled')
assert.doesNotMatch(unmigratedBody, /no such table|database-id|private\.example|backend_schema/i)
assert.equal(unmigratedDatabase.writeCalls(), 0)

const unexpectedSchemaDatabase = createMockDatabase({ schema: { version: 2 } })
const unexpectedSchemaResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health'), unexpectedSchemaDatabase.env)
const unexpectedSchemaBody = await unexpectedSchemaResponse.json() as { status: string, backend: { d1: unknown } }
assert.equal(unexpectedSchemaResponse.status, 200)
assert.equal(unexpectedSchemaBody.status, 'degraded')
assert.deepEqual(unexpectedSchemaBody.backend.d1, { configured: true, reachable: true, schemaVersion: 2 })
assert.equal(unexpectedSchemaDatabase.writeCalls(), 0)

const headDatabase = createMockDatabase({ connectivity: new Error('HEAD must not query D1') })
const headResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health', { method: 'HEAD' }), headDatabase.env)
assert.equal(headResponse.status, 200)
expectedHeaders(headResponse)
assert.equal(headResponse.headers.get('Allow'), 'GET, HEAD')
assert.equal(headResponse.body, null)
assert.equal(await headResponse.text(), '')
assert.deepEqual(headDatabase.queries, [])

const postDatabase = createMockDatabase({ connectivity: new Error('POST must not query D1') })
const postResponse = await handleHealthRequest(new Request('https://example.test/api/v1/health', { method: 'POST' }), postDatabase.env)
assert.equal(postResponse.status, 405)
expectedHeaders(postResponse)
assert.equal(postResponse.headers.get('Allow'), 'GET, HEAD')
assert.deepEqual(await postResponse.json(), {
  ok: false,
  error: { code: 'method_not_allowed', message: 'Method Not Allowed' },
})
assert.deepEqual(postDatabase.queries, [])

const missingResponse = handleApiNotFoundRequest(new Request('https://example.test/api/v1/does-not-exist'))
assert.equal(missingResponse.status, 404)
expectedHeaders(missingResponse)
const missingBody = await missingResponse.text()
assert.deepEqual(JSON.parse(missingBody), {
  ok: false,
  error: { code: 'not_found', message: 'API route not found' },
})
assert.doesNotMatch(missingBody, /<!doctype html>|<div id="root">/i)

const expectedRoutes = { version: 1, include: ['/api/*'], exclude: [] }
assert.deepEqual(JSON.parse(source('public/_routes.json')), expectedRoutes)
assert.ok(existsSync('dist/_routes.json'), 'production build must copy _routes.json')
assert.deepEqual(JSON.parse(source('dist/_routes.json')), expectedRoutes)
assert.equal(source('public/_redirects').trim(), '/* /index.html 200')
assert.equal(source('dist/_redirects').trim(), '/* /index.html 200')

console.log('Backend Phase C4.3 passed: isolated D1 bindings, distinct private validation bindings, read-only health, fail-closed production validation, and exact API routing.')
