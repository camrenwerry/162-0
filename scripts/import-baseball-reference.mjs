import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsv } from './lib/player-pipeline.mjs'

const argument = (name) => {
  const index = process.argv.indexOf(name)
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing required ${name} argument`)
  return resolve(process.argv[index + 1])
}

const battingPath = argument('--batting')
const pitchingPath = argument('--pitching')
const root = process.cwd()
const config = JSON.parse(readFileSync(resolve(root, 'data-import/pool-config.json'), 'utf8'))
const seasons = parseCsv(readFileSync(resolve(root, 'data-import/season-stats.csv'), 'utf8'))
const batting = parseCsv(readFileSync(battingPath, 'utf8')).filter((row) => row.pitcher === 'N')
const pitching = parseCsv(readFileSync(pitchingPath, 'utf8'))

const sourceKey = (playerId, season, teamId) => `${playerId}|${season}|${teamId}`
const group = (rows) => {
  const groups = new Map()
  for (const row of rows) {
    const key = sourceKey(row.player_ID, row.year_ID, row.team_ID)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return groups
}

const battingBySeason = group(batting)
const pitchingBySeason = group(pitching)
const numberOrNull = (value) => value === '' || value === 'NULL' || value === undefined ? null : Number(value)
const round = (value, digits = 0) => value === null ? null : Number(value.toFixed(digits))
const weighted = (rows, valueKey, weightKey) => {
  const usable = rows.map((row) => ({ value: numberOrNull(row[valueKey]), weight: numberOrNull(row[weightKey]) ?? 0 })).filter(({ value }) => value !== null)
  const totalWeight = usable.reduce((total, { weight }) => total + weight, 0)
  if (!usable.length) return null
  if (!totalWeight) return usable[0].value
  return usable.reduce((total, { value, weight }) => total + value * weight, 0) / totalWeight
}
const sum = (rows, key) => {
  const values = rows.map((row) => numberOrNull(row[key])).filter((value) => value !== null)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

const sourceRows = []
for (const season of seasons) {
  const franchise = config.franchises.find(({ id }) => id === season.franchiseId)
  if (!franchise) throw new Error(`Unknown franchise ${season.franchiseId}`)
  const baseballReferenceId = season.baseballReferenceId || season.playerId
  const battingRows = franchise.baseballReferenceTeamIds.flatMap((teamId) => battingBySeason.get(sourceKey(baseballReferenceId, season.season, teamId)) ?? [])
  const pitchingRows = franchise.baseballReferenceTeamIds.flatMap((teamId) => pitchingBySeason.get(sourceKey(baseballReferenceId, season.season, teamId)) ?? [])
  sourceRows.push({
    playerId: season.playerId,
    baseballReferenceId,
    franchiseId: season.franchiseId,
    season: season.season,
    battingWar: round(sum(battingRows, 'WAR'), 1),
    opsPlus: round(weighted(battingRows, 'OPS_plus', 'PA')),
    pitchingWar: round(sum(pitchingRows, 'WAR'), 1),
    eraPlus: round(weighted(pitchingRows, 'ERA_plus', 'IPouts')),
    sourceLabel: 'Baseball-Reference daily WAR data',
    battingSourceUrl: 'https://www.baseball-reference.com/data/war_daily_bat.txt',
    pitchingSourceUrl: 'https://www.baseball-reference.com/data/war_daily_pitch.txt',
    verifiedAt: '2026-07-14',
  })
}

const headers = Object.keys(sourceRows[0])
const csvValue = (value) => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const output = [headers.join(','), ...sourceRows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\n') + '\n'
writeFileSync(resolve(root, 'data-import/advanced-season-stats.csv'), output)

const hitterRows = seasons.filter((row) => (
  Number(row.plateAppearances || 0) >= 100
  && (Number(row.inningsPitched || 0) < 30 || Number(row.plateAppearances || 0) >= 200)
))
const pitcherRows = seasons.filter((row) => Number(row.inningsPitched || 0) >= 30)
const advancedByKey = new Map(sourceRows.map((row) => [`${row.franchiseId}|${row.season}|${row.playerId}`, row]))
const missingHitters = hitterRows.filter((row) => {
  const advanced = advancedByKey.get(`${row.franchiseId}|${row.season}|${row.playerId}`)
  return advanced?.battingWar === null || advanced?.opsPlus === null
})
const missingPitchers = pitcherRows.filter((row) => {
  const advanced = advancedByKey.get(`${row.franchiseId}|${row.season}|${row.playerId}`)
  return advanced?.pitchingWar === null || advanced?.eraPlus === null
})

console.log(`Imported ${sourceRows.length} advanced season rows.`)
console.log(`Eligible raw hitter rows missing WAR/OPS+: ${missingHitters.length}`)
console.log(`Eligible raw pitcher rows missing WAR/ERA+: ${missingPitchers.length}`)
