import type { ScoringVersion } from '../config/versions'

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
export type SortKey = 'name' | 'position' | 'featuredSeason' | 'ops' | 'hr' | 'avg' | 'obp' | 'slg' | 'rbi' | 'sb' | 'era' | 'whip' | 'so' | 'wins' | 'sv'

export interface TeamDecadeCombination {
  id: string
  franchiseId: string
  team: string
  teamName: string
  decade: Decade
}

export type Decade = `${number}s`

export interface SourceMetadata {
  verified: boolean
  sourceLabel: string
  sourceUrl: string
  advancedStatsSourceUrls: string[]
  verifiedAt: string
  lahmanTeamIds: string[]
  sourcePlayerId: string
}

export interface HitterVisibleStats {
  war: number | null
  opsPlus: number | null
  ops: number | null
  hr: number | null
  avg: number | null
  obp: number | null
  slg: number | null
  rbi: number | null
  sb: number | null
  games: number | null
  plateAppearances: number | null
}

export interface PitcherVisibleStats {
  war: number | null
  eraPlus: number | null
  era: number | null
  whip: number | null
  so: number | null
  wins: number | null
  saves: number | null
  sv: number | null
  inningsPitched: number | null
  games: number | null
  starts: number | null
  reliefAppearances: number | null
  k9: number | null
  bb9: number | null
}

export interface HitterScoringStats {
  obp: number | null
  slg: number | null
  wrcPlus: number | null
  offensiveValue: number | null
  defensiveValue: number | null
  baserunningValue: number | null
  games: number
  plateAppearances: number
  eraAdjustedOffense?: number | null
}

export interface PitcherScoringStats {
  whip?: number | null
  fip: number | null
  inningsPitched: number
  strikeoutRate: number | null
  walkRate: number | null
  starts?: number
  gamesStarted?: number
  games?: number
  reliefAppearances: number
  eraAdjustedPitching?: number | null
}

interface PlayerBase {
  id: string
  playerId: string
  playerSlug: string
  name: string
  franchiseId: string
  teamAbbreviation: string
  teamDisplayName: string
  historicalTeamName?: string
  team: string
  decade: Decade
  featuredSeason: number
  eligiblePositions: Position[]
  isTwoWay: boolean
  pitchingRole: 'SP' | 'RP' | null
  bats: string | null
  throws: string | null
  sourceMetadata: SourceMetadata
  sourceNotes: string
  notes: string | null
  manualPositionOverride: boolean
  selectionMetadata?: {
    score: number
    formulaVersion: string
  }
}

export interface Hitter extends PlayerBase {
  playerType: 'hitter'
  type: 'hitter'
  visibleStats: HitterVisibleStats
  pitchingVisibleStats: null
  stats: HitterVisibleStats
  scoringStats: HitterScoringStats
  pitchingScoringStats: null
}

export interface Pitcher extends PlayerBase {
  playerType: 'pitcher'
  type: 'pitcher'
  visibleStats: PitcherVisibleStats
  pitchingVisibleStats: null
  stats: PitcherVisibleStats
  scoringStats: PitcherScoringStats & { whip: number | null; starts: number }
  pitchingScoringStats: null
}

export interface TwoWayPlayer extends PlayerBase {
  playerType: 'twoWay'
  type: 'hitter'
  isTwoWay: true
  visibleStats: HitterVisibleStats
  pitchingVisibleStats: PitcherVisibleStats
  stats: HitterVisibleStats
  scoringStats: HitterScoringStats
  pitchingScoringStats: PitcherScoringStats
}

export type Player = Hitter | Pitcher | TwoWayPlayer
export type PlayerCard = Player
export type PlayerCardData = Player
export interface DraftPlayerView {
  player: PlayerCard
  isAvailable: boolean
  statView: 'hitter' | 'pitcher'
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
  grade: LetterGrade
}

export type LetterGrade = 'F' | 'D' | 'C' | 'C+' | 'B-' | 'B' | 'B+' | 'A-' | 'A' | 'A+' | 'S'
export type ScoringCategoryKey = 'offense' | 'power' | 'contact' | 'speed' | 'defense' | 'startingPitching' | 'reliefPitching' | 'rosterBalance' | 'overall'

export interface BestPlayerValue {
  playerId: string
  playerName: string
  slotId: RosterSlotId
  position: Position
  value: number
}

export interface DraftResult<TPlayer = Player> {
  wins: number
  losses: number
  overallScore: number
  overallGrade: LetterGrade
  tierLabel: string
  categoryScores: Record<ScoringCategoryKey, number>
  categoryGrades: Record<ScoringCategoryKey, LetterGrade>
  roster: Partial<Record<RosterSlotId, TPlayer>>
  strongestCategory: Exclude<ScoringCategoryKey, 'overall'>
  weakestCategory: Exclude<ScoringCategoryKey, 'overall'>
  bestPlayerValue: BestPlayerValue | null
  scoringVersion: ScoringVersion
}
