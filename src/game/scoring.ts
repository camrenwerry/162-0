import { ROSTER_SLOTS, type Hitter, type Pitcher, type Position, type Roster } from '../types/draft'

export interface CategoryScore {
  score: number
  grade: string
}

export interface ProjectedResult {
  wins: number
  losses: number
  letterGrade: string
  tierLabel: string
  overallTeamStrength: number
  offense: CategoryScore
  defense: CategoryScore
  pitching: CategoryScore
  startingPitching: CategoryScore
  reliefPitching: CategoryScore
  speed: CategoryScore
  rosterBalance: CategoryScore
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value))
const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

function grade(score: number) {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A−'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B−'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C−'
  if (score >= 65) return 'D'
  return 'F'
}

const category = (value: number): CategoryScore => {
  const score = Math.round(clamp(value))
  return { score, grade: grade(score) }
}

function hitterOffense(player: Hitter) {
  const { plateAppearances, obp, slg, wrcPlus } = player.scoringStats
  const warRate = (player.stats.war ?? 0) / Math.max(1, plateAppearances / 650)
  const durability = clamp(plateAppearances / 45, 20, 100)
  return clamp(
    50
    + (wrcPlus - 100) * .38
    + (obp - .320) * 80
    + (slg - .400) * 45
    + (warRate - 2) * 2.2
    + (durability - 70) * .08,
  )
}

function hitterDefense(player: Hitter, position: Position) {
  if (position === 'DH') return 50
  const positionPremium: Partial<Record<Position, number>> = { C: 5, SS: 5, CF: 3, '2B': 2, '3B': 1 }
  return clamp(70 + player.scoringStats.defensiveValue * 2 + (positionPremium[position] ?? 0))
}

function hitterSpeed(player: Hitter) {
  const opportunities = Math.max(1, player.scoringStats.plateAppearances / 650)
  return clamp(58 + (player.scoringStats.baserunningValue / opportunities) * 2.5)
}

function pitcherValue(player: Pitcher, role: 'SP' | 'RP') {
  const { inningsPitched, whip, fip, strikeoutRate, walkRate, starts, reliefAppearances } = player.scoringStats
  const warRate = (player.stats.war ?? 0) / Math.max(1, inningsPitched / 200)
  const roleShare = role === 'SP'
    ? starts / Math.max(1, starts + reliefAppearances)
    : reliefAppearances / Math.max(1, starts + reliefAppearances)
  const workloadTarget = role === 'SP' ? 900 : 250
  const workload = clamp(inningsPitched / workloadTarget * 100, 20, 100)
  return clamp(
    48
    + ((player.stats.eraPlus ?? 100) - 100) * .3
    + (1.3 - whip) * 22
    + (4.2 - fip) * 4
    + (strikeoutRate - walkRate - 4) * 1.8
    + (warRate - 2) * 2
    + (roleShare - .5) * 9
    + (workload - 60) * .07,
  )
}

function tierForWins(wins: number) {
  if (wins === 162) return 'Perfect Season'
  if (wins >= 145) return 'All-Time Dynasty'
  if (wins >= 120) return 'World Series Favorite'
  if (wins >= 100) return 'Championship Contender'
  if (wins >= 88) return 'Playoff Team'
  if (wins >= 76) return 'Competitive'
  return 'Rebuild'
}

export function projectRoster(roster: Roster): ProjectedResult {
  const hitterEntries = ROSTER_SLOTS
    .filter((slot) => !['SP', 'RP'].includes(slot.position))
    .flatMap((slot) => {
      const player = roster[slot.id]
      return player?.type === 'hitter' ? [{ player, position: slot.position as Position }] : []
    })

  const offenseScore = average(hitterEntries.map(({ player }) => hitterOffense(player)))
  const defenseScore = average(hitterEntries.map(({ player, position }) => hitterDefense(player, position)))
  const speedScore = average(hitterEntries.map(({ player }) => hitterSpeed(player)))

  const starterScores = (['SP1', 'SP2', 'SP3'] as const).flatMap((slot) => {
    const player = roster[slot]
    return player?.type === 'pitcher' ? [pitcherValue(player, 'SP')] : []
  })
  const relieverScores = (['RP1', 'RP2'] as const).flatMap((slot) => {
    const player = roster[slot]
    return player?.type === 'pitcher' ? [pitcherValue(player, 'RP')] : []
  })
  const startingPitchingScore = average(starterScores)
  const reliefPitchingScore = average(relieverScores)
  const pitchingScore = startingPitchingScore * .62 + reliefPitchingScore * .38

  const filled = ROSTER_SLOTS.filter((slot) => roster[slot.id]).length
  const uniqueFranchises = new Set(Object.values(roster).map((player) => player.franchiseId)).size
  const uniqueDecades = new Set(Object.values(roster).map((player) => player.decade)).size
  const hitterSpread = hitterEntries.map(({ player }) => hitterOffense(player))
  const spread = hitterSpread.length ? Math.max(...hitterSpread) - Math.min(...hitterSpread) : 100
  const balanceScore = clamp(
    (filled / ROSTER_SLOTS.length) * 65
    + Math.min(uniqueFranchises, 6) * 2.5
    + Math.min(uniqueDecades, 4) * 2.5
    + Math.max(0, 10 - spread * .15),
  )

  const overall = clamp(
    offenseScore * .34
    + defenseScore * .14
    + startingPitchingScore * .19
    + reliefPitchingScore * .14
    + speedScore * .06
    + balanceScore * .13,
  )

  // Tunable curve: elite drafts cluster around 100–125 wins; perfection
  // requires a near-max category profile rather than one outlier card.
  const wins = Math.round(clamp(45 + overall * .9 + Math.max(0, overall - 90) * 2.7, 62, 162))

  return {
    wins,
    losses: 162 - wins,
    letterGrade: grade(overall),
    tierLabel: tierForWins(wins),
    overallTeamStrength: Math.round(overall),
    offense: category(offenseScore),
    defense: category(defenseScore),
    pitching: category(pitchingScore),
    startingPitching: category(startingPitchingScore),
    reliefPitching: category(reliefPitchingScore),
    speed: category(speedScore),
    rosterBalance: category(balanceScore),
  }
}
