import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkProductionData } from '../src/game/DataReadiness'
import { TeamPool } from '../src/game/TeamPool'
import { buildFeedbackUrl, buildShareText, shareResult } from '../src/utils/appActions'
import { APP_VERSION } from '../src/config/app'
import {
  DATA_DIGEST,
  DATA_DIGEST_ALGORITHM,
  DATA_DIGEST_SCHEMA,
  DATA_VERSION,
  GAME_RULES_VERSION,
  LEADERBOARD_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
  SUBMISSION_SCHEMA_VERSION,
  VERSION_METADATA,
  VERSION_METADATA_SCHEMA_VERSION,
} from '../src/config/versions'
import { GAME_UPDATES } from '../src/config/gameUpdates'
import { dismissTutorial, isTutorialDismissed, resetTutorial, TUTORIAL_DISMISSED_KEY } from '../src/utils/onboarding'
import type { DraftResult } from '../src/types/draft'

const readiness = checkProductionData(new TeamPool())
assert.equal(readiness.ready, true, `production data has ${readiness.issueCount} readiness issue(s)`)

const feedback = buildFeedbackUrl('https://example.com/feedback?source=game', {
  screen: 'draft', round: 4, team: 'SEA', decade: '1990s',
})
assert.ok(feedback)
const parsed = new URL(feedback)
assert.equal(parsed.searchParams.get('appVersion'), APP_VERSION)
assert.equal(parsed.searchParams.get('currentScreen'), 'draft')
assert.equal(parsed.searchParams.get('round'), '4')
assert.equal(buildFeedbackUrl('not a url', { screen: 'home' }), null)

const result = { wins: 101, losses: 61, overallGrade: 'A', tierLabel: 'Contender', strongestCategory: 'startingPitching' } as DraftResult
assert.match(buildShareText(result), /101–61/)
assert.match(buildShareText(result), /Pennant Pursuit/)
assert.match(buildShareText(result), /Build the greatest roster in baseball history\./)
assert.match(buildShareText(result), /Tier: Contender/)
assert.match(buildShareText(result), /Strongest Category: Starting Pitching/)
let sharedText = ''
let sharedTitle = ''
assert.equal(await shareResult(result, { share: async (data) => { sharedTitle = data.title ?? ''; sharedText = data.text ?? '' }, publicUrl: 'https://play.example' }), 'shared')
assert.equal(sharedTitle, 'Pennant Pursuit')
assert.match(sharedText, /101–61/)
let copiedText = ''
assert.equal(await shareResult(result, { writeText: async (text) => { copiedText = text }, publicUrl: 'https://play.example' }), 'copied')
assert.match(copiedText, /https:\/\/play\.example/)
await assert.rejects(() => shareResult(result, { writeText: async () => { throw new Error('denied') }, publicUrl: 'https://play.example' }))

const memory = new Map<string, string>()
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
}
assert.equal(isTutorialDismissed(storage), false)
assert.equal(TUTORIAL_DISMISSED_KEY, 'diamond-draft:tutorial-dismissed:v1', 'the pre-1.0 tutorial preference key must remain compatible')
dismissTutorial(storage)
assert.equal(isTutorialDismissed(storage), true)
resetTutorial(storage)
assert.equal(isTutorialDismissed(storage), false)

const read = (path: string) => readFileSync(path, 'utf8')
const expectedUpdateHighlights = [
  'New permanent name and brand identity.',
  'Completely rebuilt logos, icons, and visual branding.',
  'Updated app icon, loading artwork, browser icon, and in-app logos.',
  'The same historical drafting experience.',
  'The same pursuit of building the greatest roster in baseball history.',
]
assert.equal(APP_VERSION, '1.0.0')
assert.equal(JSON.parse(read('package.json')).version, APP_VERSION, 'package and shared app versions must match')
assert.equal(VERSION_METADATA_SCHEMA_VERSION, 1)
assert.equal(GAME_RULES_VERSION, 'classic-rules-v1')
assert.equal(SCORING_VERSION, '2.3')
assert.equal(DATA_VERSION, 'lahman-2025-v1')
assert.equal(DATA_DIGEST_ALGORITHM, 'sha256')
assert.equal(DATA_DIGEST_SCHEMA, 'pennant-pursuit-runtime-data-v1')
assert.match(DATA_DIGEST, /^[a-f0-9]{64}$/)
assert.equal(SUBMISSION_SCHEMA_VERSION, null, 'submission schema must remain inactive')
assert.equal(RNG_VERSION, 'seeded-v1', 'deterministic gameplay RNG must use the active seeded-v1 contract')
assert.equal(LEADERBOARD_VERSION, null, 'leaderboard protocol must remain inactive')
assert.deepEqual(VERSION_METADATA, {
  schemaVersion: VERSION_METADATA_SCHEMA_VERSION,
  appVersion: APP_VERSION,
  gameRulesVersion: GAME_RULES_VERSION,
  scoringVersion: SCORING_VERSION,
  dataVersion: DATA_VERSION,
  dataDigestAlgorithm: DATA_DIGEST_ALGORITHM,
  dataDigestSchema: DATA_DIGEST_SCHEMA,
  dataDigest: DATA_DIGEST,
  submissionSchemaVersion: null,
  rngVersion: 'seeded-v1',
  leaderboardVersion: null,
})
assert.equal(GAME_UPDATES[0]?.version, APP_VERSION)
assert.equal(GAME_UPDATES[0]?.label, 'Pennant Pursuit 1.0.0')
assert.equal(GAME_UPDATES[0]?.heading, 'A New Era Begins')
assert.equal(GAME_UPDATES[0]?.intro, 'Pennant Pursuit has officially arrived.')
assert.deepEqual(GAME_UPDATES[0]?.highlights, expectedUpdateHighlights)
assert.equal(GAME_UPDATES[0]?.note, 'Thank you for helping shape the future of Pennant Pursuit.')
const numericVersions = GAME_UPDATES.map(({ version }) => version.split('.').reduce((total, part) => total * 1000 + Number(part), 0))
assert.deepEqual(numericVersions, [...numericVersions].sort((left, right) => right - left), 'game updates must remain newest-first')

const app = read('src/App.tsx')
const header = read('src/components/draft/DraftHeader.tsx')
const home = read('src/components/home/HomeScreen.tsx')
const menu = read('src/components/GameMenu.tsx')
const updatesScreen = read('src/components/updates/GameUpdatesScreen.tsx')
const recovery = read('src/components/AppRecovery.tsx')
const resultsScreen = read('src/components/draft/ResultsScreen.tsx')
assert.match(header, /1 per game/i)
assert.match(header, /Changes only the franchise/)
assert.match(header, /Changes only the decade/)
assert.match(home, /resetTutorial/)
assert.match(app, /['"]\/updates['"]/, 'Game Updates must have an in-app route')
assert.match(home, />Game Updates</, 'Game Updates must be discoverable from Home')
assert.match(menu, />\s*Game Updates\s*</, 'Game Updates must be discoverable from the game menu')
assert.match(updatesScreen, /update\.label \?\? `Version \$\{update\.version\}`/)
assert.match(updatesScreen, /<h2>\{update\.heading\}<\/h2>/)
assert.match(recovery, /componentDidCatch/)
assert.match(recovery, /<PennantPursuitLogo compact \/>/)
assert.match(recovery, /Restart Game/)
assert.match(resultsScreen, /AbortError/)
assert.match(resultsScreen, /ShareFallbackDialog/)
assert.match(resultsScreen, /disabled=\{isSharing\}/)
assert.doesNotMatch(resultsScreen, /['"]Speed['"]/, 'Speed must remain hidden on the Results screen')

console.log('Pennant Pursuit 1.0.0 release readiness tests passed.')
