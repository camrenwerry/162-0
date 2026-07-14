import type { ScoringCategoryKey } from '../../types/draft'
import { TIER_THRESHOLDS, WIN_CURVE } from './scoringConfig'
import { clamp } from './normalization'
import type { PlayerValueResult } from './types'

export interface ProjectedRecord {
  wins: number
  losses: number
  tierLabel: string
  winsBeforePerfectCheck: number
  perfectRequirementsMet: boolean
}

function winsFromCurve(score: number) {
  const points = WIN_CURVE.points
  const boundedScore = clamp(score)
  for (let index = 1; index < points.length; index += 1) {
    if (boundedScore > points[index].score) continue
    const left = points[index - 1]
    const right = points[index]
    const progress = (boundedScore - left.score) / (right.score - left.score)
    return Math.round(left.wins + (right.wins - left.wins) * progress)
  }
  return WIN_CURVE.maximumNonPerfectWins
}

export function tierForWins(wins: number) {
  return TIER_THRESHOLDS.find(({ minimumWins }) => wins >= minimumWins)?.label ?? 'Rebuild'
}

export function calculateProjectedRecord(
  categoryScores: Record<ScoringCategoryKey, number>,
  playerValues: readonly PlayerValueResult[],
): ProjectedRecord {
  const winsBeforePerfectCheck = Math.min(WIN_CURVE.maximumNonPerfectWins, Math.max(WIN_CURVE.minimumWins, winsFromCurve(categoryScores.overall)))
  const majorScores = [categoryScores.offense, categoryScores.defense, categoryScores.startingPitching, categoryScores.reliefPitching]
  const weakestPlayer = playerValues.length ? Math.min(...playerValues.map(({ value }) => value)) : 0
  const perfectRequirementsMet = (
    categoryScores.overall >= WIN_CURVE.perfect.overallMinimum
    && majorScores.every((score) => score >= WIN_CURVE.perfect.majorCategoryMinimum)
    && categoryScores.rosterBalance >= WIN_CURVE.perfect.balanceMinimum
    && weakestPlayer >= WIN_CURVE.perfect.weakestPlayerMinimum
  )
  const wins = perfectRequirementsMet ? 162 : winsBeforePerfectCheck
  return { wins, losses: WIN_CURVE.seasonGames - wins, tierLabel: tierForWins(wins), winsBeforePerfectCheck, perfectRequirementsMet }
}
