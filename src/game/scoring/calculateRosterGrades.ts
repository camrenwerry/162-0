import type { LetterGrade, Roster, ScoringCategoryKey } from '../../types/draft'
import { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from './calculatePlayerValue'
import { BALANCE_WEIGHTS, CATEGORY_COMPONENT_WEIGHTS, CATEGORY_WEIGHTS, GRADE_THRESHOLDS, OVERALL_ADJUSTMENTS } from './scoringConfig'
import { average, clamp, roundScore } from './normalization'
import type { OverallAdjustment, PlayerValueResult } from './types'

const HITTER_SLOT_IDS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const
const FIELDING_SLOT_IDS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const
const STARTER_SLOT_IDS = ['SP1', 'SP2', 'SP3'] as const
const RELIEVER_SLOT_IDS = ['RP1', 'RP2'] as const

const averageWithExpectedCount = (values: readonly number[], expectedCount: number) => values.reduce((total, value) => total + value, 0) / expectedCount

export function gradeForScore(score: number): LetterGrade {
  return GRADE_THRESHOLDS.find(({ minimum }) => score >= minimum)?.grade ?? 'F'
}

export interface RosterGradeCalculation {
  categoryScores: Record<ScoringCategoryKey, number>
  categoryGrades: Record<ScoringCategoryKey, LetterGrade>
  playerValues: readonly PlayerValueResult[]
  baseOverallScore: number
  adjustments: readonly OverallAdjustment[]
}

export function calculateRosterGrades(roster: Roster): RosterGradeCalculation {
  const hitterValues = HITTER_SLOT_IDS.flatMap((slotId) => {
    const player = roster[slotId]
    return player && player.playerType !== 'pitcher'
      ? [calculateHitterValue(player, slotId, slotId)]
      : []
  })
  const starterValues = STARTER_SLOT_IDS.flatMap((slotId) => {
    const player = roster[slotId]
    return player && player.playerType !== 'hitter' ? [calculateStartingPitcherValue(player, slotId)] : []
  })
  const relieverValues = RELIEVER_SLOT_IDS.flatMap((slotId) => {
    const player = roster[slotId]
    return player && player.playerType !== 'hitter' ? [calculateReliefPitcherValue(player, slotId)] : []
  })
  const playerValues = [...hitterValues, ...starterValues, ...relieverValues]

  const offense = averageWithExpectedCount(hitterValues.map(({ facets }) => facets.offense), HITTER_SLOT_IDS.length)
  const power = averageWithExpectedCount(hitterValues.map(({ facets }) => facets.power), HITTER_SLOT_IDS.length)
  const contact = averageWithExpectedCount(hitterValues.map(({ facets }) => facets.contact), HITTER_SLOT_IDS.length)
  const speed = averageWithExpectedCount(hitterValues.map(({ facets }) => facets.speed), HITTER_SLOT_IDS.length)
  const defenseValues = FIELDING_SLOT_IDS.map((slotId) => hitterValues.find((value) => value.slotId === slotId)?.facets.defense ?? 0)
  const defense = average(defenseValues)
  const startingPitching = averageWithExpectedCount(starterValues.map(({ value }) => value), STARTER_SLOT_IDS.length)
  const reliefPitching = averageWithExpectedCount(relieverValues.map(({ value }) => value), RELIEVER_SLOT_IDS.length)

  const majorFloor = Math.min(offense, defense, startingPitching, reliefPitching)
  const lineupDepth = Math.min(...HITTER_SLOT_IDS.map((slotId) => hitterValues.find((value) => value.slotId === slotId)?.value ?? 0))
  const rotationDepth = Math.min(...STARTER_SLOT_IDS.map((slotId) => starterValues.find((value) => value.slotId === slotId)?.value ?? 0))
  const bullpenDepth = Math.min(...RELIEVER_SLOT_IDS.map((slotId) => relieverValues.find((value) => value.slotId === slotId)?.value ?? 0))
  const productionMix = clamp(
    100
    - Math.abs(power - contact) * CATEGORY_COMPONENT_WEIGHTS.powerContactDifferenceRate
    + (speed - 50) * CATEGORY_COMPONENT_WEIGHTS.speedBalanceRate,
  )
  const rosterBalance = (
    majorFloor * BALANCE_WEIGHTS.majorCategoryFloor
    + lineupDepth * BALANCE_WEIGHTS.lineupDepth
    + rotationDepth * BALANCE_WEIGHTS.rotationDepth
    + bullpenDepth * BALANCE_WEIGHTS.bullpenDepth
    + productionMix * BALANCE_WEIGHTS.powerContactMix
  )

  const baseOverallScore = (
    offense * CATEGORY_WEIGHTS.offense
    + defense * CATEGORY_WEIGHTS.defense
    + startingPitching * CATEGORY_WEIGHTS.startingPitching
    + reliefPitching * CATEGORY_WEIGHTS.reliefPitching
    + speed * CATEGORY_WEIGHTS.speed
    + rosterBalance * CATEGORY_WEIGHTS.rosterBalance
  )
  const adjustments: OverallAdjustment[] = []
  const weakestMajor = Math.min(offense, defense, startingPitching, reliefPitching)
  if (weakestMajor < OVERALL_ADJUSTMENTS.weakCategoryThreshold) {
    adjustments.push({
      label: 'extremely weak major category',
      value: -Math.min(OVERALL_ADJUSTMENTS.weakCategoryMaximum, (OVERALL_ADJUSTMENTS.weakCategoryThreshold - weakestMajor) * OVERALL_ADJUSTMENTS.weakCategoryRate),
    })
  }
  if (rotationDepth < OVERALL_ADJUSTMENTS.weakRotationThreshold) {
    adjustments.push({
      label: 'poor rotation depth',
      value: -Math.min(OVERALL_ADJUSTMENTS.weakRotationMaximum, (OVERALL_ADJUSTMENTS.weakRotationThreshold - rotationDepth) * OVERALL_ADJUSTMENTS.weakRotationRate),
    })
  }
  if (bullpenDepth < OVERALL_ADJUSTMENTS.weakBullpenThreshold) {
    adjustments.push({
      label: 'poor bullpen depth',
      value: -Math.min(OVERALL_ADJUSTMENTS.weakBullpenMaximum, (OVERALL_ADJUSTMENTS.weakBullpenThreshold - bullpenDepth) * OVERALL_ADJUSTMENTS.weakBullpenRate),
    })
  }
  if (defense < OVERALL_ADJUSTMENTS.weakDefenseThreshold) {
    adjustments.push({
      label: 'unusually weak defense',
      value: -Math.min(OVERALL_ADJUSTMENTS.weakDefenseMaximum, (OVERALL_ADJUSTMENTS.weakDefenseThreshold - defense) * OVERALL_ADJUSTMENTS.weakDefenseRate),
    })
  }
  if ([offense, defense, startingPitching, reliefPitching].every((score) => score >= OVERALL_ADJUSTMENTS.allStrongThreshold)) {
    adjustments.push({ label: 'strong in every major category', value: OVERALL_ADJUSTMENTS.allStrongBonus })
  }
  if (rosterBalance >= OVERALL_ADJUSTMENTS.exceptionalBalanceThreshold) {
    adjustments.push({ label: 'exceptional roster balance', value: OVERALL_ADJUSTMENTS.exceptionalBalanceBonus })
  }
  const overall = clamp(baseOverallScore + adjustments.reduce((total, adjustment) => total + adjustment.value, 0))
  const categoryScores: Record<ScoringCategoryKey, number> = {
    offense: roundScore(offense), power: roundScore(power), contact: roundScore(contact), speed: roundScore(speed),
    defense: roundScore(defense), startingPitching: roundScore(startingPitching), reliefPitching: roundScore(reliefPitching),
    rosterBalance: roundScore(rosterBalance), overall: roundScore(overall),
  }
  const categoryGrades = Object.fromEntries(
    Object.entries(categoryScores).map(([key, score]) => [key, gradeForScore(score)]),
  ) as Record<ScoringCategoryKey, LetterGrade>

  return { categoryScores, categoryGrades, playerValues, baseOverallScore: roundScore(baseOverallScore), adjustments }
}
