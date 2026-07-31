import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const protectedFiles = Object.freeze({
  'config/preview-release.json': 'ef1705cd4a19c647a6b0b59c3ffb6b62a75c2b29f77e6eefba6b09ac2d8099d0',
  'config/preview-schema4-readiness.json': '5756120c9bc97feb0a347e8c3e54a0e62cf7262366558cfb389b01291d603e0e',
  'migrations/0001_backend_foundation.sql': '5362bdd8ea5c271aee3dbf544adae4d4036c4dfe27e44a3284f088bded5888ae',
  'migrations/0002_draft_submissions.sql': '9eba9232c8806676bd0a32dfbb7da8fca97f8d381a126a723fe2189d27721b7a',
  'migrations/0003_leaderboard_foundation.sql': '344b803c7e2111c4151c7010fd4e0c15217b1d2fc7522af5c2a260d19450b5fa',
  'migrations/0004_leaderboard_identity_ranking.sql': 'c87e555483d321e4b4ac2bcfbb7702bd6a38293ae593658cec13d48398c25346',
  'public/_redirects': '32a91e4d018194555c7f64f23faf2512270c3a248844b0c107f5f480366483eb',
  'public/_routes.json': '875208beeb02398614dd2f6dc8779c9261719bbf4f786a4464028dc2a191b29d',
  'workers/draft-validation/wrangler.toml': '2980ce50c1cd92c4974e765e0a50391a883cdb83bec8f0b407f7f7bfc23978a7',
  'wrangler.toml': '5dece37a15ffff19d31012f6a5d4427d55dbc34b295e5524fd44f6561dcdfba6',
})

for (const [file, expected] of Object.entries(protectedFiles)) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  assert.equal(actual, expected, `${file} changed without updating the protected-file contract`)
}

const pages = readFileSync('wrangler.toml', 'utf8')
const worker = readFileSync('workers/draft-validation/wrangler.toml', 'utf8')
assert.equal((pages.match(/^DRAFT_SUBMISSION_MODE = "disabled"$/gm) ?? []).length, 2)
assert.equal((worker.match(/^DRAFT_SUBMISSION_MODE = "disabled"$/gm) ?? []).length, 2)
assert.doesNotMatch(pages, /^LEADERBOARD_(?:READ|IDENTITY|RECOVERY)_MODE = "enabled"$/m)
assert.doesNotMatch(worker, /^LEADERBOARD_(?:READ|IDENTITY|RECOVERY)_MODE = "enabled"$/m)
assert.match(worker, /^\[triggers\]\ncrons = \[\]$/m)
assert.match(worker, /^\[env\.production\.triggers\]\ncrons = \[\]$/m)

console.log(`Protected release-file check passed for ${Object.keys(protectedFiles).length} files; Preview and Production public gates remain fail-closed.`)
