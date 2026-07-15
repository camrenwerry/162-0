import assert from 'node:assert/strict'
import { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from '../src/game/scoring/calculatePlayerValue'
import { calculateProjectedRecord, tierForWins } from '../src/game/scoring/calculateProjectedRecord'
import { calculateRosterGrades, gradeForScore } from '../src/game/scoring/calculateRosterGrades'
import { calculateDraftResult } from '../src/game/scoring/index'
import { normalizeMetric, weightedScore } from '../src/game/scoring/normalization'
import { NORMALIZATION_RANGES } from '../src/game/scoring/scoringConfig'
import { ROSTER_SLOTS, type Hitter, type Pitcher } from '../src/types/draft'
import { fixturePlayer, fixtureRoster, historicalPeakRoster } from './lib/scoring-fixtures'

const weak = calculateDraftResult(fixtureRoster('weak', 'weak')).result
const averageCalculation = calculateDraftResult(fixtureRoster('average', 'average'))
const average = averageCalculation.result
const strongCalculation = calculateDraftResult(fixtureRoster('strong', 'strong'))
const strong = strongCalculation.result
const perfectCalculation = calculateDraftResult(fixtureRoster('perfect', 'perfect'))
const perfect = perfectCalculation.result
const historicalPeakCalculation = calculateDraftResult(historicalPeakRoster())
const attainableHistoricalPerfect = historicalPeakCalculation.result

assert.deepEqual(calculateDraftResult(fixtureRoster('strong', 'strong')).result, strong, 'the same roster must always return the same payload')
for (const result of [weak, average, strong, perfect]) assert.equal(result.wins + result.losses, 162)
assert(weak.wins <= average.wins && average.wins <= strong.wins && strong.wins <= perfect.wins, 'clearly better rosters must not project fewer wins')
assert(historicalPeakCalculation.diagnostics.perfectRequirementsMet, 'the generated historical peak roster must pass the category and player requirements')
assert.equal(historicalPeakCalculation.diagnostics.projectedWinsBeforePerfectCheck, 152, 'the generated historical peak roster must reach the perfect gate through the ordinary curve')
assert.equal(attainableHistoricalPerfect.wins, 162, 'the extraordinary generated historical peak roster must be able to reach 162 wins')

const historicalScores = historicalPeakCalculation.diagnostics.categoryScores
const historicalPlayers = historicalPeakCalculation.diagnostics.playerValues
const singleCategoryFailures = [
  { ...historicalScores, overall: 94.9 },
  { ...historicalScores, offense: 94.4 },
  { ...historicalScores, defense: 84.9 },
  { ...historicalScores, startingPitching: 93.9 },
  { ...historicalScores, reliefPitching: 94.9 },
  { ...historicalScores, rosterBalance: 92.9 },
]
for (const scores of singleCategoryFailures) {
  const projection = calculateProjectedRecord(scores, historicalPlayers)
  assert.equal(projection.perfectRequirementsMet, false, 'failing any single perfect category threshold must prevent 162')
  assert.equal(projection.wins, projection.winsBeforePerfectCheck, 'a failed perfect category must retain its ordinary projection')
}
const weakestPlayerFailure = historicalPlayers.map((player, index) => index === 0 ? { ...player, value: 87.9 } : player)
const weakestPlayerProjection = calculateProjectedRecord(historicalScores, weakestPlayerFailure)
assert.equal(weakestPlayerProjection.perfectRequirementsMet, false)
assert.equal(weakestPlayerProjection.wins, weakestPlayerProjection.winsBeforePerfectCheck, 'failing the weakest-player threshold must retain the ordinary projection')
assert(strong.wins - weak.wins >= 60, 'fixture records must use a meaningfully wide range')

const eliteOffenseBadPitching = calculateDraftResult(fixtureRoster('perfect', 'weak')).result
const elitePitchingBadOffense = calculateDraftResult(fixtureRoster('weak', 'perfect')).result
assert(eliteOffenseBadPitching.wins < strong.wins, 'elite offense must not hide terrible pitching')
assert(elitePitchingBadOffense.wins < strong.wins, 'elite pitching must not hide terrible offense')
assert.notEqual(eliteOffenseBadPitching.wins, 162)
assert.notEqual(elitePitchingBadOffense.wins, 162)

const weakDefense = calculateDraftResult(fixtureRoster('perfect', 'perfect', -30)).result
assert.notEqual(weakDefense.wins, 162, 'weak defense must prevent perfection')
assert(weakDefense.categoryScores.defense < perfect.categoryScores.defense)

const missingDefenseRoster = fixtureRoster('average', 'average')
for (const slot of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const) {
  const player = missingDefenseRoster[slot]
  assert(player?.playerType === 'hitter')
  missingDefenseRoster[slot] = { ...player, scoringStats: { ...player.scoringStats, defensiveValue: null } }
}
const missingDefenseResult = calculateDraftResult(missingDefenseRoster).result
assert(missingDefenseResult.categoryScores.defense >= 65, 'missing defensive enrichment must use a neutral-confidence fallback')
assert.notEqual(missingDefenseResult.categoryGrades.defense, 'F')

const eliteHitters = calculateDraftResult(fixtureRoster('strong', 'average')).result
assert(eliteHitters.categoryScores.offense >= 90, `multiple elite hitters must generate elite offense; received ${eliteHitters.categoryScores.offense}`)
const elitePitchers = calculateDraftResult(fixtureRoster('average', 'strong')).result
assert(elitePitchers.categoryScores.startingPitching >= 90, 'three elite starters must generate elite starting pitching')
assert(elitePitchers.categoryScores.reliefPitching >= 90, `two elite relievers must generate elite relief pitching; received ${elitePitchers.categoryScores.reliefPitching}`)

const slowEliteRoster = fixtureRoster('perfect', 'average')
for (const slot of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const) {
  const player = slowEliteRoster[slot]
  assert(player?.playerType === 'hitter')
  slowEliteRoster[slot] = {
    ...player,
    visibleStats: { ...player.visibleStats, sb: 0 }, stats: { ...player.stats, sb: 0 },
    scoringStats: { ...player.scoringStats, baserunningValue: -6 },
  }
}
const slowEliteResult = calculateDraftResult(slowEliteRoster).result
assert(['A', 'A+', 'S'].includes(slowEliteResult.categoryGrades.offense), 'a slow dominant lineup must retain an elite offense grade')

const oneSuperstarRoster = fixtureRoster('weak', 'weak')
const weakCenterFielder = oneSuperstarRoster.CF
assert(weakCenterFielder)
oneSuperstarRoster.CF = fixturePlayer(weakCenterFielder, 'perfect')
const oneSuperstarResult = calculateDraftResult(oneSuperstarRoster).result
assert(oneSuperstarResult.wins < 100, 'one superstar cannot carry eight weak hitters and weak pitching')
assert.notEqual(oneSuperstarResult.wins, 162)

const slowRoster = fixtureRoster('strong', 'strong')
const fastCenterFielder = slowRoster.CF
assert(fastCenterFielder?.playerType === 'hitter')
slowRoster.CF = {
  ...fastCenterFielder,
  visibleStats: { ...fastCenterFielder.visibleStats, sb: 0 },
  stats: { ...fastCenterFielder.stats, sb: 0 },
  scoringStats: { ...fastCenterFielder.scoringStats, baserunningValue: -6 },
}
const slowResult = calculateDraftResult(slowRoster).result
assert(slowResult.categoryScores.offense < strong.categoryScores.offense, 'hidden speed must influence offense')
assert(slowResult.categoryScores.rosterBalance < strong.categoryScores.rosterBalance, 'hidden speed must influence roster balance')
assert(slowResult.overallScore < strong.overallScore, 'hidden speed must influence overall score')

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
assert(lowCoverage.score > 68 && lowCoverage.score < 90, 'insufficient coverage must blend toward neutral rather than treat missing metrics as zero')
assert(normalizeMetric(1.05, NORMALIZATION_RANGES.hitter.ops) > normalizeMetric(.72, NORMALIZATION_RANGES.hitter.ops))
assert(normalizeMetric(2, NORMALIZATION_RANGES.starter.era) > normalizeMetric(5, NORMALIZATION_RANGES.starter.era), 'lower-is-better normalization must be supported')

const exceptionalScores = { ...perfect.categoryScores, overall: 100, offense: 100, defense: 100, startingPitching: 100, reliefPitching: 100, rosterBalance: 100 }
const projectScore = (overall: number, overrides: Partial<typeof exceptionalScores> = {}) => calculateProjectedRecord(
  { ...exceptionalScores, overall, ...overrides },
  perfectCalculation.diagnostics.playerValues,
)

const preservedLowerAnchors = [
  [0, 55], [35, 58], [45, 65], [55, 74], [60, 78], [65, 81], [68, 87], [72, 93], [76, 99], [80, 105],
] as const
for (const [overall, expectedWins] of preservedLowerAnchors) assert.equal(projectScore(overall).wins, expectedWins, `overall ${overall} must preserve its v2.2 projection`)

const upperAnchors = [
  [84, 118], [88, 131], [92, 143], [95, 151], [97, 156], [98.5, 159], [99.5, 161],
] as const
for (const [overall, expectedWins] of upperAnchors) assert.equal(projectScore(overall).winsBeforePerfectCheck, expectedWins, `overall ${overall} must use the v2.3 upper curve`)

const qualifyingBelowThreshold = projectScore(95)
assert.equal(qualifyingBelowThreshold.winsBeforePerfectCheck, 151)
assert.equal(qualifyingBelowThreshold.perfectRequirementsMet, true)
assert.equal(qualifyingBelowThreshold.wins, 151, 'a qualifying roster below 152 curve wins must not be forced to 162')

const qualifyingExtraordinary = projectScore(95.4)
assert.equal(qualifyingExtraordinary.winsBeforePerfectCheck, 152)
assert.equal(qualifyingExtraordinary.perfectRequirementsMet, true)
assert.equal(qualifyingExtraordinary.wins, 162, 'a qualifying roster at 152+ curve wins may reach 162')
assert.equal(projectScore(100).wins, 162)

const nearPerfectRecords = [projectScore(97, { defense: 84 }), projectScore(99, { defense: 84 }), projectScore(100, { defense: 84 })]
assert.deepEqual(nearPerfectRecords.map(({ wins }) => wins), [156, 160, 161], 'non-qualifying near-perfect teams must be able to finish from 156 through 161')
for (const record of nearPerfectRecords) assert.equal(record.wins + record.losses, 162)

assert.equal(tierForWins(55), 'Rebuild')
assert.equal(tierForWins(75), 'Developing Club')
assert.equal(tierForWins(85), 'Competitive')
assert.equal(tierForWins(95), 'Playoff Contender')
assert.equal(tierForWins(105), 'Championship Contender')
assert.equal(tierForWins(115), 'World Series Favorite')
assert.equal(tierForWins(130), 'Historic Powerhouse')
assert.equal(tierForWins(145), 'All-Time Great')
assert.equal(tierForWins(156), 'Near Perfect')
assert.equal(tierForWins(162), 'Perfect Season')

for (const invalidOverall of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  const record = projectScore(invalidOverall)
  assert(Number.isInteger(record.wins) && Number.isInteger(record.losses), 'non-finite scores must still produce integer records')
  assert.equal(record.wins + record.losses, 162)
  assert(record.wins >= 55 && record.wins <= 162)
}

assert.equal(gradeForScore(100), 'S')
assert.equal(gradeForScore(94), 'A+')
assert.equal(gradeForScore(80), 'B')
assert.equal(gradeForScore(69), 'C')
assert.equal(gradeForScore(20), 'F')

assert.equal(strong.scoringVersion, '2.3')
assert.equal(Object.keys(strong.roster).length, ROSTER_SLOTS.length)
assert(strong.bestPlayerValue)
assert(strong.strongestCategory && strong.weakestCategory)
assert.equal(Object.keys(strong.categoryScores).length, 9)
assert.deepEqual(Object.keys(strong.categoryScores), Object.keys(strong.categoryGrades))
assert(new Set([weak.overallGrade, average.overallGrade, strong.overallGrade, perfect.overallGrade]).size >= 4, 'category grades must span a wider range')
for (const result of [weak, average, strong, perfect, missingDefenseResult, slowEliteResult, oneSuperstarResult]) {
  assert(Number.isInteger(result.wins) && Number.isInteger(result.losses))
  assert(Object.values(result.categoryScores).every(Number.isFinite), 'category scores must never contain NaN or Infinity')
  assert(Object.values(result.categoryGrades).every((grade) => ['F', 'D', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S'].includes(grade)), 'every category grade must be valid')
}
assert.equal(calculateProjectedRecord({ ...average.categoryScores, overall: 65 }, averageCalculation.diagnostics.playerValues).wins, 81)

assert.equal(weak.wins, 61, 'weak benchmark projection must remain unchanged')
assert.equal(average.wins, 88, 'average benchmark projection must remain unchanged')

console.log(`Scoring v2.3 tests passed: weak ${weak.wins}–${weak.losses}, average ${average.wins}–${average.losses}, strong ${strong.wins}–${strong.losses}, perfect fixture ${perfect.wins}–${perfect.losses}.`)
