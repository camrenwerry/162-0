import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const THRESHOLDS = Object.freeze({
  hitterPlateAppearances: 100,
  pitcherInnings: 30,
  twoWayPlateAppearances: 200,
  fieldingGames: 10,
  starterGames: 10,
  reliefAppearances: 15,
  veryLowHitterPlateAppearances: 150,
  veryLowPitcherInnings: 40,
})

const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
const VALID_POSITIONS = new Set([...FIELD_POSITIONS, 'SP', 'RP'])
const REQUIRED_ROSTER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'SP', 'SP', 'RP', 'RP']

export function parseCsv(text) {
  const rows = []
  let row = []; let field = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += character
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [headers, ...values] = rows
  return values.filter((value) => value.some(Boolean)).map((value) => Object.fromEntries(headers.map((header, index) => [header, value[index] ?? ''])))
}

const nullableNumber = (value) => value === '' || value === undefined || value === null ? null : Number(value)
const slugify = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const cardKey = (franchiseId, decade, playerId) => `${franchiseId}-${decade}-${playerId}`
const fieldKey = (franchiseId, season, playerId) => `${franchiseId}-${season}-${playerId}`

export function normalizeSeasonRow(row) {
  const numeric = [
    'season', 'hitterGames', 'plateAppearances', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns', 'rbi',
    'stolenBases', 'walks', 'hitByPitch', 'sacrificeFlies', 'avg', 'obp', 'slg', 'pitcherGames', 'wins',
    'gamesStarted', 'saves', 'inningsPitched', 'hitsAllowed', 'earnedRuns', 'homeRunsAllowed', 'walksAllowed',
    'strikeouts', 'era', 'whip',
  ]
  const normalized = { ...row }
  numeric.forEach((key) => { normalized[key] = nullableNumber(row[key]) })
  normalized.lahmanTeamIds = row.lahmanTeamIds ? row.lahmanTeamIds.split('|').filter(Boolean) : []
  return normalized
}

export function normalizeFieldingRow(row) {
  return { ...row, season: Number(row.season), games: Number(row.games), gamesStarted: nullableNumber(row.gamesStarted) }
}

export function normalizeAdvancedRow(row) {
  return {
    ...row,
    season: Number(row.season),
    battingWar: nullableNumber(row.battingWar),
    opsPlus: nullableNumber(row.opsPlus),
    pitchingWar: nullableNumber(row.pitchingWar),
    eraPlus: nullableNumber(row.eraPlus),
  }
}

function hitterSeasonScore(row) {
  if ((row.plateAppearances ?? 0) < THRESHOLDS.hitterPlateAppearances) return null
  const ops = row.obp !== null && row.slg !== null ? row.obp + row.slg : null
  if (ops === null) return null
  if (row.battingWar != null && row.opsPlus != null) {
    return row.battingWar * 12 + (row.opsPlus - 100) * .5 + Math.min(row.plateAppearances, 750) / 100
  }
  // Retained only for unverified imports that predate advanced-stat enrichment.
  return ops * 100 + Math.min(row.plateAppearances, 750) / 35
}

function pitcherSeasonScore(row) {
  if ((row.inningsPitched ?? 0) < THRESHOLDS.pitcherInnings) return null
  const reliefAppearances = Math.max(0, (row.pitcherGames ?? 0) - (row.gamesStarted ?? 0))
  const starter = (row.gamesStarted ?? 0) >= THRESHOLDS.starterGames
  const reliever = reliefAppearances >= THRESHOLDS.reliefAppearances
  if (!starter && !reliever) return null
  const k9 = row.inningsPitched ? (row.strikeouts ?? 0) * 9 / row.inningsPitched : 0
  const bb9 = row.inningsPitched ? (row.walksAllowed ?? 0) * 9 / row.inningsPitched : 0
  if (row.pitchingWar != null && row.eraPlus != null) {
    const workload = starter ? Math.min(row.inningsPitched / 20, 10) : Math.min(reliefAppearances / 7, 10)
    return row.pitchingWar * 12 + (row.eraPlus - 100) * .35 + workload
  }
  const prevention = row.era === null ? 0 : (6 - row.era) * 12
  const traffic = row.whip === null ? 0 : (1.6 - row.whip) * 20
  const workload = starter ? Math.min(row.inningsPitched / 18, 12) : Math.min(reliefAppearances / 5, 12)
  return prevention + traffic + (k9 - bb9) * 1.5 + workload
}

export function deriveSeasonCandidate(row, fieldingRows, override = {}) {
  const hitterScore = hitterSeasonScore(row)
  const pitcherScore = pitcherSeasonScore(row)
  if (hitterScore === null && pitcherScore === null) return null
  const reliefAppearances = Math.max(0, (row.pitcherGames ?? 0) - (row.gamesStarted ?? 0))
  const qualifiesAsTwoWay = hitterScore !== null && pitcherScore !== null
    && (row.plateAppearances ?? 0) >= THRESHOLDS.twoWayPlateAppearances
  const playerType = pitcherScore !== null
    ? qualifiesAsTwoWay ? 'twoWay' : 'pitcher'
    : 'hitter'
  const positions = fieldingRows
    .filter((appearance) => appearance.games >= THRESHOLDS.fieldingGames)
    .map((appearance) => appearance.position)
    .filter((position) => FIELD_POSITIONS.includes(position))
    .filter(() => playerType !== 'pitcher')
  if ((row.gamesStarted ?? 0) >= THRESHOLDS.starterGames) positions.push('SP')
  if (reliefAppearances >= THRESHOLDS.reliefAppearances) positions.push('RP')
  const add = override.add ?? []
  const remove = new Set(override.remove ?? [])
  const eligiblePositions = [...new Set([...positions, ...add])].filter((position) => !remove.has(position))
  return {
    row,
    playerType,
    eligiblePositions,
    pitchingRole: pitcherScore === null ? null : (row.gamesStarted ?? 0) >= reliefAppearances ? 'SP' : 'RP',
    hitterScore,
    pitcherScore,
    selectionScore: playerType === 'twoWay'
      ? Math.max(hitterScore, pitcherScore) + Math.min(hitterScore, pitcherScore) * .2
      : playerType === 'pitcher' ? pitcherScore : hitterScore,
    manualPositionOverride: add.length > 0 || remove.size > 0,
  }
}

export function selectBestSeason(rows, fieldingBySeason, overrides = {}) {
  if (!rows.length) return null
  const first = rows[0]
  const decadeStart = Number.parseInt(first.decade, 10)
  const decadeEnd = decadeStart + 9
  const requestedSeason = overrides.featuredSeasons?.[cardKey(first.franchiseId, first.decade, first.playerId)]
  const candidates = rows
    .filter((row) => (
      row.franchiseId === first.franchiseId
      && row.decade === first.decade
      && Number.isInteger(row.season)
      && row.season >= decadeStart
      && row.season <= decadeEnd
    ))
    .map((row) => deriveSeasonCandidate(
      row,
      fieldingBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId)) ?? [],
      overrides.positionOverrides?.[cardKey(row.franchiseId, row.decade, row.playerId)] ?? {},
    ))
    .filter(Boolean)
  if (requestedSeason !== undefined) return candidates.find((candidate) => candidate.row.season === requestedSeason) ?? null
  return candidates.sort((left, right) => right.selectionScore - left.selectionScore || right.row.season - left.row.season)[0] ?? null
}

function makeHitterStats(row) {
  return { war: row.battingWar ?? null, opsPlus: row.opsPlus ?? null, hr: row.homeRuns ?? null, avg: row.avg ?? null, obp: row.obp ?? null, slg: row.slg ?? null, rbi: row.rbi ?? null, sb: row.stolenBases ?? null }
}

function makePitcherStats(row) {
  return { war: row.pitchingWar ?? null, eraPlus: row.eraPlus ?? null, era: row.era ?? null, whip: row.whip ?? null, so: row.strikeouts ?? null, wins: row.wins ?? null, saves: row.saves ?? null, sv: row.saves ?? null }
}

function makePitchingScoring(row) {
  const innings = row.inningsPitched
  return {
    inningsPitched: innings,
    games: row.pitcherGames,
    gamesStarted: row.gamesStarted,
    reliefAppearances: Math.max(0, (row.pitcherGames ?? 0) - (row.gamesStarted ?? 0)),
    fip: null,
    strikeoutRate: innings ? (row.strikeouts ?? 0) * 9 / innings : null,
    walkRate: innings ? (row.walksAllowed ?? 0) * 9 / innings : null,
  }
}

export function candidateToCard(candidate, overrides = {}, verifiedAt = '2026-07-14') {
  const row = candidate.row
  const key = cardKey(row.franchiseId, row.decade, row.playerId)
  const name = overrides.names?.[row.playerId] ?? row.name
  const slug = slugify(name)
  const isPitcher = candidate.playerType === 'pitcher'
  const hitterStats = makeHitterStats(row)
  const pitcherStats = makePitcherStats(row)
  const advancedStatsSourceUrls = candidate.playerType === 'twoWay'
    ? [row.battingAdvancedSourceUrl, row.pitchingAdvancedSourceUrl]
    : [isPitcher ? row.pitchingAdvancedSourceUrl : row.battingAdvancedSourceUrl]
  const hitterScoring = {
    games: row.hitterGames,
    plateAppearances: row.plateAppearances,
    offensiveValue: null,
    defensiveValue: null,
    baserunningValue: null,
    obp: row.obp,
    slg: row.slg,
    wrcPlus: null,
  }
  const pitcherScoring = makePitchingScoring(row)
  return {
    id: `${row.franchiseId}-${row.decade}-${slug}-${row.season}`,
    playerId: row.playerId,
    playerSlug: slug,
    name,
    franchiseId: row.franchiseId,
    teamAbbreviation: row.teamAbbreviation,
    teamDisplayName: row.teamDisplayName,
    team: row.teamAbbreviation,
    decade: row.decade,
    featuredSeason: row.season,
    playerType: candidate.playerType,
    type: isPitcher ? 'pitcher' : 'hitter',
    isTwoWay: candidate.playerType === 'twoWay',
    pitchingRole: candidate.pitchingRole,
    eligiblePositions: candidate.eligiblePositions,
    bats: row.bats || null,
    throws: row.throws || null,
    visibleStats: isPitcher ? pitcherStats : hitterStats,
    pitchingVisibleStats: candidate.playerType === 'twoWay' ? pitcherStats : null,
    stats: isPitcher ? pitcherStats : hitterStats,
    scoringStats: isPitcher ? {
      whip: row.whip,
      fip: null,
      inningsPitched: row.inningsPitched,
      strikeoutRate: pitcherScoring.strikeoutRate,
      walkRate: pitcherScoring.walkRate,
      starts: row.gamesStarted,
      reliefAppearances: pitcherScoring.reliefAppearances,
    } : hitterScoring,
    pitchingScoringStats: candidate.playerType === 'twoWay' ? pitcherScoring : null,
    sourceMetadata: {
      verified: true,
      sourceLabel: 'SABR Lahman Baseball Database 2025 + Baseball-Reference daily WAR data',
      sourceUrl: 'https://sabr.org/lahman-database/',
      advancedStatsSourceUrls: advancedStatsSourceUrls.filter(Boolean),
      verifiedAt,
      lahmanTeamIds: row.lahmanTeamIds,
      sourcePlayerId: row.playerId,
    },
    sourceNotes: `SABR Lahman 2025 counting stats and Baseball-Reference season-level WAR/OPS+/ERA+ for ${row.season}.`,
    notes: overrides.notes?.[key] ?? null,
    manualPositionOverride: candidate.manualPositionOverride,
    selectionMetadata: { score: candidate.selectionScore, formulaVersion: 'advanced-season-selection-v2' },
  }
}

function selectPoolCards(cards) {
  const selected = new Set()
  const byScore = [...cards].sort((a, b) => b.selectionMetadata.score - a.selectionMetadata.score || a.name.localeCompare(b.name))
  for (const position of [...FIELD_POSITIONS, 'SP', 'RP']) {
    const target = position === 'SP' ? 5 : 3
    byScore.filter((card) => card.eligiblePositions.includes(position)).slice(0, target).forEach((card) => selected.add(card.id))
  }
  for (const card of byScore) {
    if (selected.size >= 28) break
    selected.add(card.id)
  }
  const protectedIds = new Set()
  for (const position of [...FIELD_POSITIONS, 'SP', 'RP']) {
    const target = position === 'SP' ? 3 : position === 'RP' ? 2 : 1
    byScore.filter((card) => card.eligiblePositions.includes(position)).slice(0, target).forEach((card) => protectedIds.add(card.id))
  }
  if (selected.size > 35) {
    const keep = [...protectedIds, ...byScore.filter((card) => selected.has(card.id) && !protectedIds.has(card.id)).map((card) => card.id)]
    return keep.slice(0, 35).map((id) => cards.find((card) => card.id === id))
  }
  return byScore.filter((card) => selected.has(card.id))
}

export function buildPools({ seasonRows, fieldingRows, advancedRows = [], config, overrides }) {
  const advancedBySeason = new Map(advancedRows.map(normalizeAdvancedRow).map((row) => [fieldKey(row.franchiseId, row.season, row.playerId), row]))
  const normalizedSeasons = seasonRows.map(normalizeSeasonRow).map((row) => ({
    ...row,
    battingWar: advancedBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId))?.battingWar ?? null,
    opsPlus: advancedBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId))?.opsPlus ?? null,
    pitchingWar: advancedBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId))?.pitchingWar ?? null,
    eraPlus: advancedBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId))?.eraPlus ?? null,
    battingAdvancedSourceUrl: advancedBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId))?.battingSourceUrl ?? null,
    pitchingAdvancedSourceUrl: advancedBySeason.get(fieldKey(row.franchiseId, row.season, row.playerId))?.pitchingSourceUrl ?? null,
  }))
  const normalizedFielding = fieldingRows.map(normalizeFieldingRow)
  const fieldingBySeason = new Map()
  for (const row of normalizedFielding) {
    const key = fieldKey(row.franchiseId, row.season, row.playerId)
    fieldingBySeason.set(key, [...(fieldingBySeason.get(key) ?? []), row])
  }
  const groups = new Map()
  for (const row of normalizedSeasons) {
    const key = cardKey(row.franchiseId, row.decade, row.playerId)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const allCards = []
  for (const rows of groups.values()) {
    const candidate = selectBestSeason(rows, fieldingBySeason, overrides)
    if (candidate) allCards.push(candidateToCard(candidate, overrides))
  }
  const pools = {}
  const combinations = []
  for (const franchise of config.franchises) {
    for (const decade of config.decades) {
      const id = `${franchise.id}-${decade.id}`
      const cards = allCards.filter((card) => card.franchiseId === franchise.id && card.decade === decade.id)
      if (!cards.length) continue
      pools[id] = selectPoolCards(cards)
      combinations.push({ id, franchiseId: franchise.id, team: franchise.abbreviation, teamName: franchise.poolName, decade: decade.id })
    }
  }
  return { pools, combinations }
}

function poolCanComplete(cards) {
  const cardToSlot = new Map()
  const canFill = (card, position) => position === 'DH'
    ? card.playerType === 'hitter' || card.playerType === 'twoWay'
    : card.eligiblePositions.includes(position)
  const assign = (slotIndex, seen) => {
    for (const card of cards) {
      if (!canFill(card, REQUIRED_ROSTER[slotIndex]) || seen.has(card.id)) continue
      seen.add(card.id)
      const previous = cardToSlot.get(card.id)
      if (previous === undefined || assign(previous, seen)) { cardToSlot.set(card.id, slotIndex); return true }
    }
    return false
  }
  return REQUIRED_ROSTER.every((_, index) => assign(index, new Set()))
}

export function validateBuiltData({ pools, combinations }, config) {
  const errors = []; const warnings = []; const ids = new Set()
  const franchises = new Map(config.franchises.map((franchise) => [franchise.id, franchise]))
  const decades = new Map(config.decades.map((decade) => [decade.id, decade]))
  for (const combination of combinations) {
    const cards = pools[combination.id]
    const franchise = franchises.get(combination.franchiseId)
    const decade = decades.get(combination.decade)
    if (!franchise) { errors.push({ pool: combination.id, message: 'Invalid franchise ID' }); continue }
    if (!decade) { errors.push({ pool: combination.id, message: 'Invalid decade' }); continue }
    if (!cards) { errors.push({ pool: combination.id, message: 'Missing pool file' }); continue }
    if (!poolCanComplete(cards)) errors.push({ pool: combination.id, message: 'Pool cannot complete the 14-slot roster' })
    for (const card of cards) {
      if (ids.has(card.id)) errors.push({ pool: combination.id, card: card.id, message: 'Duplicate card ID' })
      ids.add(card.id)
      if (!card.name?.trim()) errors.push({ pool: combination.id, card: card.id, message: 'Missing name' })
      if (card.franchiseId !== combination.franchiseId) errors.push({ pool: combination.id, card: card.id, message: 'Card franchise does not match pool' })
      if (card.decade !== combination.decade) errors.push({ pool: combination.id, card: card.id, message: 'Card decade does not match pool' })
      if (card.featuredSeason < decade.startYear || card.featuredSeason > decade.endYear) errors.push({ pool: combination.id, card: card.id, message: 'Featured season outside decade' })
      if (!card.sourceMetadata?.lahmanTeamIds?.every((teamId) => franchise.lahmanTeamIds.includes(teamId))) errors.push({ pool: combination.id, card: card.id, message: 'Featured season not associated with franchise' })
      if (card.eligiblePositions.some((position) => !VALID_POSITIONS.has(position))) errors.push({ pool: combination.id, card: card.id, message: 'Invalid position' })
      if (!card.visibleStats || !card.scoringStats) errors.push({ pool: combination.id, card: card.id, message: 'Missing required stat object' })
      if (card.playerType === 'hitter' && 'era' in card.visibleStats) errors.push({ pool: combination.id, card: card.id, message: 'Hitter has pitcher-only stat shape' })
      if (card.playerType === 'pitcher' && 'avg' in card.visibleStats) errors.push({ pool: combination.id, card: card.id, message: 'Pitcher has hitter-only stat shape' })
      if (card.sourceMetadata?.verified) {
        const hitterStats = card.playerType === 'pitcher' ? null : card.visibleStats
        const pitcherStats = card.playerType === 'pitcher' ? card.visibleStats : card.playerType === 'twoWay' ? card.pitchingVisibleStats : null
        for (const key of hitterStats ? ['war', 'opsPlus', 'hr', 'avg'] : []) {
          if (hitterStats[key] === null || hitterStats[key] === undefined) errors.push({ pool: combination.id, card: card.id, message: `Verified modern hitter missing required ${key}` })
        }
        for (const key of pitcherStats ? ['war', 'eraPlus', 'era', 'whip'] : []) {
          if (pitcherStats[key] === null || pitcherStats[key] === undefined) errors.push({ pool: combination.id, card: card.id, message: `Verified modern pitcher missing required ${key}` })
        }
        if (!card.sourceMetadata.advancedStatsSourceUrls?.length) errors.push({ pool: combination.id, card: card.id, message: 'Verified modern card missing advanced-stat source metadata' })
      }
      if (!card.sourceMetadata?.verified) warnings.push({ pool: combination.id, card: card.id, message: 'Unverified card' })
      if (card.manualPositionOverride) warnings.push({ pool: combination.id, card: card.id, message: 'Manual position override' })
      if (card.playerType !== 'pitcher' && (card.scoringStats.plateAppearances ?? 0) < THRESHOLDS.veryLowHitterPlateAppearances) warnings.push({ pool: combination.id, card: card.id, message: 'Very low hitter playing time' })
      if (card.playerType === 'pitcher' && (card.scoringStats.inningsPitched ?? 0) < THRESHOLDS.veryLowPitcherInnings) warnings.push({ pool: combination.id, card: card.id, message: 'Very low pitcher playing time' })
      const secondary = card.playerType === 'pitcher' ? ['so', 'wins', 'sv'] : ['obp', 'slg', 'rbi', 'sb']
      secondary.filter((key) => card.visibleStats[key] === null).forEach((key) => warnings.push({ pool: combination.id, card: card.id, message: `Missing secondary ${key}` }))
    }
    for (const position of FIELD_POSITIONS) {
      const count = cards.filter((card) => card.eligiblePositions.includes(position)).length
      if (count === 0) errors.push({ pool: combination.id, message: `No ${position} option` })
      else if (count < 3) warnings.push({ pool: combination.id, message: `Only ${count} ${position} option${count === 1 ? '' : 's'}` })
    }
    const starters = cards.filter((card) => card.eligiblePositions.includes('SP')).length
    const relievers = cards.filter((card) => card.eligiblePositions.includes('RP')).length
    if (starters < 3) errors.push({ pool: combination.id, message: `Only ${starters} SP options` })
    else if (starters < 5) warnings.push({ pool: combination.id, message: `Only ${starters} SP options; target is 5` })
    if (relievers < 2) errors.push({ pool: combination.id, message: `Only ${relievers} RP options` })
    else if (relievers < 3) warnings.push({ pool: combination.id, message: `Only ${relievers} RP options; target is 3` })
  }
  return { errors, warnings, summary: { pools: combinations.length, cards: Object.values(pools).flat().length } }
}

export function readInputs(root) {
  return {
    seasonRows: parseCsv(readFileSync(join(root, 'data-import/season-stats.csv'), 'utf8')),
    fieldingRows: parseCsv(readFileSync(join(root, 'data-import/fielding-appearances.csv'), 'utf8')),
    advancedRows: parseCsv(readFileSync(join(root, 'data-import/advanced-season-stats.csv'), 'utf8')),
    config: JSON.parse(readFileSync(join(root, 'data-import/pool-config.json'), 'utf8')),
    overrides: JSON.parse(readFileSync(join(root, 'data-import/manual-overrides.json'), 'utf8')),
  }
}

export function readBuiltData(root) {
  const mlbDir = join(root, 'src/data/mlb')
  const combinations = JSON.parse(readFileSync(join(mlbDir, 'pool-index.json'), 'utf8'))
  const pools = Object.fromEntries(combinations.map((combination) => [
    combination.id,
    JSON.parse(readFileSync(join(mlbDir, 'pools', `${combination.id}.json`), 'utf8')),
  ]))
  return { combinations, pools }
}

export function writeBuiltData(root, built, report) {
  const mlbDir = join(root, 'src/data/mlb')
  const poolsDir = join(mlbDir, 'pools')
  mkdirSync(poolsDir, { recursive: true })
  for (const filename of readdirSync(poolsDir).filter((name) => name.endsWith('.json'))) {
    rmSync(join(poolsDir, filename))
  }
  for (const [id, cards] of Object.entries(built.pools)) writeFileSync(join(poolsDir, `${id}.json`), `${JSON.stringify(cards, null, 2)}\n`)
  writeFileSync(join(mlbDir, 'pool-index.json'), `${JSON.stringify(built.combinations, null, 2)}\n`)
  writeFileSync(join(root, 'data-import/validation-report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const imports = built.combinations.map((combination, index) => `import pool${index} from './pools/${combination.id}.json'`).join('\n')
  const entries = built.combinations.map((combination, index) => `  '${combination.id}': pool${index} as unknown as PlayerCard[],`).join('\n')
  writeFileSync(join(mlbDir, 'index.ts'), `${imports}\nimport combinations from './pool-index.json'\nimport type { PlayerCard, TeamDecade } from '../../types/draft'\n\nexport const PLAYER_POOLS: Readonly<Record<string, readonly PlayerCard[]>> = {\n${entries}\n}\n\nexport const TEAM_DECADES = combinations as TeamDecade[]\nexport const PLAYER_CARDS = Object.values(PLAYER_POOLS).flat()\n`)
}

export function formatReport(report) {
  const grouped = new Map()
  for (const issue of [...report.errors.map((value) => ({ ...value, level: 'ERROR' })), ...report.warnings.map((value) => ({ ...value, level: 'WARN' }))]) {
    grouped.set(issue.pool ?? 'global', [...(grouped.get(issue.pool ?? 'global') ?? []), issue])
  }
  const lines = [`Diamond Draft data report: ${report.summary.pools} pools, ${report.summary.cards} cards`, `Blocking errors: ${report.errors.length} · Warnings: ${report.warnings.length}`]
  for (const [pool, issues] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`\n${pool}`)
    const aggregatable = new Map()
    const detailed = []
    for (const issue of issues) {
      if (issue.message.startsWith('Missing optional ') || issue.message === 'Unverified card') {
        const key = `${issue.level}|${issue.message}`
        aggregatable.set(key, { ...issue, count: (aggregatable.get(key)?.count ?? 0) + 1 })
      } else detailed.push(issue)
    }
    for (const issue of aggregatable.values()) lines.push(`  ${issue.level} ${issue.message} (${issue.count} cards)`)
    detailed.forEach((issue) => lines.push(`  ${issue.level} ${issue.card ? `[${issue.card}] ` : ''}${issue.message}`))
  }
  return lines.join('\n')
}
