import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSchema4ActivationPlan,
  assertSchema4MigrationTarget,
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

assert.throws(
  () => assertSchema4StateModelSupportsActivation(repositoryRoot),
  /protected legacy activation model lacks the independent schema-4 identity\/recovery gates/,
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

console.log('Schema-4 activation readiness tests passed: exact 3→4 migration planning is accepted while unknown versions, prefix drift, missing/extra migrations, Production ambiguity, and the missing independent recovery state fail closed.')
