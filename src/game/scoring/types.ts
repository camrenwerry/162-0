import type { ScoringVersion } from '../../config/versions'
import type { DraftResult, Position, RosterSlotId, ScoringCategoryKey } from '../../types/draft'

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

export interface ScoringCalculation {
  result: DraftResult
  diagnostics: ScoringDiagnostics
}
