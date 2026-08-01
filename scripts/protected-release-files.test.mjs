import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  assertExactProtectedConfigurationPaths,
  PROTECTED_CONFIGURATION_PATHS,
} from './lib/preview-release/local-state.mjs'
import { validateCheckedInProtectedCapabilityFoundation } from './prepare-d1c4-activation.mjs'

const protectedFiles = Object.freeze({
  'config/preview-release.json': '6f2fa50826559fb031292229d010b3c44ff0007f977738f34e8a60646209b8de',
  'config/release-inspection-manifest.json': '4aea6b112840e6879a57923fdd98d58064068b8e280ff69662a3122cb26e1051',
  'config/preview-schema4-readiness.json': '7a738fd754c8581f2cad6e9cc1c1a5358256ec3f65b47e7120b24f9ec43b0ae4',
  'scripts/lib/preview-release/wrangler-topology.mjs': 'ba4447b30bd8ae9568830e8a78fde041d62c5bc4ce887df9bf38877a5ad97e2a',
  'shared/schema4-capabilities.mjs': 'cee0c6ab8f62a67ff51b6da7215dbf5bfcf07f70db01a783217258c9b463ce97',
  'shared/schema4-runtime-consumers.mjs': 'cef6af9bace31a86c3e045a3cce19ca32e55ed40c017bd4f1650111858e7d5d6',
  'src/config/protectedCapabilities.mjs': 'b49db6f6d246ffb1d984fe856d57554b5ee1ea30c144bd62a5dada0e63781d0e',
  'src/features/leaderboard/runtimeConfig.registrations.json': '06f802ac61aa55315c8ee072cbffb9ff730c3496149c9db0f537877c5b3f0e5d',
  'functions/lib/leaderboard-mode.registrations.json': '444d479401eb9f0f4148289a6b3459d67312ff05f1530011dd2dc92bf64d462d',
  'functions/lib/leaderboard-identity-mode.registrations.json': '20ce2b653850298090faaa564eb0d5c24a44eae0452a27f94d65b89c8ca757c8',
  'functions/lib/draft-submission-mode.registrations.json': '5ad7d00c74906f0f24c791d9595bb2569fd7cf7058d5a1721ce3c6076d9b596b',
  'workers/draft-validation/src/retention-cleanup-mode.registrations.json': 'ca961c5a822b4af6261484d00b685157595444ebcad42fff1167c4beeb2a3890',
  'migrations/0001_backend_foundation.sql': '5362bdd8ea5c271aee3dbf544adae4d4036c4dfe27e44a3284f088bded5888ae',
  'migrations/0002_draft_submissions.sql': '9eba9232c8806676bd0a32dfbb7da8fca97f8d381a126a723fe2189d27721b7a',
  'migrations/0003_leaderboard_foundation.sql': '344b803c7e2111c4151c7010fd4e0c15217b1d2fc7522af5c2a260d19450b5fa',
  'migrations/0004_leaderboard_identity_ranking.sql': 'c87e555483d321e4b4ac2bcfbb7702bd6a38293ae593658cec13d48398c25346',
  'public/_redirects': '32a91e4d018194555c7f64f23faf2512270c3a248844b0c107f5f480366483eb',
  'public/_routes.json': '875208beeb02398614dd2f6dc8779c9261719bbf4f786a4464028dc2a191b29d',
  'workers/draft-validation/d1c4-activation-states.json': '768e29612688aeb3d0b3325a58468a4cccd4865bb2bae51c306e6f47958815f3',
  'workers/draft-validation/wrangler.toml': '862952756bfc0fc2b4cbd256cb5914f40e13376580fddd50a85584ef51927d83',
  'wrangler.toml': 'e1c6602a297a4bbcf82e376a6085ba8e0056faf9b8cd38a010c1b39966ba7f3e',
})

for (const [file, expected] of Object.entries(protectedFiles)) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  assert.equal(actual, expected, `${file} changed without updating the protected-file contract`)
}

const pages = readFileSync('wrangler.toml', 'utf8')
const worker = readFileSync('workers/draft-validation/wrangler.toml', 'utf8')
assert.equal(new Set(PROTECTED_CONFIGURATION_PATHS).size, PROTECTED_CONFIGURATION_PATHS.length)
assert.deepEqual(PROTECTED_CONFIGURATION_PATHS, [
    'config/preview-release.json',
    'config/release-inspection-manifest.json',
    'config/preview-schema4-readiness.json',
    'scripts/lib/preview-release/wrangler-topology.mjs',
    'shared/schema4-capabilities.mjs',
    'shared/schema4-runtime-consumers.mjs',
    'src/config/protectedCapabilities.mjs',
    'src/features/leaderboard/runtimeConfig.registrations.json',
    'functions/lib/leaderboard-mode.registrations.json',
    'functions/lib/leaderboard-identity-mode.registrations.json',
    'functions/lib/draft-submission-mode.registrations.json',
    'workers/draft-validation/src/retention-cleanup-mode.registrations.json',
    'wrangler.toml',
  'workers/draft-validation/wrangler.toml',
  'workers/draft-validation/d1c4-activation-states.json',
])
for (const relativePath of PROTECTED_CONFIGURATION_PATHS) {
  assert(Object.hasOwn(protectedFiles, relativePath), `protected configuration inventory omitted ${relativePath}`)
}
for (const mode of [
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
]) assert.equal((pages.match(new RegExp(`^${mode} = "disabled"$`, 'gm')) ?? []).length, 2, mode)
assert.doesNotMatch(pages, /^VITE_(?:LEADERBOARD|DRAFT_SUBMISSION).*_MODE\s*=/m)
for (const mode of [
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_RECOVERY_MODE',
  'RETENTION_CLEANUP_MODE',
]) assert.equal((worker.match(new RegExp(`^${mode} = "disabled"$`, 'gm')) ?? []).length, 2, mode)
assert.doesNotMatch(pages, /^(?:VITE_)?(?:LEADERBOARD|DRAFT_SUBMISSION).*_MODE = "enabled"$/m)
assert.doesNotMatch(worker, /^(?:LEADERBOARD|DRAFT_SUBMISSION|RETENTION_CLEANUP).*_MODE = "enabled"$/m)
assert.match(pages, /^LEADERBOARD_ENVIRONMENT = "preview"$/m)
assert.match(pages, /^LEADERBOARD_ENVIRONMENT = "production"$/m)
assert.match(worker, /^\[triggers\]\ncrons = \[\]$/m)
assert.match(worker, /^\[env\.production\.triggers\]\ncrons = \[\]$/m)
const productionWorker = worker.slice(worker.indexOf('\n[env.production]\n'))
assert.doesNotMatch(productionWorker, /^\[\[env\.production\.d1_databases\]\]$/m)
assert.doesNotThrow(() => validateCheckedInProtectedCapabilityFoundation())
assert.doesNotThrow(() => assertExactProtectedConfigurationPaths(PROTECTED_CONFIGURATION_PATHS))
assert.throws(
  () => assertExactProtectedConfigurationPaths(PROTECTED_CONFIGURATION_PATHS.slice(1)),
  /missing, duplicated, or unexpected/,
)
assert.throws(
  () => assertExactProtectedConfigurationPaths([
    ...PROTECTED_CONFIGURATION_PATHS,
    PROTECTED_CONFIGURATION_PATHS[0],
  ]),
  /missing, duplicated, or unexpected/,
)

console.log(`Protected release-file check passed for ${Object.keys(protectedFiles).length} files; exact inventories, Preview/Production capability gates, Cron lists, and Production Worker isolation remain fail-closed.`)
