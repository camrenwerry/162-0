import type { HitterVisibleStats, PitcherVisibleStats, Player } from '../types/draft'

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
  { key: 'war', label: 'WAR', format: 'oneDecimal' },
  { key: 'opsPlus', label: 'OPS+' },
  { key: 'hr', label: 'HR' },
  { key: 'avg', label: 'AVG', format: 'rate' },
  { key: 'obp', label: 'OBP', format: 'rate' },
  { key: 'slg', label: 'SLG', format: 'rate' },
  { key: 'rbi', label: 'RBI' },
  { key: 'sb', label: 'SB' },
]

const PITCHER_PRIORITY: readonly StatDefinition<PitcherVisibleStats>[] = [
  { key: 'war', label: 'WAR', format: 'oneDecimal' },
  { key: 'eraPlus', label: 'ERA+' },
  { key: 'era', label: 'ERA', format: 'twoDecimals' },
  { key: 'whip', label: 'WHIP', format: 'threeDecimals' },
  { key: 'so', label: 'SO' },
  { key: 'wins', label: 'W' },
  { key: 'sv', label: 'SV' },
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

export function getCompactPlayerStats(player: Player, statView: 'hitter' | 'pitcher'): CompactStat[] {
  if (statView === 'pitcher') {
    const stats = player.playerType === 'twoWay' ? player.pitchingVisibleStats : player.playerType === 'pitcher' ? player.visibleStats : null
    if (stats) return selectStats(stats, PITCHER_PRIORITY)
  }
  if (player.playerType !== 'pitcher') return selectStats(player.visibleStats, HITTER_PRIORITY)
  return selectStats(player.visibleStats, PITCHER_PRIORITY)
}
