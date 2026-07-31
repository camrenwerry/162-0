import path from 'node:path'
import {
  canonicalHash,
  immutablePlain,
  parseStrictJson,
  PREVIEW_RELEASE_TOOL_CONTRACT_VERSION,
  readStrictJsonFile,
  STRICT_JSON_LIMITS,
} from './canonical.mjs'
import { localError, refusalError } from './errors.mjs'
import { containsProhibitedCredentialAssignment } from './redaction.mjs'

export const MANIFEST_RELATIVE_PATH = 'config/preview-release.json'
export const MAX_HOSTNAME_LENGTH = 253
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const INVALID_BRANCH_CHARACTER_PATTERN = /[\u0000-\u0020\u007F~^:?*[\]\\]/u
const MAX_BRANCH_LENGTH = 255
const NAMESPACE_PATTERN = /^\d{1,20}$/
export const PREVIEW_RELEASE_TARGET_STATES = Object.freeze(['disabled'])

function assert(condition, message) {
  if (!condition) throw localError(message, 'manifest.validity')
}

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} must contain exactly: ${wanted.join(', ')}.`)
}

function assertResolution(value, label, { array = false } = {}) {
  const expected = array ? ['reason', 'status', 'values'] : ['reason', 'status', 'value']
  assertExactKeys(value, expected, label)
  assert(['resolved', 'unresolved'].includes(value.status), `${label} must be resolved or unresolved.`)
  if (value.status === 'unresolved') {
    assert(typeof value.reason === 'string' && value.reason.length > 0, `${label} must explain why it is unresolved.`)
    if (array) assert(Array.isArray(value.values) && value.values.length === 0, `${label} must not contain unreviewed values.`)
    else assert(value.value === null, `${label} must not contain an unreviewed value.`)
  } else {
    assert(value.reason === '', `${label} must clear its unresolved reason when resolved.`)
    if (array) assert(Array.isArray(value.values) && value.values.length > 0 && value.values.every((entry) => typeof entry === 'string' && entry.length > 0), `${label} resolved values are malformed.`)
    else assert(typeof value.value === 'string' && value.value.length > 0, `${label} resolved value is malformed.`)
  }
}

export function isReviewedHostname(value) {
  return typeof value === 'string'
    && value.length <= MAX_HOSTNAME_LENGTH
    && HOSTNAME_PATTERN.test(value)
}

export function isReviewedGitBranch(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BRANCH_LENGTH
    || value !== value.trim() || INVALID_BRANCH_CHARACTER_PATTERN.test(value)
    || value.includes('..') || value.includes('@{') || value.includes('//')
    || value.startsWith('/') || value.endsWith('/') || value.startsWith('-')
    || value.endsWith('.') || value === '@') return false
  const components = value.split('/')
  return components.every((component) => (
    component.length > 0
      && !component.startsWith('.')
      && !component.endsWith('.lock')
  ))
}

function assertNoCredentialMaterial(value, trail = 'manifest') {
  if (typeof value === 'string') {
    assert(!/(?:authorization\s*:\s*bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(value)
      && !containsProhibitedCredentialAssignment(value), `${trail} contains prohibited credential material.`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCredentialMaterial(entry, `${trail}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    assert(!/(?:token|secret|authorization|credential|ticket|requestdata|rowcontent)/i.test(key), `${trail}.${key} is a prohibited credential or private-data field.`)
    assertNoCredentialMaterial(entry, `${trail}.${key}`)
  }
}

export function validateReleaseManifest(input) {
  const manifest = immutablePlain(input)
  assertExactKeys(manifest, ['activation', 'cloudflare', 'configuration', 'repository', 'schemaVersion', 'toolContractVersion', 'toolchain'], 'Release manifest')
  assert(manifest.schemaVersion === 2, 'Release manifest schemaVersion must be 2.')
  assert(manifest.toolContractVersion === PREVIEW_RELEASE_TOOL_CONTRACT_VERSION, 'Unexpected Preview tool contract version.')
  assertNoCredentialMaterial(manifest)

  const repository = manifest.repository
  assertExactKeys(repository, ['allowedRoots', 'lockfileVersion', 'packageName', 'packageVersion', 'previewBranch', 'remoteUrl', 'upstream'], 'repository')
  assert(repository.packageName === 'pennant-pursuit', 'Unexpected package identity.')
  assert(repository.packageVersion === '1.0.0', 'Unexpected package version.')
  assert(repository.remoteUrl === 'https://github.com/camrenwerry/162-0.git', 'Unexpected repository remote URL.')
  assert(repository.previewBranch === 'develop' && repository.upstream === 'origin/develop', 'Preview Git topology must be develop and origin/develop.')
  assert(Array.isArray(repository.allowedRoots) && repository.allowedRoots.length > 0, 'At least one reviewed repository root is required.')
  assert(repository.allowedRoots.every((root) => path.isAbsolute(root)), 'Every reviewed repository root must be absolute.')
  assert(repository.lockfileVersion === 3, 'Only package-lock version 3 is approved.')

  const toolchain = manifest.toolchain
  assertExactKeys(toolchain, ['nodeAllowedMajors', 'npmAllowedMajors', 'wranglerVersion'], 'toolchain')
  assert(Array.isArray(toolchain.nodeAllowedMajors) && toolchain.nodeAllowedMajors.every(Number.isInteger), 'Approved Node majors are malformed.')
  assert(Array.isArray(toolchain.npmAllowedMajors) && toolchain.npmAllowedMajors.every(Number.isInteger), 'Approved npm majors are malformed.')
  assert(/^\d+\.\d+\.\d+$/.test(toolchain.wranglerVersion), 'Approved Wrangler version is malformed.')

  const cloudflare = manifest.cloudflare
  assertExactKeys(cloudflare, ['account', 'apiOrigin', 'preview', 'production'], 'cloudflare')
  assert(cloudflare.apiOrigin === 'https://api.cloudflare.com', 'Only the canonical Cloudflare API origin is approved.')
  assertExactKeys(cloudflare.account, ['id', 'reason', 'status'], 'cloudflare.account')
  if (cloudflare.account.status === 'resolved') {
    assert(ACCOUNT_ID_PATTERN.test(cloudflare.account.id), 'The reviewed Cloudflare account ID is malformed.')
    assert(cloudflare.account.reason === '', 'A resolved account identity must not carry an unresolved reason.')
  } else {
    assert(cloudflare.account.status === 'unresolved' && cloudflare.account.id === null, 'The Cloudflare account identity must be resolved or fail closed as unresolved.')
    assert(typeof cloudflare.account.reason === 'string' && cloudflare.account.reason.length > 0, 'The unresolved Cloudflare account identity needs a reason.')
  }

  const preview = cloudflare.preview
  const production = cloudflare.production
  assertExactKeys(preview, ['d1', 'pages', 'worker'], 'cloudflare.preview')
  assertExactKeys(production, ['d1', 'pages', 'worker'], 'cloudflare.production')
  assertExactKeys(preview.pages, ['branch', 'domainPatterns', 'project'], 'cloudflare.preview.pages')
  assertExactKeys(production.pages, ['branch', 'domains', 'project'], 'cloudflare.production.pages')
  assert(RESOURCE_NAME_PATTERN.test(preview.pages.project), 'Preview Pages project is malformed.')
  assert(preview.pages.branch === repository.previewBranch, 'Preview Pages branch must equal the reviewed Git branch.')
  assert(Array.isArray(preview.pages.domainPatterns) && preview.pages.domainPatterns.length > 0 && preview.pages.domainPatterns.every((value) => /^\*\.[a-z0-9.-]+$/.test(value)), 'Preview domain patterns are required and must be reviewed wildcard hostnames.')
  assert(production.pages.project === preview.pages.project, 'The checked-in Pages environments must belong to the one reviewed Pages project.')
  assertResolution(production.pages.branch, 'cloudflare.production.pages.branch')
  assertResolution(production.pages.domains, 'cloudflare.production.pages.domains', { array: true })
  if (production.pages.branch.status === 'resolved') {
    assert(isReviewedGitBranch(production.pages.branch.value), 'Resolved Production branch is malformed.')
  }
  if (production.pages.domains.status === 'resolved') {
    assert(production.pages.domains.values.every(isReviewedHostname), 'Resolved Production domains are malformed.')
  }

  assertExactKeys(preview.d1, ['binding', 'id', 'name'], 'cloudflare.preview.d1')
  assertExactKeys(production.d1, ['binding', 'id', 'name'], 'cloudflare.production.d1')
  assert(preview.d1.binding === 'DB' && production.d1.binding === 'DB', 'D1 bindings must use DB.')
  assert(UUID_PATTERN.test(preview.d1.id) && UUID_PATTERN.test(production.d1.id), 'D1 identities must be UUIDs.')
  assert(RESOURCE_NAME_PATTERN.test(preview.d1.name) && RESOURCE_NAME_PATTERN.test(production.d1.name), 'D1 names are malformed.')
  assert(preview.d1.id !== production.d1.id && preview.d1.name !== production.d1.name, 'Preview and Production D1 identities must be distinct.')

  assertExactKeys(preview.worker, ['name', 'previewUrls', 'rateLimitNamespaces', 'routeZoneIds', 'serviceBinding', 'workersDev'], 'cloudflare.preview.worker')
  assertExactKeys(production.worker, ['d1BindingAllowed', 'name', 'previewUrls', 'rateLimitNamespaces', 'serviceBinding', 'workersDev'], 'cloudflare.production.worker')
  assert(RESOURCE_NAME_PATTERN.test(preview.worker.name) && RESOURCE_NAME_PATTERN.test(production.worker.name), 'Worker names are malformed.')
  assert(preview.worker.name !== production.worker.name, 'Preview and Production Worker identities must be distinct.')
  assert(preview.worker.workersDev === false && preview.worker.previewUrls === false, 'Preview Worker public URLs must be disabled.')
  assert(production.worker.workersDev === false && production.worker.previewUrls === false, 'Production Worker public URLs must be disabled.')
  assert(production.worker.d1BindingAllowed === false, 'Production Worker must prohibit D1 bindings.')
  assertResolution(preview.worker.routeZoneIds, 'cloudflare.preview.worker.routeZoneIds', { array: true })
  if (preview.worker.routeZoneIds.status === 'resolved') {
    assert(preview.worker.routeZoneIds.values.every((value) => ACCOUNT_ID_PATTERN.test(value)), 'Reviewed Worker route-zone IDs are malformed.')
  }
  if (production.pages.branch.status === 'resolved') {
    assert(production.pages.branch.value !== preview.pages.branch, 'Preview Pages branch must differ from the resolved production branch.')
  }

  for (const [label, binding] of [['Preview', preview.worker.serviceBinding], ['Production', production.worker.serviceBinding]]) {
    assertExactKeys(binding, ['binding', 'service'], `${label} service binding`)
    assert(binding.binding === 'VALIDATION_SERVICE' && RESOURCE_NAME_PATTERN.test(binding.service), `${label} service binding is malformed.`)
  }
  assert(preview.worker.serviceBinding.service !== production.worker.serviceBinding.service, 'Preview and Production service targets must be distinct.')
  for (const namespaces of [preview.worker.rateLimitNamespaces, production.worker.rateLimitNamespaces]) {
    assert(Array.isArray(namespaces) && namespaces.length === 2 && namespaces.every((value) => NAMESPACE_PATTERN.test(value)), 'Rate-limit namespace identities are malformed.')
  }
  assert(preview.worker.rateLimitNamespaces.every((value) => !production.worker.rateLimitNamespaces.includes(value)), 'Preview and Production rate-limit namespaces must be distinct.')

  const activation = manifest.activation
  assertExactKeys(activation, [
    'authoritySchemaVersion',
    'canonicalCheckedInState',
    'capabilityModelVersion',
    'maximumReviewWindowMs',
    'releaseTooling',
  ], 'activation')
  assert(activation.capabilityModelVersion === 2, 'Capability model version must be 2.')
  assert(activation.authoritySchemaVersion === 1, 'Authority schema version must be 1.')
  assert(activation.maximumReviewWindowMs === 86_400_000, 'Authority review window must be exactly 24 hours.')
  assert(activation.canonicalCheckedInState === 'all-disabled', 'Canonical checked-in capability state must be all-disabled.')
  assert(activation.releaseTooling === 'disabled-only', 'Preview release tooling must remain disabled-only.')

  assertExactKeys(manifest.configuration, ['capabilityModel', 'migrationsDirectory', 'pages', 'worker'], 'configuration')
  for (const relativePath of Object.values(manifest.configuration)) {
    assert(typeof relativePath === 'string' && relativePath.length > 0 && !path.isAbsolute(relativePath) && !relativePath.split('/').includes('..'), 'Configuration paths must be repository-relative.')
  }
  return manifest
}

export function parseReleaseManifest(source) {
  assert(typeof source === 'string', 'Release manifest source must be text.')
  assert(!source.startsWith('\uFEFF'), 'Release manifest must not contain a UTF-8 BOM.')
  const manifest = parseStrictJson(source, {
    label: 'Release manifest',
    error: (message) => localError(message, 'manifest.validity'),
    limits: STRICT_JSON_LIMITS.releaseManifest,
  })
  return validateReleaseManifest(manifest)
}

export function loadReleaseManifest(repositoryRoot, relativePath = MANIFEST_RELATIVE_PATH) {
  const { source } = readStrictJsonFile(path.join(repositoryRoot, relativePath), {
    label: 'Release manifest',
    limits: STRICT_JSON_LIMITS.releaseManifest,
    error: (message) => localError(message, 'manifest.validity'),
  })
  const manifest = parseReleaseManifest(source)
  return Object.freeze({ manifest, source, hash: canonicalHash(manifest), relativePath })
}

export function requireResolvedRemoteIdentity(manifest) {
  if (manifest.cloudflare.account.status !== 'resolved') {
    throw refusalError(`Cloudflare account identity is unresolved: ${manifest.cloudflare.account.reason}`, 'remote.identity.account')
  }
  if (manifest.cloudflare.preview.worker.routeZoneIds.status !== 'resolved') {
    throw refusalError(`Preview Worker route-zone identities are unresolved: ${manifest.cloudflare.preview.worker.routeZoneIds.reason}`, 'remote.identity.routes')
  }
  if (manifest.cloudflare.production.pages.branch.status !== 'resolved') {
    throw refusalError(`Pages production branch is unresolved: ${manifest.cloudflare.production.pages.branch.reason}`, 'remote.identity.pages-production-branch')
  }
  if (manifest.cloudflare.production.pages.domains.status !== 'resolved') {
    throw refusalError(`Production domains are unresolved: ${manifest.cloudflare.production.pages.domains.reason}`, 'remote.identity.production-domains')
  }
  return manifest
}

export function productionDenylist(manifest, { includeBranch = false } = {}) {
  return Object.freeze([
    manifest.cloudflare.production.worker.name,
    manifest.cloudflare.production.worker.serviceBinding.service,
    manifest.cloudflare.production.d1.name,
    manifest.cloudflare.production.d1.id,
    ...(includeBranch ? [manifest.cloudflare.production.pages.branch.value] : []),
    ...manifest.cloudflare.production.worker.rateLimitNamespaces,
    ...manifest.cloudflare.production.pages.domains.values,
  ].filter(Boolean))
}
