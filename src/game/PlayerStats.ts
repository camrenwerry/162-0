import type { HitterVisibleStats, PitcherVisibleStats, Player, SortKey } from '../types/draft'

export interface CompactStat {
  key: string
  label: string
  value: number
  formattedValue: string
}

interface StatDefinition<T> {
  key: keyof T & string
  label: string
  format?: 'oneDecimal' | 'twoDecimals' | 'threeDecimals' | 'rate'
}

const HITTER_PRIORITY: readonly StatDefinition<HitterVisibleStats>[] = [
  { key: 'ops', label: 'OPS', format: 'rate' },
  { key: 'avg', label: 'AVG', format: 'rate' },
  { key: 'obp', label: 'OBP', format: 'rate' },
  { key: 'slg', label: 'SLG', format: 'rate' },
  { key: 'hr', label: 'HR' },
  { key: 'rbi', label: 'RBI' },
  { key: 'sb', label: 'SB' },
  { key: 'games', label: 'G' },
  { key: 'plateAppearances', label: 'PA' },
]

const PITCHER_PRIORITY: readonly StatDefinition<PitcherVisibleStats>[] = [
  { key: 'era', label: 'ERA', format: 'twoDecimals' },
  { key: 'whip', label: 'WHIP', format: 'threeDecimals' },
  { key: 'so', label: 'SO' },
  { key: 'wins', label: 'W' },
  { key: 'sv', label: 'SV' },
  { key: 'inningsPitched', label: 'IP', format: 'oneDecimal' },
  { key: 'games', label: 'G' },
  { key: 'starts', label: 'GS' },
  { key: 'reliefAppearances', label: 'GR' },
  { key: 'k9', label: 'K/9', format: 'twoDecimals' },
  { key: 'bb9', label: 'BB/9', format: 'twoDecimals' },
]

const isNumeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function formatStat(value: number, format?: StatDefinition<HitterVisibleStats>['format']) {
  if (format === 'oneDecimal') return value.toFixed(1)
  if (format === 'twoDecimals') return value.toFixed(2)
  if (format === 'threeDecimals') return value.toFixed(3)
  if (format === 'rate') return value.toFixed(3).replace(/^0/, '')
  return value.toLocaleString('en-US')
}

function selectStats<T extends object>(stats: T, priority: readonly StatDefinition<T>[]) {
  return priority.flatMap(({ key, label, format }) => {
    const value = stats[key]
    return isNumeric(value) ? [{ key, label, value, formattedValue: formatStat(value, format) }] : []
  }).slice(0, 4)
}

function prioritize<T>(definitions: readonly StatDefinition<T>[], sort?: SortKey) {
  if (!sort) return definitions
  const selected = definitions.find(({ key }) => key === sort)
  return selected ? [selected, ...definitions.filter(({ key }) => key !== sort)] : definitions
}

export function getCompactPlayerStats(player: Player, statView: 'hitter' | 'pitcher', sort?: SortKey): CompactStat[] {
  if (statView === 'pitcher') {
    const stats = player.playerType === 'twoWay' ? player.pitchingVisibleStats : player.playerType === 'pitcher' ? player.visibleStats : null
    if (stats) return selectStats(stats, prioritize(PITCHER_PRIORITY, sort))
  }
  if (player.playerType !== 'pitcher') return selectStats(player.visibleStats, prioritize(HITTER_PRIORITY, sort))
  return selectStats(player.visibleStats, prioritize(PITCHER_PRIORITY, sort))
}
