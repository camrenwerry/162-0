import assert from 'node:assert/strict'
import {
  documentTitleForRoute,
  routeScrollBehavior,
} from '../src/appNavigation'
import {
  LEADERBOARD_PERIODS,
  RESULT_JOURNEY_TRANSITION_LOCK_MS,
  confirmResultJourneyNavigation,
  createJourneyTransitionGuard,
  createLeaderboardStateSnapshot,
  createReadyLeaderboardSnapshot,
  isResultJourneyBlocking,
  placementAgainstLeaderboard,
  rankLeaderboardCandidates,
  recoveryMaterialIsVisible,
  type LeaderboardCandidate,
  type ResultJourneyStage,
} from '../src/features/leaderboard/leaderboardFixtures'
import {
  DEVELOPMENT_COMPETITORS,
  DEVELOPMENT_LEADERBOARD_SCENARIOS,
  developmentLeaderboardFixture,
  getDevelopmentResultPreview,
  isDevelopmentDisplayNameAvailable,
  resolveDevelopmentLeaderboard,
} from '../src/features/leaderboard/developmentResultPreview'
import {
  PRIVATE_DEVELOPMENT_RECOVERY_CODE,
  readLocalDevelopmentIdentity,
  storeLocalDevelopmentIdentity,
} from '../src/features/leaderboard/leaderboardPrivateFixture'
import {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_MIN_CHARACTERS,
  validateDisplayName,
} from '../shared/leaderboard-display-name'

class MemoryStorage {
  readonly values = new Map<string, string>()
  reads = 0
  writes = 0
  failRead = false
  failWrite = false

  getItem(key: string) {
    this.reads += 1
    if (this.failRead) throw new Error('read unavailable')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.writes += 1
    if (this.failWrite) throw new Error('write unavailable')
    this.values.set(key, value)
  }
}

function candidate(
  displayName: string,
  projectedWins: number,
  overallScore: number,
  isPersonal = false,
): LeaderboardCandidate {
  return Object.freeze({
    displayName,
    projectedWins,
    overallScore,
    timeContext: 'Now',
    mode: 'Classic',
    isPersonal,
  })
}

const ordered = rankLeaderboardCandidates([
  candidate('Higher Score', 149, 99.9),
  candidate('More Wins', 150, 70),
  candidate('Exact Tie One', 140, 90),
  candidate('Exact Tie Two', 140, 90),
  candidate('Lower Score', 140, 89.9),
])
assert.deepEqual(ordered.map((entry) => entry.displayName), [
  'More Wins',
  'Higher Score',
  'Exact Tie One',
  'Exact Tie Two',
  'Lower Score',
])
assert.deepEqual(ordered.map((entry) => entry.rank), [1, 2, 3, 3, 5])
assert.equal(placementAgainstLeaderboard(
  { projectedWins: 140, overallScore: 90 },
  ordered,
), 3, 'an exact tie must share the authoritative competition rank')
assert.equal(placementAgainstLeaderboard(
  { projectedWins: 140, overallScore: 89.95 },
  ordered,
), 5, 'score must break equal-win results before lower scores')

for (const scenario of DEVELOPMENT_LEADERBOARD_SCENARIOS) {
  for (const period of LEADERBOARD_PERIODS) {
    const snapshot = developmentLeaderboardFixture(scenario, period)
    assert.equal(snapshot.period, period)
    assert.equal(
      snapshot.kind,
      scenario === 'outside' || scenario === 'long' || scenario === 'no-personal'
        ? 'ready'
        : scenario,
    )
    if (snapshot.kind === 'ready') {
      for (let index = 1; index < snapshot.entries.length; index += 1) {
        const previous = snapshot.entries[index - 1]
        const current = snapshot.entries[index]
        assert(
          previous.projectedWins > current.projectedWins
          || (
            previous.projectedWins === current.projectedWins
            && previous.overallScore >= current.overallScore
          ),
          `${scenario} ${period} must preserve wins-first ordering`,
        )
      }
    }
  }
}

const storage = new MemoryStorage()
const firstTime = getDevelopmentResultPreview('?leaderboardResult=first-time', storage)
assert(firstTime)
assert.equal(firstTime.result.wins, 143)
assert.equal(firstTime.result.overallScore, 94.6)
assert.equal(firstTime.journey.placement.daily.rank, 7)
assert.equal(firstTime.journey.placement.weekly.rank, 11)
assert.equal(firstTime.journey.placement.allTime.rank, 84)
assert.equal(firstTime.journey.placement.topTenDistance, 1)
assert.equal(firstTime.journey.placement.winsFromPerfect, firstTime.result.losses)

for (const period of LEADERBOARD_PERIODS) {
  const snapshot = developmentLeaderboardFixture('ready', period)
  assert.equal(snapshot.kind, 'ready')
  if (snapshot.kind !== 'ready') throw new Error(`${period} fixture must be ready.`)
  const personal = snapshot.entries.find((entry) => entry.isPersonal) ?? snapshot.personalEntry
  assert(personal, `${period} fixture must expose the personal result`)
  const placement = period === 'daily'
    ? firstTime.journey.placement.daily
    : period === 'weekly'
      ? firstTime.journey.placement.weekly
      : firstTime.journey.placement.allTime
  assert.equal(
    personal.rank,
    placement.rank,
    `${period} journey placement must be derived from the displayed board model`,
  )
}

const long = developmentLeaderboardFixture('long', 'all-time')
assert.equal(long.kind, 'ready')
if (long.kind !== 'ready') throw new Error('Long fixture must be ready.')
assert.equal(long.entries.length, 50)
assert(long.personalEntry)
assert(!long.entries.some((entry) => entry.isPersonal))

const visible = developmentLeaderboardFixture('ready', 'daily')
assert.equal(visible.kind, 'ready')
if (visible.kind !== 'ready') throw new Error('Daily fixture must be ready.')
assert.equal(visible.personalStatus, 'visible')
assert.equal(visible.entries.filter((entry) => entry.isPersonal).length, 1)
assert.equal(visible.personalEntry, null)

const outside = developmentLeaderboardFixture('outside', 'daily')
assert.equal(outside.kind, 'ready')
if (outside.kind !== 'ready') throw new Error('Outside fixture must be ready.')
assert.equal(outside.personalStatus, 'anchored')
assert(outside.personalEntry)
assert(!outside.entries.some((entry) => entry.isPersonal))

const noPersonal = developmentLeaderboardFixture('no-personal', 'daily')
assert.equal(noPersonal.kind, 'ready')
if (noPersonal.kind !== 'ready') throw new Error('No-personal fixture must be ready.')
assert.equal(noPersonal.personalStatus, 'none')
assert.equal(noPersonal.personalEntry, null)

const duplicateAnchorGuard = createReadyLeaderboardSnapshot('daily', [
  candidate('Visible Player', 150, 95, true),
  candidate('Another Player', 140, 90),
  candidate('Outside Personal', 100, 70, true),
], 2, 'Now')
assert.equal(duplicateAnchorGuard.entries.filter((entry) => entry.isPersonal).length, 1)
assert.equal(duplicateAnchorGuard.personalEntry, null, 'a visible personal row must suppress the anchor')

for (const entries of Object.values(DEVELOPMENT_COMPETITORS)) {
  for (const entry of entries) {
    const validated = validateDisplayName(entry.displayName)
    assert(validated, `fixture name must remain valid: ${entry.displayName}`)
    assert.equal(
      isDevelopmentDisplayNameAvailable(validated.nameKey),
      false,
      `fixture name must not be claimable: ${entry.displayName}`,
    )
    assert(!('roster' in entry))
    assert(!('recoveryCode' in entry))
  }
}
assert.equal(isDevelopmentDisplayNameAvailable('browser local ace'), true)

assert(validateDisplayName('Extra Innings Oracle'))
assert.equal([...('Extra Innings Oracle')].length, DISPLAY_NAME_MAX_CHARACTERS)
assert.equal(validateDisplayName('A'.repeat(DISPLAY_NAME_MIN_CHARACTERS - 1)), null)
assert.equal(validateDisplayName('A'.repeat(DISPLAY_NAME_MAX_CHARACTERS + 1)), null)
assert.equal(validateDisplayName(' leading'), null)
assert.equal(validateDisplayName('two  spaces'), null)
assert.equal(validateDisplayName('name!'), null)

assert.deepEqual(readLocalDevelopmentIdentity(storage), { kind: 'missing' })
assert.deepEqual(storeLocalDevelopmentIdentity('Ａce', storage), {
  kind: 'stored',
  displayName: 'Ace',
})
assert.deepEqual(readLocalDevelopmentIdentity(storage), {
  kind: 'ready',
  displayName: 'Ace',
})
const identityKey = [...storage.values.keys()][0]
assert(identityKey)
const serializedIdentity = storage.values.get(identityKey) ?? ''
assert.match(serializedIdentity, /"version":1/)
assert.match(serializedIdentity, /"displayName":"Ace"/)
assert(!serializedIdentity.includes(PRIVATE_DEVELOPMENT_RECOVERY_CODE))
assert(!serializedIdentity.includes('PP1-'))

storage.values.set(identityKey, '{')
assert.deepEqual(readLocalDevelopmentIdentity(storage), { kind: 'corrupt' })
storage.values.set(identityKey, JSON.stringify({ version: 2, displayName: 'Pennant Ace' }))
assert.deepEqual(readLocalDevelopmentIdentity(storage), { kind: 'outdated' })
storage.values.set(identityKey, JSON.stringify({ version: 1, displayName: 'bad!' }))
assert.deepEqual(readLocalDevelopmentIdentity(storage), { kind: 'invalid' })
storage.failRead = true
assert.deepEqual(readLocalDevelopmentIdentity(storage), { kind: 'unavailable' })
storage.failRead = false
storage.failWrite = true
assert.deepEqual(storeLocalDevelopmentIdentity('Pennant Ace', storage), { kind: 'unavailable' })
storage.failWrite = false
assert.deepEqual(storeLocalDevelopmentIdentity('bad!', storage), { kind: 'invalid' })

const returningStorage = new MemoryStorage()
assert.equal(storeLocalDevelopmentIdentity('Extra Innings Oracle', returningStorage).kind, 'stored')
const returning = getDevelopmentResultPreview('?leaderboardResult=returning', returningStorage)
assert(returning)
assert.equal(returning.journey.identityState.kind, 'ready')
assert.equal(returning.journey.placement.displayName, 'Extra Innings Oracle')
const returningBoard = resolveDevelopmentLeaderboard(
  '?leaderboardFixture=ready&period=daily',
  true,
  returningStorage,
)
assert.equal(returningBoard.snapshot.kind, 'ready')
if (returningBoard.snapshot.kind !== 'ready') throw new Error('Returning board must be ready.')
assert.equal(returningBoard.personalDisplayName, 'Extra Innings Oracle')
assert.equal(
  returningBoard.snapshot.entries.find((entry) => entry.isPersonal)?.displayName,
  'Extra Innings Oracle',
)
const returningWeekly = developmentLeaderboardFixture(
  'ready',
  'weekly',
  returningBoard.personalDisplayName ?? undefined,
)
assert.equal(returningWeekly.kind, 'ready')
if (returningWeekly.kind !== 'ready') throw new Error('Returning weekly board must be ready.')
assert.equal(
  returningWeekly.entries.find((entry) => entry.isPersonal)?.displayName,
  'Extra Innings Oracle',
  'period changes must retain the revalidated browser-local identity',
)

const missingReturning = getDevelopmentResultPreview(
  '?leaderboardResult=returning',
  new MemoryStorage(),
)
assert(missingReturning)
assert.equal(missingReturning.journey.identityState.kind, 'missing')
assert.equal(missingReturning.journey.placement.displayName, null)
assert.equal(getDevelopmentResultPreview('', new MemoryStorage()), null)
assert.equal(createLeaderboardStateSnapshot('disabled').kind, 'disabled')

let time = 100
let transitions = 0
const transitionGuard = createJourneyTransitionGuard(() => time)
assert.equal(transitionGuard.tryTransition(() => { transitions += 1 }), true)
assert.equal(transitionGuard.tryTransition(() => { transitions += 1 }), false, 'double click must be ignored')
time += 10
assert.equal(transitionGuard.tryTransition(() => { transitions += 1 }), false, 'rapid Enter must be ignored')
time += 100
assert.equal(transitionGuard.tryTransition(() => { transitions += 1 }), false, 'rapid Space must be ignored')
assert.equal(transitionGuard.isLocked(), true)
assert.equal(
  transitionGuard.remainingMilliseconds(),
  RESULT_JOURNEY_TRANSITION_LOCK_MS - 110,
  'the rendered stage must be able to observe the remaining handoff lock',
)
time = 450
assert.equal(transitionGuard.tryTransition(() => { transitions += 1 }), true, 'normal later activation must proceed')
assert.equal(transitions, 2)
time += RESULT_JOURNEY_TRANSITION_LOCK_MS
assert.equal(transitionGuard.remainingMilliseconds(), 0)
transitionGuard.reset()
assert.equal(transitionGuard.isLocked(), false)

let confirmationCalls = 0
assert.equal(confirmResultJourneyNavigation(true, () => {
  confirmationCalls += 1
  return false
}), false)
assert.equal(confirmationCalls, 1)
assert.equal(confirmResultJourneyNavigation(true, () => true), true)
assert.equal(confirmResultJourneyNavigation(false, () => {
  confirmationCalls += 1
  return false
}), true)
assert.equal(confirmationCalls, 1, 'completed journeys must not prompt')

const stages: readonly ResultJourneyStage[] = [
  'suspense',
  'claim',
  'claimed',
  'recovery',
  'complete',
  'story',
]
assert.deepEqual(stages.filter(isResultJourneyBlocking), ['suspense', 'claim', 'claimed', 'recovery'])
assert.deepEqual(stages.filter(recoveryMaterialIsVisible), ['recovery'])

assert.equal(documentTitleForRoute('/'), 'Home | Pennant Pursuit')
assert.equal(documentTitleForRoute('/leaderboard'), 'Leaderboard | Pennant Pursuit')
assert.equal(documentTitleForRoute('/draft'), 'Classic Draft | Pennant Pursuit')
assert.equal(routeScrollBehavior(false), 'smooth')
assert.equal(routeScrollBehavior(true), 'auto')

assert.match(PRIVATE_DEVELOPMENT_RECOVERY_CODE, /^PP1-(?:[0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/)

console.log('Leaderboard UX behavioral/model tests passed: authoritative ranking and ties, cross-screen placements, personal-row states, versioned local identity failures, transition locking, navigation confirmation, route metadata, and recovery-code lifetime are verified.')
