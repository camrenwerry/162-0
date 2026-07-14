import assert from 'node:assert/strict'
import {
  candidateToCard,
  deriveSeasonCandidate,
  readBuiltData,
  readInputs,
  selectBestSeason,
  validateBuiltData,
} from './lib/player-pipeline.mjs'

const root = process.cwd()

const season = (overrides = {}) => ({
  playerId: 'sample01',
  name: 'Sample Player',
  franchiseId: 'sea',
  teamAbbreviation: 'SEA',
  teamDisplayName: 'Seattle Mariners',
  decade: '1990s',
  season: 1997,
  lahmanTeamIds: ['SEA'],
  bats: 'R',
  throws: 'R',
  hitterGames: 150,
  plateAppearances: 650,
  homeRuns: 30,
  rbi: 100,
  stolenBases: 10,
  avg: .300,
  obp: .400,
  slg: .550,
  pitcherGames: 0,
  wins: null,
  gamesStarted: 0,
  saves: null,
  inningsPitched: 0,
  walksAllowed: null,
  strikeouts: null,
  era: null,
  whip: null,
  ...overrides,
})

const fieldKey = (row) => `${row.franchiseId}-${row.season}-${row.playerId}`
const desired = season()
const strongerOutsideDecade = season({ season: 2001, obp: .500, slg: .800 })
const strongerOtherFranchise = season({ franchiseId: 'nyy', teamAbbreviation: 'NYY', teamDisplayName: 'New York Yankees', lahmanTeamIds: ['NYA'], obp: .500, slg: .800 })
const fielding = new Map([
  [fieldKey(desired), [{ position: 'CF', games: 100 }]],
  [fieldKey(strongerOutsideDecade), [{ position: 'SS', games: 100 }]],
  [fieldKey(strongerOtherFranchise), [{ position: '1B', games: 100 }]],
])

const selected = selectBestSeason([desired, strongerOutsideDecade, strongerOtherFranchise], fielding)
assert.equal(selected.row.franchiseId, 'sea', 'featured season must remain with the requested franchise')
assert.equal(selected.row.decade, '1990s', 'featured season must remain inside the requested decade')
assert.equal(selected.row.season, 1997, 'a stronger out-of-decade season must be rejected')
assert.deepEqual(selected.eligiblePositions, ['CF'], 'eligibility must come only from the featured season')

const multiPosition = deriveSeasonCandidate(desired, [
  { position: 'CF', games: 50 },
  { position: 'RF', games: 12 },
  { position: 'LF', games: 9 },
])
assert.deepEqual(multiPosition.eligiblePositions, ['CF', 'RF'], 'meaningful secondary positions should be retained')

const belowStarter = deriveSeasonCandidate(season({ plateAppearances: 0, obp: null, slg: null, pitcherGames: 20, gamesStarted: 9, inningsPitched: 60, era: 3, whip: 1.1, strikeouts: 60, walksAllowed: 15 }), [])
assert.equal(belowStarter, null, 'pitchers below both role thresholds are ineligible')
const starter = deriveSeasonCandidate(season({ plateAppearances: 0, obp: null, slg: null, pitcherGames: 20, gamesStarted: 10, inningsPitched: 60, era: 3, whip: 1.1, strikeouts: 60, walksAllowed: 15 }), [])
assert.deepEqual(starter.eligiblePositions, ['SP'])
const reliever = deriveSeasonCandidate(season({ plateAppearances: 0, obp: null, slg: null, pitcherGames: 16, gamesStarted: 0, inningsPitched: 35, era: 3, whip: 1.1, strikeouts: 40, walksAllowed: 10 }), [])
assert.deepEqual(reliever.eligiblePositions, ['RP'])

const twoWay = deriveSeasonCandidate(season({ pitcherGames: 10, gamesStarted: 10, inningsPitched: 50, era: 3.2, whip: 1.15, strikeouts: 60, walksAllowed: 20 }), [{ position: 'RF', games: 20 }])
assert.equal(twoWay.playerType, 'twoWay')
assert.deepEqual(twoWay.eligiblePositions, ['RF', 'SP'])
const twoWayCard = candidateToCard(twoWay)
assert(twoWayCard.pitchingVisibleStats && twoWayCard.visibleStats)
assert.equal(twoWayCard.visibleStats.war, null, 'unavailable advanced stats must remain null')
assert.equal(twoWayCard.pitchingVisibleStats.eraPlus, null)

const inputs = readInputs(root)
const built = readBuiltData(root)
const validReport = validateBuiltData(built, inputs.config)
assert.equal(validReport.errors.length, 0, 'checked-in pools must pass blocking validation')
assert(validReport.summary.pools >= 20, 'v0.7.0 requires at least 20 supported pools')
assert.equal(validReport.summary.playablePools, validReport.summary.pools, 'every indexed pool must be playable')
assert.equal(validReport.summary.verifiedCards, validReport.summary.cards, 'production pools should contain only verified cards')
assert.equal(validReport.summary.unverifiedCards, 0)

const milestonePools = [
  'sea-1990s', 'nyy-2000s', 'atl-1990s', 'stl-2000s', 'laa-2010s',
  'bos-2000s', 'lad-2010s', 'chc-1990s', 'sea-2000s', 'nyy-1990s',
  'atl-2000s', 'stl-2010s', 'laa-2000s', 'bos-2010s', 'lad-2000s',
  'chc-2000s', 'bal-1980s', 'bal-2000s', 'phi-1980s', 'phi-2000s',
]
const supportedPoolIds = new Set(validReport.pools.map(({ id }) => id))
for (const poolId of milestonePools) assert(supportedPoolIds.has(poolId), `missing v0.7.0 milestone pool ${poolId}`)
for (const pool of validReport.pools) {
  assert(pool.cards >= 24 && pool.cards <= 36, `${pool.id} should contain 24–36 cards`)
  assert(pool.rosterCompletable, `${pool.id} must support a complete 14-slot roster`)
  assert(pool.coverage.SP >= 5, `${pool.id} should contain at least five SP choices`)
  assert(pool.coverage.RP >= 3, `${pool.id} should contain at least three RP choices`)
}
assert(validReport.warnings.some(({ message }) => message.startsWith('Very low') || message.startsWith('Only ')), 'non-blocking coverage concerns should warn')

const invalid = structuredClone(built)
const firstPool = invalid.combinations[0].id
invalid.pools[firstPool][0].featuredSeason = 1901
invalid.pools[firstPool].push(structuredClone(invalid.pools[firstPool][1]))
const verifiedHitter = invalid.pools[firstPool].find(({ playerType }) => playerType !== 'pitcher')
verifiedHitter.visibleStats.war = null
verifiedHitter.stats.war = null
const invalidReport = validateBuiltData(invalid, inputs.config)
assert(invalidReport.errors.some(({ message }) => message === 'Featured season outside decade'))
assert(invalidReport.errors.some(({ message }) => message === 'Duplicate card ID'))
assert(invalidReport.errors.some(({ message }) => message === 'Verified modern hitter missing required war'))
assert.equal(invalidReport.summary.missingStats.war, 1)
assert(invalidReport.missingData.some(({ card, stat, cause }) => card === verifiedHitter.id && stat === 'war' && cause === 'Source column unavailable'))

console.log('Player pipeline tests passed: featured seasons, positions, roles, 20-pool milestone coverage, pitching depth, playability, nulls, and validation.')
