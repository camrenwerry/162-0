import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { handleApiNotFoundRequest } from '../functions/api/[[path]]'
import { handleHealthRequest } from '../functions/api/v1/health'
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

const source = (path: string) => readFileSync(path, 'utf8')

const wrangler = source('wrangler.toml')
const auditedWranglerBaseline = [
  'name = "diamond-draft"',
  'pages_build_output_dir = "dist"',
  'compatibility_date = "2026-07-14"',
  '',
  '[env.production]',
].join('\n')
const wranglerConfiguration = wrangler
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')
  .trim()
assert.equal(wranglerConfiguration, auditedWranglerBaseline, 'Wrangler configuration must match the audited dashboard baseline exactly')
assert.match(wrangler, /^name = "diamond-draft"$/m)
assert.match(wrangler, /^pages_build_output_dir = "dist"$/m)
assert.match(wrangler, /^compatibility_date = "2026-07-14"$/m)
assert.match(wrangler, /^\[env\.production\]$/m)
for (const forbidden of [
  'compatibility_flags', 'vars', 'secrets', 'd1_databases', 'kv_namespaces', 'r2_buckets',
  'durable_objects', 'services', 'queues', 'vectorize', 'hyperdrive', 'analytics_engine_datasets', 'ai',
]) assert.doesNotMatch(wrangler, new RegExp(`^${forbidden}\\s*=|^\\[+${forbidden.replace('.', '\\.')}`, 'm'), `${forbidden} must remain absent`)
assert.doesNotMatch(wrangler, /^\[env\.preview\]$/m)

const packageJson = JSON.parse(source('package.json'))
assert.equal(packageJson.devDependencies.wrangler, '4.111.0')
assert.equal(SUBMISSION_SCHEMA_VERSION, null)
assert.equal(LEADERBOARD_VERSION, null)

const expectedHeaders = (response: Response) => {
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
}

const getResponse = handleHealthRequest(new Request('https://example.test/api/v1/health'))
assert.equal(getResponse.status, 200)
expectedHeaders(getResponse)
assert.equal(getResponse.headers.get('Allow'), 'GET, HEAD')
assert.deepEqual(await getResponse.json(), {
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
  features: {
    leaderboard: 'disabled',
    submissions: 'disabled',
    writes: 'disabled',
    d1: 'not-configured',
  },
})

const headResponse = handleHealthRequest(new Request('https://example.test/api/v1/health', { method: 'HEAD' }))
assert.equal(headResponse.status, 200)
expectedHeaders(headResponse)
assert.equal(headResponse.headers.get('Allow'), 'GET, HEAD')
assert.equal(headResponse.body, null)
assert.equal(await headResponse.text(), '')

const postResponse = handleHealthRequest(new Request('https://example.test/api/v1/health', { method: 'POST' }))
assert.equal(postResponse.status, 405)
expectedHeaders(postResponse)
assert.equal(postResponse.headers.get('Allow'), 'GET, HEAD')
assert.deepEqual(await postResponse.json(), {
  ok: false,
  error: { code: 'method_not_allowed', message: 'Method Not Allowed' },
})

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

console.log('Backend foundation passed: audited config, generated-type dependency, read-only health methods, API JSON fallback, and API-only invocation routes.')
