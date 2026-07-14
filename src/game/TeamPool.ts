import { PLAYER_CARDS, PLAYER_POOLS, TEAM_DECADES } from '../data/mlb'
import { POSITIONS, type Player, type Position, type PositionFilter, type SortKey, type TeamDecade } from '../types/draft'

export interface SortOption { value: SortKey; label: string }

const UNIVERSAL_SORTS: SortOption[] = [
  { value: 'war', label: 'WAR' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'position', label: 'Position' },
]
const HITTER_STATS: SortOption[] = [
  { value: 'opsPlus', label: 'OPS+' }, { value: 'hr', label: 'HR' }, { value: 'avg', label: 'AVG' },
  { value: 'obp', label: 'OBP' }, { value: 'slg', label: 'SLG' }, { value: 'rbi', label: 'RBI' }, { value: 'sb', label: 'SB' },
]
const PITCHER_STATS: SortOption[] = [
  { value: 'eraPlus', label: 'ERA+' }, { value: 'era', label: 'ERA' }, { value: 'whip', label: 'WHIP' },
  { value: 'so', label: 'SO' }, { value: 'wins', label: 'W' }, { value: 'sv', label: 'SV' },
]
const HITTER_SORTS = [UNIVERSAL_SORTS[0], ...HITTER_STATS, UNIVERSAL_SORTS[1], UNIVERSAL_SORTS[2]]
const PITCHER_SORTS = [UNIVERSAL_SORTS[0], ...PITCHER_STATS, UNIVERSAL_SORTS[1], UNIVERSAL_SORTS[2]]
const ALL_SORTS = [...UNIVERSAL_SORTS, ...HITTER_STATS, ...PITCHER_STATS]
const HITTER_KEYS = new Set<SortKey>(HITTER_STATS.map(({ value }) => value))
const PITCHER_KEYS = new Set<SortKey>(PITCHER_STATS.map(({ value }) => value))
const POSITION_ORDER = new Map(POSITIONS.map((position, index) => [position, index]))
const ASCENDING = new Set<SortKey>(['era', 'whip', 'name', 'position'])

function matchesPosition(player: Player, filter: PositionFilter) {
  if (filter === 'ALL') return true
  if (filter === 'OF') return player.eligiblePositions.some((position) => ['LF', 'CF', 'RF'].includes(position))
  if (filter === 'DH') return player.type === 'hitter' || player.isTwoWay
  return player.eligiblePositions.includes(filter as Position)
}

function matchesSortType(player: Player, filter: PositionFilter, sort: SortKey) {
  if (filter !== 'ALL') return true
  if (HITTER_KEYS.has(sort)) return player.playerType !== 'pitcher'
  if (PITCHER_KEYS.has(sort)) return player.playerType !== 'hitter'
  return true
}

function valueFor(player: Player, key: SortKey, statView: 'hitter' | 'pitcher'): number | string | null {
  if (key === 'name') return player.name
  if (key === 'position') return Math.min(...player.eligiblePositions.map((position) => POSITION_ORDER.get(position) ?? 99))
  const stats = statView === 'pitcher' && player.playerType === 'twoWay'
    ? player.pitchingVisibleStats
    : player.stats
  return stats[key as keyof typeof stats] ?? null
}

function comparePlayers(a: Player, b: Player, key: SortKey, statView: 'hitter' | 'pitcher') {
  const left = valueFor(a, key, statView)
  const right = valueFor(b, key, statView)
  if (left === null && right === null) return a.name.localeCompare(b.name)
  if (left === null) return 1
  if (right === null) return -1
  const primary = typeof left === 'string' && typeof right === 'string'
    ? left.localeCompare(right)
    : Number(left) - Number(right)
  return (ASCENDING.has(key) ? primary : -primary) || a.name.localeCompare(b.name)
}

export interface PlayerQuery {
  combination: TeamDecade
  excludedIds: ReadonlySet<string>
  filter: PositionFilter
  sort: SortKey
  search: string
}

export interface TeamPoolSource {
  getCombinations(): readonly TeamDecade[]
  getPlayers(combination: TeamDecade): Player[]
  getPlayer(id: string | null): Player | null
  getTeams(): Array<{ franchiseId: string; team: string; teamName: string }>
  getDecades(): TeamDecade['decade'][]
  getSortOptions(filter: PositionFilter): readonly SortOption[]
  isSortValid(filter: PositionFilter, sort: SortKey): boolean
  getSortTypeLabel(filter: PositionFilter, sort: SortKey): string | null
  getStatView(filter: PositionFilter, sort: SortKey): 'hitter' | 'pitcher'
  query(query: PlayerQuery): Player[]
}

export class TeamPool implements TeamPoolSource {
  private readonly combinations: readonly TeamDecade[]
  private readonly pools: Readonly<Record<string, readonly Player[]>>
  private readonly players: readonly Player[]

  constructor(
    combinations: readonly TeamDecade[] = TEAM_DECADES,
    pools: Readonly<Record<string, readonly Player[]>> = PLAYER_POOLS,
  ) {
    this.combinations = combinations
    this.pools = pools
    this.players = pools === PLAYER_POOLS ? PLAYER_CARDS : Object.values(pools).flat()
  }

  getCombinations() { return this.combinations }
  getPlayers(combination: TeamDecade) {
    return [...(this.pools[combination.id] ?? [])]
  }
  getPlayer(id: string | null) { return id ? this.players.find((player) => player.id === id) ?? null : null }
  getTeams() { return [...new Map(this.combinations.map(({ franchiseId, team, teamName }) => [franchiseId, { franchiseId, team, teamName }])).values()] }
  getDecades() { return [...new Set(this.combinations.map(({ decade }) => decade))] }
  getSortOptions(filter: PositionFilter) {
    if (filter === 'ALL') return ALL_SORTS
    if (filter === 'SP' || filter === 'RP') return PITCHER_SORTS
    return HITTER_SORTS
  }
  isSortValid(filter: PositionFilter, sort: SortKey) { return this.getSortOptions(filter).some((option) => option.value === sort) }
  getSortTypeLabel(filter: PositionFilter, sort: SortKey) {
    if (filter !== 'ALL') return null
    if (HITTER_KEYS.has(sort)) return 'Hitters'
    if (PITCHER_KEYS.has(sort)) return 'Pitchers'
    return null
  }
  getStatView(filter: PositionFilter, sort: SortKey) {
    return filter === 'SP' || filter === 'RP' || (filter === 'ALL' && PITCHER_KEYS.has(sort)) ? 'pitcher' : 'hitter'
  }
  query({ combination, excludedIds, filter, sort, search }: PlayerQuery) {
    const term = search.trim().toLocaleLowerCase()
    const statView = this.getStatView(filter, sort)
    return this.getPlayers(combination)
      .filter((player) => !excludedIds.has(player.id))
      .filter((player) => matchesPosition(player, filter))
      .filter((player) => matchesSortType(player, filter, sort))
      .filter((player) => !term || player.name.toLocaleLowerCase().includes(term))
      .sort((a, b) => comparePlayers(a, b, sort, statView))
  }
}
