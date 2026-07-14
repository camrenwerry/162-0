import type { LetterGrade, Position } from '../../types/draft'
import type { MetricRange } from './types'

// All v2.0 tuning values live here. Ranges map poor/average/excellent/elite
// featured-season performances onto the common 0–100 scoring scale.
export const SCORING_VERSION = '2.0' as const

export const NORMALIZATION_SCORE_ANCHORS = {
  poor: 15,
  average: 50,
  excellent: 80,
  elite: 97,
} as const

export const RATE_SCALES = {
  hitterPlateAppearances: 650,
  pitcherInnings: 9,
} as const

export const NORMALIZATION_RANGES = {
  hitter: {
    eraAdjustedOffense: { poor: 65, average: 100, excellent: 135, elite: 190, direction: 'higher' },
    ops: { poor: .5, average: .72, excellent: .9, elite: 1.2, direction: 'higher' },
    opsPlus: { poor: 70, average: 100, excellent: 130, elite: 180, direction: 'higher' },
    war: { poor: -1, average: 2, excellent: 5, elite: 10, direction: 'higher' },
    avg: { poor: .210, average: .260, excellent: .310, elite: .370, direction: 'higher' },
    obp: { poor: .270, average: .325, excellent: .390, elite: .470, direction: 'higher' },
    slg: { poor: .330, average: .420, excellent: .540, elite: .720, direction: 'higher' },
    hrRate: { poor: 2, average: 18, excellent: 35, elite: 60, direction: 'higher' },
    rbiRate: { poor: 25, average: 75, excellent: 110, elite: 155, direction: 'higher' },
    sbRate: { poor: 0, average: 8, excellent: 28, elite: 65, direction: 'higher' },
    baserunning: { poor: -6, average: 0, excellent: 5, elite: 11, direction: 'higher' },
    games: { poor: 45, average: 120, excellent: 150, elite: 162, direction: 'higher' },
    plateAppearances: { poor: 140, average: 500, excellent: 650, elite: 750, direction: 'higher' },
    defense: { poor: -15, average: 0, excellent: 10, elite: 25, direction: 'higher' },
  },
  starter: {
    eraAdjustedPitching: { poor: 65, average: 100, excellent: 140, elite: 220, direction: 'higher' },
    eraPlus: { poor: 70, average: 100, excellent: 135, elite: 200, direction: 'higher' },
    war: { poor: -1, average: 2, excellent: 5, elite: 10, direction: 'higher' },
    era: { poor: 6, average: 4.2, excellent: 3, elite: 1.5, direction: 'lower' },
    whip: { poor: 1.7, average: 1.3, excellent: 1.08, elite: .78, direction: 'lower' },
    innings: { poor: 50, average: 150, excellent: 210, elite: 270, direction: 'higher' },
    strikeoutRate: { poor: 3, average: 7, excellent: 10, elite: 14, direction: 'higher' },
    walkRate: { poor: 7, average: 3.5, excellent: 2, elite: .5, direction: 'lower' },
    fip: { poor: 6, average: 4.2, excellent: 3, elite: 1.7, direction: 'lower' },
    rateProxy: { poor: -1, average: 4, excellent: 8, elite: 14, direction: 'higher' },
    starts: { poor: 5, average: 25, excellent: 32, elite: 36, direction: 'higher' },
  },
  reliever: {
    eraAdjustedPitching: { poor: 65, average: 100, excellent: 145, elite: 240, direction: 'higher' },
    eraPlus: { poor: 70, average: 100, excellent: 140, elite: 220, direction: 'higher' },
    war: { poor: -1, average: 1, excellent: 2.5, elite: 5, direction: 'higher' },
    era: { poor: 6, average: 4.1, excellent: 2.8, elite: 1.2, direction: 'lower' },
    whip: { poor: 1.7, average: 1.3, excellent: 1.05, elite: .72, direction: 'lower' },
    saves: { poor: 0, average: 10, excellent: 32, elite: 55, direction: 'higher' },
    strikeoutRate: { poor: 3, average: 8, excellent: 12, elite: 16, direction: 'higher' },
    walkRate: { poor: 7, average: 3.5, excellent: 2, elite: .5, direction: 'lower' },
    appearances: { poor: 12, average: 45, excellent: 70, elite: 90, direction: 'higher' },
    fip: { poor: 6, average: 4.1, excellent: 2.8, elite: 1.5, direction: 'lower' },
    rateProxy: { poor: -1, average: 5, excellent: 10, elite: 16, direction: 'higher' },
  },
} as const satisfies Record<string, Record<string, MetricRange>>

// Player weights are redistributed proportionally when a source metric is null.
export const PLAYER_WEIGHTS = {
  hitter: { context: .25, ops: .20, obp: .10, slg: .10, hr: .08, rbi: .06, speed: .05, durability: .10, defense: .06 },
  starter: { context: .27, era: .16, whip: .14, durability: .14, strikeouts: .10, walks: .07, starts: .08, ratePerformance: .04 },
  reliever: { context: .25, era: .16, whip: .14, saves: .12, strikeouts: .11, walks: .08, workload: .10, ratePerformance: .04 },
} as const

// Small assignment-position adjustments; these cannot outweigh player quality.
export const POSITIONAL_ADJUSTMENTS: Record<Extract<Position, 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH'>, number> = {
  C: 8, SS: 7, CF: 6, '2B': 5, '3B': 4, RF: 3, LF: 2, '1B': 1, DH: 0,
}

export const CONFIDENCE_CONFIG = {
  minimumUsableWeight: .35,
  highWeight: .85,
  mediumWeight: .60,
  highMetricCount: 6,
  mediumMetricCount: 4,
  neutralFallbackScore: 50,
} as const

export const CATEGORY_WEIGHTS = {
  offense: .32,
  defense: .18,
  startingPitching: .25,
  reliefPitching: .12,
  speed: .05,
  rosterBalance: .08,
} as const

export const BALANCE_WEIGHTS = {
  majorCategoryFloor: .25,
  lineupDepth: .20,
  rotationDepth: .20,
  bullpenDepth: .15,
  powerContactMix: .20,
} as const

export const CATEGORY_COMPONENT_WEIGHTS = {
  contact: { avg: 1, obp: 1.4, ops: .6 },
  powerContactDifferenceRate: 1.5,
} as const

// Modest caps ensure quality remains more important than bonuses or penalties.
export const OVERALL_ADJUSTMENTS = {
  weakCategoryThreshold: 45,
  weakCategoryRate: .12,
  weakCategoryMaximum: 4,
  weakRotationThreshold: 45,
  weakRotationRate: .08,
  weakRotationMaximum: 2,
  weakBullpenThreshold: 45,
  weakBullpenRate: .08,
  weakBullpenMaximum: 2,
  weakDefenseThreshold: 45,
  weakDefenseRate: .08,
  weakDefenseMaximum: 2,
  allStrongThreshold: 78,
  allStrongBonus: 2,
  exceptionalBalanceThreshold: 88,
  exceptionalBalanceBonus: 1,
} as const

export const GRADE_THRESHOLDS: ReadonlyArray<{ minimum: number; grade: LetterGrade }> = [
  { minimum: 97, grade: 'S' },
  { minimum: 93, grade: 'A+' },
  { minimum: 89, grade: 'A' },
  { minimum: 85, grade: 'A-' },
  { minimum: 81, grade: 'B+' },
  { minimum: 77, grade: 'B' },
  { minimum: 73, grade: 'B-' },
  { minimum: 69, grade: 'C+' },
  { minimum: 62, grade: 'C' },
  { minimum: 54, grade: 'D' },
  { minimum: 0, grade: 'F' },
]

// Piecewise points keep the record deterministic and make the upper tail steep.
export const WIN_CURVE = {
  seasonGames: 162,
  minimumWins: 55,
  maximumNonPerfectWins: 161,
  points: [
    { score: 0, wins: 55 }, { score: 40, wins: 68 }, { score: 50, wins: 76 },
    { score: 60, wins: 85 }, { score: 70, wins: 96 }, { score: 80, wins: 108 },
    { score: 88, wins: 120 }, { score: 94, wins: 134 }, { score: 97, wins: 146 },
    { score: 99, wins: 156 }, { score: 100, wins: 161 },
  ],
  perfect: {
    overallMinimum: 99.5,
    majorCategoryMinimum: 98,
    balanceMinimum: 98,
    weakestPlayerMinimum: 90,
  },
} as const

export const TIER_THRESHOLDS = [
  { minimumWins: 162, label: 'Perfect Season' },
  { minimumWins: 150, label: 'Near Perfect' },
  { minimumWins: 130, label: 'Historic Dynasty' },
  { minimumWins: 115, label: 'All-Time Great' },
  { minimumWins: 105, label: 'World Series Favorite' },
  { minimumWins: 95, label: 'Championship Contender' },
  { minimumWins: 85, label: 'Playoff Contender' },
  { minimumWins: 75, label: 'Competitive' },
  { minimumWins: 0, label: 'Rebuild' },
] as const
