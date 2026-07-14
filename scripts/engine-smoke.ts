import assert from 'node:assert/strict'
import { DraftEngine } from '../src/game/DraftEngine'
import { Randomizer } from '../src/game/Randomizer'
import { TeamPool } from '../src/game/TeamPool'
import { ROSTER_SLOTS } from '../src/types/draft'

const waitForTimers = () => new Promise((resolve) => setTimeout(resolve, 5))
const pool = new TeamPool()
const supported = pool.getCombinations()[0]
assert(pool.getPlayers(supported).length > 0)
assert(pool.getPlayers(supported).every((player) => (
  player.franchiseId === supported.franchiseId
  && player.decade === supported.decade
  && String(player.featuredSeason).startsWith(supported.decade.slice(0, 3))
)))
assert.deepEqual(pool.getPlayers({ ...supported, id: 'unsupported-pool' }), [])
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
