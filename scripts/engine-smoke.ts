import assert from 'node:assert/strict'
import { DraftEngine } from '../src/game/DraftEngine'
import { getCompactPlayerStats } from '../src/game/PlayerStats'
import { Randomizer } from '../src/game/Randomizer'
import { TeamPool } from '../src/game/TeamPool'
import { ROSTER_SLOTS } from '../src/types/draft'

const waitForTimers = () => new Promise((resolve) => setTimeout(resolve, 5))
const pool = new TeamPool()
const missingCombination = { ...pool.getCombinations()[0], id: 'missing-pool' }
assert(!new TeamPool([missingCombination], {}).getCombinations().length)
const cubs1980s = pool.getCombinations().find(({ id }) => id === 'chc-1980s')
assert(cubs1980s)
const bobDernier = pool.getPlayers(cubs1980s).find(({ name }) => name === 'Bob Dernier')
const billCaudill = pool.getPlayers(cubs1980s).find(({ name }) => name === 'Bill Caudill')
assert(bobDernier?.playerType === 'hitter' && billCaudill?.playerType === 'pitcher')
assert.deepEqual(getCompactPlayerStats(bobDernier, 'hitter').map(({ label }) => label), ['WAR', 'OPS+', 'HR', 'AVG'])
const bobPartialStats = { ...bobDernier.visibleStats, war: null, opsPlus: null, hr: 8, avg: .317, obp: null, slg: null, rbi: null, sb: null }
const bobPartial = { ...bobDernier, id: 'partial-bob', visibleStats: bobPartialStats, stats: bobPartialStats }
assert.deepEqual(getCompactPlayerStats(bobPartial, 'hitter').map(({ label, formattedValue }) => [label, formattedValue]), [['HR', '8'], ['AVG', '.317']])
const billPartialStats = { ...billCaudill.visibleStats, war: null, eraPlus: null, era: 2.19, whip: null, so: null, wins: null, saves: 1, sv: 1 }
const billPartial = { ...billCaudill, id: 'partial-bill', visibleStats: billPartialStats, stats: billPartialStats }
assert.deepEqual(getCompactPlayerStats(billPartial, 'pitcher').map(({ label, formattedValue }) => [label, formattedValue]), [['ERA', '2.19'], ['SV', '1']])

const bobWithoutHrStats = { ...bobPartialStats, hr: null }
const bobWithoutHr = { ...bobPartial, id: 'partial-bob-no-hr', name: 'Zed Null', visibleStats: bobWithoutHrStats, stats: bobWithoutHrStats }
const partialCombination = { ...cubs1980s, id: 'partial-pool' }
const partialPool = new TeamPool([partialCombination], { 'partial-pool': [bobPartial, bobWithoutHr, billPartial] })
const partialOptions = partialPool.getAvailableSortOptions(partialCombination, new Set(), 'ALL').map(({ value }) => value)
assert(!partialOptions.includes('war') && !partialOptions.includes('opsPlus') && !partialOptions.includes('eraPlus'))
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
const warSorted = pool.query({ combination: yankees2000s, excludedIds: new Set(), filter: 'ALL', sort: 'war', search: '' })
assert(warSorted.every(({ stats }) => stats.war !== null))
for (let index = 1; index < warSorted.length; index += 1) assert((warSorted[index - 1].stats.war ?? -Infinity) >= (warSorted[index].stats.war ?? -Infinity))
const opsSorted = pool.query({ combination: yankees2000s, excludedIds: new Set(), filter: 'ALL', sort: 'opsPlus', search: '' })
const opsValue = (player: (typeof opsSorted)[number]) => player.playerType === 'pitcher' ? null : player.stats.opsPlus
assert(opsSorted.every((player) => player.playerType !== 'pitcher' && opsValue(player) !== null))
for (let index = 1; index < opsSorted.length; index += 1) assert((opsValue(opsSorted[index - 1]) ?? -Infinity) >= (opsValue(opsSorted[index]) ?? -Infinity))
let randomIndex = 0
const randomizer = new Randomizer(pool, () => ((randomIndex++ * 17) % 97) / 97)
const engine = new DraftEngine({
  pool,
  randomizer,
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
assert.equal(engine.getSnapshot().sort, 'war')
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
assert.equal(draft.result.scoringVersion, '1.0')
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
assert(notifications > 20)

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
