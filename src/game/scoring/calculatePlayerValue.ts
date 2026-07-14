import type { Hitter, Pitcher, Position, RosterSlotId, TwoWayPlayer } from '../../types/draft'
import { CATEGORY_COMPONENT_WEIGHTS, NORMALIZATION_RANGES, PLAYER_WEIGHTS, POSITIONAL_ADJUSTMENTS, RATE_SCALES } from './scoringConfig'
import { average, clamp, confidenceFor, normalizeMetric, roundScore, weightedScore } from './normalization'
import type { MetricContribution, MetricRange, PlayerValueResult } from './types'

type PendingContribution = Omit<MetricContribution, 'appliedWeight'>

const contribution = (metric: string, rawValue: number | null | undefined, configuredWeight: number, range: MetricRange): PendingContribution | null => (
  rawValue === null || rawValue === undefined || !Number.isFinite(rawValue)
    ? null
    : { metric, rawValue, configuredWeight, normalizedValue: normalizeMetric(rawValue, range) }
)

const compact = (components: Array<PendingContribution | null>) => components.filter((value): value is PendingContribution => value !== null)
const pace = (value: number | null, opportunities: number, scale: number) => value === null || opportunities <= 0 ? null : value / opportunities * scale

export function calculateHitterValue(
  player: Hitter | TwoWayPlayer,
  position: Exclude<Position, 'SP' | 'RP'>,
  slotId: RosterSlotId,
): PlayerValueResult {
  const stats = player.visibleStats
  const scoring = player.scoringStats
  const weights = PLAYER_WEIGHTS.hitter
  const ranges = NORMALIZATION_RANGES.hitter
  const hrRate = pace(stats.hr, scoring.plateAppearances, RATE_SCALES.hitterPlateAppearances)
  const rbiRate = pace(stats.rbi, scoring.plateAppearances, RATE_SCALES.hitterPlateAppearances)
  const sbRate = pace(stats.sb, scoring.plateAppearances, RATE_SCALES.hitterPlateAppearances)
  const durabilityScore = average([
    normalizeMetric(scoring.games, ranges.games),
    normalizeMetric(scoring.plateAppearances, ranges.plateAppearances),
  ])
  const speedMetric = scoring.baserunningValue !== null
    ? contribution('baserunning', scoring.baserunningValue, weights.speed, ranges.baserunning)
    : contribution('stolenBaseRate', sbRate, weights.speed, ranges.sbRate)
  const positionAdjustment = POSITIONAL_ADJUSTMENTS[position]
  const defenseScore = position === 'DH'
    ? 0
    : clamp((scoring.defensiveValue === null ? 50 : normalizeMetric(scoring.defensiveValue, ranges.defense)) + positionAdjustment)

  const components = compact([
    contribution('era-adjusted offense', scoring.eraAdjustedOffense, weights.context, ranges.eraAdjustedOffense),
    contribution('OPS', stats.ops, weights.ops, ranges.ops),
    contribution('OBP', stats.obp, weights.obp, ranges.obp),
    contribution('SLG', stats.slg, weights.slg, ranges.slg),
    contribution('HR/650 PA', hrRate, weights.hr, ranges.hrRate),
    contribution('RBI/650 PA', rbiRate, weights.rbi, ranges.rbiRate),
    speedMetric,
    { metric: 'durability', rawValue: scoring.plateAppearances, normalizedValue: durabilityScore, configuredWeight: weights.durability },
    { metric: `defense at ${position}`, rawValue: scoring.defensiveValue ?? positionAdjustment, normalizedValue: defenseScore, configuredWeight: weights.defense },
  ])
  const weighted = weightedScore(components)

  const offenseComponents = components.filter(({ metric }) => ['era-adjusted offense', 'OPS', 'OBP', 'SLG', 'HR/650 PA', 'RBI/650 PA'].includes(metric))
  const powerComponents = components.filter(({ metric }) => ['SLG', 'HR/650 PA'].includes(metric))
  const contactComponents = compact([
    contribution('AVG', stats.avg, CATEGORY_COMPONENT_WEIGHTS.contact.avg, ranges.avg),
    contribution('OBP', stats.obp, CATEGORY_COMPONENT_WEIGHTS.contact.obp, ranges.obp),
    contribution('OPS', stats.ops, CATEGORY_COMPONENT_WEIGHTS.contact.ops, ranges.ops),
  ])

  return {
    playerId: player.id,
    playerName: player.name,
    slotId,
    position,
    role: 'hitter',
    value: roundScore(weighted.score),
    confidence: confidenceFor(weighted.availableWeight, weighted.components.length),
    availableWeight: weighted.availableWeight,
    components: weighted.components,
    facets: {
      offense: roundScore(weightedScore(offenseComponents).score),
      power: roundScore(weightedScore(powerComponents).score),
      contact: roundScore(weightedScore(contactComponents).score),
      speed: roundScore(speedMetric?.normalizedValue ?? 50),
      defense: roundScore(defenseScore),
      durability: roundScore(durabilityScore),
    },
  }
}

function pitcherData(player: Pitcher | TwoWayPlayer) {
  if (player.playerType === 'pitcher') return { stats: player.visibleStats, scoring: player.scoringStats }
  return { stats: player.pitchingVisibleStats, scoring: player.pitchingScoringStats }
}

export function calculateStartingPitcherValue(player: Pitcher | TwoWayPlayer, slotId: RosterSlotId): PlayerValueResult {
  const { stats, scoring } = pitcherData(player)
  const weights = PLAYER_WEIGHTS.starter
  const ranges = NORMALIZATION_RANGES.starter
  const strikeoutRate = stats.so === null || scoring.inningsPitched <= 0 ? null : stats.so / scoring.inningsPitched * RATE_SCALES.pitcherInnings
  const rateProxy = scoring.fip !== null
    ? contribution('FIP', scoring.fip, weights.ratePerformance, ranges.fip)
    : scoring.strikeoutRate !== null && scoring.walkRate !== null
      ? contribution('K-BB rate proxy', scoring.strikeoutRate - scoring.walkRate, weights.ratePerformance, ranges.rateProxy)
      : null
  const starts = scoring.starts ?? scoring.gamesStarted ?? 0
  const components = compact([
    contribution('era-adjusted pitching', scoring.eraAdjustedPitching, weights.context, ranges.eraAdjustedPitching),
    contribution('ERA', stats.era, weights.era, ranges.era),
    contribution('WHIP', stats.whip, weights.whip, ranges.whip),
    contribution('innings', scoring.inningsPitched, weights.durability, ranges.innings),
    contribution('SO/9', strikeoutRate, weights.strikeouts, ranges.strikeoutRate),
    contribution('BB/9', scoring.walkRate, weights.walks, ranges.walkRate),
    rateProxy,
    contribution('starts', starts, weights.starts, ranges.starts),
  ])
  const weighted = weightedScore(components)
  const durability = average([
    normalizeMetric(scoring.inningsPitched, ranges.innings),
    normalizeMetric(starts, ranges.starts),
  ])
  return {
    playerId: player.id, playerName: player.name, slotId, position: 'SP', role: 'SP',
    value: roundScore(weighted.score),
    confidence: confidenceFor(weighted.availableWeight, weighted.components.length),
    availableWeight: weighted.availableWeight,
    components: weighted.components,
    facets: { offense: 0, power: 0, contact: 0, speed: 0, defense: 0, durability: roundScore(durability) },
  }
}

export function calculateReliefPitcherValue(player: Pitcher | TwoWayPlayer, slotId: RosterSlotId): PlayerValueResult {
  const { stats, scoring } = pitcherData(player)
  const weights = PLAYER_WEIGHTS.reliever
  const ranges = NORMALIZATION_RANGES.reliever
  const strikeoutRate = stats.so === null || scoring.inningsPitched <= 0 ? null : stats.so / scoring.inningsPitched * RATE_SCALES.pitcherInnings
  const rateProxy = scoring.fip !== null
    ? contribution('FIP', scoring.fip, weights.ratePerformance, ranges.fip)
    : scoring.strikeoutRate !== null && scoring.walkRate !== null
      ? contribution('K-BB rate proxy', scoring.strikeoutRate - scoring.walkRate, weights.ratePerformance, ranges.rateProxy)
      : null
  const components = compact([
    contribution('era-adjusted pitching', scoring.eraAdjustedPitching, weights.context, ranges.eraAdjustedPitching),
    contribution('ERA', stats.era, weights.era, ranges.era),
    contribution('WHIP', stats.whip, weights.whip, ranges.whip),
    contribution('saves', stats.sv, weights.saves, ranges.saves),
    contribution('SO/9', strikeoutRate, weights.strikeouts, ranges.strikeoutRate),
    contribution('BB/9', scoring.walkRate, weights.walks, ranges.walkRate),
    contribution('relief appearances', scoring.reliefAppearances, weights.workload, ranges.appearances),
    rateProxy,
  ])
  const weighted = weightedScore(components)
  return {
    playerId: player.id, playerName: player.name, slotId, position: 'RP', role: 'RP',
    value: roundScore(weighted.score),
    confidence: confidenceFor(weighted.availableWeight, weighted.components.length),
    availableWeight: weighted.availableWeight,
    components: weighted.components,
    facets: {
      offense: 0, power: 0, contact: 0, speed: 0, defense: 0,
      durability: roundScore(normalizeMetric(scoring.reliefAppearances, ranges.appearances)),
    },
  }
}
