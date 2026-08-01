import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  PROTECTED_FRONTEND_CAPABILITY_SOURCE,
  protectedFrontendCapabilityState,
  validateProtectedFrontendCapabilitySource,
} from '../src/config/protectedCapabilities.mjs'
import {
  assertCurrentDisabledExecutionContract,
  buildExecutionContract,
} from './lib/preview-release/execution-contract.mjs'
import {
  serializeReleaseArtifact,
  validateReleasePackage,
  writeReleasePackage,
} from './lib/preview-release/artifacts.mjs'
import { assertCurrentDisabledReleasePlan, buildReleasePlan } from './lib/preview-release/plan.mjs'
import { executeReleasePackage } from './lib/preview-release/release-execution.mjs'
import {
  checkReport,
  executionReport,
  renderHumanCheck,
  renderHumanExecution,
  renderHumanPlan,
  rollbackGuidance,
  validationReport,
} from './lib/preview-release/reporting.mjs'
import {
  canonicalJson,
  immutablePlain,
  parseStrictJson,
  STRICT_JSON_LIMITS,
} from './lib/preview-release/canonical.mjs'
import {
  canonicalReleaseInspectionJson,
  createAllDisabledCapabilityTarget,
  parseCapabilityTarget,
  parseReleaseInspectionManifest,
  RELEASE_INSPECTION_CAPABILITIES,
  RELEASE_INSPECTION_ENVIRONMENTS,
  RELEASE_INSPECTION_KINDS,
  RELEASE_INSPECTION_MANIFEST_SOURCES,
  RELEASE_INSPECTION_SECRET_NAMES,
  RELEASE_INSPECTION_TOOL_CONTRACT_VERSION,
  validateBindingPolicy,
  validateCapabilityMatrix,
  validateCapabilityTarget,
  validateLocalProjection,
  validateSecretPresencePolicy,
} from './lib/release-inspection/contracts.mjs'
import {
  createLocalReleaseInspectionProjection,
  loadLocalReleaseInspectionSources,
  loadReleaseInspectionManifest,
  renderLocalReleaseInspectionProjection,
} from './lib/release-inspection/local-projection.mjs'
import {
  evaluateSchema4ActivationAuthority,
  SCHEMA4_AUTHORITY_SCHEMA_VERSION,
} from './lib/schema4-activation-authority.mjs'
import {
  parseReleaseInspectionLocalArguments,
  runReleaseInspectionLocalCli,
} from './release-inspection-local.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nowMs = Date.UTC(2026, 6, 31, 12)
const manifestSource = readFileSync(path.join(repositoryRoot, 'config/release-inspection-manifest.json'), 'utf8')
const manifest = parseReleaseInspectionManifest(manifestSource)
const projection = createLocalReleaseInspectionProjection({ repositoryRoot, nowMs })
const trustedSourceContext = immutablePlain({
  protectedSourceHashes: projection.protectedSourceHashes,
})

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.isFrozen(value), true)
  for (const entry of Object.values(value)) assertDeepFrozen(entry)
}

function clonedProjection() {
  return structuredClone(projection)
}

function localModuleGraph(entryPaths) {
  const pending = [...entryPaths]
  const visited = new Set()
  const modules = []
  while (pending.length > 0) {
    const modulePath = pending.pop()
    if (visited.has(modulePath)) continue
    visited.add(modulePath)
    const source = readFileSync(modulePath, 'utf8')
    modules.push({ modulePath, source })
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      const resolved = path.resolve(path.dirname(modulePath), specifier)
      if (resolved.endsWith('.mjs')) pending.push(resolved)
    }
  }
  return modules
}

function releaseInspectionFilesystemSnapshot() {
  const roots = [
    'config', 'docs', 'functions', 'migrations', 'public', 'scripts', 'shared', 'src', 'workers',
  ]
  const entries = []
  const visit = (absolutePath, relativePath) => {
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, entry), `${relativePath}/${entry}`)
      }
      return
    }
    if (!stats.isFile()) throw new Error(`Unsupported test snapshot entry ${relativePath}.`)
    entries.push([
      relativePath,
      createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
    ])
  }
  for (const root of roots) visit(path.join(repositoryRoot, root), root)
  for (const file of ['README.md', 'package.json', 'wrangler.toml']) {
    visit(path.join(repositoryRoot, file), file)
  }
  return canonicalJson(entries)
}

test('release-inspection manifest, projection, and canonical output are strict, immutable, and deterministic', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.kind, RELEASE_INSPECTION_KINDS.manifest)
  assert.equal(projection.schemaVersion, 1)
  assert.equal(projection.kind, RELEASE_INSPECTION_KINDS.localProjection)
  assert.equal(projection.result, 'UNKNOWN')
  assert.equal(projection.executionAuthorization, 'prohibited')
  assert.equal(projection.noNetworkAccess, true)
  assert.equal(projection.noFilesystemWrites, true)
  assertDeepFrozen(manifest)
  assertDeepFrozen(projection)
  const second = createLocalReleaseInspectionProjection({ repositoryRoot, nowMs })
  assert.equal(renderLocalReleaseInspectionProjection(projection), renderLocalReleaseInspectionProjection(second))
  assert.equal(renderLocalReleaseInspectionProjection(projection).endsWith('\n'), true)
  assert.deepEqual(validateLocalProjection(projection), projection)
  const reorderedSources = clonedProjection()
  reorderedSources.protectedSourceHashes.reverse()
  assert.throws(() => validateLocalProjection(reorderedSources), /deterministic path ordering/i)
})

test('capability targets require exactly two environments and seven exact ASCII capability names', () => {
  const allDisabled = createAllDisabledCapabilityTarget()
  assert.deepEqual(Object.keys(allDisabled), ['preview', 'production'])
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    assert.deepEqual(Object.keys(allDisabled[environment]), [...RELEASE_INSPECTION_CAPABILITIES].sort())
  }
  const reversed = Object.fromEntries([...RELEASE_INSPECTION_ENVIRONMENTS].reverse().map((environment) => [
    environment,
    Object.fromEntries([...RELEASE_INSPECTION_CAPABILITIES].reverse().map((capability) => [capability, 'disabled'])),
  ]))
  assert.equal(canonicalJson(validateCapabilityTarget(reversed)), canonicalJson(allDisabled))

  for (const mutate of [
    (target) => { delete target.preview.cleanupCron },
    (target) => { target.preview.futureCapability = 'disabled' },
    (target) => { target.preview.leaderboardReads = target.preview.leaderboardRead; delete target.preview.leaderboardRead },
    (target) => { target.preview.leaderboardReаd = target.preview.leaderboardRead; delete target.preview.leaderboardRead },
    (target) => { target.staging = target.preview },
    (target) => { delete target.production },
    (target) => { target.preview.cleanupCron = 'DISABLED' },
  ]) {
    const target = structuredClone(allDisabled)
    mutate(target)
    assert.throws(() => validateCapabilityTarget(target), /release-inspection contract refused/i)
  }
})

test('strict parsers reject duplicate semantic entries, unsupported versions, dangerous keys, BOMs, and excessive input', () => {
  const duplicateManifest = manifestSource.replace(
    '"schemaVersion": 1,',
    '"schemaVersion": 1,\n  "schemaVersion": 1,',
  )
  assert.throws(() => parseReleaseInspectionManifest(duplicateManifest), /duplicate object key/i)
  assert.throws(() => parseReleaseInspectionManifest(`\uFEFF${manifestSource}`), /BOM/i)
  assert.throws(
    () => parseReleaseInspectionManifest(manifestSource.replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1,\n  "__proto__": {},',
    )),
    /dangerous object key/i,
  )
  assert.throws(
    () => parseReleaseInspectionManifest(manifestSource.replace('"schemaVersion": 1', '"schemaVersion": 2')),
    /exact integer token|unsupported/i,
  )
  assert.throws(
    () => parseReleaseInspectionManifest(manifestSource.replace(RELEASE_INSPECTION_KINDS.manifest, 'legacy-preview-plan')),
    /unsupported/i,
  )
  for (const replacement of [
    'config/substituted-authority.json',
    'workers/draft-validation/wrangler-copy.toml',
  ]) {
    const substituted = structuredClone(manifest)
    substituted.sources.authority = replacement
    assert.throws(
      () => parseReleaseInspectionManifest(JSON.stringify(substituted)),
      /exact reviewed source identity map/i,
    )
  }

  const target = JSON.stringify(createAllDisabledCapabilityTarget())
  const duplicateCapability = target.replace(
    '"leaderboardRead":"disabled"',
    '"leaderboardRead":"disabled","leaderboardRead":"disabled"',
  )
  assert.throws(() => parseCapabilityTarget(duplicateCapability), /duplicate object key/i)
  const oversized = JSON.stringify({ preview: { payload: 'x'.repeat(70_000) }, production: {} })
  assert.throws(() => parseCapabilityTarget(oversized), /byte|exact seven/i)
})

test('release-inspection schema versions require the exact integer token while ordinary numbers remain supported', () => {
  for (const token of ['1.0', '1.00', '1e0', '1E+0', '01', '+1', '-0', '-1', '2']) {
    assert.throws(
      () => parseReleaseInspectionManifest(manifestSource.replace('"schemaVersion": 1', `"schemaVersion": ${token}`)),
      /exact integer token/i,
      token,
    )
  }
  for (const token of ['"1"', 'null', 'true', 'false', '{}', '[]']) {
    assert.throws(
      () => parseReleaseInspectionManifest(manifestSource.replace('"schemaVersion": 1', `"schemaVersion": ${token}`)),
      /exact integer token/i,
      token,
    )
  }
  const parsed = parseStrictJson('{"schemaVersion":1,"ordinary":1.0,"exponent":1e0}', {
    label: 'Exact-version parser fixture',
    limits: STRICT_JSON_LIMITS.releaseManifest,
    exactIntegerTokens: { schemaVersion: '1' },
  })
  assert.deepEqual(parsed, { schemaVersion: 1, ordinary: 1, exponent: 1 })
  assert.equal(canonicalReleaseInspectionJson(manifest).includes('"schemaVersion":1'), true)
  assert.equal(renderLocalReleaseInspectionProjection(projection).includes('"schemaVersion":1'), true)
})

test('all 2^7 combinations are understood but only exact all-disabled targets pass policy before source initialization', () => {
  const base = createAllDisabledCapabilityTarget()
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    for (let mask = 0; mask < 2 ** RELEASE_INSPECTION_CAPABILITIES.length; mask += 1) {
      const target = structuredClone(base)
      RELEASE_INSPECTION_CAPABILITIES.forEach((capability, index) => {
        target[environment][capability] = mask & (1 << index) ? 'enabled' : 'disabled'
      })
      assert.doesNotThrow(() => validateCapabilityTarget(target, { enforceAllDisabledPolicy: false }))
      if (mask === 0) {
        assert.doesNotThrow(() => validateCapabilityTarget(target))
      } else {
        let sourceInitializations = 0
        assert.throws(() => createLocalReleaseInspectionProjection({
          repositoryRoot,
          nowMs,
          requestedCapabilities: target,
          sourceLoader() {
            sourceInitializations += 1
            throw new Error('source loader initialized')
          },
        }), /all-disabled capability target/i)
        assert.equal(sourceInitializations, 0)
      }
    }
  }
})

test('identity narrow state, compatibility ceiling, and emergency stop cross-product fails closed', () => {
  const identityCapabilities = ['identityClaim', 'identityStatus', 'identityRename', 'identityRecovery']
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    for (const capability of identityCapabilities) {
      for (const narrow of ['disabled', 'enabled']) {
        for (const ceiling of ['disabled', 'enabled']) {
          for (const emergencyStop of ['engaged', 'clear']) {
            const capabilities = Object.fromEntries(
              RELEASE_INSPECTION_CAPABILITIES.map((name) => [name, name === capability ? narrow : 'disabled']),
            )
            const authority = {
              schemaVersion: SCHEMA4_AUTHORITY_SCHEMA_VERSION,
              environment,
              reviewedAtMs: emergencyStop === 'engaged' ? null : nowMs - 1_000,
              expiresAtMs: emergencyStop === 'engaged' ? null : nowMs + 60_000,
              emergencyStop,
              identityCompatibilityMode: ceiling,
              capabilities,
            }
            const result = evaluateSchema4ActivationAuthority(authority, { expectedEnvironment: environment, nowMs })
            const expectedEnabled = emergencyStop === 'clear' && narrow === 'enabled' && ceiling === 'enabled'
            assert.equal(result.capabilities[capability], expectedEnabled ? 'enabled' : 'disabled')
            if (emergencyStop === 'engaged' && (narrow === 'enabled' || ceiling === 'enabled')) {
              assert.equal(result.valid, false)
            }
            if (emergencyStop === 'clear' && narrow === 'enabled' && ceiling === 'disabled') {
              assert.equal(result.valid, false)
            }
          }
        }
      }
    }
  }
})

test('surface projection matches an independently authored exact matrix', () => {
  const expected = {
    leaderboardRead: ['frontend', 'pages'],
    identityClaim: ['frontend', 'pages', 'worker'],
    identityStatus: ['frontend', 'pages', 'worker'],
    identityRename: ['frontend', 'pages', 'worker'],
    draftSubmission: ['frontend', 'pages', 'worker'],
    identityRecovery: ['frontend', 'pages', 'worker'],
    cleanupCron: ['worker', 'schedule'],
  }
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    const record = projection.capabilityMatrix.environments[environment]
    assert.equal(record.authorityContext.environment, environment)
    assert.equal(record.authorityContext.emergencyStop, 'engaged')
    assert.equal(record.authorityContext.identityCompatibilityCeiling, 'disabled')
    assert.equal(record.authorityContext.reviewedAtMs, null)
    assert.equal(record.authorityContext.expiresAtMs, null)
    assert.deepEqual(Object.keys(record.capabilities), [...RELEASE_INSPECTION_CAPABILITIES].sort())
    for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
      const capabilityRecord = record.capabilities[capability]
      assert.equal(capabilityRecord.authority.configuredState, 'disabled')
      assert.equal(capabilityRecord.effectiveState, 'disabled')
      assert.equal(capabilityRecord.emergencyStopInfluence, 'forced-disabled')
      for (const surface of ['frontend', 'pages', 'worker', 'schedule']) {
        assert.equal(
          capabilityRecord.surfaces[surface].applicability,
          expected[capability].includes(surface) ? 'applicable' : 'not-applicable',
        )
      }
    }
  }

  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
      const compatibilityMutation = structuredClone(projection.capabilityMatrix)
      compatibilityMutation.environments[environment].capabilities[capability].compatibilityCeiling = (
        compatibilityMutation.environments[environment].capabilities[capability].compatibilityCeiling
          === 'disabled' ? 'not-applicable' : 'disabled'
      )
      assert.throws(
        () => validateCapabilityMatrix(compatibilityMutation, trustedSourceContext),
        /release-inspection contract refused/i,
      )

      for (const surface of ['frontend', 'pages', 'worker', 'schedule']) {
        const mutated = structuredClone(projection.capabilityMatrix)
        const record = mutated.environments[environment].capabilities[capability].surfaces[surface]
        if (expected[capability].includes(surface)) {
          Object.assign(record, {
            applicability: 'not-applicable',
            configuredState: 'not-applicable',
            effectiveState: 'not-applicable',
            evidence: {
              availability: 'not-applicable',
              provenance: 'not-applicable',
              sourceHash: null,
              sourcePath: null,
            },
          })
        } else {
          Object.assign(record, {
            applicability: 'applicable',
            configuredState: 'disabled',
            effectiveState: 'disabled',
            evidence: structuredClone(
              mutated.environments[environment].capabilities.leaderboardRead.surfaces.pages.evidence,
            ),
          })
        }
        assert.throws(
          () => validateCapabilityMatrix(mutated, trustedSourceContext),
          /release-inspection contract refused/i,
        )
      }
    }
  }
})

test('standalone artifacts require and exhaustively verify trusted protected-source context', () => {
  assert.deepEqual(
    validateCapabilityMatrix(projection.capabilityMatrix, trustedSourceContext),
    projection.capabilityMatrix,
  )
  assert.deepEqual(
    validateBindingPolicy(projection.bindingPolicy, trustedSourceContext),
    projection.bindingPolicy,
  )
  assert.throws(
    () => validateCapabilityMatrix(projection.capabilityMatrix),
    /explicit trusted protected-source inventory/i,
  )
  assert.throws(
    () => validateBindingPolicy(projection.bindingPolicy),
    /explicit trusted protected-source inventory/i,
  )
  assert.throws(
    () => canonicalReleaseInspectionJson(projection.capabilityMatrix),
    /explicit trusted protected-source inventory/i,
  )
  assert.throws(
    () => canonicalReleaseInspectionJson(projection.bindingPolicy),
    /explicit trusted protected-source inventory/i,
  )
  assert.match(
    canonicalReleaseInspectionJson(projection.capabilityMatrix, trustedSourceContext),
    /pennant-pursuit-release-inspection-capability-matrix/,
  )
  assert.match(
    canonicalReleaseInspectionJson(projection.bindingPolicy, trustedSourceContext),
    /pennant-pursuit-release-inspection-binding-policy/,
  )

  const valueAt = (root, segments) => segments.reduce((value, segment) => value[segment], root)
  const evidencePaths = []
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    evidencePaths.push(['environments', environment, 'authorityContext', 'evidence'])
    for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
      evidencePaths.push(['environments', environment, 'capabilities', capability, 'authority', 'evidence'])
      for (const surface of ['frontend', 'pages', 'worker', 'schedule']) {
        evidencePaths.push([
          'environments', environment, 'capabilities', capability, 'surfaces', surface, 'evidence',
        ])
      }
    }
  }
  for (const evidencePath of evidencePaths) {
    const original = valueAt(projection.capabilityMatrix, evidencePath)
    for (const provenance of ['substituted-provenance', original.provenance === 'not-applicable'
      ? 'local-configuration'
      : 'not-applicable']) {
      const mutated = structuredClone(projection.capabilityMatrix)
      valueAt(mutated, evidencePath).provenance = provenance
      assert.throws(
        () => validateCapabilityMatrix(mutated, trustedSourceContext),
        /release-inspection contract refused/i,
      )
    }
    if (original.availability !== 'available') continue
    for (const sourceHash of ['0'.repeat(64), 'f'.repeat(64)]) {
      const mutated = structuredClone(projection.capabilityMatrix)
      valueAt(mutated, evidencePath).sourceHash = sourceHash
      assert.throws(
        () => validateCapabilityMatrix(mutated, trustedSourceContext),
        /exact reviewed source/i,
      )
    }
    const substituted = structuredClone(projection.capabilityMatrix)
    const substitutedEvidence = valueAt(substituted, evidencePath)
    const alternate = trustedSourceContext.protectedSourceHashes.find(({ path: sourcePath }) => (
      sourcePath !== original.sourcePath
    ))
    substitutedEvidence.sourcePath = alternate.path
    substitutedEvidence.sourceHash = alternate.sha256
    assert.throws(
      () => validateCapabilityMatrix(substituted, trustedSourceContext),
      /exact reviewed source/i,
    )
  }

  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    for (const field of ['redirectsHash', 'routesHash']) {
      for (const sourceHash of ['0'.repeat(64), 'f'.repeat(64)]) {
        const mutated = structuredClone(projection.bindingPolicy)
        mutated.environments[environment].providerBuildSettings.localEvidence[field] = sourceHash
        assert.throws(
          () => validateBindingPolicy(mutated, trustedSourceContext),
          /trusted protected-source provenance/i,
        )
      }
    }
  }

  for (let index = 0; index < trustedSourceContext.protectedSourceHashes.length; index += 1) {
    for (const sourceHash of ['0'.repeat(64), 'f'.repeat(64)]) {
      const context = structuredClone(trustedSourceContext)
      context.protectedSourceHashes[index].sha256 = sourceHash
      assert.throws(
        () => validateCapabilityMatrix(projection.capabilityMatrix, context),
        /trusted protected-source hashes/i,
      )
      assert.throws(
        () => validateBindingPolicy(projection.bindingPolicy, context),
        /trusted protected-source hashes/i,
      )
    }
    const substitutedPath = structuredClone(trustedSourceContext)
    substitutedPath.protectedSourceHashes[index].path = `substituted/source-${index}.json`
    assert.throws(
      () => validateCapabilityMatrix(projection.capabilityMatrix, substitutedPath),
      /trusted protected-source inventory|deterministic path ordering/i,
    )
    const omitted = structuredClone(trustedSourceContext)
    omitted.protectedSourceHashes.splice(index, 1)
    assert.throws(
      () => validateBindingPolicy(projection.bindingPolicy, omitted),
      /explicit trusted protected-source inventory/i,
    )
  }
  const duplicated = structuredClone(trustedSourceContext)
  duplicated.protectedSourceHashes[1] = structuredClone(duplicated.protectedSourceHashes[0])
  assert.throws(
    () => validateCapabilityMatrix(projection.capabilityMatrix, duplicated),
    /duplicate provenance/i,
  )
  const reordered = structuredClone(trustedSourceContext)
  reordered.protectedSourceHashes.reverse()
  assert.throws(
    () => canonicalReleaseInspectionJson(projection.bindingPolicy, reordered),
    /deterministic path ordering/i,
  )
  const swappedHashes = structuredClone(trustedSourceContext)
  ;[swappedHashes.protectedSourceHashes[0].sha256, swappedHashes.protectedSourceHashes[1].sha256] = [
    swappedHashes.protectedSourceHashes[1].sha256,
    swappedHashes.protectedSourceHashes[0].sha256,
  ]
  assert.throws(
    () => canonicalReleaseInspectionJson(projection.capabilityMatrix, swappedHashes),
    /trusted protected-source hashes/i,
  )
})

test('protected frontend source is exact, immutable, structurally versioned, and has no ambient activation input', () => {
  assert.deepEqual(Object.keys(PROTECTED_FRONTEND_CAPABILITY_SOURCE.capabilities), RELEASE_INSPECTION_CAPABILITIES)
  for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
    assert.equal(PROTECTED_FRONTEND_CAPABILITY_SOURCE.capabilities[capability], 'disabled')
    assert.equal(protectedFrontendCapabilityState(capability), 'disabled')
  }
  assert.equal(protectedFrontendCapabilityState('futureCapability'), 'disabled')
  assertDeepFrozen(PROTECTED_FRONTEND_CAPABILITY_SOURCE)
  const structurallyEnabled = structuredClone(PROTECTED_FRONTEND_CAPABILITY_SOURCE)
  structurallyEnabled.capabilities.leaderboardRead = 'enabled'
  assert.doesNotThrow(() => validateProtectedFrontendCapabilitySource(structurallyEnabled, {
    enforceAllDisabledPolicy: false,
  }))
  assert.throws(() => validateProtectedFrontendCapabilitySource(structurallyEnabled), /all-disabled/i)

  const source = readFileSync(path.join(repositoryRoot, 'src/config/protectedCapabilities.mjs'), 'utf8')
  for (const forbidden of [
    'import.meta.env', 'process.env', 'localStorage', 'sessionStorage', 'URLSearchParams',
    'location.search', 'document.cookie',
  ]) assert.equal(source.includes(forbidden), false, forbidden)
})

test('binding policies are exact, secret-name-only, and preserve Production and schedule guards', () => {
  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    const record = projection.bindingPolicy.environments[environment]
    assert.deepEqual(
      Object.keys(record).filter((key) => ['frontend', 'pages', 'worker', 'schedule'].includes(key)),
      ['frontend', 'pages', 'schedule', 'worker'],
    )
    assert.deepEqual(Object.keys(record.platformPrerequisites.pages), ['DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE'])
    assert.deepEqual(Object.keys(record.platformPrerequisites.worker), ['DRAFT_TICKET_MODE', 'DRAFT_VALIDATION_MODE'])
    assert.equal(record.worker.schedules.policy, 'exact-empty')
    assert.equal(record.schedule.schedules.policy, 'exact-empty')
    assert.deepEqual(record.worker.schedules.values, [])
    assert.deepEqual(record.schedule.schedules.values, [])
    assert.equal(record.worker.publicExposure.workersDev, false)
    assert.equal(record.worker.publicExposure.previewUrls, false)
    assert.equal(record.pages.publicExposure.evidenceStatus, 'unavailable')
    assert.equal(record.pages.publicExposure.customDomains, null)
    assert.equal(record.pages.publicExposure.routes, null)
    for (const surface of ['frontend', 'pages', 'worker', 'schedule']) {
      assert.deepEqual(Object.keys(record[surface].secretPolicies), RELEASE_INSPECTION_SECRET_NAMES)
    }
  }
  assert.equal(
    projection.bindingPolicy.environments.production.worker.bindings.some(({ type }) => type === 'd1'),
    false,
  )
  assert.equal(
    projection.bindingPolicy.environments.preview.worker.secretPolicies.DRAFT_TICKET_SIGNING_KEY,
    'required',
  )
  assert.equal(
    projection.bindingPolicy.environments.production.worker.secretPolicies.DRAFT_TICKET_SIGNING_KEY,
    'forbidden',
  )

  const mutations = [
    (policy) => { policy.environments.preview.worker.bindings.push({ ...policy.environments.preview.worker.bindings[0] }) },
    (policy) => { policy.environments.preview.worker.bindings.reverse() },
    (policy) => { policy.environments.preview.worker.bindings.push({ name: 'UNEXPECTED', type: 'plain-text', value: 'disabled' }) },
    (policy) => { policy.environments.preview.worker.bindings.pop() },
    (policy) => { policy.environments.preview.worker.bindings[0].type = 'secret' },
    (policy) => { policy.environments.production.worker.bindings.push({ name: 'DB', type: 'd1', value: 'production-db' }) },
    (policy) => { policy.environments.preview.worker.schedules.values.push('17 * * * *') },
    (policy) => { policy.environments.preview.worker.publicExposure.workersDev = true },
    (policy) => { policy.environments.preview.worker.publicExposure.routes.push('*/*') },
    (policy) => { policy.environments.preview.worker.publicExposure.customDomains.push('*.example.invalid') },
    (policy) => {
      policy.environments.preview.worker.bindings.find(({ name }) => name === 'RETENTION_CLEANUP_MODE').value = 'enabled'
    },
  ]
  for (const mutate of mutations) {
    const policy = structuredClone(projection.bindingPolicy)
    mutate(policy)
    assert.throws(
      () => validateBindingPolicy(policy, trustedSourceContext),
      /release-inspection contract refused/i,
    )
  }

  for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
    for (const surface of ['pages', 'worker']) {
      for (let index = 0; index < projection.bindingPolicy.environments[environment][surface].bindings.length; index += 1) {
        const policy = structuredClone(projection.bindingPolicy)
        policy.environments[environment][surface].bindings[index].value += '-substituted'
        assert.throws(() => validateBindingPolicy(policy, trustedSourceContext), /exact reviewed inventory/i)
      }
    }
    for (const identity of ['pagesProjectName', 'workerName']) {
      const policy = structuredClone(projection.bindingPolicy)
      policy.environments[environment].providerBuildSettings.localEvidence[identity] += '-substituted'
      assert.throws(() => validateBindingPolicy(policy, trustedSourceContext), /provider configuration differs/i)
    }
    const providerMutations = [
      (local) => { local.pagesCompatibilityDate = '2099-01-01' },
      (local) => { local.pagesD1Configuration.migrationsDirectory = 'substituted-migrations' },
      (local) => { local.pagesD1Configuration.previewDatabaseId = 'substituted-preview-id' },
      (local) => { local.workerCompatibilityDate = '2099-01-01' },
      (local) => { local.workerMain = 'src/substituted.ts' },
      (local) => { local.workerRateLimits[0].limit += 1 },
      (local) => { local.workerRateLimits[0].period += 1 },
      (local) => { local.workerRateLimits[0].name += '_SUBSTITUTED' },
      (local) => { local.workerRateLimits[0].namespaceId += '-substituted' },
    ]
    if (environment === 'preview') {
      providerMutations.push(
        (local) => { local.workerD1Configuration.migrationsDirectory = 'substituted-migrations' },
        (local) => { local.workerD1Configuration.previewDatabaseId = 'substituted-preview-id' },
      )
    } else {
      providerMutations.push((local) => { local.workerD1Configuration = {} })
    }
    for (const mutate of providerMutations) {
      const policy = structuredClone(projection.bindingPolicy)
      mutate(policy.environments[environment].providerBuildSettings.localEvidence)
      assert.throws(() => validateBindingPolicy(policy, trustedSourceContext), /provider configuration differs/i)
    }
  }

  for (const presencePolicy of ['required', 'allowed', 'forbidden', 'unresolved', 'not-applicable']) {
    assert.equal(validateSecretPresencePolicy(presencePolicy), presencePolicy)
  }
  assert.throws(() => validateSecretPresencePolicy('present'), /unsupported/i)
  const weakenedPolicy = structuredClone(projection.bindingPolicy)
  weakenedPolicy.environments.preview.pages.secretPolicies.LEADERBOARD_CURSOR_SIGNING_KEY = 'allowed'
  assert.throws(
    () => validateBindingPolicy(weakenedPolicy, trustedSourceContext),
    /secret policy is unsupported/i,
  )

  const secretValue = 'fixture-private-value-that-must-never-appear'
  const masquerade = structuredClone(projection.bindingPolicy)
  masquerade.environments.preview.worker.bindings.push({
    name: 'DRAFT_TICKET_SIGNING_KEY',
    type: 'plain-text',
    value: secretValue,
  })
  let message = ''
  assert.throws(() => validateBindingPolicy(masquerade, trustedSourceContext), (error) => {
    message = error.message
    return /secret-name presence policy/i.test(message)
  })
  assert.equal(message.includes(secretValue), false)
  assert.equal(renderLocalReleaseInspectionProjection(projection).includes(secretValue), false)
})

test('local projection rejects Production identities inserted into Preview evidence', () => {
  const sources = loadLocalReleaseInspectionSources(repositoryRoot, manifest, nowMs)
  const poisoned = structuredClone(sources)
  poisoned.legacyManifest.cloudflare.preview.d1 = structuredClone(
    poisoned.legacyManifest.cloudflare.production.d1,
  )
  assert.throws(() => createLocalReleaseInspectionProjection({
    repositoryRoot,
    nowMs,
    sourceLoader: () => poisoned,
  }), /Preview D1 binding differs|reviewed identity/i)
})

test('local projection rejects every unreviewed Wrangler topology and cross-family binding collision', () => {
  const sources = loadLocalReleaseInspectionSources(repositoryRoot, manifest, nowMs)
  const workerRootSetting = (setting) => sources.workerSource.replace(
    'preview_urls = false\n\n[vars]',
    `preview_urls = false\n${setting}\n\n[vars]`,
  )
  const mutations = [
    (candidate) => { candidate.workerSource = workerRootSetting('routes = []') },
    (candidate) => {
      candidate.workerSource = workerRootSetting(
        'routes = [{ pattern = "validation.example.invalid/*", custom_domain = true }]',
      )
    },
    (candidate) => { candidate.workerSource += '\n[[kv_namespaces]]\nbinding = "CACHE"\nid = "fixture"\n' },
    (candidate) => { candidate.workerSource += '\n[[r2_buckets]]\nbinding = "BUCKET"\nbucket_name = "fixture"\n' },
    (candidate) => { candidate.workerSource += '\n[durable_objects]\nbindings = []\n' },
    (candidate) => { candidate.workerSource += '\n[queues]\nproducers = []\n' },
    (candidate) => { candidate.workerSource += '\n[[analytics_engine_datasets]]\nbinding = "ANALYTICS"\n' },
    (candidate) => { candidate.workerSource += '\n[browser]\nbinding = "BROWSER"\n' },
    (candidate) => { candidate.workerSource += '\n[ai]\nbinding = "AI"\n' },
    (candidate) => { candidate.workerSource += '\n[[hyperdrive]]\nbinding = "HYPERDRIVE"\nid = "fixture"\n' },
    (candidate) => { candidate.workerSource += '\n[[future_bindings]]\nbinding = "FUTURE"\n' },
    (candidate) => { candidate.workerSource += '\n[env.staging]\nworkers_dev = true\n' },
    (candidate) => { candidate.workerSource += '\n[env.production.ai]\nbinding = "AI"\n' },
    (candidate) => {
      candidate.workerSource = candidate.workerSource.replace(
        'binding = "DB"',
        'binding = "DRAFT_VALIDATION_MODE"',
      )
    },
    (candidate) => {
      candidate.workerSource = candidate.workerSource.replace(
        'namespace_id = "16204011"',
        'namespace_id = "16204021"',
      )
    },
    (candidate) => { candidate.workerSource = candidate.workerSource.replace('limit = 5', 'limit = 6') },
    (candidate) => {
      candidate.workerSource = candidate.workerSource.replace('main = "src/index.ts"', 'main = "src/alternate.ts"')
    },
    (candidate) => {
      candidate.pagesSource = candidate.pagesSource.replace(
        'compatibility_date = "2026-07-14"',
        'compatibility_date = "2026-07-14"\nroutes = []',
      )
    },
    (candidate) => { candidate.pagesSource += '\n[[env.production.kv_namespaces]]\nbinding = "CACHE"\nid = "fixture"\n' },
    (candidate) => {
      candidate.pagesSource = candidate.pagesSource.replace(
        'service = "pennant-pursuit-validation-preview"',
        'service = "pennant-pursuit-validation-production"',
      )
    },
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(sources)
    mutate(candidate)
    assert.throws(() => createLocalReleaseInspectionProjection({
      repositoryRoot,
      nowMs,
      sourceLoader: () => candidate,
    }), /Wrangler topology validation refused/)
  }
})

test('local projection provenance is exact, raw-file-bound, and cross-linked through every nested hash', () => {
  const mutations = [
    (candidate) => { candidate.protectedSourceHashes.shift() },
    (candidate) => { candidate.protectedSourceHashes.push({ path: 'config/substitute.json', sha256: '0'.repeat(64) }) },
    (candidate) => { candidate.protectedSourceHashes[0].path = 'config/substitute.json' },
    (candidate) => { candidate.protectedSourceHashes[0].sha256 = '0'.repeat(64) },
    (candidate) => { candidate.authorityHash = '0'.repeat(64) },
    (candidate) => { candidate.manifestHash = '0'.repeat(64) },
    (candidate) => {
      candidate.capabilityMatrix.environments.preview.authorityContext.evidence.sourceHash = '0'.repeat(64)
    },
    (candidate) => {
      candidate.capabilityMatrix.environments.production.capabilities.cleanupCron
        .surfaces.worker.evidence.sourceHash = '0'.repeat(64)
    },
    (candidate) => {
      candidate.bindingPolicy.environments.preview.providerBuildSettings.localEvidence.routesHash = '0'.repeat(64)
    },
  ]
  for (const mutate of mutations) {
    const candidate = clonedProjection()
    mutate(candidate)
    assert.throws(() => validateLocalProjection(candidate), /release-inspection contract refused/i)
  }
  assert.equal(
    projection.authorityHash,
    projection.protectedSourceHashes.find(({ path: sourcePath }) => (
      sourcePath === RELEASE_INSPECTION_MANIFEST_SOURCES.authority
    )).sha256,
  )
})

test('invalid capability targets fail before the implicit clock or any local source initialization', () => {
  const originalNow = Date.now
  let clockReads = 0
  let sourceInitializations = 0
  Date.now = () => {
    clockReads += 1
    return nowMs
  }
  try {
    const enabled = structuredClone(createAllDisabledCapabilityTarget())
    enabled.preview.leaderboardRead = 'enabled'
    for (const requestedCapabilities of [enabled, { preview: {}, production: {} }]) {
      assert.throws(() => createLocalReleaseInspectionProjection({
        repositoryRoot,
        requestedCapabilities,
        sourceLoader() {
          sourceInitializations += 1
          throw new Error('source loader initialized')
        },
      }), /capability target|seven-capability/i)
    }
  } finally {
    Date.now = originalNow
  }
  assert.equal(clockReads, 0)
  assert.equal(sourceInitializations, 0)
})

test('legacy plan, package, artifact, report, and executor paths reject all release-inspection markers', async () => {
  for (const operation of [
    () => assertCurrentDisabledReleasePlan(projection),
    () => buildReleasePlan(projection),
    () => assertCurrentDisabledExecutionContract(projection),
    () => buildExecutionContract(projection),
    () => validateReleasePackage(projection),
    () => writeReleasePackage('/path-that-must-not-be-read', projection),
    () => serializeReleaseArtifact(projection),
    () => checkReport(projection),
    () => renderHumanCheck(projection),
    () => renderHumanPlan(projection),
    () => renderHumanExecution(projection),
    () => rollbackGuidance(projection),
    () => validationReport([projection]),
    () => executionReport({
      releasePackage: projection,
      startedAt: '2026-07-31T12:00:00.000Z',
      completedAt: '2026-07-31T12:00:01.000Z',
      status: 'FAIL',
      stageResults: [],
      finalValidation: {},
      mutationAttempted: false,
    }),
  ]) assert.throws(operation, /release-inspection artifacts.*prohibited/i)

  let clockReads = 0
  await assert.rejects(() => executeReleasePackage(projection, {
    now() {
      clockReads += 1
      return nowMs
    },
  }), /release-inspection artifacts.*prohibited/i)
  assert.equal(clockReads, 0)

  for (const forged of [
    { kind: 'pennant-pursuit-preview-release-package', schemaVersion: 2, nested: projection },
    { kind: 'pennant-pursuit-preview-release-package', schemaVersion: 2, plan: projection.capabilityMatrix },
    {
      kind: 'pennant-pursuit-preview-release-package',
      schemaVersion: 2,
      capabilityMatrix: {},
      bindingPolicy: {},
      remoteObservation: {},
    },
  ]) assert.throws(() => validateReleasePackage(forged), /release-inspection artifacts.*prohibited/i)

  const fullwidth = (value) => [...value].map((character) => {
    const code = character.codePointAt(0)
    return code >= 0x21 && code <= 0x7E
      ? String.fromCodePoint(code + 0xFEE0)
      : character
  }).join('')
  let getterReads = 0
  const accessorCandidate = {}
  Object.defineProperty(accessorCandidate, 'kind', {
    enumerable: true,
    get() {
      getterReads += 1
      return RELEASE_INSPECTION_KINDS.localProjection
    },
  })
  const cyclicCandidate = { kind: 'pennant-pursuit-preview-release-package' }
  cyclicCandidate.self = cyclicCandidate
  const shared = { ordinary: true }
  const sharedCandidate = { left: shared, right: shared }
  const deepCandidate = {}
  let deepCursor = deepCandidate
  for (let depth = 0; depth < 66; depth += 1) {
    deepCursor.child = {}
    deepCursor = deepCursor.child
  }
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  let setterWrites = 0
  const setterCandidate = {}
  Object.defineProperty(setterCandidate, 'artifactKind', {
    enumerable: true,
    set() {
      setterWrites += 1
    },
  })
  const inspectionSpecificKeys = [
    'artifactKind', 'toolContract', 'schemaVersion', 'capabilityMatrix', 'bindingPolicy',
    'remoteObservation', 'executionAuthorization', 'remoteCurrentness', 'provenance',
    'authorityHash', 'manifestHash', 'protectedSourceHashes', 'policy', 'result',
  ]
  const fragmentValue = (key) => key === 'schemaVersion' ? 1 : `copied-${key}`
  const oneKeyFragments = inspectionSpecificKeys.map((key) => ({ [key]: fragmentValue(key) }))
  const twoKeyFragments = inspectionSpecificKeys.map((key, index) => {
    const companion = inspectionSpecificKeys[(index + 1) % inspectionSpecificKeys.length]
    return { [key]: fragmentValue(key), [companion]: fragmentValue(companion) }
  })
  const barrierCandidates = [
    ...oneKeyFragments,
    ...oneKeyFragments.map((fragment) => JSON.parse(JSON.stringify(fragment))),
    ...twoKeyFragments,
    ...twoKeyFragments.map((fragment) => JSON.parse(JSON.stringify(fragment))),
    { kind: RELEASE_INSPECTION_KINDS.localProjection.toUpperCase() },
    { kind: fullwidth(RELEASE_INSPECTION_KINDS.localProjection) },
    { ArTiFaCtKiNd: 'copied' },
    { [fullwidth('artifactKind')]: 'copied' },
    { nested: [[[{ toolContractVersion: RELEASE_INSPECTION_TOOL_CONTRACT_VERSION.toUpperCase() }]]] },
    { nested: [[[{ policy: 'all-disabled', result: 'UNKNOWN' }]]] },
    Object.create({ kind: RELEASE_INSPECTION_KINDS.bindingPolicy }),
    Object.create({ artifactKind: 'copied' }),
    Object.create({ capabilityMatrix: {}, bindingPolicy: {}, remoteObservation: {} }),
    { CapabilityMatrix: {}, BindingPolicy: {}, RemoteObservation: {} },
    accessorCandidate,
    setterCandidate,
    cyclicCandidate,
    sharedCandidate,
    deepCandidate,
    new Proxy({ ordinary: true }, {}),
    revoked.proxy,
    new Proxy({}, { ownKeys() { throw new Error('ambiguous reflection') } }),
    { [Symbol('inspection')]: true },
    { unsupportedSnapshotValue: Symbol('inspection') },
    { unsupportedSnapshotValue: 1n },
  ]
  for (const candidate of barrierCandidates) {
    assert.throws(() => validateReleasePackage(candidate), /release-inspection artifacts.*prohibited/i)
    let optionReads = 0
    const options = new Proxy({}, {
      get() {
        optionReads += 1
        throw new Error('executor options must remain unread')
      },
    })
    await assert.rejects(
      () => executeReleasePackage(candidate, options),
      /release-inspection artifacts.*prohibited/i,
    )
    assert.equal(optionReads, 0)
  }
  assert.equal(getterReads, 0)
  assert.equal(setterWrites, 0)

  let environmentReads = 0
  let stdinReads = 0
  let stdoutReads = 0
  let optionReads = 0
  const environmentDescriptor = Object.getOwnPropertyDescriptor(process, 'env')
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout')
  let rejection
  try {
    Object.defineProperty(process, 'env', {
      configurable: true,
      enumerable: true,
      get() {
        environmentReads += 1
        throw new Error('environment must remain unread')
      },
    })
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      enumerable: true,
      get() {
        stdinReads += 1
        throw new Error('stdin TTY must remain unread')
      },
    })
    Object.defineProperty(process, 'stdout', {
      configurable: true,
      enumerable: true,
      get() {
        stdoutReads += 1
        throw new Error('stdout TTY must remain unread')
      },
    })
    rejection = executeReleasePackage({ executionAuthorization: 'prohibited' }, new Proxy({}, {
      get() {
        optionReads += 1
        throw new Error('executor dependency must remain unread')
      },
    }))
  } finally {
    Object.defineProperty(process, 'env', environmentDescriptor)
    Object.defineProperty(process, 'stdin', stdinDescriptor)
    Object.defineProperty(process, 'stdout', stdoutDescriptor)
  }
  await assert.rejects(rejection, /release-inspection artifacts.*prohibited/i)
  assert.deepEqual({ environmentReads, stdinReads, stdoutReads, optionReads }, {
    environmentReads: 0,
    stdinReads: 0,
    stdoutReads: 0,
    optionReads: 0,
  })
})

test('stdout-only CLI has no target, writer, network, remote Git, environment activation, or subprocess surface', () => {
  assert.deepEqual(parseReleaseInspectionLocalArguments([]), { help: false })
  assert.deepEqual(parseReleaseInspectionLocalArguments(['--help']), { help: true })
  let projectCalls = 0
  assert.throws(() => runReleaseInspectionLocalCli(['--target-state', 'enabled'], {
    repositoryRoot,
    project() {
      projectCalls += 1
      return projection
    },
  }), /accepts no target/i)
  assert.equal(projectCalls, 0)

  let output = ''
  const result = runReleaseInspectionLocalCli([], {
    repositoryRoot,
    output: { write(value) { output += value } },
    project: () => projection,
  })
  assert.equal(result, projection)
  assert.equal(output, renderLocalReleaseInspectionProjection(projection))

  const modules = localModuleGraph([
    path.join(repositoryRoot, 'scripts/release-inspection-local.mjs'),
    path.join(repositoryRoot, 'scripts/lib/release-inspection/local-projection.mjs'),
  ])
  const sources = modules.map(({ source }) => source).join('\n')
  for (const forbidden of [
    'node:child_process', 'writeFile', 'appendFile', 'mkdir', 'fetch(', 'cloudflare-readonly',
    'node:http', 'node:https', 'node:net', 'node:tls', 'ls-remote', '--remote',
    '.preview-release',
  ]) assert.equal(sources.includes(forbidden), false, forbidden)

  const originalFetch = globalThis.fetch
  const poisonedEnvironment = {
    CLOUDFLARE_API_TOKEN: 'fixture-cloudflare-value',
    PENNANT_PREVIEW_API_TOKEN: 'fixture-preview-value',
    VITE_DRAFT_SUBMISSION_MODE: 'enabled',
    VITE_LEADERBOARD_READ_MODE: 'enabled',
  }
  const previousEnvironment = Object.fromEntries(
    Object.keys(poisonedEnvironment).map((name) => [name, process.env[name]]),
  )
  let networkCalls = 0
  const beforeFilesystem = releaseInspectionFilesystemSnapshot()
  try {
    globalThis.fetch = async () => {
      networkCalls += 1
      throw new Error('network must not initialize')
    }
    Object.assign(process.env, poisonedEnvironment)
    const actual = runReleaseInspectionLocalCli([], {
      repositoryRoot,
      output: { write() {} },
    })
    assert.equal(actual.result, 'UNKNOWN')
    assert.equal(actual.executionAuthorization, 'prohibited')
    for (const environment of RELEASE_INSPECTION_ENVIRONMENTS) {
      for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
        assert.equal(actual.capabilityMatrix.environments[environment]
          .capabilities[capability].effectiveState, 'disabled')
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  assert.equal(networkCalls, 0)
  assert.equal(releaseInspectionFilesystemSnapshot(), beforeFilesystem)

  for (const documentationPath of [
    'docs/PREVIEW_RELEASE_WORKFLOW.md',
    'docs/MILESTONE_3D2A_RELEASE_INSPECTION_CONTRACTS.md',
  ]) {
    const documentation = readFileSync(path.join(repositoryRoot, documentationPath), 'utf8')
    assert.match(documentation, /Node (?:entry point|program).*no-write|no-write.*Node (?:entry point|program)/is)
    assert.match(documentation, /npm.*cache.*logs|npm.*cache or logs/is)
    assert.doesNotMatch(documentation, /npm[^\n]*literally zero[^\n]*filesystem calls\./i)
  }
})

test('unproven currentness cannot be reported as NO-OP or executable authorization', () => {
  const noOp = clonedProjection()
  noOp.result = 'NO-OP'
  assert.throws(() => validateLocalProjection(noOp), /authority boundary/i)
  const executable = clonedProjection()
  executable.executionAuthorization = 'approved'
  assert.throws(() => validateLocalProjection(executable), /authority boundary/i)
  const observed = clonedProjection()
  observed.remoteObservation.environments.production.status = 'available'
  assert.throws(() => validateLocalProjection(observed), /remote observation/i)
})

test('manifest loading uses the strict checked-in contract', () => {
  assert.deepEqual(loadReleaseInspectionManifest(repositoryRoot), manifest)
})

console.log('Release-inspection 3D-2A contract tests passed: strict seven-capability local evidence remains all-disabled, UNKNOWN, side-effect-free, and non-executable.')
