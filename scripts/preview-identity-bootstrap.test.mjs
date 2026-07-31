import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalHash, canonicalJson, fileHash } from './lib/preview-release/canonical.mjs'
import { createIdentityBootstrapCloudflareClient } from './lib/preview-release/cloudflare-readonly.mjs'
import { EXIT_CODES } from './lib/preview-release/errors.mjs'
import {
  collectIdentityBootstrapEvidence,
  constructIdentityBootstrapCandidate,
  normalizeAccountName,
  normalizeWorkerRouteInventory,
  projectIdentityBootstrapReport,
  renderIdentityBootstrapReport,
} from './lib/preview-release/identity-bootstrap.mjs'
import { loadReleaseManifest, validateReleaseManifest } from './lib/preview-release/manifest.mjs'
import {
  GENERIC_CLOUDFLARE_CREDENTIALS,
  redactText,
} from './lib/preview-release/redaction.mjs'
import { failureReport } from './lib/preview-release/reporting.mjs'
import {
  parseIdentityBootstrapArguments,
  runIdentityBootstrapCli,
} from './preview-identity-bootstrap.mjs'

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(REPOSITORY_ROOT, 'config/preview-release.json')
const loaded = loadReleaseManifest(REPOSITORY_ROOT)
const manifest = loaded.manifest
const TOKEN = 'dedicated-sensitive-fixture-token'
const ACCOUNT_ID = 'a'.repeat(32)
const OTHER_ACCOUNT_ID = 'd'.repeat(32)
const ZONE_IDS = ['b'.repeat(32), 'c'.repeat(32)]
const PREVIEW_WORKER = manifest.cloudflare.preview.worker.name
const PREVIEW_D1 = manifest.cloudflare.preview.d1
const PRODUCTION_WORKER = manifest.cloudflare.production.worker.name
const PRODUCTION_D1 = manifest.cloudflare.production.d1
const SAFE_ENVIRONMENT = Object.freeze({ PENNANT_PREVIEW_API_TOKEN: TOKEN })
const PRODUCTION_DOMAINS = ['www.example.invalid', 'diamond-draft.pages.dev']
const MAXIMUM_HOSTNAME = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
const OVERLENGTH_HOSTNAME = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function pagination(page, items, totalCount = items.length, totalPages = 1) {
  return {
    count: items.length,
    page,
    per_page: 25,
    total_count: totalCount,
    total_pages: totalPages,
  }
}

function accountPagination(page, items, totalCount = items.length, totalPages) {
  return {
    count: items.length,
    page,
    per_page: 25,
    total_count: totalCount,
    ...(totalPages === undefined ? {} : { total_pages: totalPages }),
  }
}

function servicePagination(items, overrides = {}) {
  return {
    count: items.length,
    page: 1,
    per_page: 20,
    total_count: items.length,
    total_pages: 1,
    ...overrides,
  }
}

function cloudflareResponse(result, {
  resultInfo,
  status = 200,
  contentType = 'application/json',
  headers = {},
} = {}) {
  return new Response(JSON.stringify({
    success: true,
    result,
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
  }), {
    status,
    headers: { 'content-type': contentType, ...headers },
  })
}

function endpointKey(url) {
  const pathname = url.pathname
  if (pathname === '/client/v4/accounts') return 'accounts'
  if (/^\/client\/v4\/accounts\/[0-9a-f]{32}$/.test(pathname)) return 'account'
  if (pathname === '/client/v4/zones') return 'zones'
  if (pathname.endsWith(`/pages/projects/${manifest.cloudflare.preview.pages.project}`)) return 'pages'
  if (pathname.endsWith(`/workers/scripts/${PREVIEW_WORKER}/settings`)) return 'workerSettings'
  if (pathname.endsWith(`/workers/scripts/${PREVIEW_WORKER}/subdomain`)) return 'workerSubdomain'
  if (pathname.endsWith('/workers/domains')) return 'workerDomains'
  if (/^\/client\/v4\/zones\/[0-9a-f]{32}\/workers\/routes$/.test(pathname)) return 'workerRoutes'
  if (pathname.endsWith(`/d1/database/${PREVIEW_D1.id}`)) return 'd1'
  return 'unexpected'
}

function defaultEndpointResult(key, url) {
  const page = Number(url.searchParams.get('page') ?? 1)
  const scopedAccountId = url.pathname.split('/')[4] ?? ACCOUNT_ID
  if (key === 'accounts') {
    const result = [{ id: ACCOUNT_ID, name: 'Fixture account' }]
    return { result, resultInfo: accountPagination(page, result) }
  }
  if (key === 'account') return { result: { id: scopedAccountId, name: 'Fixture account' } }
  if (key === 'zones') {
    const result = ZONE_IDS.map((id) => ({ id, account: { id: url.searchParams.get('account.id') } }))
    return { result, resultInfo: pagination(page, result) }
  }
  if (key === 'pages') {
    return {
      result: {
        name: manifest.cloudflare.preview.pages.project,
        production_branch: 'main',
        domains: [...PRODUCTION_DOMAINS].reverse(),
      },
    }
  }
  if (key === 'workerSettings') return { result: {} }
  if (key === 'workerSubdomain') return { result: { enabled: false, previews_enabled: false } }
  if (key === 'workerDomains') {
    return { result: [], resultInfo: servicePagination([]) }
  }
  if (key === 'workerRoutes') {
    const zoneId = url.pathname.split('/')[4]
    return { result: [{ id: zoneId, pattern: `unrelated-${zoneId[0]}.example.invalid/*`, script: 'unrelated-worker' }] }
  }
  if (key === 'd1') return { result: { uuid: PREVIEW_D1.id, name: PREVIEW_D1.name } }
  throw new Error(`Unexpected fake Cloudflare endpoint: ${url}`)
}

function createFakeCloudflare(overrides = {}) {
  const contacts = []
  const counts = new Map()
  const fetchImplementation = async (input, options) => {
    const url = new URL(input)
    const key = endpointKey(url)
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    contacts.push({ url: url.href, key, options })
    const fallback = () => defaultEndpointResult(key, url)
    const selected = typeof overrides[key] === 'function'
      ? await overrides[key]({ url, options, count, fallback })
      : (overrides[key] ?? fallback())
    if (selected instanceof Response) return selected
    return cloudflareResponse(selected.result, selected)
  }
  return { contacts, counts, fetchImplementation }
}

function snapshotTree(root) {
  const rootMetadata = lstatSync(root)
  const entries = [{ path: '.', type: 'directory', mode: rootMetadata.mode & 0o777 }]
  const visit = (directory, relativeDirectory = '') => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name)
      const relative = path.posix.join(relativeDirectory, name)
      const metadata = lstatSync(absolute)
      if (metadata.isDirectory()) {
        entries.push({ path: `${relative}/`, type: 'directory', mode: metadata.mode & 0o777 })
        visit(absolute, relative)
      } else if (metadata.isSymbolicLink()) {
        entries.push({ path: relative, type: 'symlink', mode: metadata.mode & 0o777, target: readlinkSync(absolute) })
      } else {
        entries.push({
          path: relative,
          type: 'file',
          mode: metadata.mode & 0o777,
          size: metadata.size,
          contents: readFileSync(absolute).toString('base64'),
        })
      }
    }
  }
  visit(root)
  return entries
}

function snapshotControlledRepository(root) {
  const inventory = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    shell: false,
  })
  assert.equal(inventory.error, undefined)
  assert.equal(inventory.signal, null)
  assert.equal(inventory.status, 0, inventory.stderr.toString('utf8'))

  return inventory.stdout.toString('utf8').split('\0').filter(Boolean).sort().map((relative) => {
    const absolute = path.join(root, relative)
    const metadata = lstatSync(absolute)
    if (metadata.isSymbolicLink()) {
      return { path: relative, type: 'symlink', mode: metadata.mode & 0o777, target: readlinkSync(absolute) }
    }
    assert.equal(metadata.isFile(), true, relative)
    return {
      path: relative,
      type: 'file',
      mode: metadata.mode & 0o777,
      size: metadata.size,
      sha256: fileHash(absolute),
    }
  })
}

function customDomain(index, overrides = {}) {
  return {
    id: (BigInt(index) + 1n).toString(16).padStart(32, '0'),
    cert_id: `00000000-0000-4000-8000-${(BigInt(index) + 1n).toString(16).padStart(12, '0')}`,
    hostname: `domain-${index}.example.invalid`,
    service: PREVIEW_WORKER,
    environment: 'production',
    zone_id: ZONE_IDS[0],
    zone_name: 'example.invalid',
    ...overrides,
  }
}

function route(index, overrides = {}) {
  const source = String(index)
  const id = /^[0-9a-f]{32}$/.test(source)
    ? source
    : (BigInt(index) + 1n).toString(16).padStart(32, '0')
  return {
    id,
    pattern: `route-${index}.example.invalid/*`,
    script: 'unrelated-worker',
    ...overrides,
  }
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function publicEntryPreloadSource() {
  return `
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

const requests = []
const denyNetwork = () => { throw new Error('Test sentinel blocked non-fake networking.') }
http.request = denyNetwork
http.get = denyNetwork
https.request = denyNetwork
https.get = denyNetwork
net.Socket.prototype.connect = denyNetwork
tls.connect = denyNetwork

const accountId = ${JSON.stringify(ACCOUNT_ID)}
const zoneIds = ${JSON.stringify(ZONE_IDS)}
const pagesProject = ${JSON.stringify(manifest.cloudflare.preview.pages.project)}
const previewWorker = ${JSON.stringify(PREVIEW_WORKER)}
const previewD1 = ${JSON.stringify(PREVIEW_D1)}
const pageInfo = (items) => ({
  count: items.length,
  page: 1,
  per_page: 25,
  total_count: items.length,
  total_pages: 1,
})
const accountPageInfo = (items) => ({
  count: items.length,
  page: 1,
  per_page: 25,
  total_count: items.length,
})
const servicePageInfo = (items) => ({
  count: items.length,
  page: 1,
  per_page: 20,
  total_count: items.length,
  total_pages: 1,
})
const response = (result, resultInfo) => new Response(JSON.stringify({
  success: true,
  result,
  ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
}), { headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input)
  requests.push({ method: options.method, url: url.href })
  if (url.origin !== 'https://api.cloudflare.com' || options.method !== 'GET' || options.redirect !== 'manual') {
    throw new Error('Test sentinel received a non-reviewed request.')
  }
  if (url.pathname === '/client/v4/accounts') {
    const items = [{ id: accountId, name: 'Sentinel account' }]
    return response(items, accountPageInfo(items))
  }
  if (url.pathname === '/client/v4/zones') {
    const items = zoneIds.map((id) => ({ id, account: { id: accountId } }))
    return response(items, pageInfo(items))
  }
  if (url.pathname === \`/client/v4/accounts/\${accountId}\`) {
    return response({ id: accountId, name: 'Sentinel account' })
  }
  if (url.pathname.endsWith(\`/pages/projects/\${pagesProject}\`)) {
    return response({
      name: pagesProject,
      production_branch: 'main',
      domains: ${JSON.stringify(PRODUCTION_DOMAINS)},
    })
  }
  if (url.pathname.endsWith(\`/workers/scripts/\${previewWorker}/settings\`)) return response({})
  if (url.pathname.endsWith(\`/workers/scripts/\${previewWorker}/subdomain\`)) {
    return response({ enabled: false, previews_enabled: false })
  }
  if (url.pathname.endsWith('/workers/domains')) {
    const items = []
    return response(items, servicePageInfo(items))
  }
  const routeMatch = url.pathname.match(/^\\/client\\/v4\\/zones\\/([0-9a-f]{32})\\/workers\\/routes$/)
  if (routeMatch && zoneIds.includes(routeMatch[1])) {
    return response([{
      id: routeMatch[1],
      pattern: \`unrelated-\${routeMatch[1][0]}.example.invalid/*\`,
      script: 'unrelated-worker',
    }])
  }
  if (url.pathname.endsWith(\`/d1/database/\${previewD1.id}\`)) {
    return response({ uuid: previewD1.id, name: previewD1.name })
  }
  throw new Error(\`Test sentinel blocked unexpected request: \${url.href}\`)
}

let reported = false
process.on('beforeExit', () => {
  if (reported) return
  reported = true
  process.stderr.write(\`__PP15_PUBLIC_REQUESTS__\${JSON.stringify(requests)}\\n\`)
})
`
}

function expectedHappyPathRequests() {
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`
  const observation = [
    `https://api.cloudflare.com/client/v4/accounts?page=1&per_page=25`,
    prefix,
    `https://api.cloudflare.com/client/v4/zones?account.id=${ACCOUNT_ID}&type=full%2Cpartial%2Csecondary%2Cinternal&page=1&per_page=25`,
    `${prefix}/pages/projects/${manifest.cloudflare.preview.pages.project}`,
    `${prefix}/workers/scripts/${PREVIEW_WORKER}/settings`,
    `${prefix}/workers/scripts/${PREVIEW_WORKER}/subdomain`,
    `${prefix}/workers/domains?service=${PREVIEW_WORKER}`,
    ...ZONE_IDS.map((zoneId) => `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`),
    `${prefix}/d1/database/${PREVIEW_D1.id}`,
  ].map((url) => ({ method: 'GET', url }))
  return [...observation, ...observation]
}

function parseHumanProjection(output) {
  const values = new Map(output.split('\n').map((line) => {
    const separator = line.indexOf(': ')
    return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 2)]
  }))
  return {
    schemaVersion: Number(values.get('schemaVersion')),
    command: values.get('command'),
    status: values.get('status'),
    candidateIdentities: {
      'cloudflare.account.id': values.get('cloudflare.account.id'),
      'cloudflare.preview.worker.routeZoneIds': JSON.parse(values.get('cloudflare.preview.worker.routeZoneIds')),
      'cloudflare.production.pages.branch': values.get('cloudflare.production.pages.branch'),
      'cloudflare.production.pages.domains': JSON.parse(values.get('cloudflare.production.pages.domains')),
    },
    manifestHash: values.get('manifestHash'),
    evidenceHash: values.get('evidenceHash'),
    stableObservation: JSON.parse(values.get('stableObservation')),
    noRemoteMutation: values.get('noRemoteMutation') === 'true',
    configurationModified: values.get('configurationModified') === 'true',
    authority: values.get('authority'),
    reviewedAnchors: JSON.parse(values.get('reviewedAnchors')),
    crossChecks: JSON.parse(values.get('crossChecks')),
    ordinaryCheckPlanBlocked: values.get('ordinaryCheckPlanBlocked') === 'true',
  }
}

async function collect(fake = createFakeCloudflare(), options = {}) {
  return collectIdentityBootstrapEvidence({
    repositoryRoot: REPOSITORY_ROOT,
    token: TOKEN,
    environment: SAFE_ENVIRONMENT,
    fetchImplementation: fake.fetchImplementation,
    ...options,
  })
}

function assertRemoteFailure(promise, pattern, exitCode = EXIT_CODES.REMOTE_FAILURE, sensitiveValues = []) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.exitCode, exitCode)
    assert.match(error.message, pattern)
    assert.equal(error.message.includes(TOKEN), false)
    for (const sensitive of sensitiveValues) assert.equal(error.message.includes(sensitive), false)
    return true
  })
}

test('canonical manifest remains unresolved and byte-identical', async () => {
  const before = readFileSync(MANIFEST_PATH)
  const beforeHash = fileHash(MANIFEST_PATH)
  const report = await collect()
  const after = readFileSync(MANIFEST_PATH)
  assert.deepEqual(after, before)
  assert.equal(fileHash(MANIFEST_PATH), beforeHash)
  assert.equal(manifest.cloudflare.account.status, 'unresolved')
  assert.equal(manifest.cloudflare.preview.worker.routeZoneIds.status, 'unresolved')
  assert.equal(manifest.cloudflare.production.pages.branch.status, 'unresolved')
  assert.equal(manifest.cloudflare.production.pages.domains.status, 'unresolved')
  assert.equal(report.configurationModified, false)
})

test('happy path returns deterministic untrusted identity evidence from GET-only local fakes', async () => {
  const firstFake = createFakeCloudflare()
  const secondFake = createFakeCloudflare()
  const first = await collect(firstFake)
  const second = await collect(secondFake)
  assert.deepEqual(first, second)
  assert.deepEqual(first.candidateIdentities, {
    'cloudflare.account.id': ACCOUNT_ID,
    'cloudflare.preview.worker.routeZoneIds': [...ZONE_IDS],
    'cloudflare.production.pages.branch': 'main',
    'cloudflare.production.pages.domains': [...PRODUCTION_DOMAINS].sort(),
  })
  assert.match(first.evidenceHash, /^[0-9a-f]{64}$/)
  assert.equal(first.manifestHash, loaded.hash)
  assert.deepEqual(first.stableObservation, { readCount: 2, matched: true })
  assert.equal(first.authority, 'untrusted-pending-independent-review')
  assert.equal(first.noRemoteMutation, true)
  assert.equal(first.ordinaryCheckPlanBlocked, true)
  assert.deepEqual(
    firstFake.contacts.map(({ url, options }) => ({ method: options.method, url })),
    expectedHappyPathRequests(),
  )
  for (const contact of firstFake.contacts) {
    assert.equal(contact.options.method, 'GET')
    assert.equal(contact.options.redirect, 'manual')
    assert.equal(contact.url.includes(PRODUCTION_WORKER), false)
    assert.equal(contact.url.includes(PRODUCTION_D1.id), false)
    assert.equal(contact.url.includes(PRODUCTION_D1.name), false)
    assert.equal(contact.url.includes('/query'), false)
    if (contact.key === 'zones') {
      const zoneUrl = new URL(contact.url)
      assert.equal(zoneUrl.searchParams.get('type'), 'full,partial,secondary,internal')
      assert.match(zoneUrl.search, /type=full%2Cpartial%2Csecondary%2Cinternal/)
    }
    if (contact.key === 'workerDomains') {
      const domainUrl = new URL(contact.url)
      assert.equal(domainUrl.searchParams.get('service'), PREVIEW_WORKER)
      assert.deepEqual([...domainUrl.searchParams.keys()], ['service'])
    }
  }
  assert.equal(firstFake.counts.get('accounts'), 2)
  assert.equal(firstFake.counts.get('pages'), 2)
  assert.equal(firstFake.counts.get('workerSettings'), 2)
  assert.equal(firstFake.counts.get('workerSubdomain'), 2)
  assert.equal(firstFake.counts.get('workerDomains'), 2)
  assert.equal(firstFake.counts.get('workerRoutes'), ZONE_IDS.length * 2)
  assert.equal(firstFake.counts.get('d1'), 2)
  assert.equal(firstFake.contacts.length, 20)
})

test('the exact public Node entry point leaves the complete controlled repository tree unchanged', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pennant-bootstrap-public-repository-'))
  const controlRoot = mkdtempSync(path.join(tmpdir(), 'pennant-bootstrap-public-control-'))
  try {
    mkdirSync(path.join(temporaryRoot, 'scripts'), { recursive: true })
    mkdirSync(path.join(temporaryRoot, 'config'), { recursive: true })
    mkdirSync(path.join(temporaryRoot, 'nested'), { recursive: true })
    cpSync(
      path.join(REPOSITORY_ROOT, 'scripts/preview-identity-bootstrap.mjs'),
      path.join(temporaryRoot, 'scripts/preview-identity-bootstrap.mjs'),
    )
    cpSync(
      path.join(REPOSITORY_ROOT, 'scripts/lib/preview-release'),
      path.join(temporaryRoot, 'scripts/lib/preview-release'),
      { recursive: true },
    )
    const temporaryManifest = clone(manifest)
    temporaryManifest.repository.allowedRoots = [temporaryRoot]
    writeFileSync(
      path.join(temporaryRoot, 'config/preview-release.json'),
      `${JSON.stringify(temporaryManifest, null, 2)}\n`,
    )
    writeFileSync(path.join(temporaryRoot, 'README.md'), 'Repository-wide write sentinel.\n')
    writeFileSync(path.join(temporaryRoot, 'nested/sentinel.bin'), Buffer.from([0, 1, 2, 3, 255]))
    chmodSync(path.join(temporaryRoot, 'nested/sentinel.bin'), 0o640)
    symlinkSync('../README.md', path.join(temporaryRoot, 'nested/readme-link'))
    const repositoryRootPolicyPath = path.join(temporaryRoot, 'nested/repository-root-policy.txt')
    writeFileSync(repositoryRootPolicyPath, `Immutable policy value: ${REPOSITORY_ROOT}\n`)
    assert.equal(readFileSync(repositoryRootPolicyPath, 'utf8').includes(REPOSITORY_ROOT), true)

    const preloadPath = path.join(controlRoot, 'public-entry-preload.mjs')
    const nodeWrapper = path.join(controlRoot, 'node')
    writeFileSync(preloadPath, publicEntryPreloadSource())
    writeFileSync(
      nodeWrapper,
      `#!/bin/sh\nexec ${shellSingleQuote(process.execPath)} --import ${shellSingleQuote(preloadPath)} "$@"\n`,
    )
    chmodSync(nodeWrapper, 0o755)

    assert.equal(readFileSync(preloadPath, 'utf8').includes(REPOSITORY_ROOT), false)
    assert.equal(readFileSync(nodeWrapper, 'utf8').includes(REPOSITORY_ROOT), false)

    const childEnvironment = {
      PATH: controlRoot,
      PENNANT_PREVIEW_API_TOKEN: 'pennant-phase15-public-entry-sentinel-not-a-real-secret',
    }
    assert.equal(childEnvironment.PENNANT_PREVIEW_API_TOKEN === process.env.PENNANT_PREVIEW_API_TOKEN, false)
    for (const key of GENERIC_CLOUDFLARE_CREDENTIALS) {
      assert.equal(Object.hasOwn(childEnvironment, key), false)
    }
    const controlledCheckoutBefore = snapshotControlledRepository(REPOSITORY_ROOT)
    assert.equal(
      controlledCheckoutBefore.some(({ path: relative }) => relative === 'scripts/lib/preview-release/local-state.mjs'),
      true,
    )
    const before = {
      controlledCheckout: controlledCheckoutBefore,
      temporaryRepository: snapshotTree(temporaryRoot),
    }
    const result = spawnSync('node', ['scripts/preview-identity-bootstrap.mjs', '--json', '--no-color'], {
      cwd: temporaryRoot,
      env: childEnvironment,
      encoding: 'utf8',
      shell: false,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, EXIT_CODES.SUCCESS, result.stderr)
    assert.equal(JSON.parse(result.stdout).status, 'PASS')
    const requestLine = result.stderr.split('\n').find((line) => line.startsWith('__PP15_PUBLIC_REQUESTS__'))
    assert.ok(requestLine)
    assert.deepEqual(
      JSON.parse(requestLine.slice('__PP15_PUBLIC_REQUESTS__'.length)),
      expectedHappyPathRequests(),
    )
    assert.deepEqual({
      controlledCheckout: snapshotControlledRepository(REPOSITORY_ROOT),
      temporaryRepository: snapshotTree(temporaryRoot),
    }, before)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
    rmSync(controlRoot, { recursive: true, force: true })
  }
})

test('human and JSON modes represent the same complete normalized report projection', async () => {
  const jsonLines = []
  const jsonCode = await runIdentityBootstrapCli(['--json', '--no-color'], {
    repositoryRoot: REPOSITORY_ROOT,
    environment: SAFE_ENVIRONMENT,
    fetchImplementation: createFakeCloudflare().fetchImplementation,
    output: { log(value) { jsonLines.push(value) } },
  })
  assert.equal(jsonCode, EXIT_CODES.SUCCESS)
  assert.equal(jsonLines.length, 1)
  const json = JSON.parse(jsonLines[0])
  assert.equal(json.status, 'PASS')
  assert.equal(jsonLines[0].includes(TOKEN), false)
  assert.equal(jsonLines[0].includes('\u001B'), false)

  const humanLines = []
  const humanCode = await runIdentityBootstrapCli(['--no-color'], {
    repositoryRoot: REPOSITORY_ROOT,
    environment: SAFE_ENVIRONMENT,
    fetchImplementation: createFakeCloudflare().fetchImplementation,
    output: { log(value) { humanLines.push(value) } },
  })
  assert.equal(humanCode, EXIT_CODES.SUCCESS)
  const human = humanLines.join('\n')
  assert.deepEqual(parseHumanProjection(human), json)
  assert.deepEqual(json, projectIdentityBootstrapReport(json))
  assert.equal(human.includes(TOKEN), false)
  assert.equal(human.includes('\u001B'), false)
  assert.match(human, /Production-specific Worker and D1 resources were not contacted/)
  assert.match(human, /Ordinary check and plan remain blocked pending a separately reviewed manifest grounding change/)

  const coloredLines = []
  await runIdentityBootstrapCli([], {
    repositoryRoot: REPOSITORY_ROOT,
    environment: SAFE_ENVIRONMENT,
    fetchImplementation: createFakeCloudflare().fetchImplementation,
    output: { log(value) { coloredLines.push(value) } },
  })
  assert.equal(
    coloredLines.join('\n').replaceAll(/\u001B\[[0-9;]*m/g, ''),
    human,
  )

  const defaultJsonLines = []
  await runIdentityBootstrapCli(['--json'], {
    repositoryRoot: REPOSITORY_ROOT,
    environment: SAFE_ENVIRONMENT,
    fetchImplementation: createFakeCloudflare().fetchImplementation,
    output: { log(value) { defaultJsonLines.push(value) } },
  })
  assert.deepEqual(JSON.parse(defaultJsonLines[0]), json)
})

test('CLI rejects positional arguments, unknown flags, duplicate flags, and runtime identity inputs', () => {
  for (const argv of [
    ['positional'],
    ['--unknown'],
    ['--json', '--json'],
    ['--account-id', ACCOUNT_ID],
    ['--zone-id', ZONE_IDS[0]],
    ['--production-branch', 'main'],
    ['--production-domain', 'example.invalid'],
    ['--url', 'https://api.cloudflare.com/client/v4/accounts'],
    ['--operation', 'accounts'],
    ['--query', 'page=1'],
  ]) {
    assert.throws(() => parseIdentityBootstrapArguments(argv), (error) => error.exitCode === EXIT_CODES.USAGE)
  }
  assert.deepEqual(parseIdentityBootstrapArguments(['--json', '--no-color']), { json: true, color: false })
})

test('missing dedicated token and every generic Cloudflare credential fallback are rejected before contact', async () => {
  const missing = createFakeCloudflare()
  await assertRemoteFailure(collectIdentityBootstrapEvidence({
    repositoryRoot: REPOSITORY_ROOT,
    environment: {},
    fetchImplementation: missing.fetchImplementation,
  }), /PENNANT_PREVIEW_API_TOKEN/)
  assert.equal(missing.contacts.length, 0)

  for (const key of GENERIC_CLOUDFLARE_CREDENTIALS) {
    const fake = createFakeCloudflare()
    const genericSecret = `generic-sensitive-fixture-${key}`
    await assertRemoteFailure(collectIdentityBootstrapEvidence({
      repositoryRoot: REPOSITORY_ROOT,
      token: TOKEN,
      environment: { ...SAFE_ENVIRONMENT, [key]: genericSecret },
      fetchImplementation: fake.fetchImplementation,
    }), new RegExp(key), EXIT_CODES.PRODUCTION_REFUSAL, [genericSecret])
    assert.equal(fake.contacts.length, 0)
  }

  const conflict = createFakeCloudflare()
  await assertRemoteFailure(collectIdentityBootstrapEvidence({
    repositoryRoot: REPOSITORY_ROOT,
    environment: { CF_EMAIL: 'generic-sensitive-fixture' },
    fetchImplementation: conflict.fetchImplementation,
  }), /CF_EMAIL/, EXIT_CODES.PRODUCTION_REFUSAL)
  assert.equal(conflict.contacts.length, 0)
  assert.equal(redactText('CF_EMAIL=generic-sensitive-fixture').includes('generic-sensitive-fixture'), false)
})

test('runtime account, route-zone, production-branch, and production-domain variables are rejected', async () => {
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CF_ACCOUNT_ID',
    'PENNANT_PREVIEW_ACCOUNT_ID',
    'PENNANT_PREVIEW_ROUTE_ZONE_IDS',
    'PENNANT_PRODUCTION_BRANCH',
    'PENNANT_PRODUCTION_DOMAINS',
  ]) {
    const fake = createFakeCloudflare()
    await assertRemoteFailure(collectIdentityBootstrapEvidence({
      repositoryRoot: REPOSITORY_ROOT,
      token: TOKEN,
      environment: { ...SAFE_ENVIRONMENT, [key]: 'runtime-fixture' },
      fetchImplementation: fake.fetchImplementation,
    }), new RegExp(key), EXIT_CODES.PRODUCTION_REFUSAL)
    assert.equal(fake.contacts.length, 0)
  }
})

for (const [name, accounts, message] of [
  ['zero accounts', [], /exactly one/],
  ['multiple accounts', [{ id: ACCOUNT_ID, name: 'Fixture account' }, { id: OTHER_ACCOUNT_ID, name: 'Other account' }], /exactly one/],
  ['duplicate account IDs', [{ id: ACCOUNT_ID, name: 'Fixture account' }, { id: ACCOUNT_ID, name: 'Fixture account' }], /duplicate/],
  ['malformed account ID', [{ id: 'not-an-account', name: 'Fixture account' }], /malformed/],
]) {
  test(`account inventory fails closed for ${name}`, async () => {
    const fake = createFakeCloudflare({
      accounts: ({ url }) => ({ result: accounts, resultInfo: accountPagination(Number(url.searchParams.get('page')), accounts) }),
    })
    await assertRemoteFailure(collect(fake), message)
    assert.equal(fake.counts.get('account') ?? 0, 0)
  })
}

test('account names are bounded, normalized deterministically, and cross-checked with account detail', async () => {
  assert.equal(normalizeAccountName('Cafe\u0301 account'), 'Café account')
  const canonicallyEquivalent = createFakeCloudflare({
    accounts: ({ url }) => {
      const result = [{ id: ACCOUNT_ID, name: 'Cafe\u0301 account' }]
      return { result, resultInfo: accountPagination(Number(url.searchParams.get('page')), result) }
    },
    account: { result: { id: ACCOUNT_ID, name: 'Café account' } },
  })
  const report = await collect(canonicallyEquivalent)
  assert.equal(report.crossChecks.accountNameConfirmed, true)
  assert.equal(JSON.stringify(report).includes('Café account'), false)

  for (const [label, name] of [
    ['empty', ''],
    ['whitespace-only', '   '],
    ['leading whitespace', ' Fixture account'],
    ['oversized', 'a'.repeat(101)],
    ['control character', 'Fixture\u000Aaccount'],
    ['format character', 'Fixture\u200Baccount'],
  ]) {
    const fake = createFakeCloudflare({
      accounts: ({ url }) => {
        const result = [{ id: ACCOUNT_ID, name }]
        return { result, resultInfo: accountPagination(Number(url.searchParams.get('page')), result) }
      },
    })
    await assertRemoteFailure(collect(fake), /account name/, EXIT_CODES.REMOTE_FAILURE)
    assert.equal(fake.counts.get('account') ?? 0, 0, label)
  }

  const conflicting = createFakeCloudflare({
    account: { result: { id: ACCOUNT_ID, name: 'Conflicting account' } },
  })
  await assertRemoteFailure(collect(conflicting), /names conflict/)
})

test('account pagination refuses incomplete, inconsistent, excessive, and changing inventories', async () => {
  const incomplete = createFakeCloudflare({
    accounts: ({ url }) => {
      const result = [{ id: ACCOUNT_ID, name: 'Fixture account' }]
      return { result, resultInfo: accountPagination(Number(url.searchParams.get('page')), result, 2) }
    },
  })
  await assertRemoteFailure(collect(incomplete), /declared complete inventory|incomplete or inconsistent/)

  const firstPageAccounts = Array.from({ length: 25 }, (_, index) => ({
    id: index.toString(16).padStart(32, '0'),
    name: `Fixture account ${index}`,
  }))
  const inconsistent = createFakeCloudflare({
    accounts: ({ url }) => {
      const page = Number(url.searchParams.get('page'))
      const result = page === 1 ? firstPageAccounts : [{ id: ACCOUNT_ID, name: 'Fixture account' }]
      return { result, resultInfo: accountPagination(page, result, page === 1 ? 26 : 27) }
    },
  })
  await assertRemoteFailure(collect(inconsistent), /changed, exceeded its bound, or was truncated|incomplete or inconsistent/)

  const excessive = createFakeCloudflare({
    accounts: ({ url }) => {
      const result = [{ id: ACCOUNT_ID, name: 'Fixture account' }]
      return { result, resultInfo: accountPagination(Number(url.searchParams.get('page')), result, 251) }
    },
  })
  await assertRemoteFailure(collect(excessive), /incomplete or inconsistent/)

  const changing = createFakeCloudflare({
    accounts: ({ url, count }) => {
      const result = [{ id: count === 1 ? ACCOUNT_ID : OTHER_ACCOUNT_ID, name: 'Fixture account' }]
      return { result, resultInfo: accountPagination(Number(url.searchParams.get('page')), result) }
    },
  })
  await assertRemoteFailure(collect(changing), /observations changed/)
})

test('documented account pagination omits total_pages, derives bounded traversal, and rejects contradictions', async () => {
  const records = Array.from({ length: 26 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(32, '0'),
    name: `Fixture account ${index}`,
  }))
  const derived = createFakeCloudflare({
    accounts: ({ url }) => {
      const page = Number(url.searchParams.get('page'))
      const result = records.slice((page - 1) * 25, page * 25)
      return { result, resultInfo: accountPagination(page, result, records.length) }
    },
  })
  await assertRemoteFailure(collect(derived), /exactly one/)
  assert.equal(derived.counts.get('accounts'), 2)

  const malformedValues = [
    { count: -1, page: 1, per_page: 25, total_count: 1 },
    { count: 1, page: 0, per_page: 25, total_count: 1 },
    { count: 1, page: 1, per_page: 0, total_count: 1 },
    { count: 1, page: 1, per_page: 25.5, total_count: 1 },
    { count: 1, page: 1, per_page: 25, total_count: Number.MAX_SAFE_INTEGER + 1 },
    { count: 1, page: 1, per_page: 25, total_count: 1, total_pages: 2 },
  ]
  for (const resultInfo of malformedValues) {
    const fake = createFakeCloudflare({
      accounts: { result: [{ id: ACCOUNT_ID, name: 'Fixture account' }], resultInfo },
    })
    await assertRemoteFailure(collect(fake), /pagination metadata/)
    assert.equal(fake.counts.get('accounts'), 1)
  }
})

test('paginated responses reject 26 records at per_page 25 before a second request', async () => {
  const records = Array.from({ length: 26 }, (_, index) => ({
    id: index.toString(16).padStart(32, '0'),
    name: `Fixture account ${index}`,
  }))
  const fake = createFakeCloudflare({
    accounts: ({ url }) => ({
      result: records,
      resultInfo: accountPagination(Number(url.searchParams.get('page')), records, 26),
    }),
  })
  await assertRemoteFailure(collect(fake), /incomplete or inconsistent/)
  assert.equal(fake.counts.get('accounts'), 1)
  assert.equal(fake.contacts.length, 1)

  const wrongPageSize = createFakeCloudflare({
    accounts: ({ url }) => {
      const records = [{ id: ACCOUNT_ID, name: 'Fixture account' }]
      return {
        result: records,
        resultInfo: {
          ...accountPagination(Number(url.searchParams.get('page')), records),
          per_page: 24,
        },
      }
    },
  })
  await assertRemoteFailure(collect(wrongPageSize), /incomplete or inconsistent/)
  assert.equal(wrongPageSize.counts.get('accounts'), 1)
})

for (const [name, zones, message] of [
  ['empty zone inventory', [], /empty/],
  ['malformed zone ID', [{ id: 'bad-zone', account: { id: ACCOUNT_ID } }], /malformed/],
  ['duplicate zones', [{ id: ZONE_IDS[0], account: { id: ACCOUNT_ID } }, { id: ZONE_IDS[0], account: { id: ACCOUNT_ID } }], /duplicate/],
  ['zone owned by another account', [{ id: ZONE_IDS[0], account: { id: OTHER_ACCOUNT_ID } }], /does not match/],
]) {
  test(`zone inventory fails closed for ${name}`, async () => {
    const fake = createFakeCloudflare({
      zones: ({ url }) => ({ result: zones, resultInfo: pagination(Number(url.searchParams.get('page')), zones) }),
    })
    await assertRemoteFailure(collect(fake), message, name.includes('owned') ? EXIT_CODES.PRODUCTION_REFUSAL : EXIT_CODES.REMOTE_FAILURE)
  })
}

test('the fixed all-type zone request includes and retains internal zones', async () => {
  const internalZone = { id: ZONE_IDS[0], type: 'internal', account: { id: ACCOUNT_ID } }
  const fake = createFakeCloudflare({
    zones: ({ url }) => {
      assert.equal(url.searchParams.get('type'), 'full,partial,secondary,internal')
      return {
        result: [internalZone],
        resultInfo: pagination(Number(url.searchParams.get('page')), [internalZone]),
      }
    },
  })
  const report = await collect(fake)
  assert.deepEqual(report.candidateIdentities['cloudflare.preview.worker.routeZoneIds'], [ZONE_IDS[0]])
})

test('zone pagination refuses incomplete, inconsistent, excessive, and changing inventories', async () => {
  const incomplete = createFakeCloudflare({
    zones: ({ url }) => {
      const result = [{ id: ZONE_IDS[0], account: { id: ACCOUNT_ID } }]
      return { result, resultInfo: pagination(Number(url.searchParams.get('page')), result, 2, 1) }
    },
  })
  await assertRemoteFailure(collect(incomplete), /declared complete inventory|incomplete or inconsistent/)

  const pageOneZones = Array.from({ length: 25 }, (_, index) => ({
    id: index.toString(16).padStart(32, '0'),
    account: { id: ACCOUNT_ID },
  }))
  const inconsistent = createFakeCloudflare({
    zones: ({ url }) => {
      const page = Number(url.searchParams.get('page'))
      const result = page === 1 ? pageOneZones : [{ id: ZONE_IDS[0], account: { id: ACCOUNT_ID } }]
      return { result, resultInfo: pagination(page, result, page === 1 ? 26 : 27, 2) }
    },
  })
  await assertRemoteFailure(collect(inconsistent), /changed, exceeded its bound, or was truncated|incomplete or inconsistent/)

  const excessive = createFakeCloudflare({
    zones: ({ url }) => {
      const result = [{ id: ZONE_IDS[0], account: { id: ACCOUNT_ID } }]
      return { result, resultInfo: pagination(Number(url.searchParams.get('page')), result, 251, 11) }
    },
  })
  await assertRemoteFailure(collect(excessive), /incomplete or inconsistent/)

  const changing = createFakeCloudflare({
    zones: ({ url, count }) => {
      const id = count === 1 ? ZONE_IDS[0] : ZONE_IDS[1]
      const result = [{ id, account: { id: ACCOUNT_ID } }]
      return { result, resultInfo: pagination(Number(url.searchParams.get('page')), result) }
    },
    workerDomains: { result: [], resultInfo: servicePagination([]) },
  })
  await assertRemoteFailure(collect(changing), /observations changed/)
})

test('251 grounded zones are rejected before route fan-out and with one zone request', async () => {
  const firstPage = Array.from({ length: 25 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(32, '0'),
    account: { id: ACCOUNT_ID },
  }))
  const fake = createFakeCloudflare({
    zones: ({ url }) => ({
      result: firstPage,
      resultInfo: pagination(Number(url.searchParams.get('page')), firstPage, 251, 11),
    }),
  })
  await assertRemoteFailure(collect(fake), /incomplete or inconsistent/)
  assert.equal(fake.counts.get('zones'), 1)
  assert.equal(fake.counts.get('workerRoutes') ?? 0, 0)
  assert.equal(fake.contacts.length, 3)
})

test('final-page cardinality rejects truncation and extra records after exactly ten requests', async () => {
  for (const finalCount of [23, 25]) {
    const fake = createFakeCloudflare({
      zones: ({ url }) => {
        const page = Number(url.searchParams.get('page'))
        const count = page < 10 ? 25 : finalCount
        const offset = (page - 1) * 25
        const records = Array.from({ length: count }, (_, index) => ({
          id: (offset + index + 1).toString(16).padStart(32, '0'),
          account: { id: ACCOUNT_ID },
        }))
        return { result: records, resultInfo: pagination(page, records, 249, 10) }
      },
    })
    await assertRemoteFailure(collect(fake), /incomplete or inconsistent/)
    assert.equal(fake.counts.get('zones'), 10)
    assert.equal(fake.counts.get('workerRoutes') ?? 0, 0)
  }
})

test('the exact 250-zone and route-fan-out boundary is accepted with bounded request counts', async () => {
  const zoneIds = Array.from({ length: 250 }, (_, index) => (
    (index + 1).toString(16).padStart(32, '0')
  ))
  const fake = createFakeCloudflare({
    zones: ({ url }) => {
      const page = Number(url.searchParams.get('page'))
      const records = zoneIds.slice((page - 1) * 25, page * 25)
        .map((id) => ({ id, account: { id: ACCOUNT_ID } }))
      return { result: records, resultInfo: pagination(page, records, 250, 10) }
    },
    workerRoutes: ({ url }) => {
      const zoneId = url.pathname.split('/')[4]
      return { result: [route(zoneId)] }
    },
    workerDomains: { result: [], resultInfo: servicePagination([]) },
  })
  const report = await collect(fake)
  assert.equal(report.candidateIdentities['cloudflare.preview.worker.routeZoneIds'].length, 250)
  assert.equal(report.crossChecks.groundedRouteInventoryCount, 250)
  assert.equal(fake.counts.get('accounts'), 2)
  assert.equal(fake.counts.get('zones'), 20)
  assert.equal(fake.counts.get('workerRoutes'), 500)
  assert.equal(fake.contacts.length, 534)
})

test('custom-domain and route inventories enforce bounded single-page and aggregate caps', async () => {
  const maximumRoutes = Array.from({ length: 250 }, (_, index) => route(index))
  const exact = createFakeCloudflare({
    workerRoutes: ({ url }) => ({
      result: url.pathname.includes(ZONE_IDS[0]) ? maximumRoutes.slice(0, 125) : maximumRoutes.slice(125),
    }),
  })
  const report = await collect(exact)
  assert.equal(report.crossChecks.previewWorkerCustomDomainCount, 0)
  assert.equal(report.crossChecks.groundedRouteInventoryCount, 250)
  assert.equal(exact.counts.get('workerDomains'), 2)
  assert.equal(exact.counts.get('workerRoutes'), 4)

  const maximumDomains = Array.from({ length: 251 }, (_, index) => customDomain(index))
  const excessiveDomains = createFakeCloudflare({
    workerDomains: {
      result: maximumDomains,
      resultInfo: servicePagination(maximumDomains, { per_page: 251 }),
    },
  })
  await assertRemoteFailure(collect(excessiveDomains), /record bound/)
  assert.equal(excessiveDomains.counts.get('workerDomains'), 1)
  assert.equal(excessiveDomains.counts.get('workerRoutes') ?? 0, 0)

  const excessiveSingleRoutePage = createFakeCloudflare({
    workerRoutes: { result: [...maximumRoutes, route(250)] },
  })
  await assertRemoteFailure(collect(excessiveSingleRoutePage), /record bound/)
  assert.equal(excessiveSingleRoutePage.counts.get('workerRoutes'), 1)

  const aggregateRouteBreach = createFakeCloudflare({
    workerRoutes: ({ url }) => ({
      result: url.pathname.includes(ZONE_IDS[0])
        ? maximumRoutes.slice(0, 125)
        : [...maximumRoutes.slice(125), route(250)],
    }),
  })
  await assertRemoteFailure(collect(aggregateRouteBreach), /aggregate record bound/)
  assert.equal(aggregateRouteBreach.counts.get('workerRoutes'), 2)
})

test('Preview Worker route or custom-domain exposure fails closed', async () => {
  const routed = createFakeCloudflare({
    workerRoutes: () => ({
      result: [{
        id: 'f'.repeat(32),
        pattern: 'preview.example.invalid/*',
        script: PREVIEW_WORKER,
      }],
    }),
  })
  await assertRemoteFailure(collect(routed), /public route/, EXIT_CODES.PRODUCTION_REFUSAL)

  const domain = createFakeCloudflare({
    workerDomains: {
      result: [customDomain(0, { hostname: 'preview.example.invalid' })],
      resultInfo: servicePagination([{}]),
    },
  })
  await assertRemoteFailure(collect(domain), /custom domain/, EXIT_CODES.PRODUCTION_REFUSAL)
})

test('route records reject coercion, non-data shapes, duplicates, and conflicts before non-exposure', async () => {
  const valid = route(0)
  const serializedInvalid = [
    ['numeric id', { ...valid, id: 1 }],
    ['numeric pattern', { ...valid, pattern: 1 }],
    ['numeric script', { ...valid, script: 1 }],
    ['Boolean id', { ...valid, id: true }],
    ['Boolean pattern', { ...valid, pattern: false }],
    ['Boolean script', { ...valid, script: true }],
    ['null id', { ...valid, id: null }],
    ['null pattern', { ...valid, pattern: null }],
    ['null script', { ...valid, script: null }],
    ['object id', { ...valid, id: { value: valid.id } }],
    ['object pattern', { ...valid, pattern: { value: valid.pattern } }],
    ['object script', { ...valid, script: { value: valid.script } }],
    ['array id', { ...valid, id: [valid.id] }],
    ['array pattern', { ...valid, pattern: [valid.pattern] }],
    ['array script', { ...valid, script: [valid.script] }],
    ['unknown extra key', { ...valid, unexpected: true }],
    ['empty id', { ...valid, id: '' }],
    ['empty pattern', { ...valid, pattern: '' }],
    ['whitespace-only script', { ...valid, script: '   ' }],
  ]
  for (const [label, record] of serializedInvalid) {
    const fake = createFakeCloudflare({ workerRoutes: { result: [record] } })
    await assertRemoteFailure(collect(fake), /Worker route/, EXIT_CODES.REMOTE_FAILURE)
    assert.equal(fake.counts.get('workerRoutes'), 1, label)
    assert.equal(fake.counts.get('d1') ?? 0, 0, label)
    assert.equal(fake.counts.get('unexpected') ?? 0, 0, label)
  }

  for (const [label, records, message] of [
    ['duplicate route ID', [valid, { ...valid }], /duplicated/],
    ['conflicting duplicate route ID', [valid, { ...valid, pattern: 'different.example.invalid/*' }], /conflicting records/],
    ['conflicting duplicate route pattern', [valid, { ...route(1), pattern: valid.pattern }], /conflicting records/],
  ]) {
    const fake = createFakeCloudflare({ workerRoutes: { result: records } })
    await assertRemoteFailure(collect(fake), message, EXIT_CODES.REMOTE_FAILURE)
    assert.equal(fake.counts.get('workerRoutes'), 1, label)
    assert.equal(fake.counts.get('d1') ?? 0, 0, label)
    assert.equal(fake.counts.get('unexpected') ?? 0, 0, label)
  }

  const accessor = { id: valid.id, pattern: valid.pattern }
  Object.defineProperty(accessor, 'script', {
    enumerable: true,
    get() { return valid.script },
  })
  const inherited = Object.assign(Object.create({ id: valid.id }), {
    pattern: valid.pattern,
    script: valid.script,
  })
  const symbolKey = { ...valid, [Symbol('security-relevant')]: 'unexpected' }
  const nonEnumerable = { pattern: valid.pattern, script: valid.script }
  Object.defineProperty(nonEnumerable, 'id', { enumerable: false, value: valid.id })
  const exotic = new (class RouteRecord {
    constructor() {
      Object.assign(this, valid)
    }
  })()
  const nullPrototype = Object.assign(Object.create(null), valid)
  const arrayRecord = Object.assign([], valid)
  for (const [label, record] of [
    ['accessor property', accessor],
    ['inherited property', inherited],
    ['symbol key', symbolKey],
    ['non-enumerable security-relevant field', nonEnumerable],
    ['exotic prototype', exotic],
    ['null prototype', nullPrototype],
    ['array record', arrayRecord],
  ]) {
    assert.throws(
      () => normalizeWorkerRouteInventory([record], {
        zoneId: ZONE_IDS[0],
        previewWorker: PREVIEW_WORKER,
      }),
      (error) => error.exitCode === EXIT_CODES.REMOTE_FAILURE,
      label,
    )
  }

  const unrelated = normalizeWorkerRouteInventory([route(1), valid], {
    zoneId: ZONE_IDS[0],
    previewWorker: PREVIEW_WORKER,
  })
  assert.deepEqual(unrelated.map(({ id }) => id), [valid.id, route(1).id])
  const scriptless = { id: 'e'.repeat(32), pattern: 'disabled.example.invalid/*' }
  assert.deepEqual(
    normalizeWorkerRouteInventory([scriptless], {
      zoneId: ZONE_IDS[0],
      previewWorker: PREVIEW_WORKER,
    }),
    [{ ...scriptless, script: null, zoneId: ZONE_IDS[0] }],
  )
  const documentedPatterns = [
    'example.invalid',
    '*example.invalid/images/cat.png',
    '*.example.invalid/*',
    'https://*.example.invalid/images/*',
    'http://example.invalid/path*',
  ]
  assert.equal(normalizeWorkerRouteInventory(
    documentedPatterns.map((pattern, index) => ({
      id: (index + 10).toString(16).padStart(32, '0'),
      pattern,
    })),
    {
      zoneId: ZONE_IDS[0],
      previewWorker: PREVIEW_WORKER,
    },
  ).length, documentedPatterns.length)
  for (const pattern of [
    'ftp://example.invalid/*',
    'example.invalid/*.jpg',
    'example.invalid/path*more',
    'example.invalid/**',
    'example.invalid/?query=value',
    'ex*ample.invalid/*',
  ]) {
    assert.throws(
      () => normalizeWorkerRouteInventory([{
        id: 'f'.repeat(32),
        pattern,
      }], {
        zoneId: ZONE_IDS[0],
        previewWorker: PREVIEW_WORKER,
      }),
      /Worker route inventory is malformed/,
      pattern,
    )
  }
  const scriptlessInventory = createFakeCloudflare({
    workerRoutes: ({ url }) => {
      const zoneId = url.pathname.split('/')[4]
      return {
        result: [{
          id: zoneId,
          pattern: `disabled-${zoneId[0]}.example.invalid/*`,
        }],
      }
    },
  })
  const scriptlessReport = await collect(scriptlessInventory)
  assert.equal(scriptlessReport.crossChecks.groundedRouteInventoryCount, ZONE_IDS.length)

  const duplicatePatternAcrossZones = createFakeCloudflare({
    workerRoutes: ({ url }) => ({
      result: [{
        id: url.pathname.split('/')[4],
        pattern: 'duplicate-across-zones.example.invalid/*',
        script: 'unrelated-worker',
      }],
    }),
  })
  await assertRemoteFailure(
    collect(duplicatePatternAcrossZones),
    /conflicting records for one route pattern/,
    EXIT_CODES.REMOTE_FAILURE,
  )
  assert.equal(duplicatePatternAcrossZones.counts.get('workerRoutes'), ZONE_IDS.length)
  assert.equal(duplicatePatternAcrossZones.counts.get('d1') ?? 0, 0)

  assert.throws(
    () => normalizeWorkerRouteInventory([{ ...valid, script: PREVIEW_WORKER }], {
      zoneId: ZONE_IDS[0],
      previewWorker: PREVIEW_WORKER,
    }),
    (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL,
  )
})

test('custom domains accept the official record shape, handle deprecated environment, and fail closed on malformed or conflicting evidence', async () => {
  const valid = customDomain(0)
  const without = (key) => Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key))
  const invalid = [
    ['missing id', without('id'), /missing required field id/],
    ['missing cert_id', without('cert_id'), /missing required field cert_id/],
    ['missing hostname', without('hostname'), /missing required field hostname/],
    ['missing zone_id', without('zone_id'), /missing required field zone_id/],
    ['missing zone_name', without('zone_name'), /missing required field zone_name/],
    ['malformed id', { ...valid, id: 'not an ID' }, /malformed or duplicated/],
    ['malformed cert_id', { ...valid, cert_id: 'not-a-uuid' }, /malformed or duplicated/],
    ['malformed hostname', { ...valid, hostname: '*example.invalid' }, /malformed or duplicated/],
    ['empty zone_id', { ...valid, zone_id: '' }, /malformed or duplicated/],
    ['malformed zone_id', { ...valid, zone_id: 'not-a-zone' }, /malformed or duplicated/],
    ['ungrounded zone_id', { ...valid, zone_id: 'f'.repeat(32) }, /malformed or duplicated/],
    ['empty environment', { ...valid, environment: '' }, /malformed or duplicated/],
    ['null environment', { ...valid, environment: null }, /malformed or duplicated/],
    ['missing service', without('service'), /missing required field service/],
    ['empty service', { ...valid, service: '' }, /malformed or duplicated/],
    ['wrong zone_name', { ...valid, zone_name: 'different.invalid' }, /malformed or duplicated/],
    ['unexpected field', { ...valid, unexpected: true }, /undocumented field/],
  ]
  for (const [label, domain, message] of invalid) {
    const fake = createFakeCloudflare({
      workerDomains: { result: [domain], resultInfo: servicePagination([domain]) },
    })
    await assertRemoteFailure(collect(fake), message)
    assert.equal(fake.counts.get('workerDomains'), 1, label)
    assert.equal(fake.counts.get('workerRoutes') ?? 0, 0, label)
  }

  for (const [label, domains, message] of [
    ['duplicate record', [valid, { ...valid }], /malformed or duplicated/],
    ['conflicting ID', [valid, { ...valid, hostname: 'other.example.invalid' }], /conflicting records/],
    ['conflicting hostname', [valid, { ...customDomain(1), hostname: valid.hostname }], /conflicting records/],
    ['mixed relevant and irrelevant services', [valid, { ...customDomain(1), service: 'different-worker' }], /fixed Preview service filter/],
  ]) {
    const fake = createFakeCloudflare({
      workerDomains: { result: domains, resultInfo: servicePagination(domains) },
    })
    await assertRemoteFailure(collect(fake), message)
    assert.equal(fake.counts.get('workerRoutes') ?? 0, 0)
    assert.equal(fake.counts.get('workerDomains'), 1, label)
  }

  for (const domain of [
    without('environment'),
    valid,
    { ...valid, environment: 'staging' },
    { ...valid, cert_id: valid.cert_id.toUpperCase() },
  ]) {
    const official = createFakeCloudflare({
      workerDomains: { result: [domain], resultInfo: servicePagination([domain]) },
    })
    await assertRemoteFailure(collect(official), /custom domain/, EXIT_CODES.PRODUCTION_REFUSAL)
  }
})

test('custom-domain completeness requires consistent single-page metadata for the fixed service filter', async () => {
  for (const [label, override] of [
    ['absent metadata', { result: [] }],
    ['multi-page metadata', { result: [], resultInfo: servicePagination([], { total_count: 21, total_pages: 2 }) }],
    ['truncated count', { result: [], resultInfo: servicePagination([], { total_count: 1 }) }],
    ['wrong page', { result: [], resultInfo: servicePagination([], { page: 2 }) }],
    ['zero page size', { result: [], resultInfo: servicePagination([], { per_page: 0 }) }],
    ['unsafe count', { result: [], resultInfo: servicePagination([], { total_count: Number.MAX_SAFE_INTEGER + 1 }) }],
  ]) {
    const fake = createFakeCloudflare({ workerDomains: override })
    await assertRemoteFailure(collect(fake), /pagination metadata|incomplete or unverifiable/)
    assert.equal(fake.counts.get('workerDomains'), 1, label)
    assert.equal(fake.counts.get('workerRoutes') ?? 0, 0, label)
  }

  const complete = createFakeCloudflare({
    workerDomains: { result: [], resultInfo: servicePagination([]) },
  })
  const report = await collect(complete)
  assert.equal(report.crossChecks.previewWorkerCustomDomainFilterApplied, true)
  assert.equal(report.crossChecks.previewWorkerCustomDomainCount, 0)
})

test('workers.dev and Worker Preview URLs must both remain disabled', async () => {
  for (const settings of [
    { enabled: true, previews_enabled: false },
    { enabled: false, previews_enabled: true },
  ]) {
    const fake = createFakeCloudflare({ workerSubdomain: { result: settings } })
    await assertRemoteFailure(collect(fake), /workers\.dev or Preview URLs/, EXIT_CODES.PRODUCTION_REFUSAL)
  }
})

test('Pages project and production branch validation enforces the complete local ref grammar', async () => {
  await assertRemoteFailure(collect(createFakeCloudflare({
    pages: { result: { name: 'wrong-project', production_branch: 'main', domains: PRODUCTION_DOMAINS } },
  })), /does not match/, EXIT_CODES.PRODUCTION_REFUSAL)

  const invalidBranches = [
    undefined,
    '',
    '@',
    '-main',
    '--main',
    ' -main',
    '/foo',
    'foo/',
    'foo//bar',
    '.foo',
    'foo/.bar',
    'foo/bar.lock/baz',
    'foo.lock',
    'foo.',
    'foo..bar',
    'foo/@{bar',
    'bad branch',
    'bad~branch',
    'bad^branch',
    'bad:branch',
    'bad?branch',
    'bad*branch',
    'bad[branch',
    String.raw`bad\branch`,
    'bad\u0000branch',
    'bad\u001Fbranch',
    'bad\u007Fbranch',
    'a'.repeat(256),
  ]
  for (const productionBranch of invalidBranches) {
    const fake = createFakeCloudflare({
      pages: {
        result: {
          name: manifest.cloudflare.preview.pages.project,
          ...(productionBranch === undefined ? {} : { production_branch: productionBranch }),
          domains: PRODUCTION_DOMAINS,
        },
      },
    })
    await assertRemoteFailure(collect(fake), /branch/)
    assert.equal(fake.counts.get('pages'), 1, JSON.stringify(productionBranch))
  }

  await assertRemoteFailure(collect(createFakeCloudflare({
    pages: {
      result: {
        name: manifest.cloudflare.preview.pages.project,
        production_branch: 'develop',
        domains: PRODUCTION_DOMAINS,
      },
    },
  })), /branch/, EXIT_CODES.PRODUCTION_REFUSAL)

  for (const validBranch of [
    'main',
    'release/2026/july',
    'Release/2026',
    'feature/-child',
    '–main',
    'é',
    'e\u0301',
    'a'.repeat(255),
  ]) {
    const report = await collect(createFakeCloudflare({
      pages: {
        result: {
          name: manifest.cloudflare.preview.pages.project,
          production_branch: validBranch,
          domains: PRODUCTION_DOMAINS,
        },
      },
    }))
    assert.equal(report.candidateIdentities['cloudflare.production.pages.branch'], validBranch)
  }
})

test('Production domains enforce strict label and total hostname bounds without normalization into validity', async () => {
  const invalid = [
    [null, /unexpected JSON shape/],
    [[], /empty/],
    [[''], /empty or malformed/],
    [['*.example.invalid'], /malformed or wildcard/],
    [['example.invalid.'], /malformed or wildcard/],
    [['example..invalid'], /malformed or wildcard/],
    [[`${'a'.repeat(64)}.example.invalid`], /malformed or wildcard/],
    [[OVERLENGTH_HOSTNAME], /malformed or wildcard/],
    [['éxample.example.invalid'], /malformed or wildcard/],
    [['WWW.EXAMPLE.INVALID', 'www.example.invalid'], /duplicate/],
    [['develop.diamond-draft.pages.dev'], /collides/],
  ]
  for (const [domains, message] of invalid) {
    const fake = createFakeCloudflare({
      pages: {
        result: {
          name: manifest.cloudflare.preview.pages.project,
          production_branch: 'main',
          domains,
        },
      },
    })
    await assertRemoteFailure(collect(fake), message, message.source.includes('collides') ? EXIT_CODES.PRODUCTION_REFUSAL : EXIT_CODES.REMOTE_FAILURE)
  }

  for (const [observed, normalized] of [
    [MAXIMUM_HOSTNAME, MAXIMUM_HOSTNAME],
    [`${'a'.repeat(63)}.example.invalid`, `${'a'.repeat(63)}.example.invalid`],
    ['WWW.EXAMPLE.INVALID', 'www.example.invalid'],
  ]) {
    const report = await collect(createFakeCloudflare({
      pages: {
        result: {
          name: manifest.cloudflare.preview.pages.project,
          production_branch: 'main',
          domains: [observed],
        },
      },
    }))
    assert.deepEqual(report.candidateIdentities['cloudflare.production.pages.domains'], [normalized])
  }

  const changing = createFakeCloudflare({
    pages: ({ count }) => ({
      result: {
        name: manifest.cloudflare.preview.pages.project,
        production_branch: 'main',
        domains: count === 1 ? PRODUCTION_DOMAINS : ['changed.example.invalid'],
      },
    }),
  })
  await assertRemoteFailure(collect(changing), /observations changed/)
})

test('Worker custom domains use the same strict 253-character hostname boundary', async () => {
  const exactDomain = customDomain(0, { hostname: MAXIMUM_HOSTNAME, zone_name: MAXIMUM_HOSTNAME })
  const exact = createFakeCloudflare({
    workerDomains: {
      result: [exactDomain],
      resultInfo: servicePagination([exactDomain]),
    },
  })
  await assertRemoteFailure(collect(exact), /custom domain/, EXIT_CODES.PRODUCTION_REFUSAL)

  for (const hostname of [
    OVERLENGTH_HOSTNAME,
    `${'a'.repeat(64)}.example.invalid`,
    'example.invalid.',
    'example..invalid',
    '*.example.invalid',
  ]) {
    const domain = customDomain(0, { hostname })
    const malformed = createFakeCloudflare({
      workerDomains: {
        result: [domain],
        resultInfo: servicePagination([domain]),
      },
    })
    await assertRemoteFailure(collect(malformed), /custom-domain inventory is malformed/)
    assert.equal(malformed.counts.get('workerDomains'), 1)
    assert.equal(malformed.counts.get('workerRoutes') ?? 0, 0)
  }
})

test('Preview D1 UUID and name must match both reviewed anchors', async () => {
  for (const result of [
    { uuid: '00000000-0000-0000-0000-000000000000', name: PREVIEW_D1.name },
    { uuid: PREVIEW_D1.id, name: 'wrong-preview-database' },
  ]) {
    const fake = createFakeCloudflare({ d1: { result } })
    await assertRemoteFailure(collect(fake), /Preview D1/, EXIT_CODES.PRODUCTION_REFUSAL)
  }
})

test('missing or changing Preview Worker identity fails closed', async () => {
  const missing = createFakeCloudflare({ workerSettings: { result: null } })
  await assertRemoteFailure(collect(missing), /unexpected JSON shape/)

  const changing = createFakeCloudflare({
    workerSettings: ({ count }) => count === 1
      ? { result: {} }
      : new Response('missing', { status: 404, headers: { 'content-type': 'application/json' } }),
  })
  await assertRemoteFailure(collect(changing), /HTTP 404/)
})

test('candidate manifest resolves only the four approved fields and passes strict validation', () => {
  const observation = {
    account: { id: ACCOUNT_ID },
    routeZoneIds: [...ZONE_IDS],
    pages: { productionBranch: 'main', productionDomains: [...PRODUCTION_DOMAINS].sort() },
  }
  const candidate = constructIdentityBootstrapCandidate(manifest, observation)
  assert.equal(candidate.cloudflare.account.status, 'resolved')
  assert.equal(candidate.cloudflare.preview.worker.routeZoneIds.status, 'resolved')
  assert.equal(candidate.cloudflare.production.pages.branch.status, 'resolved')
  assert.equal(candidate.cloudflare.production.pages.domains.status, 'resolved')
  assert.ok(Object.isFrozen(candidate))

  const restored = clone(candidate)
  restored.cloudflare.account = clone(manifest.cloudflare.account)
  restored.cloudflare.preview.worker.routeZoneIds = clone(manifest.cloudflare.preview.worker.routeZoneIds)
  restored.cloudflare.production.pages.branch = clone(manifest.cloudflare.production.pages.branch)
  restored.cloudflare.production.pages.domains = clone(manifest.cloudflare.production.pages.domains)
  assert.equal(canonicalHash(restored), canonicalHash(manifest))

  assert.throws(() => constructIdentityBootstrapCandidate(manifest, {
    ...observation,
    pages: { ...observation.pages, productionDomains: ['not a hostname'] },
  }), /Production domains are malformed/)
  assert.throws(() => constructIdentityBootstrapCandidate(manifest, {
    ...observation,
    pages: { ...observation.pages, productionDomains: [OVERLENGTH_HOSTNAME] },
  }), /Production domains are malformed/)
  assert.throws(() => constructIdentityBootstrapCandidate(manifest, {
    ...observation,
    pages: { ...observation.pages, productionBranch: 'bad branch' },
  }), /Production branch is malformed/)
  assert.doesNotThrow(() => constructIdentityBootstrapCandidate(manifest, {
    ...observation,
    pages: { ...observation.pages, productionDomains: [MAXIMUM_HOSTNAME] },
  }))

  const loadedCandidate = clone(manifest)
  loadedCandidate.cloudflare.account = { status: 'resolved', id: ACCOUNT_ID, reason: '' }
  loadedCandidate.cloudflare.preview.worker.routeZoneIds = { status: 'resolved', values: [...ZONE_IDS], reason: '' }
  loadedCandidate.cloudflare.production.pages.branch = { status: 'resolved', value: 'bad branch', reason: '' }
  loadedCandidate.cloudflare.production.pages.domains = { status: 'resolved', values: [...PRODUCTION_DOMAINS], reason: '' }
  assert.throws(() => validateReleaseManifest(loadedCandidate), /Production branch is malformed/)
})

test('transport rejects redirects, non-JSON, malformed JSON, invalid UTF-8, and a BOM without retry', async () => {
  const cases = [
    [new Response('', { status: 302, headers: { location: 'https://example.invalid/' } }), /redirect/],
    [new Response('{}', { headers: { 'content-type': 'text/plain' } }), /application\/json/],
    [new Response('{', { headers: { 'content-type': 'application/json' } }), /malformed JSON/],
    [new Response(new Uint8Array([0xC3, 0x28]), { headers: { 'content-type': 'application/json' } }), /valid UTF-8/],
    [new Response(new Uint8Array([0xEF, 0xBB, 0xBF, 0x7B, 0x7D]), { headers: { 'content-type': 'application/json' } }), /BOM/],
  ]
  for (const [response, message] of cases) {
    let contacts = 0
    const client = createIdentityBootstrapCloudflareClient({
      manifest,
      token: TOKEN,
      fetchImplementation: async () => {
        contacts += 1
        return response
      },
    })
    await assertRemoteFailure(client.request('accounts', { page: 1 }), message)
    assert.equal(contacts, 1)
  }
})

test('transport accepts only the complete reviewed application/json media-type grammar', async () => {
  const payload = JSON.stringify({
    success: true,
    result: [{ id: ACCOUNT_ID, name: 'Fixture account' }],
    result_info: accountPagination(1, [{ id: ACCOUNT_ID, name: 'Fixture account' }]),
  })
  const responseWithRawContentType = (contentType) => {
    const body = new Response(payload).body
    return {
      status: 200,
      ok: true,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'content-type') return contentType
          if (name.toLowerCase() === 'content-length') return null
          return null
        },
      },
      body,
    }
  }
  for (const contentType of [
    'application/json',
    'Application/JSON',
    'application/json; charset=utf-8',
    'application/json ; Charset = "UTF-8"',
  ]) {
    let contacts = 0
    const client = createIdentityBootstrapCloudflareClient({
      manifest,
      token: TOKEN,
      fetchImplementation: async () => {
        contacts += 1
        return responseWithRawContentType(contentType)
      },
    })
    const result = await client.request('accounts', { page: 1 })
    assert.equal(result.items.length, 1)
    assert.equal(contacts, 1)
  }

  for (const contentType of [
    'application/json; bare',
    'application/json; charset="utf-8',
    'application/json; charset=utf-8; charset=utf-8',
    'application/json; version=1',
    'application/json, text/plain',
    'application/json;',
    'application/json;\tcharset=utf-8',
    'application/json;\u0000charset=utf-8',
    'application/json\u007F',
    'application/json trailing',
  ]) {
    let contacts = 0
    const client = createIdentityBootstrapCloudflareClient({
      manifest,
      token: TOKEN,
      fetchImplementation: async () => {
        contacts += 1
        return responseWithRawContentType(contentType)
      },
    })
    await assertRemoteFailure(client.request('accounts', { page: 1 }), /application\/json/)
    assert.equal(contacts, 1, JSON.stringify(contentType))
  }
})

test('transport rejects declared and streamed oversized bodies', async () => {
  const declared = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    maximumBytes: 4,
    fetchImplementation: async () => new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '5' },
    }),
  })
  await assertRemoteFailure(declared.request('accounts', { page: 1 }), /content length/)

  const streamed = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    maximumBytes: 4,
    fetchImplementation: async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      headers: { 'content-type': 'application/json' },
    }),
  })
  await assertRemoteFailure(streamed.request('accounts', { page: 1 }), /streaming size/)
})

test('transport deadline covers pre-fetch, body read, endpoint validation, and result normalization', async () => {
  let beforeFetchContacts = 0
  const beforeFetch = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    timeoutMs: 0,
    monotonicNow: () => 0,
    fetchImplementation: async () => {
      beforeFetchContacts += 1
      return cloudflareResponse([], { resultInfo: pagination(1, []) })
    },
  })
  await assertRemoteFailure(beforeFetch.request('accounts', { page: 1 }), /deadline/)
  assert.equal(beforeFetchContacts, 0)

  let cancellations = 0
  let clears = 0
  const stalled = new ReadableStream({
    pull() {},
    cancel() { cancellations += 1 },
  })
  const bodyRead = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    timeoutMs: 5,
    fetchImplementation: async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }),
    setTimer(callback) {
      queueMicrotask(callback)
      return 1
    },
    clearTimer() { clears += 1 },
  })
  await assertRemoteFailure(bodyRead.request('accounts', { page: 1 }), /deadline/)
  assert.equal(cancellations, 1)
  assert.equal(clears, 1)

  for (const deadlineStage of ['fixture-endpoint-validation', 'result-normalization-complete']) {
    let clearCount = 0
    const client = createIdentityBootstrapCloudflareClient({
      manifest,
      token: TOKEN,
      timeoutMs: 10,
      monotonicNow: (stage) => stage === deadlineStage ? 10 : 0,
      fetchImplementation: async () => cloudflareResponse([], { resultInfo: pagination(1, []) }),
      setTimer: () => 1,
      clearTimer: () => { clearCount += 1 },
    })
    await assertRemoteFailure(client.request('accounts', { page: 1 }, (value, assertDeadline) => {
      assertDeadline('fixture-endpoint-validation')
      return value
    }), /deadline/)
    assert.equal(clearCount, 1)
  }
})

test('transport cleans timers exactly once, performs no retry, redacts errors, and freezes normalized output', async () => {
  let contacts = 0
  let clears = 0
  const client = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    fetchImplementation: async () => {
      contacts += 1
      return cloudflareResponse([{ id: ACCOUNT_ID, name: 'Fixture account' }], {
        resultInfo: accountPagination(1, [{ id: ACCOUNT_ID, name: 'Fixture account' }]),
      })
    },
    setTimer: () => 1,
    clearTimer: () => { clears += 1 },
  })
  const result = await client.request('accounts', { page: 1 })
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.items))
  assert.throws(() => result.items.push({ id: OTHER_ACCOUNT_ID }), TypeError)
  assert.equal(contacts, 1)
  assert.equal(clears, 1)

  let failedContacts = 0
  const failed = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    fetchImplementation: async () => {
      failedContacts += 1
      throw new Error(`fixture failure ${TOKEN}`)
    },
  })
  let captured
  try {
    await failed.request('accounts', { page: 1 })
  } catch (error) {
    captured = error
  }
  assert.equal(failedContacts, 1)
  assert.equal(captured.message.includes(TOKEN), false)
  assert.equal(JSON.stringify(failureReport('preview:identity-bootstrap', captured, [], [TOKEN])).includes(TOKEN), false)
})

test('operation parameters reject unexpected keys, accessors, symbols, inheritance, non-enumerability, exotic prototypes, and URL injection', async () => {
  const client = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    fetchImplementation: async () => {
      throw new Error('fetch must not run')
    },
  })
  const inherited = Object.create({ page: 1 })
  const accessor = {}
  Object.defineProperty(accessor, 'page', { enumerable: true, get() { return 1 } })
  const nonEnumerable = {}
  Object.defineProperty(nonEnumerable, 'page', { enumerable: false, value: 1 })
  const symbol = { page: 1, [Symbol('query')]: 'unsafe' }
  const exotic = new (class Parameters { constructor() { this.page = 1 } })()
  for (const parameters of [
    { page: 1, unexpected: true },
    { page: 1, url: 'https://example.invalid/' },
    { page: 1, query: 'per_page=1000' },
    inherited,
    accessor,
    nonEnumerable,
    symbol,
    exotic,
  ]) {
    await assert.rejects(client.request('accounts', parameters), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL)
  }
  await assert.rejects(client.request('not-an-operation', {}), (error) => error.exitCode === EXIT_CODES.PRODUCTION_REFUSAL)

  const grounded = createIdentityBootstrapCloudflareClient({
    manifest,
    token: TOKEN,
    groundedAccountId: ACCOUNT_ID,
    groundedRouteZoneIds: [ZONE_IDS[0]],
    fetchImplementation: async () => {
      throw new Error('fetch must not run')
    },
  })
  await assert.rejects(grounded.request('account', { accountId: OTHER_ACCOUNT_ID }))
  await assert.rejects(grounded.request('worker-routes', {
    accountId: ACCOUNT_ID,
    worker: PREVIEW_WORKER,
    zoneId: ZONE_IDS[1],
  }))
  await assert.rejects(grounded.request('d1-database', {
    accountId: ACCOUNT_ID,
    databaseId: PRODUCTION_D1.id,
  }))
})

test('stable double-read detects account, zone, Pages, Worker exposure, route, custom-domain, and D1 changes', async () => {
  const changingCases = [
    ['account', {
      account: ({ count, url }) => ({
        result: {
          id: count === 1 ? url.pathname.split('/')[4] : OTHER_ACCOUNT_ID,
          name: 'Fixture account',
        },
      }),
    }],
    ['Pages', {
      pages: ({ count }) => ({
        result: {
          name: manifest.cloudflare.preview.pages.project,
          production_branch: count === 1 ? 'main' : 'release',
          domains: PRODUCTION_DOMAINS,
        },
      }),
    }],
    ['Worker exposure', {
      workerDomains: ({ count }) => {
        const result = count === 1 ? [] : [customDomain(0, { hostname: 'changed.example.invalid' })]
        return { result, resultInfo: servicePagination(result) }
      },
    }],
    ['route', {
      workerRoutes: ({ count, url }) => {
        const zoneId = url.pathname.split('/')[4]
        return {
          result: [{
            id: count <= ZONE_IDS.length
              ? zoneId
              : `${'e'.repeat(31)}${zoneId[0]}`,
            pattern: `unrelated-${zoneId[0]}.example.invalid/*`,
            script: 'unrelated-worker',
          }],
        }
      },
    }],
    ['D1', {
      d1: ({ count }) => count === 1
        ? { result: { uuid: PREVIEW_D1.id, name: PREVIEW_D1.name } }
        : new Response('missing', { status: 404, headers: { 'content-type': 'application/json' } }),
    }],
  ]
  for (const [label, overrides] of changingCases) {
    await assert.rejects(
      collect(createFakeCloudflare(overrides)),
      label === 'account'
        ? /does not match|observations changed/
        : /observations changed|HTTP 404|custom domain/,
    )
  }
})

test('evidence hash uses only normalized timestamp-free evidence', async () => {
  const report = await collect()
  assert.equal(JSON.stringify(report).includes('timestamp'), false)
  const expected = canonicalHash({
    schemaVersion: report.schemaVersion,
    candidateIdentities: report.candidateIdentities,
    reviewedAnchors: report.reviewedAnchors,
    crossChecks: report.crossChecks,
    stableObservation: report.stableObservation,
  })
  assert.equal(report.evidenceHash, expected)
  assert.equal(canonicalJson(report).includes(TOKEN), false)
  assert.equal(renderIdentityBootstrapReport(report, false).includes(TOKEN), false)
})
