import assert from 'node:assert/strict'
import { calculateDraftResult } from '../src/game/scoring'
import { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from '../src/game/scoring/calculatePlayerValue'
import { SCORING_VERSION } from '../src/game/scoring/scoringConfig'
import { Randomizer } from '../src/game/Randomizer'
import { TeamPool } from '../src/game/TeamPool'
import { ROSTER_SLOTS, type Player, type Roster, type RosterSlotId } from '../src/types/draft'
import { fixturePlayer, fixtureRoster, historicalPeakRoster, type FixtureLevel } from './lib/scoring-fixtures'

function seededRandom(seed = 0x1620115) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const random = seededRandom()
const pool = new TeamPool()
const randomizer = new Randomizer(pool, random)
const isEligibleForSlot = (player: Player, slot: (typeof ROSTER_SLOTS)[number]) => (
  slot.position === 'DH' ? player.playerType !== 'pitcher'
    : slot.position === 'SP' || slot.position === 'RP' ? player.playerType !== 'hitter' && player.eligiblePositions.includes(slot.position)
      : player.playerType !== 'pitcher' && player.eligiblePositions.includes(slot.position)
)

function playerValueForSlot(player: Player, slot: (typeof ROSTER_SLOTS)[number]) {
  if (slot.position === 'SP') {
    assert(player.playerType !== 'hitter')
    return calculateStartingPitcherValue(player, slot.id).value
  }
  if (slot.position === 'RP') {
    assert(player.playerType !== 'hitter')
    return calculateReliefPitcherValue(player, slot.id).value
  }
  assert(player.playerType !== 'pitcher')
  return calculateHitterValue(player, slot.position, slot.id).value
}

function completeLocalDraft(qualityQuantile: number): Roster {
  const roster: Roster = {}
  const usedCombinationIds = new Set<string>()
  const selectedPlayerIds = new Set<string>()
  let current = pool.getCombinations()[0]
  for (const [index, slot] of ROSTER_SLOTS.entries()) {
    const isPlayable = (combination: typeof current) => pool.getPlayers(combination).some((player) => !selectedPlayerIds.has(player.id) && isEligibleForSlot(player, slot))
    const selected = randomizer.select({
      mode: 'both', current, usedCombinationIds, teamRerollAvailable: true, eraRerollAvailable: true,
      roundsRemaining: ROSTER_SLOTS.length - index, isPlayable,
    })
    assert(selected, `Local diagnostic draft could not fill ${slot.id}`)
    const options = pool.getPlayers(selected).filter((player) => !selectedPlayerIds.has(player.id) && isEligibleForSlot(player, slot))
      .sort((left, right) => playerValueForSlot(left, slot) - playerValueForSlot(right, slot))
    const player = options[Math.round(qualityQuantile * (options.length - 1))]
    assert(player)
    roster[slot.id] = player
    selectedPlayerIds.add(player.id)
    usedCombinationIds.add(selected.id)
    current = selected
  }
  return roster
}

const levels: readonly FixtureLevel[] = ['weak', 'average', 'good', 'strong']
const fixtureBatch: Roster[] = []
fixtureBatch.push(fixtureRoster('perfect', 'perfect'))
for (let index = 0; index < 5; index += 1) {
  const roster = fixtureRoster('perfect', 'perfect')
  const reliever = roster.RP2
  if (reliever) roster.RP2 = fixturePlayer(reliever, 'strong')
  fixtureBatch.push(roster)
}
for (let index = 0; index < 10; index += 1) {
  const roster = fixtureRoster('strong', 'strong')
  for (const slot of ['C', '1B', '2B', '3B', 'SS', 'CF', 'SP1', 'SP2', 'RP1'] as RosterSlotId[]) {
    const player = roster[slot]
    if (player) roster[slot] = fixturePlayer(player, 'perfect')
  }
  fixtureBatch.push(roster)
}
while (fixtureBatch.length < 5_000) {
  const baseIndex = Math.min(levels.length - 1, Math.floor(random() * levels.length))
  const roster = fixtureRoster(levels[baseIndex], levels[baseIndex])
  for (const slot of ROSTER_SLOTS) {
    const player = roster[slot.id]
    if (!player) continue
    const variation = random()
    const levelIndex = variation < .15 ? Math.max(0, baseIndex - 1) : variation > .85 ? Math.min(levels.length - 1, baseIndex + 1) : baseIndex
    roster[slot.id] = fixturePlayer(player, levels[levelIndex])
  }
  fixtureBatch.push(roster)
}

const localDrafts = [.05, .25, .5, .75, .95].map(completeLocalDraft)
const localResults = localDrafts.map((roster) => calculateDraftResult(roster).result)
const allTimeRoster = historicalPeakRoster()
const allTimeResult = calculateDraftResult(allTimeRoster).result
const results = [...fixtureBatch, ...localDrafts].map((roster) => calculateDraftResult(roster).result)
const wins = results.map((result) => result.wins).sort((left, right) => left - right)
const mean = wins.reduce((total, value) => total + value, 0) / wins.length
const median = wins.length % 2 ? wins[Math.floor(wins.length / 2)] : (wins[wins.length / 2 - 1] + wins[wins.length / 2]) / 2
const standardDeviation = Math.sqrt(wins.reduce((total, value) => total + (value - mean) ** 2, 0) / wins.length)
const bands = [
  ['55–74', 55, 74], ['75–84', 75, 84], ['85–94', 85, 94], ['95–104', 95, 104], ['105–114', 105, 114],
  ['115–129', 115, 129], ['130–144', 130, 144], ['145–155', 145, 155], ['156–161', 156, 161], ['162', 162, 162],
] as const
const visibleCategories = ['offense', 'defense', 'startingPitching', 'reliefPitching', 'rosterBalance'] as const
const gradeCounts = new Map<string, number>()
for (const result of results) for (const category of visibleCategories) gradeCounts.set(result.categoryGrades[category], (gradeCounts.get(result.categoryGrades[category]) ?? 0) + 1)

console.log(`Scoring v${SCORING_VERSION} distribution (${results.length.toLocaleString()} completed rosters)`)
console.log(`Minimum wins: ${wins[0]}`)
console.log(`Maximum wins: ${wins.at(-1)}`)
console.log(`Mean wins: ${mean.toFixed(2)}`)
console.log(`Median wins: ${median.toFixed(1)}`)
console.log(`Standard deviation: ${standardDeviation.toFixed(2)}`)
console.log('Win bands:')
for (const [label, minimum, maximum] of bands) console.log(`${label}: ${wins.filter((value) => value >= minimum && value <= maximum).length}`)
console.log('Visible-category grades:')
for (const grade of ['F', 'D', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S']) console.log(`${grade}: ${gradeCounts.get(grade) ?? 0}`)
console.log(`115+ wins: ${wins.filter((value) => value >= 115).length}`)
console.log(`130+ wins: ${wins.filter((value) => value >= 130).length}`)
console.log(`145+ wins: ${wins.filter((value) => value >= 145).length}`)
console.log(`156+ wins: ${wins.filter((value) => value >= 156).length}`)
console.log(`162 wins: ${wins.filter((value) => value === 162).length}`)
console.log('Five local draft records (5th/25th/50th/75th/95th player-value strategies):')
for (const [index, result] of localResults.entries()) console.log(`Draft ${index + 1}: ${result.wins}–${result.losses}, overall ${result.overallGrade} (${result.overallScore}), ${result.tierLabel}`)
console.log(`Best eligible generated-card roster: ${allTimeResult.wins}–${allTimeResult.losses}, overall ${allTimeResult.overallGrade} (${allTimeResult.overallScore}), categories ${JSON.stringify(allTimeResult.categoryScores)}`)

assert.equal(wins.at(-1), 162, 'distribution must include an attainable perfect roster')
assert.equal(wins.filter((value) => value === 162).length, 1, 'perfect seasons must remain exceptionally rare')
assert.equal(allTimeResult.wins, 162, 'the best eligible generated-card roster must be capable of perfection')
assert(standardDeviation >= 15, 'projected records remain too tightly clustered')
assert(Math.max(...localResults.map(({ wins: value }) => value)) - Math.min(...localResults.map(({ wins: value }) => value)) >= 15, 'five materially different local drafts should produce meaningfully different records')
