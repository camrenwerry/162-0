import fs from 'node:fs'

const report = JSON.parse(fs.readFileSync('src/data/generated/data-report.json', 'utf8'))
console.log(`Lahman source: ${report.source.label}`)
console.log(`Pools: ${report.summary.validPools} valid / ${report.summary.attemptedPools} attempted; cards: ${report.summary.cards.toLocaleString()}`)
console.log(`Candidate seasons: ${report.summary.candidateSeasons.toLocaleString()}; featured cards before curation: ${report.summary.featuredCards.toLocaleString()}`)
console.log(`Excluded pools: ${report.summary.excludedPools}; coverage warnings: ${report.summary.warnings}`)
for (const pool of report.excludedPools) console.log(`EXCLUDED ${pool.id}: ${pool.errors.join('; ')}`)
