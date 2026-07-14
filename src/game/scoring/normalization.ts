import { CONFIDENCE_CONFIG, NORMALIZATION_SCORE_ANCHORS } from './scoringConfig'
import type { MetricContribution, MetricRange, ScoringConfidence } from './types'

export const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value))

const interpolate = (value: number, leftValue: number, rightValue: number, leftScore: number, rightScore: number) => {
  if (rightValue === leftValue) return rightScore
  return leftScore + ((value - leftValue) / (rightValue - leftValue)) * (rightScore - leftScore)
}

export function normalizeMetric(value: number, range: MetricRange) {
  const orientedValue = range.direction === 'higher' ? value : -value
  const anchors = [range.poor, range.average, range.excellent, range.elite]
    .map((anchor) => range.direction === 'higher' ? anchor : -anchor)
  const scores = [
    NORMALIZATION_SCORE_ANCHORS.poor,
    NORMALIZATION_SCORE_ANCHORS.average,
    NORMALIZATION_SCORE_ANCHORS.excellent,
    NORMALIZATION_SCORE_ANCHORS.elite,
  ]
  if (orientedValue <= anchors[0]) return clamp(interpolate(orientedValue, anchors[0] - (anchors[1] - anchors[0]), anchors[0], 0, scores[0]))
  for (let index = 1; index < anchors.length; index += 1) {
    if (orientedValue <= anchors[index]) return clamp(interpolate(orientedValue, anchors[index - 1], anchors[index], scores[index - 1], scores[index]))
  }
  return clamp(interpolate(orientedValue, anchors[3], anchors[3] + Math.max(anchors[3] - anchors[2], .0001), scores[3], 100))
}

export function weightedScore(components: ReadonlyArray<Omit<MetricContribution, 'appliedWeight'>>) {
  const availableWeight = components.reduce((total, component) => total + component.configuredWeight, 0)
  if (!availableWeight) return { score: CONFIDENCE_CONFIG.neutralFallbackScore, availableWeight: 0, components: [] as MetricContribution[] }
  const normalizedComponents = components.map((component) => ({ ...component, appliedWeight: component.configuredWeight / availableWeight }))
  const availableScore = normalizedComponents.reduce((total, component) => total + component.normalizedValue * component.appliedWeight, 0)
  const coverageFactor = Math.min(1, availableWeight / CONFIDENCE_CONFIG.minimumUsableWeight)
  const score = availableScore * coverageFactor + CONFIDENCE_CONFIG.neutralFallbackScore * (1 - coverageFactor)
  return { score: clamp(score), availableWeight, components: normalizedComponents }
}

export function confidenceFor(availableWeight: number, metricCount: number): ScoringConfidence {
  if (availableWeight >= CONFIDENCE_CONFIG.highWeight && metricCount >= CONFIDENCE_CONFIG.highMetricCount) return 'high'
  if (availableWeight >= CONFIDENCE_CONFIG.mediumWeight && metricCount >= CONFIDENCE_CONFIG.mediumMetricCount) return 'medium'
  return 'low'
}

export const average = (values: readonly number[], fallback = 0) => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : fallback

export const roundScore = (value: number) => Math.round(clamp(value) * 10) / 10
