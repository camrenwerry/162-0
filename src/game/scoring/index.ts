import type { DraftResult, Roster, ScoringCategoryKey } from '../../types/draft'
import { calculateProjectedRecord } from './calculateProjectedRecord'
import { calculateRosterGrades } from './calculateRosterGrades'
import { SCORING_VERSION } from './scoringConfig'
import type { ScoringCalculation, ScoringDiagnostics } from './types'

const SUMMARY_CATEGORIES: Array<Exclude<ScoringCategoryKey, 'overall'>> = [
  'offense', 'defense', 'startingPitching', 'reliefPitching', 'rosterBalance',
]

export function calculateDraftResult(roster: Roster): ScoringCalculation {
  const grades = calculateRosterGrades(roster)
  const projection = calculateProjectedRecord(grades.categoryScores, grades.playerValues)
  const rankedCategories = [...SUMMARY_CATEGORIES].sort((left, right) => (
    grades.categoryScores[right] - grades.categoryScores[left] || left.localeCompare(right)
  ))
  const bestPlayer = [...grades.playerValues].sort((left, right) => right.value - left.value || left.playerName.localeCompare(right.playerName))[0]
  const result: DraftResult = {
    wins: projection.wins,
    losses: projection.losses,
    overallScore: grades.categoryScores.overall,
    overallGrade: grades.categoryGrades.overall,
    tierLabel: projection.tierLabel,
    categoryScores: grades.categoryScores,
    categoryGrades: grades.categoryGrades,
    roster: { ...roster },
    strongestCategory: rankedCategories[0],
    weakestCategory: rankedCategories.at(-1) ?? 'rosterBalance',
    bestPlayerValue: bestPlayer ? {
      playerId: bestPlayer.playerId,
      playerName: bestPlayer.playerName,
      slotId: bestPlayer.slotId,
      position: bestPlayer.position,
      value: bestPlayer.value,
    } : null,
    scoringVersion: SCORING_VERSION,
  }
  const diagnostics: ScoringDiagnostics = {
    scoringVersion: SCORING_VERSION,
    playerValues: grades.playerValues,
    categoryScores: grades.categoryScores,
    baseOverallScore: grades.baseOverallScore,
    adjustments: grades.adjustments,
    projectedWinsBeforePerfectCheck: projection.winsBeforePerfectCheck,
    perfectRequirementsMet: projection.perfectRequirementsMet,
  }
  return { result, diagnostics }
}

export { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from './calculatePlayerValue'
export { calculateProjectedRecord, tierForWins } from './calculateProjectedRecord'
export { calculateRosterGrades, gradeForScore } from './calculateRosterGrades'
export { normalizeMetric, weightedScore } from './normalization'
export * from './types'
