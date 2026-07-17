import type { ScoringVersion } from '../../config/versions'
import type { DraftResult, Position, RosterSlotId, ScoringCategoryKey } from '../../types/draft'

export interface ScoringHitterVisibleStats {
  readonly ops: number | null
  readonly obp: number | null
  readonly slg: number | null
  readonly hr: number | null
  readonly rbi: number | null
  readonly sb: number | null
  readonly avg: number | null
}

export interface ScoringPitcherVisibleStats {
  readonly era: number | null
  readonly whip: number | null
  readonly so: number | null
  readonly sv: number | null
}

export interface ScoringHitterStats {
  readonly plateAppearances: number
  readonly games: number
  readonly baserunningValue: number | null
  readonly defensiveValue: number | null
  readonly eraAdjustedOffense?: number | null
}

export interface ScoringPitcherStats {
  readonly fip: number | null
  readonly inningsPitched: number
  readonly strikeoutRate: number | null
  readonly walkRate: number | null
  readonly starts?: number
  readonly gamesStarted?: number
  readonly reliefAppearances: number
  readonly eraAdjustedPitching?: number | null
}

interface ScoringPlayerBase {
  readonly id: string
  readonly name: string
}

export interface ScoringHitter extends ScoringPlayerBase {
  readonly playerType: 'hitter'
  readonly visibleStats: ScoringHitterVisibleStats
  readonly pitchingVisibleStats: null
  readonly scoringStats: ScoringHitterStats
  readonly pitchingScoringStats: null
}

export interface ScoringPitcher extends ScoringPlayerBase {
  readonly playerType: 'pitcher'
  readonly visibleStats: ScoringPitcherVisibleStats
  readonly pitchingVisibleStats: null
  readonly scoringStats: ScoringPitcherStats
  readonly pitchingScoringStats: null
}

export interface ScoringTwoWayPlayer extends ScoringPlayerBase {
  readonly playerType: 'twoWay'
  readonly visibleStats: ScoringHitterVisibleStats
  readonly pitchingVisibleStats: ScoringPitcherVisibleStats
  readonly scoringStats: ScoringHitterStats
  readonly pitchingScoringStats: ScoringPitcherStats
}

export type ScoringPlayer = ScoringHitter | ScoringPitcher | ScoringTwoWayPlayer
export type ScoringRoster<TPlayer extends ScoringPlayer = ScoringPlayer> = Partial<Record<RosterSlotId, TPlayer>>

export type ScoringConfidence = 'high' | 'medium' | 'low'
export type ScoringRole = 'hitter' | 'SP' | 'RP'

export interface MetricRange {
  poor: number
  average: number
  excellent: number
  elite: number
  direction: 'higher' | 'lower'
}

export interface MetricContribution {
  metric: string
  rawValue: number
  normalizedValue: number
  configuredWeight: number
  appliedWeight: number
}

export interface PlayerValueFacets {
  offense: number
  power: number
  contact: number
  speed: number
  defense: number
  durability: number
}

export interface PlayerValueResult {
  playerId: string
  playerName: string
  slotId: RosterSlotId
  position: Position
  role: ScoringRole
  value: number
  confidence: ScoringConfidence
  availableWeight: number
  components: readonly MetricContribution[]
  facets: PlayerValueFacets
}

export interface OverallAdjustment {
  label: string
  value: number
}

export interface RankingScoreDiagnostics {
  /** Post-adjustment, post-transform overall score before public one-decimal rounding. */
  rawOverallScore: number
  /** Unrounded sum of offense, defense, starting pitching, and relief pitching only. */
  rawCombinedMajorScore: number
  /** Roster Balance before public one-decimal rounding. */
  rawRosterBalanceScore: number
}

export interface ScoringDiagnostics extends RankingScoreDiagnostics {
  scoringVersion: ScoringVersion
  playerValues: readonly PlayerValueResult[]
  categoryScores: Record<ScoringCategoryKey, number>
  baseOverallScore: number
  adjustments: readonly OverallAdjustment[]
  projectedWinsBeforePerfectCheck: number
  perfectRequirementsMet: boolean
}

export interface ScoringCalculation<TPlayer extends ScoringPlayer = ScoringPlayer> {
  result: DraftResult<TPlayer>
  diagnostics: ScoringDiagnostics
}
