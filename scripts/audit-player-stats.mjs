import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBuiltData } from './lib/player-pipeline.mjs'

const HITTER_STATS = ['war', 'opsPlus', 'hr', 'avg', 'obp', 'slg', 'rbi', 'sb']
const PITCHER_STATS = ['war', 'eraPlus', 'era', 'whip', 'so', 'wins', 'sv']
const { pools } = readBuiltData(process.cwd())
const cards = Object.values(pools).flat()

const audit = cards.map((card) => {
  const missing = []
  if (card.playerType !== 'pitcher') {
    for (const key of HITTER_STATS) if (card.visibleStats[key] === null || card.visibleStats[key] === undefined) missing.push(key)
  }
  const pitcherStats = card.playerType === 'pitcher' ? card.visibleStats : card.playerType === 'twoWay' ? card.pitchingVisibleStats : null
  if (pitcherStats) {
    for (const key of PITCHER_STATS) if (pitcherStats[key] === null || pitcherStats[key] === undefined) missing.push(card.playerType === 'twoWay' ? `pitching.${key}` : key)
  }
  return {
    cardId: card.id,
    playerName: card.name,
    team: card.teamAbbreviation,
    decade: card.decade,
    featuredSeason: card.featuredSeason,
    missingRequiredVisibleStats: missing,
    verified: card.sourceMetadata.verified,
  }
})

const report = {
  sourceVerifiedAt: [...new Set(cards.map((card) => card.sourceMetadata.verifiedAt))].sort().at(-1) ?? null,
  summary: {
    cards: audit.length,
    verified: audit.filter(({ verified }) => verified).length,
    incomplete: audit.filter(({ missingRequiredVisibleStats }) => missingRequiredVisibleStats.length).length,
    incompleteVerified: audit.filter(({ verified, missingRequiredVisibleStats }) => verified && missingRequiredVisibleStats.length).length,
  },
  cards: audit,
}

writeFileSync(join(process.cwd(), 'data-import/stat-completeness-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Diamond Draft visible-stat audit: ${report.summary.cards} cards`)
console.log(`Verified: ${report.summary.verified} · Incomplete: ${report.summary.incomplete} · Incomplete verified: ${report.summary.incompleteVerified}`)
for (const card of audit.filter(({ missingRequiredVisibleStats }) => missingRequiredVisibleStats.length)) {
  console.log(`${card.cardId} | ${card.playerName} | ${card.team} | ${card.decade} | ${card.featuredSeason} | ${card.missingRequiredVisibleStats.join(', ')} | verified=${card.verified}`)
}
if (report.summary.incompleteVerified) process.exitCode = 1
