import assert from 'node:assert/strict'
import fs from 'node:fs'
import { aggregateRows, buildLahmanData, canCompleteRoster, hitterStats, parseCsv, selectFeatured, validateGeneratedData } from './lib/lahman-pipeline.mjs'

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

const candidate = (year, score) => ({ franchiseId: 'test', decade: '2000s', playerId: 'player01', featuredSeason: year, selectionScore: score })
assert.equal(selectFeatured([candidate(2001, .5), candidate(2004, .8)], { featuredSeasons: {} })[0].featuredSeason, 2004)
assert.equal(selectFeatured([candidate(2001, .5), candidate(2004, .8)], { featuredSeasons: { 'test-2000s-player01': 2001 } })[0].featuredSeason, 2001)

const built = buildLahmanData(process.cwd())
assert(built.combinations.length >= 150, 'complete Lahman generation should produce broad historical coverage')
assert(built.combinations.some(({ decade }) => decade === '1920s') && built.combinations.some(({ decade }) => decade === '2020s'))
for (const table of ['people', 'teams', 'teamFranchises', 'batting', 'pitching', 'fielding', 'appearances', 'legacyOutfield', 'outfieldSplits']) assert(built.report.summary.sourceRows[table] > 0, `${table} must be imported and reported`)
assert(Object.keys(built.pools).every((id) => built.combinations.some((combination) => combination.id === id)))
assert.equal(new Set(built.combinations.map(({ id }) => id)).size, built.combinations.length)
assert(built.report.excludedPools.length > 0, 'invalid historical pools should be reported rather than indexed')
assert(built.report.franchises.some(({ franchiseId, historicalNames }) => franchiseId === 'lad' && historicalNames.some((name) => name.includes('Brooklyn')) && historicalNames.some((name) => name.includes('Los Angeles'))), 'relocations must share a canonical franchise')

for (const [id, cards] of Object.entries(built.pools)) {
  assert(cards.length >= 24 && cards.length <= 40, `${id} must stay within the pool-size contract`)
  assert(canCompleteRoster(cards), `${id} must support a complete distinct-player roster`)
  assert.equal(new Set(cards.map(({ id: cardId }) => cardId)).size, cards.length, `${id} must not contain duplicate cards`)
  assert(cards.every(({ eligiblePositions }) => !eligiblePositions.includes('OF')), `${id} must use split outfield positions only`)
  for (const card of cards) {
    assert.equal(card.decade, `${Math.floor(card.featuredSeason / 10) * 10}s`)
    if (card.eligiblePositions.includes('SP')) assert(card.pitchingScoringStats?.starts >= 10 || card.scoringStats.starts >= 10)
    if (card.eligiblePositions.includes('RP')) assert(card.pitchingScoringStats?.reliefAppearances >= 15 || card.scoringStats.reliefAppearances >= 15)
  }
}

const checkedIn = validateGeneratedData(process.cwd())
assert.deepEqual(checkedIn.errors, [])
assert.equal(checkedIn.combinations, built.combinations.length)
assert(fs.statSync('src/data/generated/data-report.json').size > 1_000)
const rebuilt = buildLahmanData(process.cwd())
assert.deepEqual(rebuilt, built, 'rebuilding identical source inputs must be deterministic')

console.log(`Lahman pipeline tests passed: stint aggregation, featured seasons, relocation mapping, roles, eligibility, ${built.combinations.length} validated pools.`)
