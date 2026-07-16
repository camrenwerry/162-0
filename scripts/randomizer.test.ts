import assert from 'node:assert/strict'
import { Randomizer, type RandomizerRequest } from '../src/game/Randomizer'
import { createSeededRandom } from '../src/game/SeededRandom'
import type { TeamDecade } from '../src/types/draft'

const decade = (index: number) => `${1900 + index * 10}s` as TeamDecade['decade']
const combination = (franchiseId: string, index: number): TeamDecade => ({
  id: `${franchiseId}-${decade(index)}`,
  franchiseId,
  team: franchiseId.toUpperCase(),
  teamName: franchiseId,
  decade: decade(index),
})
const source = (combinations: readonly TeamDecade[]) => ({
  getCombinations: () => combinations,
  getTeams: () => [...new Map(combinations.map((item) => [item.franchiseId, item])).values()].map((item) => ({ franchiseId: item.franchiseId, team: item.team, teamName: item.teamName })),
  getDecades: () => [...new Set(combinations.map((item) => item.decade))],
})
const request = (current: TeamDecade, overrides: Partial<RandomizerRequest> = {}): RandomizerRequest => ({
  mode: 'both', current, usedCombinationIds: new Set(), teamRerollAvailable: false,
  eraRerollAvailable: false, roundsRemaining: 1, isPlayable: () => true, ...overrides,
})

const uneven = [
  ...Array.from({ length: 10 }, (_, index) => combination('old', index)),
  combination('new', 0),
  ...Array.from({ length: 4 }, (_, index) => combination('mid', index)),
  ...Array.from({ length: 2 }, (_, index) => combination('short', index)),
]
const unevenRandomizer = new Randomizer(source(uneven), createSeededRandom('seeded-v1:00000001000000020000000300000004'))
const franchiseCounts = new Map<string, number>()
for (let roll = 0; roll < 200_000; roll += 1) {
  const selected = unevenRandomizer.select(request(uneven[0]))
  assert(selected)
  franchiseCounts.set(selected.franchiseId, (franchiseCounts.get(selected.franchiseId) ?? 0) + 1)
}
for (const count of franchiseCounts.values()) assert(Math.abs(count / 200_000 - .25) < .01, 'franchises must be approximately uniform')
assert((franchiseCounts.get('old') ?? 0) / (franchiseCounts.get('new') ?? 1) < 1.1, 'ten decades must not create ten times the probability')

const oneFranchise = Array.from({ length: 10 }, (_, index) => combination('old', index))
const decadeRandomizer = new Randomizer(source(oneFranchise), createSeededRandom('seeded-v1:00000005000000060000000700000008'))
const decadeCounts = new Map<string, number>()
for (let roll = 0; roll < 100_000; roll += 1) {
  const selected = decadeRandomizer.select(request(oneFranchise[0]))
  assert(selected)
  decadeCounts.set(selected.decade, (decadeCounts.get(selected.decade) ?? 0) + 1)
}
for (const count of decadeCounts.values()) assert(Math.abs(count / 100_000 - .1) < .006, 'decades within a franchise must be approximately uniform')

const rerollCombinations = [combination('a', 0), combination('a', 1), combination('b', 0), combination('b', 1), combination('c', 0), combination('c', 1)]
const rerollRandomizer = new Randomizer(source(rerollCombinations), createSeededRandom('seeded-v1:000000090000000a0000000b0000000c'))
const current = rerollCombinations[0]
const teamResult = rerollRandomizer.select(request(current, { mode: 'team', usedCombinationIds: new Set([current.id]), eraRerollAvailable: true }))
assert(teamResult)
assert.equal(teamResult.decade, current.decade, 'Team rerolls must preserve the decade')
assert.notEqual(teamResult.franchiseId, current.franchiseId, 'Team rerolls must replace the franchise')
const eraResult = rerollRandomizer.select(request(current, { mode: 'era', usedCombinationIds: new Set([current.id]), teamRerollAvailable: true }))
assert(eraResult)
assert.equal(eraResult.franchiseId, current.franchiseId, 'Era rerolls must preserve the franchise')
assert.notEqual(eraResult.decade, current.decade, 'Era rerolls must replace the decade')

const gameCombinations = Array.from({ length: 4 }, (_, franchise) => Array.from({ length: 10 }, (_, index) => combination(`f${franchise}`, index))).flat()
const gameRandomizer = new Randomizer(source(gameCombinations), createSeededRandom('seeded-v1:0000000d0000000e0000000f00000010'))
const used = new Set<string>()
let gameCurrent = gameCombinations[0]
for (let round = 0; round < 14; round += 1) {
  const selected = gameRandomizer.select(request(gameCurrent, { usedCombinationIds: used, roundsRemaining: 14 - round }))
  assert(selected, `14-round game dead-ended at round ${round + 1}`)
  assert(!used.has(selected.id), 'Exact combinations must never repeat')
  used.add(selected.id)
  gameCurrent = selected
}
assert.equal(used.size, 14)
assert.equal(gameRandomizer.select(request(gameCurrent, { usedCombinationIds: new Set(gameCombinations.map(({ id }) => id)), roundsRemaining: 1 })), null, 'exhaustion must terminate with null')

console.log('Randomizer tests passed: franchise-first fairness, within-franchise decades, reroll invariants, uniqueness, 14-round completion, and bounded exhaustion.')
