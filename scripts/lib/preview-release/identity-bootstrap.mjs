import { canonicalHash, canonicalJson, immutablePlain } from './canonical.mjs'
import {
  createIdentityBootstrapCloudflareClient,
  normalizeWorkerCustomDomainInventory,
  normalizeWorkerRouteInventory,
} from './cloudflare-readonly.mjs'
import { localError, refusalError, remoteError } from './errors.mjs'
import {
  isReviewedHostname,
  isReviewedGitBranch,
  loadReleaseManifest,
  productionDenylist,
  validateReleaseManifest,
} from './manifest.mjs'
import { GENERIC_CLOUDFLARE_CREDENTIALS } from './redaction.mjs'

const ACCOUNT_PATTERN = /^[0-9a-f]{32}$/
const ZONE_PATTERN = /^[0-9a-f]{32}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/
const PROHIBITED_ACCOUNT_NAME_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
const MAX_ACCOUNT_NAME_LENGTH = 100
const MAX_PAGES = 10
const PAGE_SIZE = 25
const MAX_INVENTORY_RECORDS = MAX_PAGES * PAGE_SIZE
const RUNTIME_IDENTITY_VARIABLES = Object.freeze([
  'CLOUDFLARE_ACCOUNT_ID',
  'CF_ACCOUNT_ID',
  'PENNANT_PREVIEW_ACCOUNT_ID',
  'PENNANT_PREVIEW_ROUTE_ZONE_IDS',
  'PENNANT_PRODUCTION_BRANCH',
  'PENNANT_PRODUCTION_DOMAINS',
])

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw remoteError(`${label} has an unexpected JSON shape.`, 'unexpected_json_shape')
  }
  return value
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw remoteError(`${label} has an unexpected JSON shape.`, 'unexpected_json_shape')
  return value
}

function requireIdentity(actual, expected, label, pattern) {
  if (typeof actual !== 'string' || !pattern.test(actual) || actual !== expected) {
    throw refusalError(`${label} does not match the grounded bootstrap identity.`, 'bootstrap.identity')
  }
  return actual
}

export function normalizeAccountName(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
    || Array.from(value).length > MAX_ACCOUNT_NAME_LENGTH
    || PROHIBITED_ACCOUNT_NAME_CHARACTER_PATTERN.test(value)) {
    throw remoteError('Cloudflare account name is empty or malformed.', 'ambiguous_remote_state', 'bootstrap.identity.account')
  }
  const normalized = value.normalize('NFC')
  if (normalized.length === 0 || Array.from(normalized).length > MAX_ACCOUNT_NAME_LENGTH
    || PROHIBITED_ACCOUNT_NAME_CHARACTER_PATTERN.test(normalized)) {
    throw remoteError('Cloudflare account name is empty or malformed.', 'ambiguous_remote_state', 'bootstrap.identity.account')
  }
  return normalized
}

function hostnameMatchesPattern(hostname, pattern) {
  if (!pattern.startsWith('*.')) return hostname === pattern
  const suffix = pattern.slice(1)
  return hostname.endsWith(suffix) && hostname.length > suffix.length
}

function normalizeProductionBranch(value, previewBranch) {
  if (!isReviewedGitBranch(value)) {
    throw remoteError('Pages production branch is missing or malformed.', 'ambiguous_remote_state', 'bootstrap.pages.production-branch')
  }
  if (value === previewBranch) {
    throw refusalError('Pages production branch equals the reviewed Preview branch.', 'bootstrap.pages.production-branch')
  }
  return value
}

function normalizeProductionDomains(value, previewPatterns) {
  const domains = assertArray(value, 'Pages Production domains')
  if (domains.length === 0) throw remoteError('Pages Production-domain inventory is empty.', 'ambiguous_remote_state', 'bootstrap.pages.production-domains')
  const seen = new Set()
  const normalized = []
  for (const raw of domains) {
    if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) {
      throw remoteError('Pages Production-domain inventory contains an empty or malformed value.', 'ambiguous_remote_state', 'bootstrap.pages.production-domains')
    }
    const hostname = raw.toLowerCase()
    if (!isReviewedHostname(hostname) || hostname.includes('*')) {
      throw remoteError('Pages Production-domain inventory contains a malformed or wildcard hostname.', 'ambiguous_remote_state', 'bootstrap.pages.production-domains')
    }
    if (seen.has(hostname)) {
      throw remoteError('Pages Production-domain inventory contains a duplicate hostname.', 'ambiguous_remote_state', 'bootstrap.pages.production-domains')
    }
    if (previewPatterns.some((pattern) => hostnameMatchesPattern(hostname, pattern))) {
      throw refusalError('Pages Production-domain inventory collides with a reviewed Preview domain pattern.', 'bootstrap.pages.production-domains')
    }
    seen.add(hostname)
    normalized.push(hostname)
  }
  return normalized.sort()
}

export { normalizeWorkerRouteInventory }

async function completePaginatedInventory(client, operation, parameters, label, finalize) {
  const all = []
  let totalPages
  let totalCount
  let complete
  for (let page = 1; totalPages === undefined || page <= totalPages; page += 1) {
    const pageResult = await client.request(operation, { ...parameters, page }, (response, assertDeadline) => {
      const result = assertObject(response, `${label} paginated result`)
      const items = assertArray(result.items, `${label} page`)
      const info = assertObject(result.resultInfo, `${label} pagination metadata`)
      assertDeadline(`${operation}-page-shape`)
      if (page === 1) {
        totalPages = info.totalPages
        totalCount = info.totalCount
      }
      if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGES
        || !Number.isInteger(totalCount) || totalCount < 0 || totalCount > MAX_INVENTORY_RECORDS
        || info.page !== page || info.perPage !== PAGE_SIZE
        || info.totalPages !== totalPages || info.totalCount !== totalCount
        || items.length > PAGE_SIZE || all.length + items.length > MAX_INVENTORY_RECORDS
        || (page < totalPages && items.length !== PAGE_SIZE)
        || (totalPages > 1 && items.length === 0)) {
        throw remoteError(`${label} pagination changed, exceeded its bound, or was truncated.`, 'ambiguous_remote_state', 'bootstrap.pagination')
      }
      all.push(...items)
      assertDeadline(`${operation}-page-normalized`)
      let normalizedComplete = null
      if (page === totalPages) {
        if (all.length !== totalCount) {
          throw remoteError(`${label} pagination did not return its declared complete inventory.`, 'ambiguous_remote_state', 'bootstrap.pagination')
        }
        normalizedComplete = finalize(all, assertDeadline)
        assertDeadline(`${operation}-inventory-normalized`)
      }
      return { page, complete: normalizedComplete }
    })
    if (pageResult.complete !== null) complete = pageResult.complete
  }
  return complete
}

async function observeAccounts(client) {
  return completePaginatedInventory(client, 'accounts', {}, 'Cloudflare accounts', (accounts, assertDeadline) => {
    const seen = new Set()
    const normalized = []
    for (const raw of accounts) {
      const account = assertObject(raw, 'Cloudflare account inventory entry')
      if (typeof account.id !== 'string' || !ACCOUNT_PATTERN.test(account.id)) {
        throw remoteError('Cloudflare account inventory contains a malformed account ID.', 'ambiguous_remote_state', 'bootstrap.identity.account')
      }
      if (seen.has(account.id)) {
        throw remoteError('Cloudflare account inventory contains a duplicate account ID.', 'ambiguous_remote_state', 'bootstrap.identity.account')
      }
      seen.add(account.id)
      normalized.push({ id: account.id, name: normalizeAccountName(account.name) })
      assertDeadline('accounts-item-normalized')
    }
    normalized.sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name))
    if (normalized.length !== 1) {
      throw remoteError('Identity bootstrap requires exactly one unambiguous accessible Cloudflare account.', 'ambiguous_remote_state', 'bootstrap.identity.account')
    }
    return normalized
  })
}

async function observeZones(client, accountId) {
  return completePaginatedInventory(client, 'account-zones', { accountId }, 'Cloudflare account zones', (zones, assertDeadline) => {
    const seen = new Set()
    const ids = []
    for (const raw of zones) {
      const zone = assertObject(raw, 'Cloudflare account zone')
      if (typeof zone.id !== 'string' || !ZONE_PATTERN.test(zone.id)) {
        throw remoteError('Cloudflare account zone inventory contains a malformed zone ID.', 'ambiguous_remote_state', 'bootstrap.identity.routes')
      }
      if (seen.has(zone.id)) {
        throw remoteError('Cloudflare account zone inventory contains a duplicate zone ID.', 'ambiguous_remote_state', 'bootstrap.identity.routes')
      }
      const owner = assertObject(zone.account, 'Cloudflare account zone owner')
      requireIdentity(owner.id, accountId, 'Cloudflare zone account owner', ACCOUNT_PATTERN)
      seen.add(zone.id)
      ids.push(zone.id)
      assertDeadline('account-zones-item-normalized')
    }
    if (ids.length === 0) {
      throw remoteError('Cloudflare account zone inventory is empty under the current manifest contract.', 'ambiguous_remote_state', 'bootstrap.identity.routes')
    }
    return ids.sort()
  })
}

function validateKnownProductionCollisions(manifest, accountId, routeZoneIds) {
  const denied = productionDenylist(manifest, { includeBranch: true }).map((value) => value.toLowerCase())
  for (const identity of [accountId, ...routeZoneIds]) {
    if (denied.includes(identity.toLowerCase())) {
      throw refusalError('Discovered bootstrap identity collides with a reviewed Production denylist value.', 'bootstrap.production-protection')
    }
  }
}

function requireCanonicalUnresolvedIdentities(manifest) {
  const unresolved = [
    manifest.cloudflare.account.status === 'unresolved' && manifest.cloudflare.account.id === null,
    manifest.cloudflare.preview.worker.routeZoneIds.status === 'unresolved'
      && manifest.cloudflare.preview.worker.routeZoneIds.values.length === 0,
    manifest.cloudflare.production.pages.branch.status === 'unresolved'
      && manifest.cloudflare.production.pages.branch.value === null,
    manifest.cloudflare.production.pages.domains.status === 'unresolved'
      && manifest.cloudflare.production.pages.domains.values.length === 0,
  ]
  if (!unresolved.every(Boolean)) {
    throw localError('Identity bootstrap requires the canonical manifest to retain exactly four unresolved identity fields.', 'bootstrap.manifest-precondition')
  }
}

async function observeBootstrapState({ manifest, token, transportOptions }) {
  const inventoryClient = createIdentityBootstrapCloudflareClient({ manifest, token, ...transportOptions })
  const [inventoryAccount] = await observeAccounts(inventoryClient)
  const accountId = inventoryAccount.id
  const accountClient = createIdentityBootstrapCloudflareClient({
    manifest,
    token,
    groundedAccountId: accountId,
    ...transportOptions,
  })
  const account = await accountClient.request('account', { accountId }, (value, assertDeadline) => {
    const result = assertObject(value, 'Cloudflare account')
    requireIdentity(result.id, accountId, 'Cloudflare account response', ACCOUNT_PATTERN)
    const name = normalizeAccountName(result.name)
    if (name !== inventoryAccount.name) {
      throw remoteError('Cloudflare account inventory and detail names conflict.', 'ambiguous_remote_state', 'bootstrap.identity.account')
    }
    assertDeadline('account-identity-normalized')
    return { id: result.id, name }
  })
  const routeZoneIds = await observeZones(accountClient, accountId)
  validateKnownProductionCollisions(manifest, accountId, routeZoneIds)

  const pages = await accountClient.request('pages-project', {
    accountId,
    project: manifest.cloudflare.preview.pages.project,
  }, (value, assertDeadline) => {
    const project = assertObject(value, 'Pages project')
    requireIdentity(
      project.name,
      manifest.cloudflare.preview.pages.project,
      'Pages project response',
      RESOURCE_NAME_PATTERN,
    )
    const productionBranch = normalizeProductionBranch(
      project.production_branch,
      manifest.cloudflare.preview.pages.branch,
    )
    const productionDomains = normalizeProductionDomains(
      project.domains,
      manifest.cloudflare.preview.pages.domainPatterns,
    )
    assertDeadline('pages-project-identities-normalized')
    return { name: project.name, productionBranch, productionDomains }
  })

  const worker = await accountClient.request('worker-settings', {
    accountId,
    worker: manifest.cloudflare.preview.worker.name,
  }, (value, assertDeadline) => {
    assertObject(value, 'Preview Worker settings')
    assertDeadline('worker-identity-normalized')
    return { name: manifest.cloudflare.preview.worker.name, reachable: true }
  })
  const publicUrls = await accountClient.request('worker-subdomain', {
    accountId,
    worker: manifest.cloudflare.preview.worker.name,
  }, (value, assertDeadline) => {
    const settings = assertObject(value, 'Preview Worker public-URL settings')
    if (settings.enabled !== false || settings.previews_enabled !== false) {
      throw refusalError('Preview Worker workers.dev or Preview URLs are enabled.', 'bootstrap.worker.public-urls')
    }
    assertDeadline('worker-public-urls-normalized')
    return { workersDev: false, previewUrls: false }
  })
  const customDomains = await accountClient.request('worker-domains', {
    accountId,
    worker: manifest.cloudflare.preview.worker.name,
  }, (value, assertDeadline) => {
    return normalizeWorkerCustomDomainInventory(value, {
      groundedZoneIds: routeZoneIds,
      previewWorker: manifest.cloudflare.preview.worker.name,
      assertDeadline,
      stage: 'bootstrap.worker.domains',
    })
  })

  const routeClient = createIdentityBootstrapCloudflareClient({
    manifest,
    token,
    groundedAccountId: accountId,
    groundedRouteZoneIds: routeZoneIds,
    ...transportOptions,
  })
  const routes = []
  const routeIds = new Map()
  const routePatterns = new Map()
  for (const zoneId of routeZoneIds) {
    const observed = await routeClient.request('worker-routes', {
      accountId,
      worker: manifest.cloudflare.preview.worker.name,
      zoneId,
    }, (value, assertDeadline) => {
      return normalizeWorkerRouteInventory(value, {
        zoneId,
        previewWorker: manifest.cloudflare.preview.worker.name,
        assertDeadline,
        stage: 'bootstrap.worker.routes',
      })
    })
    for (const route of observed) {
      const priorId = routeIds.get(route.id)
      if (priorId) {
        const conflict = priorId.pattern !== route.pattern || priorId.script !== route.script || priorId.zoneId !== route.zoneId
        throw remoteError(
          conflict
            ? 'Worker route inventory contains conflicting records for one route ID.'
            : 'Worker route inventory is malformed or duplicated.',
          'ambiguous_remote_state',
          'bootstrap.worker.routes',
        )
      }
      const priorPattern = routePatterns.get(route.pattern)
      if (priorPattern) {
        throw remoteError(
          'Worker route inventory contains conflicting records for one route pattern.',
          'ambiguous_remote_state',
          'bootstrap.worker.routes',
        )
      }
      routeIds.set(route.id, route)
      routePatterns.set(route.pattern, route)
    }
    if (routes.length + observed.length > MAX_INVENTORY_RECORDS) {
      throw remoteError('Worker route inventory exceeds the reviewed aggregate record bound.', 'ambiguous_remote_state', 'bootstrap.worker.routes')
    }
    routes.push(...observed)
  }

  const database = await accountClient.request('d1-database', {
    accountId,
    databaseId: manifest.cloudflare.preview.d1.id,
  }, (value, assertDeadline) => {
    const result = assertObject(value, 'Preview D1 database')
    requireIdentity(result.uuid, manifest.cloudflare.preview.d1.id, 'Preview D1 response', UUID_PATTERN)
    requireIdentity(result.name, manifest.cloudflare.preview.d1.name, 'Preview D1 name', RESOURCE_NAME_PATTERN)
    assertDeadline('d1-database-identity-normalized')
    return { id: result.uuid, name: result.name }
  })

  return immutablePlain({
    account,
    routeZoneIds,
    pages,
    worker,
    publicUrls,
    customDomains,
    routes,
    database,
  })
}

export function constructIdentityBootstrapCandidate(manifest, observation) {
  const candidate = JSON.parse(canonicalJson(manifest))
  candidate.cloudflare.account = { status: 'resolved', id: observation.account.id, reason: '' }
  candidate.cloudflare.preview.worker.routeZoneIds = {
    status: 'resolved',
    values: [...observation.routeZoneIds],
    reason: '',
  }
  candidate.cloudflare.production.pages.branch = {
    status: 'resolved',
    value: observation.pages.productionBranch,
    reason: '',
  }
  candidate.cloudflare.production.pages.domains = {
    status: 'resolved',
    values: [...observation.pages.productionDomains],
    reason: '',
  }
  const approvedPaths = [
    ['cloudflare', 'account'],
    ['cloudflare', 'preview', 'worker', 'routeZoneIds'],
    ['cloudflare', 'production', 'pages', 'branch'],
    ['cloudflare', 'production', 'pages', 'domains'],
  ]
  const restored = JSON.parse(canonicalJson(candidate))
  for (const path of approvedPaths) {
    let restoredParent = restored
    let originalParent = manifest
    for (const key of path.slice(0, -1)) {
      restoredParent = restoredParent[key]
      originalParent = originalParent[key]
    }
    restoredParent[path.at(-1)] = JSON.parse(canonicalJson(originalParent[path.at(-1)]))
  }
  if (canonicalHash(restored) !== canonicalHash(manifest)) {
    throw refusalError('Candidate manifest changed a field outside the four approved identity paths.', 'bootstrap.candidate-manifest')
  }
  for (const path of approvedPaths) {
    let candidateValue = candidate
    let originalValue = manifest
    for (const key of path) {
      candidateValue = candidateValue[key]
      originalValue = originalValue[key]
    }
    if (canonicalHash(candidateValue) === canonicalHash(originalValue)) {
      throw refusalError('Candidate manifest did not resolve every approved identity path.', 'bootstrap.candidate-manifest')
    }
  }
  return validateReleaseManifest(candidate)
}

export function assertIdentityBootstrapEnvironment(environment = process.env) {
  for (const key of GENERIC_CLOUDFLARE_CREDENTIALS) {
    if (Object.hasOwn(environment, key)) {
      throw refusalError(`Identity bootstrap rejects generic Cloudflare credential variable ${key}.`, 'bootstrap.credential')
    }
  }
  for (const key of RUNTIME_IDENTITY_VARIABLES) {
    if (Object.hasOwn(environment, key)) {
      throw refusalError(`Identity bootstrap rejects runtime identity variable ${key}.`, 'bootstrap.identity.runtime')
    }
  }
}

export async function collectIdentityBootstrapEvidence({
  repositoryRoot,
  token,
  environment = process.env,
  fetchImplementation,
  timeoutMs,
  maximumBytes,
  monotonicNow,
  setTimer,
  clearTimer,
} = {}) {
  assertIdentityBootstrapEnvironment(environment)
  const loaded = loadReleaseManifest(repositoryRoot)
  requireCanonicalUnresolvedIdentities(loaded.manifest)
  const transportOptions = {
    ...(fetchImplementation ? { fetchImplementation } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maximumBytes === undefined ? {} : { maximumBytes }),
    ...(monotonicNow ? { monotonicNow } : {}),
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {}),
  }
  const initial = await observeBootstrapState({ manifest: loaded.manifest, token, transportOptions })
  const final = await observeBootstrapState({ manifest: loaded.manifest, token, transportOptions })
  if (canonicalHash(initial) !== canonicalHash(final)) {
    throw remoteError('Cloudflare identity-bootstrap observations changed during the stable double-read window.', 'ambiguous_remote_state', 'bootstrap.snapshot')
  }
  const finalLoaded = loadReleaseManifest(repositoryRoot)
  if (finalLoaded.source !== loaded.source || finalLoaded.hash !== loaded.hash) {
    throw localError('The checked-in release manifest changed during identity bootstrap.', 'bootstrap.manifest-snapshot')
  }
  constructIdentityBootstrapCandidate(loaded.manifest, final)
  const candidateIdentities = immutablePlain({
    'cloudflare.account.id': final.account.id,
    'cloudflare.preview.worker.routeZoneIds': final.routeZoneIds,
    'cloudflare.production.pages.branch': final.pages.productionBranch,
    'cloudflare.production.pages.domains': final.pages.productionDomains,
  })
  const reviewedAnchors = immutablePlain({
    pagesProject: loaded.manifest.cloudflare.preview.pages.project,
    previewBranch: loaded.manifest.cloudflare.preview.pages.branch,
    previewWorker: loaded.manifest.cloudflare.preview.worker.name,
    previewD1: {
      id: loaded.manifest.cloudflare.preview.d1.id,
      name: loaded.manifest.cloudflare.preview.d1.name,
    },
  })
  const crossChecks = immutablePlain({
    accountIdentityConfirmed: true,
    accountNameConfirmed: true,
    pagesProjectConfirmed: true,
    previewWorkerConfirmed: true,
    previewWorkerWorkersDevDisabled: true,
    previewWorkerPreviewUrlsDisabled: true,
    previewWorkerCustomDomainFilterApplied: true,
    previewWorkerCustomDomainCount: 0,
    previewWorkerRouteCount: 0,
    groundedRouteInventoryCount: final.routes.length,
    previewD1Confirmed: true,
    productionDenylistApplied: true,
    productionSpecificResourcesContacted: false,
  })
  const stableObservation = immutablePlain({ readCount: 2, matched: true })
  const evidenceHash = canonicalHash({
    schemaVersion: 1,
    candidateIdentities,
    reviewedAnchors,
    crossChecks,
    stableObservation,
  })
  return projectIdentityBootstrapReport({
    schemaVersion: 1,
    command: 'preview:identity-bootstrap',
    status: 'PASS',
    candidateIdentities,
    evidenceHash,
    manifestHash: loaded.hash,
    reviewedAnchors,
    crossChecks,
    stableObservation,
    noRemoteMutation: true,
    configurationModified: false,
    authority: 'untrusted-pending-independent-review',
    ordinaryCheckPlanBlocked: true,
  })
}

export function projectIdentityBootstrapReport(report) {
  return immutablePlain({
    schemaVersion: report.schemaVersion,
    command: report.command,
    status: report.status,
    candidateIdentities: report.candidateIdentities,
    manifestHash: report.manifestHash,
    evidenceHash: report.evidenceHash,
    stableObservation: report.stableObservation,
    noRemoteMutation: report.noRemoteMutation,
    configurationModified: report.configurationModified,
    authority: report.authority,
    reviewedAnchors: report.reviewedAnchors,
    crossChecks: report.crossChecks,
    ordinaryCheckPlanBlocked: report.ordinaryCheckPlanBlocked,
  })
}

export function renderIdentityBootstrapReport(report, color = true) {
  const safe = projectIdentityBootstrapReport(report)
  const green = color ? '\u001B[32m' : ''
  const yellow = color ? '\u001B[33m' : ''
  const reset = color ? '\u001B[0m' : ''
  const identities = safe.candidateIdentities
  return [
    `${green}PASS${reset} Phase 1.5 identity bootstrap`,
    `${yellow}UNTRUSTED${reset} bootstrap evidence pending independent review`,
    `schemaVersion: ${safe.schemaVersion}`,
    `command: ${safe.command}`,
    `status: ${safe.status}`,
    `cloudflare.account.id: ${identities['cloudflare.account.id']}`,
    `cloudflare.preview.worker.routeZoneIds: ${canonicalJson(identities['cloudflare.preview.worker.routeZoneIds'])}`,
    `cloudflare.production.pages.branch: ${identities['cloudflare.production.pages.branch']}`,
    `cloudflare.production.pages.domains: ${canonicalJson(identities['cloudflare.production.pages.domains'])}`,
    `manifestHash: ${safe.manifestHash}`,
    `evidenceHash: ${safe.evidenceHash}`,
    `stableObservation: ${canonicalJson(safe.stableObservation)}`,
    `noRemoteMutation: ${safe.noRemoteMutation}`,
    `configurationModified: ${safe.configurationModified}`,
    `authority: ${safe.authority}`,
    `reviewedAnchors: ${canonicalJson(safe.reviewedAnchors)}`,
    `crossChecks: ${canonicalJson(safe.crossChecks)}`,
    `ordinaryCheckPlanBlocked: ${safe.ordinaryCheckPlanBlocked}`,
    'PASS stable-observation: Two complete observations matched.',
    'PASS safety.no-remote-mutation: Only fixed, allowlisted GET reads were used.',
    'PASS safety.configuration-unchanged: No repository configuration was modified.',
    'NOT CONTACTED: Production-specific Worker and D1 resources were not contacted.',
    'BLOCKED: Ordinary check and plan remain blocked pending a separately reviewed manifest grounding change.',
  ].join('\n')
}
