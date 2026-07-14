import { BETA_PLAYERS, TEAM_DECADES } from '../data/mlb'
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
  if (HITTER_KEYS.has(sort)) return player.type === 'hitter'
  if (PITCHER_KEYS.has(sort)) return player.type === 'pitcher'
  return true
}

function valueFor(player: Player, key: SortKey): number | string | null {
  if (key === 'name') return player.name
  if (key === 'position') return Math.min(...player.eligiblePositions.map((position) => POSITION_ORDER.get(position) ?? 99))
  if (key === 'war') return player.stats.war
  if (player.type === 'hitter') return player.stats[key as keyof Player['stats']] ?? null
  if (key === 'wins') return player.stats.wins
  return player.stats[key as keyof typeof player.stats] ?? null
}

function comparePlayers(a: Player, b: Player, key: SortKey) {
  const left = valueFor(a, key)
  const right = valueFor(b, key)
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
  query(query: PlayerQuery): Player[]
}

export class TeamPool implements TeamPoolSource {
  private readonly combinations: readonly TeamDecade[]
  private readonly players: readonly Player[]

  constructor(
    combinations: readonly TeamDecade[] = TEAM_DECADES,
    players: readonly Player[] = BETA_PLAYERS,
  ) {
    this.combinations = combinations
    this.players = players
  }

  getCombinations() { return this.combinations }
  getPlayers(combination: TeamDecade) {
    return this.players.filter((player) => player.franchiseId === combination.franchiseId && player.decade === combination.decade)
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
  query({ combination, excludedIds, filter, sort, search }: PlayerQuery) {
    const term = search.trim().toLocaleLowerCase()
    return this.getPlayers(combination)
      .filter((player) => !excludedIds.has(player.id))
      .filter((player) => matchesPosition(player, filter))
      .filter((player) => matchesSortType(player, filter, sort))
      .filter((player) => !term || player.name.toLocaleLowerCase().includes(term))
      .sort((a, b) => comparePlayers(a, b, sort))
  }
}
