export const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'] as const

export const ROSTER_SLOTS = [
  { id: 'C', label: 'C', position: 'C' },
  { id: '1B', label: '1B', position: '1B' },
  { id: '2B', label: '2B', position: '2B' },
  { id: '3B', label: '3B', position: '3B' },
  { id: 'SS', label: 'SS', position: 'SS' },
  { id: 'LF', label: 'LF', position: 'LF' },
  { id: 'CF', label: 'CF', position: 'CF' },
  { id: 'RF', label: 'RF', position: 'RF' },
  { id: 'DH', label: 'DH', position: 'DH' },
  { id: 'SP1', label: 'SP', position: 'SP' },
  { id: 'SP2', label: 'SP', position: 'SP' },
  { id: 'SP3', label: 'SP', position: 'SP' },
  { id: 'RP1', label: 'RP', position: 'RP' },
  { id: 'RP2', label: 'RP', position: 'RP' },
] as const

export type Position = (typeof POSITIONS)[number]
export type RosterSlotId = (typeof ROSTER_SLOTS)[number]['id']
export type PositionFilter = 'ALL' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH' | 'SP' | 'RP'
export type SortKey = 'war' | 'name' | 'position' | 'opsPlus' | 'hr' | 'avg' | 'obp' | 'slg' | 'rbi' | 'sb' | 'eraPlus' | 'era' | 'whip' | 'so' | 'wins' | 'sv'

export interface TeamDecadeCombination {
  id: string
  franchiseId: string
  team: string
  teamName: string
  decade: Decade
}

export const DECADES = ['1980s', '1990s', '2000s', '2010s'] as const
export type Decade = (typeof DECADES)[number]

interface PlayerBase {
  id: string
  playerId: string
  name: string
  franchiseId: string
  team: string
  decade: Decade
  eligiblePositions: Position[]
  isTwoWay: boolean
  sourceNotes: string
}

export interface Hitter extends PlayerBase {
  type: 'hitter'
  stats: {
    war: number | null
    opsPlus: number | null
    hr: number | null
    avg: number | null
    obp: number | null
    slg: number | null
    rbi: number | null
    sb: number | null
  }
  scoringStats: {
    obp: number
    slg: number
    wrcPlus: number
    defensiveValue: number
    baserunningValue: number
    games: number
    plateAppearances: number
  }
}

export interface Pitcher extends PlayerBase {
  type: 'pitcher'
  stats: {
    war: number | null
    eraPlus: number | null
    era: number | null
    whip: number | null
    so: number | null
    wins: number | null
    sv: number | null
  }
  scoringStats: {
    whip: number
    fip: number
    inningsPitched: number
    strikeoutRate: number
    walkRate: number
    starts: number
    reliefAppearances: number
  }
}

export type Player = Hitter | Pitcher
export type PlayerCard = Player
export type PlayerCardData = Player
export interface DraftPlayerView {
  player: PlayerCard
  isAvailable: boolean
}
export type RosterSlot = (typeof ROSTER_SLOTS)[number]
export type Roster = Partial<Record<RosterSlotId, Player>>

export type TeamDecade = TeamDecadeCombination

export interface DraftRound {
  current: number
  total: number
  combination: TeamDecade
}

export interface DraftCategoryResult {
  score: number
  grade: string
}

export interface DraftResult {
  wins: number
  losses: number
  letterGrade: string
  tierLabel: string
  overallTeamStrength: number
  offense: DraftCategoryResult
  defense: DraftCategoryResult
  pitching: DraftCategoryResult
  startingPitching: DraftCategoryResult
  reliefPitching: DraftCategoryResult
  speed: DraftCategoryResult
  rosterBalance: DraftCategoryResult
}
