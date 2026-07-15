import { runHistoricalAudits, writeHistoricalAuditReports } from './lib/historical-audits.mjs'

const root = process.cwd()
const report = runHistoricalAudits(root)
writeHistoricalAuditReports(root, report)
const section = process.argv.find((argument) => argument.startsWith('--section='))?.split('=')[1] ?? 'all'
if (section === 'star' || section === 'all') console.log(`Star audit: ${report.stars.missingExpectedPlayers.length} missing expected players, ${report.stars.duplicateCards.length} duplicate card/file findings, ${report.stars.suspiciousFeaturedSeasons.length} suspicious featured seasons.`)
if (section === 'position' || section === 'all') console.log(`Position audit: ${report.positions.length} cards flagged for review.`)
if (section === 'season' || section === 'all') console.log(`Featured-season audit: ${report.featuredSeasons.length} cards flagged for review.`)
