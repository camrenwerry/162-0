import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkProductionData } from '../src/game/DataReadiness'
import { TeamPool } from '../src/game/TeamPool'
import { buildFeedbackUrl, buildShareText, shareResult } from '../src/utils/betaActions'
import { APP_VERSION } from '../src/config/beta'
import { dismissTutorial, isTutorialDismissed, resetTutorial } from '../src/utils/onboarding'
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
assert.match(buildShareText(result), /Diamond Draft/)
assert.match(buildShareText(result), /Tier: Contender/)
assert.match(buildShareText(result), /Strongest Category: Starting Pitching/)
let sharedText = ''
assert.equal(await shareResult(result, { share: async (data) => { sharedText = data.text ?? '' }, publicUrl: 'https://play.example' }), 'shared')
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
dismissTutorial(storage)
assert.equal(isTutorialDismissed(storage), true)
resetTutorial(storage)
assert.equal(isTutorialDismissed(storage), false)

const read = (path: string) => readFileSync(path, 'utf8')
const header = read('src/components/draft/DraftHeader.tsx')
const home = read('src/components/home/HomeScreen.tsx')
const recovery = read('src/components/BetaRecovery.tsx')
const resultsScreen = read('src/components/draft/ResultsScreen.tsx')
assert.match(header, /1 per game/i)
assert.match(header, /Changes only the franchise/)
assert.match(header, /Changes only the decade/)
assert.match(home, /resetTutorial/)
assert.match(recovery, /componentDidCatch/)
assert.match(recovery, /Restart Game/)
assert.match(resultsScreen, /AbortError/)
assert.match(resultsScreen, /ShareFallbackDialog/)
assert.match(resultsScreen, /disabled=\{isSharing\}/)
assert.doesNotMatch(resultsScreen, /['"]Speed['"]/, 'Speed must remain hidden on the Results screen')

console.log('Beta readiness tests passed.')
