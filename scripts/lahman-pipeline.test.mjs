import assert from 'node:assert/strict'
import fs from 'node:fs'
import { aggregateAppearances, aggregateRows, buildCandidate, buildLahmanData, canCompleteRoster, curatePool, FIELD_POSITIONS, hitterStats, parseCsv, POSITION_ORDER, selectFeatured, validateGeneratedData, validatePool } from './lib/lahman-pipeline.mjs'

assert.deepEqual(parseCsv('id,name\n1,"Last, First"\n'), [{ id: '1', name: 'Last, First' }])

const franchise = { franchiseId: 'test', team: 'TST', teamName: 'Test Club' }
const teamByYear = new Map([
  ['2001:A', { teamID: 'A', name: 'Old Test Club', franchise }],
  ['2001:B', { teamID: 'B', name: 'New Test Club', franchise }],
])
const battingRows = [
  { playerID: 'player01', yearID: '2001', teamID: 'A', lgID: 'AL', G: '20', AB: '50', H: '15', '2B': '2', '3B': '0', HR: '3', RBI: '9', SB: '2', BB: '5', HBP: '0', SF: '1', SH: '0' },
  { playerID: 'player01', yearID: '2001', teamID: 'B', lgID: 'AL', G: '30', AB: '100', H: '35', '2B': '6', '3B': '1', HR: '5', RBI: '20', SB: '4', BB: '10', HBP: '1', SF: '2', SH: '0' },
]
const aggregated = aggregateRows(battingRows, teamByYear, 'batting').get('player01:test:2001')
assert(aggregated, 'same-franchise stints should aggregate to one season')
assert.equal(aggregated.AB, 150)
assert.equal(aggregated.HR, 8)
assert.equal(aggregated.teamRows.size, 2)
const visible = hitterStats(aggregated, { ops: .75 })
assert.equal(visible.games, 50)
assert.equal(visible.plateAppearances, 169)
assert.equal(visible.hr, 8)

const testPlayer = { playerID: 'player01', bbrefID: 'player01', nameFirst: 'Test', nameLast: 'Hitter', bats: 'R', throws: 'R' }
const testConfig = {
  eligibility: {
    minimumHitterPlateAppearances: 100, minimumPitcherInnings: 30, minimumFieldingGames: 5,
    minimumSelectionFieldingGames: 10, minimumDhGames: 10,
    minimumStarts: 10, minimumReliefAppearances: 15,
  },
  selection: {
    hitter: { eraAdjustedOps: .45, ops: .22, plateAppearances: .08, homeRunRate: .08, rbiRate: .06, stolenBaseRate: .03, positionValue: .08 },
    starter: { eraAdjustedRunPrevention: .38, whip: .18, strikeoutsPerNine: .14, walksPerNine: .08, innings: .14, starts: .08 },
    reliever: { eraAdjustedRunPrevention: .32, whip: .18, strikeoutsPerNine: .16, walksPerNine: .08, reliefAppearances: .12, saves: .14 },
  },
}
const testContext = new Map([['2001:AL', { ops: .75, era: 4.5 }]])
const emptyOverrides = { featuredSeasons: {}, positions: {}, names: {}, notes: {} }
const candidateFrom = (positions, pitching = null) => buildCandidate({
  player: testPlayer, franchise, year: 2001, batting: aggregated, pitching, positions,
  context: testContext, config: testConfig, overrides: emptyOverrides,
})
const appearanceRow = (teamID, G_dh) => ({
  yearID: '2001', teamID, playerID: 'player01', G_c: '', G_1b: '', G_2b: '', G_3b: '', G_ss: '',
  G_lf: '', G_cf: '', G_rf: '', G_dh,
})
const dhAppearances = aggregateAppearances([appearanceRow('A', '6'), appearanceRow('B', '4')], teamByYear).get('player01:test:2001')
assert(dhAppearances)
assert.equal(dhAppearances.get('DH'), 10, 'same-franchise G_dh stints must aggregate before eligibility')
const dhOnly = candidateFrom(dhAppearances)
assert(dhOnly, 'ten DH games and sufficient plate appearances must create a hitter candidate')
assert.equal(dhOnly.playerType, 'hitter')
assert.deepEqual(dhOnly.eligiblePositions, ['DH'])
assert.equal(dhOnly.hitter.plateAppearances, 169)
const belowDhThreshold = aggregateAppearances([appearanceRow('A', '5'), appearanceRow('B', '4')], teamByYear).get('player01:test:2001')
assert.equal(candidateFrom(belowDhThreshold), null, 'fewer than ten DH games must not grant hitter eligibility')
const nonDhBoundary = candidateFrom(new Map([['RF', 10], ['DH', 9]]))
assert(nonDhBoundary)
assert.deepEqual(nonDhBoundary.eligiblePositions, ['RF'], 'DH support must not change non-DH position thresholds')
assert.deepEqual(nonDhBoundary.selectionEligiblePositions, ['RF'])

for (const position of FIELD_POSITIONS) {
  const primary = position === '1B' ? '3B' : '1B'
  const atFive = candidateFrom(new Map([[primary, 10], [position, 5]]))
  const atFour = candidateFrom(new Map([[primary, 10], [position, 4]]))
  assert(atFive && atFour)
  assert(atFive.eligiblePositions.includes(position), `${position}: five featured-season games must grant card eligibility`)
  assert(!atFour.eligiblePositions.includes(position), `${position}: four featured-season games must not grant card eligibility`)
  assert(!atFive.selectionEligiblePositions.includes(position), `${position}: expanded eligibility must not alter the legacy selection position list`)
  assert.equal(atFive.selectionScore, atFour.selectionScore, `${position}: expanded eligibility must not alter player scoring`)
}

const earlierSeason = { ...candidateFrom(new Map([['1B', 10], ['3B', 5]])), featuredSeason: 2001, selectionScore: .7 }
const featuredSeason = { ...candidateFrom(new Map([['1B', 10], ['SS', 5]])), featuredSeason: 2002, selectionScore: .8 }
const featuredOnly = selectFeatured([earlierSeason, featuredSeason], { featuredSeasons: {} })[0]
assert.deepEqual(featuredOnly.eligiblePositions, ['1B', 'SS'], 'featured-season selection must not union positions from another season')
assert(!featuredOnly.eligiblePositions.includes('3B'), 'whole-career positions must not leak into the featured season')

const pitchingRows = [{
  playerID: 'player01', yearID: '2001', teamID: 'B', lgID: 'AL', W: '5', L: '2', G: '10', GS: '10', CG: '', SHO: '', SV: '0',
  IPouts: '150', H: '40', ER: '15', HR: '4', BB: '10', SO: '60', IBB: '', WP: '', HBP: '', BK: '', BFP: '', GF: '', R: '', SH: '', SF: '', GIDP: '',
}]
const aggregatedPitching = aggregateRows(pitchingRows, teamByYear, 'pitching').get('player01:test:2001')
assert(aggregatedPitching)
const pitchingBoundaryCandidate = (games, starts) => candidateFrom(new Map([['RF', 10]]), { ...aggregatedPitching, G: games, GS: starts })
assert.deepEqual(pitchingBoundaryCandidate(24, 9)?.eligiblePositions, ['RF', 'RP'], 'nine starts must not grant SP while fifteen relief appearances still grant RP')
assert.deepEqual(pitchingBoundaryCandidate(24, 10)?.eligiblePositions, ['RF', 'SP'], 'ten starts must grant SP while fourteen relief appearances do not grant RP')
assert.deepEqual(pitchingBoundaryCandidate(25, 10)?.eligiblePositions, ['RF', 'SP', 'RP'], 'SP/RP thresholds must remain ten starts and fifteen relief appearances')
const syntheticTwoWay = candidateFrom(new Map([['DH', 10]]), aggregatedPitching)
assert(syntheticTwoWay)
assert.equal(syntheticTwoWay.playerType, 'twoWay')
assert.equal(syntheticTwoWay.type, 'hitter')
assert.equal(syntheticTwoWay.isTwoWay, true)
assert.deepEqual(syntheticTwoWay.eligiblePositions, ['DH', 'SP'])
assert.deepEqual(syntheticTwoWay.selectionEligiblePositions, ['DH', 'SP'])
assert(syntheticTwoWay.hitter && syntheticTwoWay.pitcher, 'two-way candidates must preserve both stat records')

const candidate = (year, score) => ({ franchiseId: 'test', decade: '2000s', playerId: 'player01', featuredSeason: year, selectionScore: score })
assert.equal(selectFeatured([candidate(2001, .5), candidate(2004, .8)], { featuredSeasons: {} })[0].featuredSeason, 2004)
assert.equal(selectFeatured([candidate(2001, .5), candidate(2004, .8)], { featuredSeasons: { 'test-2000s-player01': 2001 } })[0].featuredSeason, 2001)

const poolCandidate = (id, score, eligiblePositions, playerType = 'hitter') => ({ id, name: id, selectionScore: score, eligiblePositions, playerType })
const curationCandidates = [
  poolCandidate('coverage-c', .8, ['C']),
  poolCandidate('score-fill-1', .7, ['1B']),
  poolCandidate('score-fill-2', .5, ['2B']),
  poolCandidate('coverage-sp', .4, ['SP'], 'pitcher'),
  poolCandidate('below-expansion-floor', .44, ['3B']),
]
const curationConfig = { coverage: { C: 1, SP: 1 }, pool: { minimumCards: 2, targetCards: 5, maximumCards: 6, minimumExpansionScore: .45 } }
const legacyCuration = curatePool(curationCandidates, { ...curationConfig, pool: { ...curationConfig.pool, targetCards: 2, maximumCards: 2 } })
const expandedCuration = curatePool(curationCandidates, curationConfig)
assert.deepEqual(legacyCuration.map(({ id }) => id).sort(), ['coverage-c', 'coverage-sp'])
assert(legacyCuration.every(({ id }) => expandedCuration.some((card) => card.id === id)), 'expansion must retain every legacy-core card')
assert.deepEqual(expandedCuration.map(({ id }) => id).sort(), ['coverage-c', 'coverage-sp', 'score-fill-1', 'score-fill-2'])
assert(!expandedCuration.some(({ id }) => id === 'below-expansion-floor'), 'score fill must stop below the configured expansion-quality floor')

const selectionTrackCuration = curatePool([
  { ...poolCandidate('public-only-c', .99, ['C', '1B']), selectionEligiblePositions: ['1B'] },
  { ...poolCandidate('legacy-c', .8, ['C']), selectionEligiblePositions: ['C'] },
  poolCandidate('legacy-sp', .7, ['SP'], 'pitcher'),
], { coverage: { C: 1, SP: 1 }, pool: { minimumCards: 2, targetCards: 2, maximumCards: 2 } })
assert.deepEqual(selectionTrackCuration.map(({ id }) => id).sort(), ['legacy-c', 'legacy-sp'], 'new public positions must not alter position-coverage selection')

const incompleteRosterPositions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'C', 'C', 'SP', 'SP', 'SP', 'RP', 'RP']
const rosterCompletionCandidates = [
  ...incompleteRosterPositions.map((position, index) => poolCandidate(`roster-core-${index}`, .9 - index * .01, [position], ['SP', 'RP'].includes(position) ? 'pitcher' : 'hitter')),
  poolCandidate('roster-completing-rf', .7, ['RF']),
  poolCandidate('unused-after-completion', .6, ['C']),
]
const completionCuration = curatePool(rosterCompletionCandidates, { coverage: {}, pool: { minimumCards: 14, targetCards: 14, maximumCards: 16 } })
assert.equal(completionCuration.length, 15, 'curation may exceed its target only far enough to complete a distinct-player roster')
assert(completionCuration.some(({ id }) => id === 'roster-completing-rf'))
assert(!completionCuration.some(({ id }) => id === 'unused-after-completion'), 'curation must stop immediately once the roster is completable')

const built = buildLahmanData(process.cwd())
const allCards = Object.values(built.pools).flat()
assert.deepEqual(built.config.pool, { minimumCards: 24, targetCards: 36, maximumCards: 40, minimumExpansionScore: .3 })
assert.deepEqual(built.config.eligibility, {
  minimumHitterPlateAppearances: 100, minimumPitcherInnings: 30, minimumFieldingGames: 5,
  minimumSelectionFieldingGames: 10, minimumDhGames: 10, minimumStarts: 10, minimumReliefAppearances: 15,
})
assert(built.combinations.length >= 150, 'complete Lahman generation should produce broad historical coverage')
assert(built.combinations.some(({ decade }) => decade === '1920s') && built.combinations.some(({ decade }) => decade === '2020s'))
for (const table of ['people', 'teams', 'teamFranchises', 'batting', 'pitching', 'fielding', 'appearances', 'legacyOutfield', 'outfieldSplits']) assert(built.report.summary.sourceRows[table] > 0, `${table} must be imported and reported`)
assert(Object.keys(built.pools).every((id) => built.combinations.some((combination) => combination.id === id)))
assert.equal(new Set(built.combinations.map(({ id }) => id)).size, built.combinations.length)
assert(built.report.excludedPools.length > 0, 'invalid historical pools should be reported rather than indexed')
assert(built.report.franchises.some(({ franchiseId, historicalNames }) => franchiseId === 'lad' && historicalNames.some((name) => name.includes('Brooklyn')) && historicalNames.some((name) => name.includes('Los Angeles'))), 'relocations must share a canonical franchise')

const sourceCandidate = (playerId, franchiseId, decade, year) => built.auditContext.candidates.find((value) => (
  value.playerId === playerId && value.franchiseId === franchiseId && value.decade === decade && value.featuredSeason === year
))
const featuredCandidate = (playerId, poolId) => built.auditContext.selected.find((value) => value.playerId === playerId && `${value.franchiseId}-${value.decade}` === poolId)
const playableCard = (playerId, poolId) => built.pools[poolId]?.find((value) => value.playerId === playerId)

const namedPositionCases = [
  ['machama01', 'bal-2010s', 2018, ['SS'], 'Manny Machado — Baltimore 2010s'],
  ['cabremi01', 'fla-2000s', 2006, ['3B'], 'Miguel Cabrera — Florida 2000s'],
  ['winfida01', 'sdp-1970s', 1979, ['RF'], 'Dave Winfield — San Diego 1970s'],
  ['thomeji01', 'cle-1990s', 1996, ['3B'], 'Jim Thome — Cleveland 1990s'],
  ['tatisfe02', 'sdp-2010s', 2019, ['SS'], 'Fernando Tatis Jr. — San Diego 2010s'],
  ['tatisfe02', 'sdp-2020s', 2021, ['SS', 'CF', 'RF'], 'Fernando Tatis Jr. — San Diego 2020s'],
]
for (const [playerId, poolId, year, positions, label] of namedPositionCases) {
  const card = playableCard(playerId, poolId)
  assert(card, `${label} must remain playable`)
  assert.equal(card.featuredSeason, year, `${label} must retain its featured season`)
  assert.deepEqual(card.eligiblePositions, positions, `${label} must use only its featured-season positions`)
}

const ohtani2018 = sourceCandidate('ohtansh01', 'ana', '2010s', 2018)
assert(ohtani2018)
assert.equal(ohtani2018.positionAppearances.DH, 82, 'Lahman G_dh must be aggregated into candidate position appearances')
assert.equal(ohtani2018.playerType, 'twoWay')
assert.deepEqual(ohtani2018.eligiblePositions, ['DH', 'SP'])
assert(ohtani2018.hitter && ohtani2018.pitcher)

const ohtaniAngels2010s = playableCard('ohtansh01', 'ana-2010s')
assert(ohtaniAngels2010s)
assert.equal(ohtaniAngels2010s.featuredSeason, 2018)
assert.equal(ohtaniAngels2010s.playerType, 'twoWay')
assert.deepEqual(ohtaniAngels2010s.eligiblePositions, ['DH', 'SP'])
assert(ohtaniAngels2010s.visibleStats.ops && ohtaniAngels2010s.pitchingVisibleStats?.era)

const ohtaniAngels2020s = playableCard('ohtansh01', 'ana-2020s')
assert(ohtaniAngels2020s)
assert.equal(ohtaniAngels2020s.featuredSeason, 2023, 'DH offense must participate in the unchanged featured-season formula')
assert.equal(ohtaniAngels2020s.playerType, 'twoWay')
assert.deepEqual(ohtaniAngels2020s.eligiblePositions, ['DH', 'SP'])

const ohtaniDodgers2024 = sourceCandidate('ohtansh01', 'lad', '2020s', 2024)
const ohtaniDodgers2025 = sourceCandidate('ohtansh01', 'lad', '2020s', 2025)
assert(ohtaniDodgers2024 && ohtaniDodgers2025)
assert.equal(ohtaniDodgers2024.playerType, 'hitter')
assert.deepEqual(ohtaniDodgers2024.eligiblePositions, ['DH'])
assert.equal(ohtaniDodgers2025.playerType, 'twoWay')
assert.deepEqual(ohtaniDodgers2025.eligiblePositions, ['DH', 'SP'])
assert.equal(featuredCandidate('ohtansh01', 'lad-2020s')?.featuredSeason, 2024)
const ohtaniDodgers2020s = playableCard('ohtansh01', 'lad-2020s')
assert(ohtaniDodgers2020s)
assert.equal(ohtaniDodgers2020s.featuredSeason, 2024)
assert.equal(ohtaniDodgers2020s.playerType, 'hitter')
assert.deepEqual(ohtaniDodgers2020s.eligiblePositions, ['DH'])

const dhHeavySeasons = [
  ['ortizda01', 'bos', '2010s', 2016, 'David Ortiz'],
  ['martied01', 'sea', '2000s', 2000, 'Edgar Martinez'],
  ['thomeji01', 'chw', '2000s', 2006, 'Jim Thome'],
  ['cruzne02', 'min', '2010s', 2019, 'Nelson Cruz'],
  ['thomafr04', 'oak', '2000s', 2006, 'Frank Thomas'],
]
for (const [playerId, franchiseId, decade, year, name] of dhHeavySeasons) {
  const dhCandidate = sourceCandidate(playerId, franchiseId, decade, year)
  assert(dhCandidate, `${name} must produce a source-qualified DH candidate`)
  assert.equal(dhCandidate.playerType, 'hitter', `${name} must not be misclassified as a pitcher`)
  assert.deepEqual(dhCandidate.eligiblePositions, ['DH'])
  assert(dhCandidate.hitter.plateAppearances >= 100 && Number.isFinite(dhCandidate.hitter.ops), `${name} must preserve offensive statistics`)
}

assert.equal(new Set(allCards.map(({ id }) => id)).size, allCards.length, 'canonical card IDs must be globally unique')
const selectedById = new Map(built.auditContext.selected.map((value) => [value.id, value]))
for (const card of allCards.filter(({ eligiblePositions }) => eligiblePositions.includes('DH'))) {
  assert.notEqual(card.playerType, 'pitcher')
  assert(Number.isFinite(card.visibleStats.ops), `${card.id} must serialize DH offense`)
}
for (const card of allCards.filter(({ playerType }) => playerType === 'twoWay')) {
  assert.equal(card.type, 'hitter')
  assert.equal(card.isTwoWay, true)
  assert(card.eligiblePositions.some((position) => !['SP', 'RP'].includes(position)))
  assert(card.eligiblePositions.some((position) => ['SP', 'RP'].includes(position)))
  assert(card.visibleStats && card.pitchingVisibleStats && card.scoringStats && card.pitchingScoringStats)
}

for (const [id, cards] of Object.entries(built.pools)) {
  assert(cards.length >= built.config.pool.minimumCards && cards.length <= built.config.pool.maximumCards, `${id} must stay within the 24–40 card contract`)
  assert(canCompleteRoster(cards), `${id} must support a complete distinct-player roster`)
  assert.equal(new Set(cards.map(({ id: cardId }) => cardId)).size, cards.length, `${id} must not contain duplicate cards`)
  assert(cards.every(({ eligiblePositions }) => !eligiblePositions.includes('OF')), `${id} must use split outfield positions only`)
  for (const card of cards) {
    const source = selectedById.get(card.id)
    assert(source, `${card.id} must map to one featured-season candidate`)
    assert.equal(new Set(card.eligiblePositions).size, card.eligiblePositions.length, `${card.id} must not contain duplicate positions`)
    assert(card.eligiblePositions.every((position) => POSITION_ORDER.includes(position)), `${card.id} must not contain invalid positions`)
    assert.deepEqual(card.eligiblePositions, [...card.eligiblePositions].sort((left, right) => POSITION_ORDER.indexOf(left) - POSITION_ORDER.indexOf(right)), `${card.id} positions must use canonical order`)
    if (!card.manualPositionOverride) {
      assert.deepEqual(card.eligiblePositions, source.sourceEligiblePositions, `${card.id} must serialize only featured-season source eligibility`)
      for (const position of FIELD_POSITIONS) {
        const games = source.positionAppearances[position] ?? 0
        assert.equal(card.eligiblePositions.includes(position), games >= 5, `${card.id} ${position} must follow the five-game boundary`)
        assert.equal(source.selectionEligiblePositions.includes(position), games >= 10, `${card.id} ${position} must retain the selection-only ten-game boundary`)
      }
      const dhGames = source.positionAppearances.DH ?? 0
      assert.equal(card.eligiblePositions.includes('DH'), card.playerType !== 'pitcher' && dhGames >= 10, `${card.id} DH must retain its ten-game boundary`)
    }
    assert.equal(card.decade, `${Math.floor(card.featuredSeason / 10) * 10}s`)
    if (card.eligiblePositions.includes('SP')) assert(card.pitchingScoringStats?.starts >= 10 || card.scoringStats.starts >= 10)
    if (card.eligiblePositions.includes('RP')) assert(card.pitchingScoringStats?.reliefAppearances >= 15 || card.scoringStats.reliefAppearances >= 15)
  }
}

const validationCombination = built.combinations[0]
const duplicatePositionCards = structuredClone(built.pools[validationCombination.id])
duplicatePositionCards[0].eligiblePositions.push(duplicatePositionCards[0].eligiblePositions[0])
assert(validatePool(duplicatePositionCards, validationCombination, built.config).errors.some((message) => message.includes('duplicate eligible positions')))
const invalidPositionCards = structuredClone(built.pools[validationCombination.id])
invalidPositionCards[0].eligiblePositions.push('OF')
assert(validatePool(invalidPositionCards, validationCombination, built.config).errors.some((message) => message.includes('invalid eligible positions')))

const legacyTargetCards = Object.values(built.config.coverage).reduce((total, target) => total + target, 0)
const candidatesByPool = new Map()
for (const value of built.auditContext.selected) {
  const poolId = `${value.franchiseId}-${value.decade}`
  const values = candidatesByPool.get(poolId) ?? []
  values.push(value)
  candidatesByPool.set(poolId, values)
}
for (const [id, cards] of Object.entries(built.pools)) {
  const legacyCards = curatePool(candidatesByPool.get(id), {
    ...built.config,
    pool: { ...built.config.pool, targetCards: legacyTargetCards },
  })
  const expandedIds = new Set(cards.map(({ id: cardId }) => cardId))
  assert(legacyCards.every(({ id: cardId }) => expandedIds.has(cardId)), `${id} must retain every legacy 32-card selection`)
  const legacyIds = new Set(legacyCards.map(({ id: cardId }) => cardId))
  const qualityFloor = Math.max(built.config.pool.minimumExpansionScore, Math.min(...legacyCards.map(({ selectionScore }) => selectionScore)))
  const expandedCandidates = candidatesByPool.get(id).filter(({ id: cardId }) => expandedIds.has(cardId))
  assert(expandedCandidates.filter(({ id: cardId }) => !legacyIds.has(cardId)).every(({ selectionScore }) => selectionScore >= qualityFloor), `${id} expansion must respect its legacy-core quality floor`)
}
assert(Object.values(built.pools).some((cards) => cards.length === built.config.pool.targetCards), 'eligible pools must expand to the 36-card target')

const checkedIn = validateGeneratedData(process.cwd())
assert.deepEqual(checkedIn.errors, [])
assert.equal(checkedIn.combinations, built.combinations.length)
for (const poolId of ['ana-2010s', 'ana-2020s', 'lad-2020s']) {
  const generated = JSON.parse(fs.readFileSync(`src/data/generated/pools/${poolId}.json`, 'utf8')).find(({ playerId }) => playerId === 'ohtansh01')
  assert.deepEqual(generated, playableCard('ohtansh01', poolId), `${poolId} Ohtani must be regenerated from the corrected pipeline`)
}
assert(fs.statSync('src/data/generated/data-report.json').size > 1_000)
const rebuilt = buildLahmanData(process.cwd())
assert.deepEqual(rebuilt, built, 'rebuilding identical source inputs must be deterministic')

console.log(`Lahman pipeline tests passed: stint aggregation, featured seasons, relocation mapping, DH/two-way roles, additive pool curation, eligibility, ${built.combinations.length} validated pools.`)
