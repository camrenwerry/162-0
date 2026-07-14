import { readFileSync } from 'node:fs'

const datasetUrl = new URL('../src/data/mlb/betaPlayers.json', import.meta.url)
const { combinations, players } = JSON.parse(readFileSync(datasetUrl, 'utf8'))

const validDecades = new Set(['1980s', '1990s', '2000s', '2010s'])
const validFranchises = new Set([
  'yankees', 'red-sox', 'dodgers', 'giants', 'cardinals', 'cubs',
  'braves', 'mariners', 'orioles', 'athletics', 'angels', 'phillies',
])
const validPositions = new Set(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'])
const requiredPoolPositions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SP', 'RP']
const requiredRoster = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'SP', 'SP', 'RP', 'RP']
const errors = []
const warnings = []

const finiteOrNull = (value) => value === null || (typeof value === 'number' && Number.isFinite(value))
const requireStats = (card, object, keys, label, allowNull = true) => {
  for (const key of keys) {
    if (!Object.hasOwn(object ?? {}, key)) errors.push(`${card.id}: missing ${label}.${key}`)
    else if (allowNull ? !finiteOrNull(object[key]) : typeof object[key] !== 'number' || !Number.isFinite(object[key])) {
      errors.push(`${card.id}: invalid ${label}.${key}`)
    }
  }
}

const poolCanCompleteRoster = (pool) => {
  const cardToSlot = new Map()
  const canFill = (card, position) => position === 'DH'
    ? card.type === 'hitter' || card.isTwoWay === true
    : card.eligiblePositions.includes(position)
  const assign = (slotIndex, seenCards) => {
    for (const card of pool) {
      if (!canFill(card, requiredRoster[slotIndex]) || seenCards.has(card.id)) continue
      seenCards.add(card.id)
      const previousSlot = cardToSlot.get(card.id)
      if (previousSlot === undefined || assign(previousSlot, seenCards)) {
        cardToSlot.set(card.id, slotIndex)
        return true
      }
    }
    return false
  }
  return requiredRoster.every((_, slotIndex) => assign(slotIndex, new Set()))
}

const combinationIds = new Set()
for (const combination of combinations) {
  if (combinationIds.has(combination.id)) errors.push(`Duplicate combination id: ${combination.id}`)
  combinationIds.add(combination.id)
  if (!validFranchises.has(combination.franchiseId)) errors.push(`${combination.id}: invalid franchise`)
  if (!validDecades.has(combination.decade)) errors.push(`${combination.id}: invalid decade`)
}

const ids = new Set()
const cardKeys = new Set()
for (const card of players) {
  if (ids.has(card.id)) errors.push(`Duplicate card id: ${card.id}`)
  ids.add(card.id)
  const cardKey = `${card.playerId}|${card.franchiseId}|${card.decade}`
  if (cardKeys.has(cardKey)) errors.push(`Duplicate player/franchise/decade card: ${cardKey}`)
  cardKeys.add(cardKey)

  if (!card.name?.trim()) errors.push(`${card.id}: empty player name`)
  if (!validFranchises.has(card.franchiseId)) errors.push(`${card.id}: invalid franchise`)
  if (!validDecades.has(card.decade)) errors.push(`${card.id}: invalid decade`)
  if (!Array.isArray(card.eligiblePositions) || card.eligiblePositions.length === 0) errors.push(`${card.id}: no eligible positions`)
  for (const position of card.eligiblePositions ?? []) {
    if (!validPositions.has(position)) errors.push(`${card.id}: invalid position ${position}`)
  }
  if (card.type === 'pitcher' && card.eligiblePositions.includes('DH') && !card.isTwoWay) {
    errors.push(`${card.id}: non-two-way pitcher cannot use DH`)
  }

  if (card.type === 'hitter') {
    if (card.eligiblePositions.some((position) => ['SP', 'RP'].includes(position)) && !card.isTwoWay) errors.push(`${card.id}: non-two-way hitter has a pitching position`)
    requireStats(card, card.stats, ['war', 'opsPlus', 'hr', 'avg', 'obp', 'slg', 'rbi', 'sb'], 'stats')
    requireStats(card, card.scoringStats, ['obp', 'slg', 'wrcPlus', 'defensiveValue', 'baserunningValue', 'games', 'plateAppearances'], 'scoringStats', false)
  } else if (card.type === 'pitcher') {
    if (card.eligiblePositions.some((position) => !['SP', 'RP', 'DH'].includes(position)) && !card.isTwoWay) errors.push(`${card.id}: non-two-way pitcher has a fielding position`)
    requireStats(card, card.stats, ['war', 'eraPlus', 'era', 'whip', 'so', 'wins', 'sv'], 'stats')
    requireStats(card, card.scoringStats, ['whip', 'fip', 'inningsPitched', 'strikeoutRate', 'walkRate', 'starts', 'reliefAppearances'], 'scoringStats', false)
  } else {
    errors.push(`${card.id}: invalid player type`)
  }
}

for (const combination of combinations) {
  const pool = players.filter((card) => card.franchiseId === combination.franchiseId && card.decade === combination.decade)
  if (pool.length < 24 || pool.length > 36) errors.push(`${combination.id}: expected 24–36 cards, found ${pool.length}`)
  if (!poolCanCompleteRoster(pool)) errors.push(`${combination.id}: cards cannot uniquely fill the complete 14-slot roster`)
  for (const position of requiredPoolPositions) {
    const count = pool.filter((card) => card.eligiblePositions.includes(position)).length
    if (count === 0) errors.push(`${combination.id}: no eligible ${position}`)
    else if (position === 'SP' && count < 3) errors.push(`${combination.id}: cannot fill three SP slots (${count} choices)`)
    else if (position === 'RP' && count < 2) errors.push(`${combination.id}: cannot fill two RP slots (${count} choices)`)
    else if (position === 'SP' && count < 5) warnings.push(`${combination.id}: SP has ${count} eligible choices; target is 5`)
    else if (position === 'RP' && count < 3) warnings.push(`${combination.id}: RP has ${count} eligible choices; target is 3`)
    else if (!['SP', 'RP'].includes(position) && count < 3) warnings.push(`${combination.id}: ${position} has ${count} eligible choice${count === 1 ? '' : 's'}`)
  }
}

console.log(`Validated ${players.length} cards across ${combinations.length} franchise/decade pools.`)
if (warnings.length) {
  console.warn(`Coverage warnings (${warnings.length}):`)
  warnings.forEach((warning) => console.warn(`  - ${warning}`))
}
if (errors.length) {
  console.error(`Serious dataset errors (${errors.length}):`)
  errors.forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}
console.log('No serious dataset errors found.')
