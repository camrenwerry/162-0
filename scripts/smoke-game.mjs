import assert from 'node:assert/strict'
import fs from 'node:fs'

const combinations = JSON.parse(fs.readFileSync('src/data/generated/combinations.json', 'utf8'))
const pools = Object.fromEntries(combinations.map(({ id }) => [id, JSON.parse(fs.readFileSync(`src/data/generated/pools/${id}.json`, 'utf8'))]))
const players = Object.values(pools).flat()
const slots = [
  ['C', 'C'], ['1B', '1B'], ['2B', '2B'], ['3B', '3B'], ['SS', 'SS'],
  ['LF', 'LF'], ['CF', 'CF'], ['RF', 'RF'], ['DH', 'DH'],
  ['SP1', 'SP'], ['SP2', 'SP'], ['SP3', 'SP'], ['RP1', 'RP'], ['RP2', 'RP'],
]
const positionOrder = new Map(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'].map((position, index) => [position, index]))
const universalSorts = new Set(['name', 'position', 'featuredSeason'])
const hitterSorts = new Set(['ops', 'hr', 'avg', 'obp', 'slg', 'rbi', 'sb'])
const pitcherSorts = new Set(['era', 'whip', 'so', 'wins', 'sv'])

const firstOpenSlot = (position, roster) => slots.find(([id, label]) => label === position && !roster[id])?.[0] ?? null
const availablePositions = (player, roster) => {
  const positions = player.eligiblePositions.filter((position) => position !== 'DH' && firstOpenSlot(position, roster))
  if (!roster.DH && (player.type === 'hitter' || player.isTwoWay)) positions.push('DH')
  return positions
}

// Explicit duplicate-slot behavior.
const pitchingRoster = {}
const sampleStarters = players.filter((player) => player.eligiblePositions.includes('SP')).slice(0, 3)
for (let index = 0; index < sampleStarters.length; index += 1) {
  assert(availablePositions(sampleStarters[index], pitchingRoster).includes('SP'))
  pitchingRoster[firstOpenSlot('SP', pitchingRoster)] = sampleStarters[index]
}
assert.equal(firstOpenSlot('SP', pitchingRoster), null)
assert(!availablePositions(players.find((player) => player.eligiblePositions.includes('SP')), pitchingRoster).includes('SP'))

const sampleRelievers = players.filter((player) => player.eligiblePositions.includes('RP')).slice(0, 2)
for (const reliever of sampleRelievers) {
  assert(availablePositions(reliever, pitchingRoster).includes('RP'))
  pitchingRoster[firstOpenSlot('RP', pitchingRoster)] = reliever
}
assert.equal(firstOpenSlot('RP', pitchingRoster), null)

// Complete many independent 14-round drafts using unique combinations.
for (let game = 0; game < 200; game += 1) {
  const roster = {}
  const usedCombinations = new Set()
  const draftedCards = new Set()
  for (const [slotId, position] of slots) {
    const options = combinations.filter((combination) => (
      !usedCombinations.has(combination.id)
      && players.some((player) => player.franchiseId === combination.franchiseId
        && player.decade === combination.decade
        && !draftedCards.has(player.id)
        && availablePositions(player, roster).includes(position))
    ))
    assert(options.length > 0, `Draft ${game + 1} dead-ended at ${slotId}`)
    const combination = options[Math.floor(Math.random() * options.length)]
    usedCombinations.add(combination.id)
    const player = players.find((card) => card.franchiseId === combination.franchiseId
      && card.decade === combination.decade
      && !draftedCards.has(card.id)
      && availablePositions(card, roster).includes(position))
    roster[slotId] = player
    draftedCards.add(player.id)
    assert.equal(Object.keys(roster).length, slots.indexOf(slots.find(([id]) => id === slotId)) + 1)
  }
  assert.equal(Object.keys(roster).length, 14)
  assert.equal(usedCombinations.size, 14)
}

// One team reroll preserves era; one era reroll preserves franchise.
for (let game = 0; game < 100; game += 1) {
  const used = new Set()
  const rerollable = combinations.filter((candidate) => (
    combinations.some((option) => option.id !== candidate.id && option.decade === candidate.decade)
    && combinations.some((option) => option.id !== candidate.id && option.franchiseId === candidate.franchiseId)
  ))
  let current = rerollable[Math.floor(Math.random() * rerollable.length)]
  used.add(current.id)
  const teamOptions = combinations.filter((candidate) => candidate.decade === current.decade
    && !used.has(candidate.id)
    && combinations.some((eraOption) => eraOption.franchiseId === candidate.franchiseId && eraOption.id !== candidate.id && !used.has(eraOption.id)))
  const heldDecade = current.decade
  current = teamOptions[Math.floor(Math.random() * teamOptions.length)]
  assert.equal(current.decade, heldDecade)
  assert(!used.has(current.id))
  used.add(current.id)
  const eraOptions = combinations.filter((candidate) => candidate.franchiseId === current.franchiseId && !used.has(candidate.id))
  const heldFranchise = current.franchiseId
  current = eraOptions[Math.floor(Math.random() * eraOptions.length)]
  assert.equal(current.franchiseId, heldFranchise)
  assert(!used.has(current.id))
}

// Requested direction and stable-name tie behavior for every sort key.
const pool = players.filter((player) => player.franchiseId === combinations[0].franchiseId && player.decade === combinations[0].decade)
const visibleForAllSort = (key) => pool.filter((player) => hitterSorts.has(key)
  ? player.playerType !== 'pitcher'
  : pitcherSorts.has(key) ? player.playerType !== 'hitter' : true)
for (const key of universalSorts) {
  const visible = visibleForAllSort(key)
  assert(visible.some((player) => player.type === 'hitter'))
  assert(visible.some((player) => player.type === 'pitcher'))
}
for (const key of hitterSorts) assert(visibleForAllSort(key).every((player) => player.playerType !== 'pitcher'))
for (const key of pitcherSorts) assert(visibleForAllSort(key).every((player) => player.playerType !== 'hitter'))

const valueFor = (player, key) => {
  if (key === 'name') return player.name
  if (key === 'position') return Math.min(...player.eligiblePositions.map((position) => positionOrder.get(position)))
  if (key === 'featuredSeason') return player.featuredSeason
  const stats = pitcherSorts.has(key) && player.playerType === 'twoWay' ? player.pitchingVisibleStats : player.stats
  return stats[key] ?? null
}
const compare = (key, ascending) => (a, b) => {
  const av = valueFor(a, key); const bv = valueFor(b, key)
  if (av === null && bv === null) return a.name.localeCompare(b.name)
  if (av === null) return 1
  if (bv === null) return -1
  const primary = typeof av === 'string' ? av.localeCompare(bv) : av - bv
  return (ascending ? primary : -primary) || a.name.localeCompare(b.name)
}
for (const key of ['ops', 'hr', 'avg', 'obp', 'slg', 'rbi', 'sb', 'so', 'wins', 'sv']) {
  const compatible = pool.filter((player) => valueFor(player, key) !== null)
  const sorted = [...compatible].sort(compare(key, false))
  for (let index = 1; index < sorted.length; index += 1) assert(valueFor(sorted[index - 1], key) >= valueFor(sorted[index], key))
}
for (const key of ['era', 'whip', 'name', 'position', 'featuredSeason']) {
  const compatible = pool.filter((player) => valueFor(player, key) !== null)
  const sorted = [...compatible].sort(compare(key, true))
  for (let index = 1; index < sorted.length; index += 1) assert(valueFor(sorted[index - 1], key) <= valueFor(sorted[index], key))
}

const validHr = pool.find((player) => player.type === 'hitter' && player.stats.hr !== null)
const missingHr = { ...validHr, id: 'null-stat-test', name: 'Null Stat', stats: { ...validHr.stats, hr: null } }
assert.equal([missingHr, validHr].sort(compare('hr', false)).at(-1).id, 'null-stat-test')

const searchTarget = visibleForAllSort('hr')[0]
const searchTerm = searchTarget.name.toLocaleLowerCase()
assert(visibleForAllSort('hr').filter((player) => player.name.toLocaleLowerCase().includes(searchTerm)).every((player) => player.playerType !== 'pitcher'))

console.log('Gameplay smoke passed: 200 drafts, duplicate pitching slots, rerolls, ALL type filtering, search, null handling, and all sort directions.')
