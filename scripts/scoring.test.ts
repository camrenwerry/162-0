import assert from 'node:assert/strict'
import { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from '../src/game/scoring/calculatePlayerValue'
import { calculateProjectedRecord } from '../src/game/scoring/calculateProjectedRecord'
import { calculateRosterGrades, gradeForScore } from '../src/game/scoring/calculateRosterGrades'
import { calculateDraftResult } from '../src/game/scoring/index'
import { normalizeMetric, weightedScore } from '../src/game/scoring/normalization'
import { NORMALIZATION_RANGES } from '../src/game/scoring/scoringConfig'
import { TeamPool } from '../src/game/TeamPool'
import { ROSTER_SLOTS, type Hitter, type Pitcher, type Player, type Roster } from '../src/types/draft'

type FixtureLevel = 'weak' | 'average' | 'strong' | 'perfect'

const pool = new TeamPool()
const allPlayers = pool.getCombinations().flatMap((combination) => pool.getPlayers(combination))
const selectedIds = new Set<string>()
const baseRoster: Roster = {}

for (const slot of ROSTER_SLOTS) {
  const player = allPlayers.find((candidate) => {
    if (selectedIds.has(candidate.id)) return false
    if (slot.position === 'DH') return candidate.playerType === 'hitter'
    if (slot.position === 'SP' || slot.position === 'RP') return candidate.playerType === 'pitcher' && candidate.eligiblePositions.includes(slot.position)
    return candidate.playerType === 'hitter' && candidate.eligiblePositions.includes(slot.position)
  })
  assert(player, `fixture player missing for ${slot.id}`)
  baseRoster[slot.id] = player
  selectedIds.add(player.id)
}

const HITTER_FIXTURES = {
  weak: { war: -.5, opsPlus: 72, hr: 3, avg: .215, obp: .275, slg: .330, rbi: 30, sb: 1, games: 80, pa: 300, defense: -12, baserunning: -4 },
  average: { war: 2, opsPlus: 100, hr: 18, avg: .260, obp: .325, slg: .420, rbi: 75, sb: 8, games: 130, pa: 520, defense: 0, baserunning: 0 },
  strong: { war: 6, opsPlus: 140, hr: 38, avg: .315, obp: .400, slg: .560, rbi: 115, sb: 20, games: 155, pa: 680, defense: 10, baserunning: 5 },
  perfect: { war: 13, opsPlus: 230, hr: 70, avg: .390, obp: .520, slg: .800, rbi: 170, sb: 70, games: 162, pa: 750, defense: 30, baserunning: 14 },
} as const

const PITCHER_FIXTURES = {
  weak: { war: -.5, eraPlus: 72, era: 5.8, whip: 1.62, soRate: 4, wins: 4, saves: 1, innings: 90, starts: 18, relief: 22, fip: 5.7, walkRate: 5 },
  average: { war: 2, eraPlus: 100, era: 4.2, whip: 1.3, soRate: 7, wins: 10, saves: 10, innings: 155, starts: 27, relief: 45, fip: 4.2, walkRate: 3 },
  strong: { war: 6, eraPlus: 155, era: 2.65, whip: 1, soRate: 11, wins: 20, saves: 40, innings: 220, starts: 33, relief: 72, fip: 2.6, walkRate: 2 },
  perfect: { war: 12, eraPlus: 260, era: 1.1, whip: .65, soRate: 17, wins: 28, saves: 60, innings: 280, starts: 37, relief: 92, fip: 1.1, walkRate: 1 },
} as const

function fixturePlayer(player: Player, level: FixtureLevel, defenseOverride?: number): Player {
  if (player.playerType === 'hitter') {
    const fixture = HITTER_FIXTURES[level]
    return {
      ...player,
      visibleStats: { war: fixture.war, opsPlus: fixture.opsPlus, ops: fixture.obp + fixture.slg, hr: fixture.hr, avg: fixture.avg, obp: fixture.obp, slg: fixture.slg, rbi: fixture.rbi, sb: fixture.sb, games: fixture.games, plateAppearances: fixture.pa },
      stats: { war: fixture.war, opsPlus: fixture.opsPlus, ops: fixture.obp + fixture.slg, hr: fixture.hr, avg: fixture.avg, obp: fixture.obp, slg: fixture.slg, rbi: fixture.rbi, sb: fixture.sb, games: fixture.games, plateAppearances: fixture.pa },
      scoringStats: {
        ...player.scoringStats,
        obp: fixture.obp, slg: fixture.slg, wrcPlus: fixture.opsPlus, games: fixture.games, plateAppearances: fixture.pa,
        defensiveValue: defenseOverride ?? fixture.defense, baserunningValue: fixture.baserunning, eraAdjustedOffense: fixture.opsPlus,
      },
    }
  }
  assert.equal(player.playerType, 'pitcher')
  const fixture = PITCHER_FIXTURES[level]
  const isStarter = player.eligiblePositions.includes('SP')
  const innings = isStarter ? fixture.innings : Math.min(fixture.innings, level === 'perfect' ? 100 : 75)
  const starts = isStarter ? fixture.starts : 0
  const reliefAppearances = isStarter ? Math.min(fixture.relief, 5) : fixture.relief
  const stats = {
    war: fixture.war, eraPlus: fixture.eraPlus, era: fixture.era, whip: fixture.whip,
    so: Math.round(innings * fixture.soRate / 9), wins: fixture.wins, saves: fixture.saves, sv: fixture.saves,
    inningsPitched: innings, games: starts + reliefAppearances, starts, reliefAppearances,
    k9: fixture.soRate, bb9: fixture.walkRate,
  }
  return {
    ...player,
    visibleStats: stats,
    stats,
    scoringStats: {
      ...player.scoringStats,
      whip: fixture.whip, fip: fixture.fip, inningsPitched: innings, strikeoutRate: fixture.soRate,
      walkRate: fixture.walkRate, starts, gamesStarted: starts, games: starts + reliefAppearances,
      reliefAppearances, eraAdjustedPitching: fixture.eraPlus,
    },
  }
}

function fixtureRoster(hitterLevel: FixtureLevel, pitcherLevel: FixtureLevel, defenseOverride?: number): Roster {
  return Object.fromEntries(Object.entries(baseRoster).map(([slotId, player]) => [
    slotId,
    fixturePlayer(player, player.playerType === 'hitter' ? hitterLevel : pitcherLevel, defenseOverride),
  ])) as Roster
}

const weak = calculateDraftResult(fixtureRoster('weak', 'weak')).result
const average = calculateDraftResult(fixtureRoster('average', 'average')).result
const strongCalculation = calculateDraftResult(fixtureRoster('strong', 'strong'))
const strong = strongCalculation.result
const perfectCalculation = calculateDraftResult(fixtureRoster('perfect', 'perfect'))
const perfect = perfectCalculation.result

assert.deepEqual(calculateDraftResult(fixtureRoster('strong', 'strong')).result, strong, 'the same roster must always return the same payload')
for (const result of [weak, average, strong, perfect]) assert.equal(result.wins + result.losses, 162)
assert(weak.wins <= average.wins && average.wins <= strong.wins && strong.wins <= perfect.wins, 'clearly better rosters must not project fewer wins')

const eliteOffenseBadPitching = calculateDraftResult(fixtureRoster('perfect', 'weak')).result
const elitePitchingBadOffense = calculateDraftResult(fixtureRoster('weak', 'perfect')).result
assert(eliteOffenseBadPitching.wins < strong.wins, 'elite offense must not hide terrible pitching')
assert(elitePitchingBadOffense.wins < strong.wins, 'elite pitching must not hide terrible offense')
assert.notEqual(eliteOffenseBadPitching.wins, 162)
assert.notEqual(elitePitchingBadOffense.wins, 162)

const weakDefense = calculateDraftResult(fixtureRoster('perfect', 'perfect', -30)).result
assert.notEqual(weakDefense.wins, 162, 'weak defense must prevent perfection')
assert(weakDefense.categoryScores.defense < perfect.categoryScores.defense)

const dhPlayer = fixtureRoster('strong', 'strong').DH
assert(dhPlayer?.playerType === 'hitter')
const eliteDhDefense = calculateHitterValue({ ...dhPlayer, scoringStats: { ...dhPlayer.scoringStats, defensiveValue: 30 } }, 'DH', 'DH')
const poorDhDefense = calculateHitterValue({ ...dhPlayer, scoringStats: { ...dhPlayer.scoringStats, defensiveValue: -30 } }, 'DH', 'DH')
assert.equal(eliteDhDefense.value, poorDhDefense.value, 'DH must exclude defensive value')
assert.equal(eliteDhDefense.facets.defense, 0)

const oneWeakStarter = fixtureRoster('strong', 'strong')
oneWeakStarter.SP3 = fixturePlayer(oneWeakStarter.SP3 as Pitcher, 'weak')
const oneWeakReliever = fixtureRoster('strong', 'strong')
oneWeakReliever.RP2 = fixturePlayer(oneWeakReliever.RP2 as Pitcher, 'weak')
assert(calculateDraftResult(oneWeakStarter).result.categoryScores.startingPitching < strong.categoryScores.startingPitching, 'all three SP slots must contribute')
assert(calculateDraftResult(oneWeakReliever).result.categoryScores.reliefPitching < strong.categoryScores.reliefPitching, 'both RP slots must contribute')
assert(calculateStartingPitcherValue(fixtureRoster('strong', 'strong').SP1 as Pitcher, 'SP1').value > calculateStartingPitcherValue(fixtureRoster('strong', 'weak').SP1 as Pitcher, 'SP1').value)
assert(calculateReliefPitcherValue(fixtureRoster('strong', 'strong').RP1 as Pitcher, 'RP1').value > calculateReliefPitcherValue(fixtureRoster('strong', 'weak').RP1 as Pitcher, 'RP1').value)
assert.equal(calculateRosterGrades(fixtureRoster('strong', 'strong')).playerValues.length, ROSTER_SLOTS.length)

const hitter = fixtureRoster('strong', 'strong').CF
assert(hitter?.playerType === 'hitter')
const missingWarStats = { ...hitter.visibleStats, war: null }
const missingWarHitter: Hitter = { ...hitter, visibleStats: missingWarStats, stats: missingWarStats }
const missingWarValue = calculateHitterValue(missingWarHitter, 'CF', 'CF')
assert(!missingWarValue.components.some(({ metric }) => metric === 'WAR'), 'null WAR must be omitted rather than scored as zero')
assert(Math.abs(missingWarValue.components.reduce((total, component) => total + component.appliedWeight, 0) - 1) < .00001, 'available weights must rebalance to 100%')
assert(missingWarValue.value > 50, 'a strong hitter with one missing metric should remain strong')
const lowCoverage = weightedScore([{ metric: 'only metric', rawValue: 1, normalizedValue: 90, configuredWeight: .1 }])
assert(lowCoverage.score > 50 && lowCoverage.score < 90, 'insufficient coverage must blend toward neutral rather than treat missing metrics as zero')
assert(normalizeMetric(1.05, NORMALIZATION_RANGES.hitter.ops) > normalizeMetric(.72, NORMALIZATION_RANGES.hitter.ops))
assert(normalizeMetric(2, NORMALIZATION_RANGES.starter.era) > normalizeMetric(5, NORMALIZATION_RANGES.starter.era), 'lower-is-better normalization must be supported')

const exceptionalScores = { ...perfect.categoryScores, overall: 100, offense: 100, defense: 100, startingPitching: 100, reliefPitching: 100, rosterBalance: 100 }
assert.equal(calculateProjectedRecord(exceptionalScores, perfectCalculation.diagnostics.playerValues).wins, 162)
assert.notEqual(calculateProjectedRecord({ ...exceptionalScores, defense: 97 }, perfectCalculation.diagnostics.playerValues).wins, 162)

assert.equal(gradeForScore(100), 'S')
assert.equal(gradeForScore(94), 'A+')
assert.equal(gradeForScore(80), 'B')
assert.equal(gradeForScore(69), 'C+')
assert.equal(gradeForScore(20), 'F')

assert.equal(strong.scoringVersion, '2.0')
assert.equal(Object.keys(strong.roster).length, ROSTER_SLOTS.length)
assert(strong.bestPlayerValue)
assert(strong.strongestCategory && strong.weakestCategory)
assert.equal(Object.keys(strong.categoryScores).length, 9)
assert.deepEqual(Object.keys(strong.categoryScores), Object.keys(strong.categoryGrades))

console.log(`Scoring v2.0 tests passed: weak ${weak.wins}–${weak.losses}, average ${average.wins}–${average.losses}, strong ${strong.wins}–${strong.losses}, perfect fixture ${perfect.wins}–${perfect.losses}.`)
