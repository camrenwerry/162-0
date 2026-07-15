import assert from 'node:assert/strict'
import { DraftEngine } from '../src/game/DraftEngine'
import { partitionPlayersByAvailability } from '../src/game/Eligibility'
import { getCompactPlayerStats } from '../src/game/PlayerStats'
import { Randomizer } from '../src/game/Randomizer'
import { DiamondDraftScoring } from '../src/game/ScoringEngine'
import { TeamPool } from '../src/game/TeamPool'
import { getSimulationDuration, getSimulationPhase, getSimulationReveal, SIMULATION_PHASES } from '../src/components/results/simulationSequence'
import { ROSTER_SLOTS, type Position } from '../src/types/draft'

const waitForTimers = () => new Promise((resolve) => setTimeout(resolve, 5))
const pool = new TeamPool()
const missingCombination = { ...pool.getCombinations()[0], id: 'missing-pool' }
assert(!new TeamPool([missingCombination], {}).getCombinations().length)
const fixtureCombination = pool.getCombinations().find((combination) => {
  const players = pool.getPlayers(combination)
  return players.some(({ playerType }) => playerType !== 'pitcher') && players.some(({ playerType }) => playerType === 'pitcher')
})
assert(fixtureCombination)
const fixtureHitter = pool.getPlayers(fixtureCombination).find(({ playerType }) => playerType === 'hitter')
const fixturePitcher = pool.getPlayers(fixtureCombination).find(({ playerType }) => playerType === 'pitcher')
assert(fixtureHitter?.playerType === 'hitter' && fixturePitcher?.playerType === 'pitcher')
assert.deepEqual(getCompactPlayerStats(fixtureHitter, 'hitter').map(({ label }) => label), ['OPS', 'AVG', 'OBP', 'SLG'])
const partialHitterStats = { ...fixtureHitter.visibleStats, ops: null, hr: 8, avg: .317, obp: null, slg: null, rbi: null, sb: null }
const bobPartial = { ...fixtureHitter, id: 'partial-bob', visibleStats: partialHitterStats, stats: partialHitterStats }
assert.deepEqual(getCompactPlayerStats(bobPartial, 'hitter').map(({ label, formattedValue }) => [label, formattedValue]).slice(0, 2), [['AVG', '.317'], ['HR', '8']])
const partialPitcherStats = { ...fixturePitcher.visibleStats, era: 2.19, whip: null, so: null, wins: null, saves: 1, sv: 1, inningsPitched: null, games: null, starts: null, reliefAppearances: null, k9: null, bb9: null }
const billPartial = { ...fixturePitcher, id: 'partial-bill', visibleStats: partialPitcherStats, stats: partialPitcherStats }
assert.deepEqual(getCompactPlayerStats(billPartial, 'pitcher').map(({ label, formattedValue }) => [label, formattedValue]), [['ERA', '2.19'], ['SV', '1']])

const ssOnly = { ...fixtureHitter, id: 'ss-only', eligiblePositions: ['SS'] as Position[] }
const ssAndThird = { ...fixtureHitter, id: 'ss-third', eligiblePositions: ['SS', '3B'] as Position[] }
const dhOpen = partitionPlayersByAvailability([ssOnly], { SS: fixtureHitter })
assert.deepEqual(dhOpen.selectable.map(({ id }) => id), ['ss-only'], 'an otherwise blocked hitter remains available for open DH')
const grouped = partitionPlayersByAvailability([ssOnly, ssAndThird], { SS: fixtureHitter, DH: fixtureHitter })
assert.deepEqual(grouped.selectable.map(({ id }) => id), ['ss-third'])
assert.deepEqual(grouped.unavailable.map(({ id }) => id), ['ss-only'])
const stableGrouping = partitionPlayersByAvailability([ssOnly, ssAndThird, { ...ssOnly, id: 'ss-only-2' }], { SS: fixtureHitter, DH: fixtureHitter })
assert.deepEqual(stableGrouping.unavailable.map(({ id }) => id), ['ss-only', 'ss-only-2'], 'availability grouping must preserve selected sort order within each group')
const lateCombination = { ...fixtureCombination, id: 'late-browse' }
const unavailableSlugger = { ...ssOnly, id: 'unavailable-slugger', name: 'Alpha Slugger', visibleStats: { ...ssOnly.visibleStats, hr: 50 } }
const availableUtility = { ...ssAndThird, id: 'available-utility', name: 'Bravo Utility', visibleStats: { ...ssAndThird.visibleStats, hr: 20 } }
const latePool = new TeamPool([lateCombination], { 'late-browse': [unavailableSlugger, availableUtility] })
const lateRoster = { SS: fixtureHitter, DH: fixtureHitter }
const hrQuery = latePool.query({ combination: lateCombination, excludedIds: new Set(), filter: 'ALL', sort: 'hr', search: '' })
const hrGrouping = partitionPlayersByAvailability(hrQuery, lateRoster)
assert.deepEqual([...hrGrouping.selectable, ...hrGrouping.unavailable].map(({ id }) => id), ['available-utility', 'unavailable-slugger'], 'availability must take precedence over the selected stat sort')
assert.deepEqual(partitionPlayersByAvailability(latePool.query({ combination: lateCombination, excludedIds: new Set(), filter: 'ALL', sort: 'name', search: 'Alpha' }), lateRoster).unavailable.map(({ id }) => id), ['unavailable-slugger'], 'search must preserve availability grouping')
assert.deepEqual(partitionPlayersByAvailability(latePool.query({ combination: lateCombination, excludedIds: new Set(), filter: '3B', sort: 'name', search: '' }), lateRoster).selectable.map(({ id }) => id), ['available-utility'], 'position filters must preserve availability grouping')
const fullPitchingRoster = { SP1: fixturePitcher, SP2: fixturePitcher, SP3: fixturePitcher, RP1: fixturePitcher, RP2: fixturePitcher }
const starterOnly = { ...fixturePitcher, eligiblePositions: ['SP'] as Position[] }
const relieverOnly = { ...fixturePitcher, eligiblePositions: ['RP'] as Position[] }
assert.equal(partitionPlayersByAvailability([starterOnly], fullPitchingRoster).selectable.length, 0)
assert.equal(partitionPlayersByAvailability([starterOnly], { SP1: fixturePitcher, SP2: fixturePitcher }).selectable.length, 1)
assert.equal(partitionPlayersByAvailability([relieverOnly], fullPitchingRoster).selectable.length, 0)
assert.equal(partitionPlayersByAvailability([relieverOnly], { RP1: fixturePitcher }).selectable.length, 1)

const bobWithoutHrStats = { ...partialHitterStats, hr: null }
const bobWithoutHr = { ...bobPartial, id: 'partial-bob-no-hr', name: 'Zed Null', visibleStats: bobWithoutHrStats, stats: bobWithoutHrStats }
const partialCombination = { ...fixtureCombination, id: 'partial-pool' }
const partialPool = new TeamPool([partialCombination], { 'partial-pool': [bobPartial, bobWithoutHr, billPartial] })
const partialOptions = partialPool.getAvailableSortOptions(partialCombination, new Set(), 'ALL').map(({ value }) => value)
assert(partialOptions.includes('hr') && partialOptions.includes('avg') && partialOptions.includes('era') && partialOptions.includes('sv'))
const partialHrSorted = partialPool.query({ combination: partialCombination, excludedIds: new Set(), filter: 'ALL', sort: 'hr', search: '' })
assert.deepEqual(partialHrSorted.map(({ id }) => id), ['partial-bob', 'partial-bob-no-hr'])
assert.throws(
  () => new DraftEngine({ pool: partialPool, reducedMotion: () => true }),
  /requires at least 16 validated team\/decade combinations/,
)
const partialCombinations = Array.from({ length: 16 }, (_, index) => ({ ...partialCombination, id: `partial-pool-${index}` }))
const partialPools = Object.fromEntries(partialCombinations.map(({ id }) => [id, [bobPartial, bobWithoutHr, billPartial]]))
const capacityPool = new TeamPool(partialCombinations, partialPools)
const partialEngine = new DraftEngine({ pool: capacityPool, reducedMotion: () => true })
assert.equal(partialEngine.getSnapshot().sort, 'name')
partialEngine.dispose()
const supported = pool.getCombinations()[0]
assert(pool.getPlayers(supported).length > 0)
assert(pool.getPlayers(supported).every((player) => (
  player.franchiseId === supported.franchiseId
  && player.decade === supported.decade
  && String(player.featuredSeason).startsWith(supported.decade.slice(0, 3))
)))
assert.deepEqual(pool.getPlayers({ ...supported, id: 'unsupported-pool' }), [])
for (let game = 0; game < 25; game += 1) {
  let sequence = game
  const simulationRandomizer = new Randomizer(pool, () => ((sequence++ * 19) % 101) / 101)
  const used = new Set<string>()
  let current = supported
  let teamRerollAvailable = true
  let eraRerollAvailable = true
  for (let round = 0; round < ROSTER_SLOTS.length; round += 1) {
    const selected = simulationRandomizer.select({
      mode: 'both', current, usedCombinationIds: used, teamRerollAvailable, eraRerollAvailable,
      roundsRemaining: ROSTER_SLOTS.length - round, isPlayable: () => true,
    })
    assert(selected, `Randomizer game ${game + 1} failed on round ${round + 1}`)
    current = selected
    used.add(current.id)
    if (round === 1) {
      const heldDecade = current.decade
      const rerolled = simulationRandomizer.select({
        mode: 'team', current, usedCombinationIds: used, teamRerollAvailable, eraRerollAvailable,
        roundsRemaining: ROSTER_SLOTS.length - round, isPlayable: () => true,
      })
      assert(rerolled && rerolled.decade === heldDecade)
      current = rerolled
      used.add(current.id)
      teamRerollAvailable = false
    }
    if (round === 7) {
      const heldFranchise = current.franchiseId
      const rerolled = simulationRandomizer.select({
        mode: 'era', current, usedCombinationIds: used, teamRerollAvailable, eraRerollAvailable,
        roundsRemaining: ROSTER_SLOTS.length - round, isPlayable: () => true,
      })
      assert(rerolled && rerolled.franchiseId === heldFranchise)
      current = rerolled
      used.add(current.id)
      eraRerollAvailable = false
    }
  }
  assert.equal(used.size, ROSTER_SLOTS.length + 2)
}
const yankees2000s = pool.getCombinations().find(({ id }) => id === 'nyy-2000s')
assert(yankees2000s)
const seasonSorted = pool.query({ combination: yankees2000s, excludedIds: new Set(), filter: 'ALL', sort: 'featuredSeason', search: '' })
for (let index = 1; index < seasonSorted.length; index += 1) assert(seasonSorted[index - 1].featuredSeason <= seasonSorted[index].featuredSeason)
const opsSorted = pool.query({ combination: yankees2000s, excludedIds: new Set(), filter: 'ALL', sort: 'ops', search: '' })
const opsValue = (player: (typeof opsSorted)[number]) => player.playerType === 'pitcher' ? null : player.visibleStats.ops
assert(opsSorted.every((player) => player.playerType !== 'pitcher' && opsValue(player) !== null))
for (let index = 1; index < opsSorted.length; index += 1) assert((opsValue(opsSorted[index - 1]) ?? -Infinity) >= (opsValue(opsSorted[index]) ?? -Infinity))
let randomIndex = 0
const randomizer = new Randomizer(pool, () => ((randomIndex++ * 17) % 97) / 97)
let scoringCalls = 0
const deterministicScoring = new DiamondDraftScoring()
const engine = new DraftEngine({
  pool,
  randomizer,
  scoring: { calculate: (roster) => { scoringCalls += 1; return deterministicScoring.calculate(roster) } },
  reducedMotion: () => true,
  timings: { reducedRoll: 0, reducedCommit: 0, rosterEffect: 0, resultsReveal: 0 },
})

let notifications = 0
const unsubscribe = engine.subscribe(() => { notifications += 1 })
engine.start()
await waitForTimers()

let draft = engine.getSnapshot()
assert.equal(draft.round, 1)
assert.equal(draft.totalRounds, 14)
assert.equal(draft.usedCombinationIds.length, 1)

engine.setSort('hr')
draft = engine.getSnapshot()
assert(draft.players.length > 0 && draft.players.every(({ player }) => player.playerType !== 'pitcher'))
const searchName = draft.players[0].player.name
engine.setSearch(searchName)
assert(engine.getSnapshot().players.every(({ player }) => player.name === searchName))
engine.setSearch('')
engine.setFilter('SP')
assert.equal(engine.getSnapshot().sort, 'name')
engine.setFilter('ALL')

const initialDecade = engine.getSnapshot().combination.decade
engine.rerollTeam()
assert.equal(engine.getSnapshot().teamRerollAvailable, false)
await waitForTimers()
assert.equal(engine.getSnapshot().combination.decade, initialDecade)
const rerolledFranchise = engine.getSnapshot().combination.franchiseId
engine.rerollEra()
assert.equal(engine.getSnapshot().eraRerollAvailable, false)
await waitForTimers()
assert.equal(engine.getSnapshot().combination.franchiseId, rerolledFranchise)

for (const [index, slot] of ROSTER_SLOTS.entries()) {
  draft = engine.getSnapshot()
  const candidate = draft.players.find(({ player, isAvailable }) => (
    isAvailable && (slot.position === 'DH' ? player.type === 'hitter' || player.isTwoWay : player.eligiblePositions.includes(slot.position))
  ))
  assert(candidate, `No candidate for ${slot.id}`)
  engine.selectPlayer(candidate.player.id)
  assert(engine.getSnapshot().availablePositions.includes(slot.position))
  engine.assignSelectedPlayer(slot.position)
  await waitForTimers()
  if (index < ROSTER_SLOTS.length - 1) await waitForTimers()
  draft = engine.getSnapshot()
  assert.equal(Object.keys(draft.roster).length, index + 1)
  if (index < ROSTER_SLOTS.length - 1) assert.equal(draft.complete, false)
}

await waitForTimers()
draft = engine.getSnapshot()
assert.equal(draft.complete, true)
assert(draft.result)
assert.equal(draft.result.wins + draft.result.losses, 162)
assert.equal(draft.result.scoringVersion, '2.2')
assert.equal(scoringCalls, 1, 'final scoring must execute exactly once')
assert.deepEqual(getSimulationReveal(draft.result), getSimulationReveal(draft.result), 'simulation reveal must reuse the predetermined result')
assert.equal(scoringCalls, 1, 'reading or skipping the presentation result must not rerun scoring')
assert.equal(Object.keys(draft.result.roster).length, ROSTER_SLOTS.length)
assert.deepEqual(draft.result.roster, draft.roster)
assert.equal(draft.result.overallGrade, draft.result.categoryGrades.overall)
assert.equal(draft.result.overallScore, draft.result.categoryScores.overall)
assert(draft.result.strongestCategory && draft.result.weakestCategory && draft.result.bestPlayerValue)
assert.equal(new Set(draft.usedCombinationIds).size, draft.usedCombinationIds.length)

engine.restart()
await waitForTimers()
draft = engine.getSnapshot()
assert.equal(draft.round, 1)
assert.equal(Object.keys(draft.roster).length, 0)
assert.equal(draft.teamRerollAvailable, true)
assert.equal(draft.eraRerollAvailable, true)
assert.equal(scoringCalls, 1, 'restart must not recalculate the prior result')
assert(notifications > 20)
engine.abandon()
draft = engine.getSnapshot()
assert.equal(Object.keys(draft.roster).length, 0, 'Home/abandon must clear completed draft state')
assert.equal(draft.result, null)

assert.equal(SIMULATION_PHASES.length, 3)
const standardDuration = getSimulationDuration(false)
const reducedDuration = getSimulationDuration(true)
assert(standardDuration >= 2_500 && standardDuration <= 3_500)
assert(reducedDuration >= 500 && reducedDuration <= 1_000)
const phaseProgression = [0, .5, .749, .75, .9, .919, .92, 1].map(getSimulationPhase)
for (let index = 1; index < phaseProgression.length; index += 1) assert(phaseProgression[index] >= phaseProgression[index - 1], 'simulation phases must never move backward')

unsubscribe()
engine.dispose()

const strictEngine = new DraftEngine({ reducedMotion: () => true, timings: { reducedRoll: 0 } })
strictEngine.start()
strictEngine.dispose()
strictEngine.start()
await waitForTimers()
assert.equal(strictEngine.getSnapshot().usedCombinationIds.length, 1)
strictEngine.dispose()
console.log('DraftEngine smoke passed: controls, rerolls, 14 assignments, results, restart, and subscriptions.')
