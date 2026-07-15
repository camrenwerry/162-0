import fs from 'node:fs'
import path from 'node:path'
import { buildLahmanData, parseCsv } from './lahman-pipeline.mjs'

const AWARDS = new Map([
  ['Most Valuable Player', 'MVP winner'],
  ['Cy Young Award', 'Cy Young winner'],
  ['Rookie of the Year', 'Rookie of the Year winner'],
])
const compare = (left, right) => left.localeCompare(right, 'en')
const workload = (candidate) => candidate.playerType === 'pitcher'
  ? candidate.pitcher?.inningsPitched ?? 0
  : candidate.hitter?.plateAppearances ?? 0
const poolIdFor = (candidate) => `${candidate.franchiseId}-${candidate.decade}`
const cardKey = (candidate) => `${candidate.franchiseId}-${candidate.decade}-${candidate.playerId}`
const markdownTable = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map((value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`),
].join('\n')

function sourceRows(root, name) {
  return parseCsv(fs.readFileSync(path.join(root, 'data-import/lahman', `${name}.csv`), 'utf8'))
}

function honorsByPlayerYear(root) {
  const honors = new Map()
  for (const row of sourceRows(root, 'AwardsPlayers')) {
    const label = AWARDS.get(row.awardID)
    if (!label) continue
    const key = `${row.playerID}:${row.yearID}`
    honors.set(key, [...new Set([...(honors.get(key) ?? []), label])])
  }
  return honors
}

function hallOfFamers(root) {
  return new Set(sourceRows(root, 'HallOfFame').filter((row) => row.inducted === 'Y' && row.category === 'Player').map((row) => row.playerID))
}

function duplicateFileFindings(root) {
  const findings = []
  for (const directory of ['pools', 'runtime-pools']) {
    const folder = path.join(root, 'src/data/generated', directory)
    for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.json') && !/^[a-z0-9-]+-\d{4}s\.json$/.test(name))) {
      findings.push({ identity: file, locations: directory, reason: 'Unindexed duplicate or suspicious generated filename' })
    }
  }
  return findings
}

export function runHistoricalAudits(root = process.cwd()) {
  const built = buildLahmanData(root)
  const { candidates, selected, overrides } = built.auditContext
  const cards = Object.values(built.pools).flat()
  const cardIds = new Set(cards.map(({ id }) => id))
  const supportedPools = new Set(built.combinations.map(({ id }) => id))
  const honors = honorsByPlayerYear(root)
  const hof = hallOfFamers(root)
  const candidatesByCard = new Map()
  for (const candidate of candidates) {
    const key = cardKey(candidate)
    const seasons = candidatesByCard.get(key) ?? []
    seasons.push(candidate)
    candidatesByCard.set(key, seasons)
  }

  const selectedByPool = new Map()
  for (const candidate of selected) {
    const pool = poolIdFor(candidate)
    const values = selectedByPool.get(pool) ?? []
    values.push(candidate)
    selectedByPool.set(pool, values)
  }

  const tenure = new Map()
  for (const candidate of candidates) {
    const key = `${candidate.franchiseId}:${candidate.playerId}`
    tenure.set(key, (tenure.get(key) ?? new Set()).add(candidate.featuredSeason))
  }

  const missingExpectedPlayers = []
  for (const candidate of selected) {
    const pool = poolIdFor(candidate)
    if (!supportedPools.has(pool) || cardIds.has(candidate.id)) continue
    const reasons = [...(honors.get(`${candidate.playerId}:${candidate.featuredSeason}`) ?? [])]
    const poolCandidates = selectedByPool.get(pool) ?? []
    const rank = [...poolCandidates].sort((a, b) => b.selectionScore - a.selectionScore).findIndex(({ id }) => id === candidate.id)
    const qualifiedFranchiseSeasons = tenure.get(`${candidate.franchiseId}:${candidate.playerId}`)?.size ?? 0
    if (hof.has(candidate.playerId) && (qualifiedFranchiseSeasons >= 3 || (rank >= 0 && rank < Math.ceil(poolCandidates.length * .5)))) reasons.push('Hall of Fame player with meaningful franchise/decade relevance')
    if (qualifiedFranchiseSeasons >= 8 && rank >= 0 && rank < Math.ceil(poolCandidates.length * .25)) reasons.push('data-derived franchise legend candidate')
    if (reasons.length) missingExpectedPlayers.push({ player: candidate.name, franchise: candidate.teamDisplayName, decade: candidate.decade, reasons: [...new Set(reasons)].join('; ') })
  }

  const duplicateCards = duplicateFileFindings(root)
  const occurrences = new Map()
  for (const card of cards) {
    const values = occurrences.get(card.id) ?? []
    values.push(`${card.franchiseId}-${card.decade}`)
    occurrences.set(card.id, values)
  }
  for (const [identity, locations] of occurrences) if (locations.length > 1) duplicateCards.push({ identity, locations: locations.join(', '), reason: 'Duplicate card ID in canonical pools' })

  const featuredSeasons = []
  for (const chosen of selected) {
    if (!supportedPools.has(poolIdFor(chosen))) continue
    const seasons = [...(candidatesByCard.get(cardKey(chosen)) ?? [])].sort((a, b) => b.selectionScore - a.selectionScore || b.featuredSeason - a.featuredSeason)
    const formulaBest = seasons[0]
    const fullest = [...seasons].sort((a, b) => workload(b) - workload(a) || b.selectionScore - a.selectionScore)[0]
    const override = overrides.featuredSeasons?.[cardKey(chosen)]
    let reason = ''
    if (override && formulaBest && formulaBest.featuredSeason !== chosen.featuredSeason) reason = `Manual override conflicts with formula-best ${formulaBest.featuredSeason}`
    else if (formulaBest && formulaBest.selectionScore > chosen.selectionScore + .02) reason = `Clearly stronger eligible season ${formulaBest.featuredSeason} scores ${(formulaBest.selectionScore * 100).toFixed(1)} vs ${(chosen.selectionScore * 100).toFixed(1)}`
    else if (fullest && fullest.featuredSeason !== chosen.featuredSeason && workload(chosen) < workload(fullest) * .65 && fullest.selectionScore >= chosen.selectionScore * .88) reason = `Shorter featured season (${workload(chosen)} workload) narrowly outranks fuller ${fullest.featuredSeason} season (${workload(fullest)})`
    if (reason) featuredSeasons.push({
      player: chosen.name, franchise: chosen.teamDisplayName, decade: chosen.decade,
      featuredSeason: chosen.featuredSeason, possibleSeason: formulaBest?.featuredSeason === chosen.featuredSeason ? fullest.featuredSeason : formulaBest?.featuredSeason,
      reason, manualOverride: override ? 'yes — retained' : 'no',
    })
  }

  const featuredById = new Map(selected.map((candidate) => [candidate.id, candidate]))
  const positionFindings = []
  for (const card of cards) {
    const candidate = featuredById.get(card.id)
    if (!candidate || card.playerType === 'pitcher') continue
    const seasons = candidatesByCard.get(cardKey(candidate)) ?? []
    const possible = new Set(candidate.sourceEligiblePositions.filter((position) => !['SP', 'RP'].includes(position)))
    let reason = ''
    if (card.manualPositionOverride) reason = 'Manual position override retained for review'
    else if (card.eligiblePositions.join(',') !== candidate.sourceEligiblePositions.join(',')) reason = 'Generated card differs from featured-season source eligibility'
    const fullerAlternates = seasons.filter((season) => season.featuredSeason !== candidate.featuredSeason && workload(candidate) < workload(season) * .65 && season.selectionScore >= candidate.selectionScore * .88)
    for (const season of fullerAlternates) for (const position of season.sourceEligiblePositions) possible.add(position)
    for (const [position, games] of Object.entries(candidate.positionAppearances)) if (games >= 5) possible.add(position)
    if (!reason && [...possible].some((position) => !card.eligiblePositions.includes(position))) reason = 'Featured-season threshold or short-season selection may suppress a legitimate secondary position'
    if (reason) positionFindings.push({
      player: card.name, franchise: card.teamDisplayName, decade: card.decade, featuredSeason: card.featuredSeason,
      eligiblePositions: card.eligiblePositions.join(', '), reason, possibleExpectedPositions: [...possible].sort(compare).join(', '),
    })
  }

  return {
    summary: { supportedPools: built.combinations.length, cards: cards.length },
    stars: { missingExpectedPlayers: missingExpectedPlayers.sort((a, b) => compare(`${a.franchise}${a.decade}${a.player}`, `${b.franchise}${b.decade}${b.player}`)), duplicateCards: duplicateCards.sort((a, b) => compare(a.identity, b.identity)), suspiciousFeaturedSeasons: featuredSeasons },
    positions: positionFindings.sort((a, b) => compare(`${a.franchise}${a.decade}${a.player}`, `${b.franchise}${b.decade}${b.player}`)),
    featuredSeasons,
  }
}

export function writeHistoricalAuditReports(root, report) {
  const directory = path.join(root, 'docs/audits')
  fs.mkdirSync(directory, { recursive: true })
  const starRows = report.stars.missingExpectedPlayers.map((item) => [item.player, item.franchise, item.decade, item.reasons])
  const duplicateRows = report.stars.duplicateCards.map((item) => [item.identity, item.locations, item.reason])
  fs.writeFileSync(path.join(directory, 'STAR_AUDIT.md'), `# Star Player Audit\n\nGenerated from Lahman awards, Hall of Fame inductions, qualified franchise tenure, and supported pool membership. No cards are added automatically.\n\n## Missing expected players (${starRows.length})\n\n${starRows.length ? markdownTable(['Player', 'Franchise', 'Decade', 'Why expected'], starRows) : 'None.'}\n\n## Duplicate cards/files (${duplicateRows.length})\n\n${duplicateRows.length ? markdownTable(['Identity', 'Location(s)', 'Reason'], duplicateRows) : 'None.'}\n\n## Suspicious featured seasons (${report.featuredSeasons.length})\n\nSee [FEATURED_SEASON_AUDIT.md](FEATURED_SEASON_AUDIT.md).\n`)
  const positionRows = report.positions.map((item) => [item.player, item.franchise, item.decade, item.featuredSeason, item.eligiblePositions, item.reason, item.possibleExpectedPositions])
  fs.writeFileSync(path.join(directory, 'POSITION_AUDIT.md'), `# Position Audit\n\nReport only. Eligibility remains sourced from the featured season, and manual overrides are never overwritten.\n\n${positionRows.length ? markdownTable(['Player', 'Franchise', 'Decade', 'Featured season', 'Eligible positions', 'Reason flagged', 'Possible expected positions'], positionRows) : 'No suspicious positions found.'}\n`)
  const seasonRows = report.featuredSeasons.map((item) => [item.player, item.franchise, item.decade, item.featuredSeason, item.possibleSeason, item.reason, item.manualOverride])
  fs.writeFileSync(path.join(directory, 'FEATURED_SEASON_AUDIT.md'), `# Featured-Season Audit\n\nReport only. The audit compares the chosen season with every eligible same-franchise season in the decade; it does not replace selections or manual overrides.\n\n${seasonRows.length ? markdownTable(['Player', 'Franchise', 'Decade', 'Featured season', 'Possible season', 'Reason flagged', 'Manual override'], seasonRows) : 'No suspicious featured seasons found.'}\n`)
  fs.writeFileSync(path.join(directory, 'historical-audit.json'), `${JSON.stringify(report, null, 2)}\n`)
}
