import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../', import.meta.url)
const read = (filePath) => readFileSync(new URL(filePath, ROOT), 'utf8')
const productionMode = process.argv.slice(2).includes('--production')
const TEXT_ASSET_GROUPS = Object.freeze([
  ['HTML', new Set(['.html'])],
  ['JavaScript', new Set(['.js', '.mjs', '.cjs'])],
  ['CSS', new Set(['.css'])],
  ['JSON', new Set(['.json'])],
  ['web manifests', new Set(['.webmanifest'])],
  ['source maps', new Set(['.map'])],
  ['other text', new Set(['.txt', '.xml', '.svg', '.csv', '.tsv'])],
])
const EXTENSIONLESS_TEXT_ASSETS = new Set(['_headers', '_redirects'])
const FORBIDDEN_PRODUCTION_SENTINELS = Object.freeze([
  'Grandstand Grace',
  'PP1-7H2K-9M4Q-T6RX-3W8D-F5JC-NP7A-2QR5',
  'pennant-pursuit:leaderboard-preview-identity:v1',
  'leaderboardFixture',
  'leaderboardResult',
  'Leaderboard result preview roster is unavailable.',
  'developmentResultPreview',
  'leaderboardPrivateFixture',
])

function textAssetGroup(filePath) {
  if (EXTENSIONLESS_TEXT_ASSETS.has(path.basename(filePath))) return 'other text'
  const extension = path.extname(filePath).toLowerCase()
  return TEXT_ASSET_GROUPS.find(([, extensions]) => extensions.has(extension))?.[0] ?? null
}

function findProductionLeaks(textOutputs) {
  return FORBIDDEN_PRODUCTION_SENTINELS.flatMap((sentinel) => textOutputs
    .filter(({ content }) => content.includes(sentinel))
    .map(({ filePath }) => ({ filePath, sentinel })))
}

function assertProductionTextIsIsolated(textOutputs, label) {
  const leaks = findProductionLeaks(textOutputs)
  assert.deepEqual(
    leaks,
    [],
    `${label} leaked forbidden development material: ${leaks
      .map(({ filePath, sentinel }) => `${sentinel} in ${filePath}`)
      .join(', ')}`,
  )
}

const cssSentinelFixture = [{
  filePath: '/isolated-fixture/styles.css',
  content: `.fixture::after { content: "${FORBIDDEN_PRODUCTION_SENTINELS[0]}"; }`,
}]
const sourceMapSentinelFixture = [{
  filePath: '/isolated-fixture/app.js.map',
  content: JSON.stringify({ sources: ['leaderboardPrivateFixture.ts'] }),
}]
assert.equal(textAssetGroup(cssSentinelFixture[0].filePath), 'CSS')
assert.equal(textAssetGroup(sourceMapSentinelFixture[0].filePath), 'source maps')
assert.equal(textAssetGroup('/isolated-fixture/image.png'), null, 'binary assets must not be decoded as text')
assert.throws(
  () => assertProductionTextIsIsolated(cssSentinelFixture, 'CSS fixture'),
  /Grandstand Grace.*styles\.css|styles\.css.*Grandstand Grace/,
  'CSS fixture sentinel must be caught',
)
assert.throws(
  () => assertProductionTextIsIsolated(sourceMapSentinelFixture, 'source-map fixture'),
  /leaderboardPrivateFixture.*app\.js\.map|app\.js\.map.*leaderboardPrivateFixture/,
  'source-map fixture sentinel must be caught',
)

if (productionMode) {
  const distRoot = path.resolve(new URL('dist', ROOT).pathname)
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else files.push(target)
    }
  }
  visit(distRoot)

  const serviceWorkerPath = path.join(distRoot, 'sw.js')
  const textOutputs = files
    .filter((filePath) => filePath !== serviceWorkerPath && textAssetGroup(filePath))
    .map((filePath) => ({
      filePath,
      content: readFileSync(filePath, 'utf8'),
      group: textAssetGroup(filePath),
    }))
  assertProductionTextIsIsolated(textOutputs, 'Production output')

  assertProductionTextIsIsolated([{
    filePath: serviceWorkerPath,
    content: readFileSync(serviceWorkerPath, 'utf8'),
  }], 'Service worker')

  const groupedReport = TEXT_ASSET_GROUPS.map(([group]) => {
    const inspected = textOutputs
      .filter((output) => output.group === group)
      .map(({ filePath }) => path.relative(distRoot, filePath))
      .sort()
    return `  ${group} (${inspected.length}): ${inspected.join(', ') || 'none emitted'}`
  }).join('\n')
  console.log(`Inspected production text assets by type:\n${groupedReport}`)
  console.log(`Leaderboard production isolation passed: ${textOutputs.length} emitted text assets exclude every development fixture, query control, storage key, private module marker, and recovery sentinel; sw.js passed the separate service-worker scan.`)
  process.exit(0)
}

const app = read('src/App.tsx')
const globalCss = read('src/index.css')
const home = read('src/components/home/HomeScreen.tsx')
const leaderboard = read('src/components/leaderboard/LeaderboardScreen.tsx')
const journey = read('src/components/leaderboard/ResultLeaderboardJourney.tsx')
const runtimeJourney = read('src/components/leaderboard/RuntimeResultLeaderboardJourney.tsx')
const runtimeIdentityControls = read('src/components/leaderboard/RuntimeIdentityControls.tsx')
const runtimeIdentity = read('src/features/leaderboard/useRuntimeIdentity.ts')
const runtimeIdentityState = read('src/features/leaderboard/runtimeIdentityState.ts')
const runtimeConfig = read('src/features/leaderboard/runtimeConfig.ts')
const leaderboardCss = read('src/components/leaderboard/Leaderboard.css')
const classic = read('src/components/draft/ClassicMode.tsx')
const results = read('src/components/draft/ResultsScreen.tsx')
const pagesConfig = read('wrangler.toml')
const workerConfig = read('workers/draft-validation/wrangler.toml')

assert(app.includes("'/leaderboard'") && app.includes('<LeaderboardScreen'), 'leaderboard route is missing')
assert(home.includes('dd-home__leaderboard') && home.includes('Leaderboards'), 'Home leaderboard entry is missing')
assert(home.indexOf('dd-home__play') < home.indexOf('dd-home__leaderboard'), 'Play Classic must remain the first Home action')
assert.match(
  classic,
  /DEVELOPMENT_FIXTURES_ENABLED\s*=\s*import\.meta\.env\.DEV\s*&&\s*localLeaderboardFixturesAreEnabled\(\)/,
)
assert.match(classic, /\/\* @vite-ignore \*\/ DEVELOPMENT_RESULT_MODULE_PATH/)
assert.match(classic, /\/\* @vite-ignore \*\/ DEVELOPMENT_JOURNEY_MODULE_PATH/)
assert.match(
  leaderboard,
  /DEVELOPMENT_FIXTURES_ENABLED\s*=\s*import\.meta\.env\.DEV\s*&&\s*localLeaderboardFixturesAreEnabled\(\)/,
)
assert.match(leaderboard, /DEVELOPMENT_FIXTURE_QUERY\s*=\s*import\.meta\.env\.DEV/)
assert.match(leaderboard, /\/\* @vite-ignore \*\/ DEVELOPMENT_RESULT_MODULE_PATH/)
assert.doesNotMatch(classic, /^import \{[^}]*getDevelopmentResultPreview/m, 'development preview must not use a production-reachable static value import')
assert.doesNotMatch(results, /^import ResultLeaderboardJourney/m, 'private journey UI must not be statically imported by production results')

assert(results.includes('!leaderboardJourneyBlocking'), 'blocking results controls must be conditionally unavailable')
assert(journey.includes('beforeunload'), 'blocking journey must register refresh/close protection')
assert(journey.includes('registerNavigationBlocker'), 'blocking journey must register the App navigation guard')
assert(journey.includes('Leave Local Preview'), 'blocking journey must expose one explicit leave action')
assert(journey.includes('createJourneyTransitionGuard'), 'cross-stage activation guard is missing')
assert(journey.includes('remainingMilliseconds()'), 'rendered recovery controls must observe the remaining transition lock')
assert.match(journey, /disabled=\{recoveryControlsLocked\}/, 'recovery handoff controls must be natively disabled')
assert.match(journey, /recoveryControlsLocked \|\| !recoveryAcknowledged/, 'Save must remain disabled throughout the handoff')
assert(app.includes('navigationBlockerRef') && app.includes('handlePopState'), 'App navigation and browser history must share the blocker')
assert(app.includes('routeFocusRef') && app.includes('documentTitleForRoute'), 'route focus and title management are missing')
assert(app.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'route scrolling must respect reduced motion')
assert(results.includes("'Results | Pennant Pursuit'"), 'Results title is missing')
for (const capability of ['identityClaim', 'identityStatus', 'identityRename', 'recovery']) {
  assert(runtimeConfig.includes(`'${capability}'`), `independent frontend ${capability} authority is missing`)
}
assert(
  runtimeIdentityState.includes("kind: 'local'")
    && runtimeIdentity.includes("runtimeFeatureIsEnabled('identityStatus')")
    && runtimeIdentity.includes('deriveRuntimeIdentityState'),
  'locally stored identity must remain usable without coupling rename or submission to status authority',
)
assert(
  runtimeIdentityControls.includes("state.kind === 'ready' || state.kind === 'local'"),
  'rename must accept a locally stored identity when status authority is disabled',
)
assert(
  runtimeJourney.includes('resolveRuntimeSubmissionIdentity')
    && runtimeJourney.includes("identityState.kind === 'missing'")
    && runtimeJourney.includes("kind: 'identity-blocked'"),
  'submission attribution must accept valid local identity while anonymous claim remains limited to genuinely missing continuity',
)
assert.match(
  runtimeJourney,
  /submission\.receipt\.leaderboard\.claim\.state === 'available'[\s\S]*identityState\.kind === 'missing'/,
  'claim setup must be reachable only for genuinely missing local identity continuity',
)
assert.doesNotMatch(
  runtimeJourney,
  /onIdentityRemove|Remove Saved Identity from This Device/,
  'a blocked result must not offer local deletion as a path to anonymous replacement',
)
assert.doesNotMatch(
  runtimeIdentityState,
  /stored\.kind\s*}\)\s*:\s*Object\.freeze\(\{\s*kind:\s*'disabled'/,
  'corrupt, outdated, or unavailable storage must not collapse into disabled during partial activation',
)

for (const period of ['Daily', 'Weekly', 'All-Time']) {
  assert(leaderboard.includes(period), `${period} navigation is missing`)
}
assert(leaderboard.includes('role="tablist"') && leaderboard.includes('role="tabpanel"'))
assert(leaderboard.includes("event.key === 'ArrowRight'") && leaderboard.includes("event.key === 'ArrowLeft'"))
assert(!leaderboard.includes('entry.roster') && !leaderboard.includes('results-roster'))
assert.match(leaderboard, /key=\{entry\.stableKey\}/, 'React row identity must use the stable raw-entry key')
assert.match(leaderboard, /existing = new Set\(view\.snapshot\.entries\.map\(\(entry\) => entry\.stableKey\)\)/)
assert.doesNotMatch(leaderboard, /existing\.has\([^)]*timeContext/, 'presentation time must not drive pagination de-duplication')
assert.match(
  leaderboard,
  /<th data-label="Player" scope="row">[\s\S]*?lb-row__player-name[\s\S]*?lb-row__you[\s\S]*?<\/th>/,
  'the personal badge must remain in the player/name cell',
)

const leaderboardFontSizes = [...leaderboardCss.matchAll(/font-size:\s*([0-9.]+)rem/g)]
  .map((match) => Number(match[1]))
assert(
  leaderboardFontSizes.every((size) => size >= 0.75),
  'leaderboard and journey styles must keep meaningful text at 12px or larger',
)
for (const inset of ['top', 'right', 'bottom', 'left']) {
  assert(leaderboardCss.includes(`env(safe-area-inset-${inset})`), `missing ${inset} safe-area support`)
}
assert(leaderboardCss.includes('@media (max-width: 639px)'))
assert(leaderboardCss.includes('@media (min-width: 640px)'))
assert(leaderboardCss.includes('@media (prefers-reduced-motion: reduce)'))
assert(leaderboardCss.includes('overflow-wrap: anywhere'))
assert(leaderboardCss.includes('min-height: 2.75rem'))
assert(globalCss.includes('min-width: min(320px, 100%)'), 'the 320px floor must not create scrollbar-width overflow')

for (const config of [pagesConfig, workerConfig]) {
  assert.match(config, /DRAFT_SUBMISSION_MODE = "disabled"/)
  assert(!config.includes('LEADERBOARD_READ_MODE = "enabled"'))
  assert(!config.includes('LEADERBOARD_IDENTITY_MODE = "enabled"'))
}

console.log('Leaderboard UX structural contract passed: route wiring, development-only import boundaries, control hierarchy, keyboard semantics, minimum typography, safe areas, and disabled feature gates are present.')
