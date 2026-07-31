import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSchema4ActivationPlan,
  assertSchema4MigrationTarget,
  assertSchema4ProtectedConfigurationSupportsActivation,
  assertSchema4RepositoryReadiness,
  assertSchema4StateModelSupportsActivation,
} from './lib/schema4-activation-readiness.mjs'
import { loadReleaseManifest } from './lib/preview-release/manifest.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { migrations } = assertSchema4RepositoryReadiness(repositoryRoot)
const migration = (backendVersion, pending, status = 'valid') => ({
  status,
  backendVersion,
  pending,
})
const pending0004 = [{ ...migrations[3] }]

assert.doesNotThrow(() => assertSchema4MigrationTarget(
  migration(3, pending0004),
  migrations,
))
assert.doesNotThrow(() => assertSchema4MigrationTarget(
  migration(4, []),
  migrations,
))
for (const [label, observed, known = migrations] of [
  ['unknown schema', migration(null, [], 'ambiguous')],
  ['older schema', migration(2, pending0004)],
  ['newer schema', migration(5, [])],
  ['missing 0004', migration(3, []), migrations.slice(0, 3)],
  ['unexpected prefix', migration(3, pending0004), [
    ...migrations.slice(0, 2),
    { ...migrations[2], name: '0003_unreviewed.sql' },
    migrations[3],
  ]],
  ['more than 0004 pending', migration(3, [
    ...pending0004,
    { id: 5, name: '0005_unreviewed.sql', sha256: '0'.repeat(64) },
  ]), [
    ...migrations,
    { id: 5, name: '0005_unreviewed.sql', sha256: '0'.repeat(64) },
  ]],
]) {
  assert.throws(
    () => assertSchema4MigrationTarget(observed, known),
    /Schema-4 activation refused/,
    label,
  )
}

assert.doesNotThrow(() => assertSchema4StateModelSupportsActivation(repositoryRoot))
assert.throws(
  () => assertSchema4ProtectedConfigurationSupportsActivation(repositoryRoot),
  /protected configuration does not yet represent enabled schema-4 authority/,
)

const unresolved = loadReleaseManifest(repositoryRoot).manifest
assert.throws(
  () => assertSchema4ActivationPlan({
    repositoryRoot,
    targetState: 'submission-enabled',
    migration: migration(3, pending0004),
    manifest: unresolved,
  }),
  /Production identity remains ambiguous/,
)
assert.doesNotThrow(() => assertSchema4ActivationPlan({
  repositoryRoot,
  targetState: 'disabled',
  migration: migration(null, [], 'ambiguous'),
  manifest: unresolved,
}))

const resolved = JSON.parse(JSON.stringify(unresolved))
resolved.cloudflare.account = {
  status: 'resolved',
  id: 'a'.repeat(32),
  reason: '',
}
resolved.cloudflare.production.pages.branch = {
  status: 'resolved',
  value: 'main',
  reason: '',
}
resolved.cloudflare.production.pages.domains = {
  status: 'resolved',
  values: ['pennant.example'],
  reason: '',
}
assert.throws(
  () => assertSchema4ActivationPlan({
    repositoryRoot,
    targetState: 'submission-enabled',
    migration: migration(3, pending0004),
    manifest: resolved,
  }),
  /protected configuration does not yet represent enabled schema-4 authority/,
)

console.log('Schema-4 activation readiness tests passed: the independent local authority model supports every capability while unknown migration state, Production ambiguity, and still-unmodified protected activation configuration fail closed.')
