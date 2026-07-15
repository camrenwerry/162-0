import type { LetterGrade, Position } from '../../types/draft'
import type { MetricRange } from './types'

// All v2.2 tuning values live here. Ranges map poor/average/excellent/elite
// featured-season performances onto the common 0–100 scoring scale.
export const SCORING_VERSION = '2.2' as const

export const NORMALIZATION_SCORE_ANCHORS = {
  poor: 35,
  average: 68,
  excellent: 89,
  elite: 98,
} as const

export const RATE_SCALES = {
  hitterPlateAppearances: 650,
  pitcherInnings: 9,
} as const

export const NORMALIZATION_RANGES = {
  hitter: {
    eraAdjustedOffense: { poor: 65, average: 100, excellent: 130, elite: 190, direction: 'higher' },
    ops: { poor: .5, average: .72, excellent: .88, elite: 1.2, direction: 'higher' },
    opsPlus: { poor: 70, average: 100, excellent: 130, elite: 180, direction: 'higher' },
    war: { poor: -1, average: 2, excellent: 5, elite: 10, direction: 'higher' },
    avg: { poor: .210, average: .260, excellent: .310, elite: .370, direction: 'higher' },
    obp: { poor: .270, average: .325, excellent: .380, elite: .470, direction: 'higher' },
    slg: { poor: .330, average: .420, excellent: .520, elite: .720, direction: 'higher' },
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
    eraAdjustedPitching: { poor: 65, average: 100, excellent: 130, elite: 220, direction: 'higher' },
    eraPlus: { poor: 70, average: 100, excellent: 140, elite: 220, direction: 'higher' },
    war: { poor: -1, average: 1, excellent: 2.5, elite: 5, direction: 'higher' },
    era: { poor: 6, average: 4.1, excellent: 2.8, elite: 1.2, direction: 'lower' },
    whip: { poor: 1.7, average: 1.3, excellent: 1.05, elite: .72, direction: 'lower' },
    saves: { poor: 0, average: 10, excellent: 32, elite: 55, direction: 'higher' },
    strikeoutRate: { poor: 3, average: 8, excellent: 11, elite: 16, direction: 'higher' },
    walkRate: { poor: 7, average: 3.5, excellent: 2, elite: .5, direction: 'lower' },
    appearances: { poor: 12, average: 45, excellent: 65, elite: 85, direction: 'higher' },
    fip: { poor: 6, average: 4.1, excellent: 2.8, elite: 1.5, direction: 'lower' },
    rateProxy: { poor: -1, average: 5, excellent: 10, elite: 16, direction: 'higher' },
  },
} as const satisfies Record<string, Record<string, MetricRange>>

// Player weights are redistributed proportionally when a source metric is null.
export const PLAYER_WEIGHTS = {
  hitter: { context: .27, ops: .21, obp: .11, slg: .11, hr: .08, rbi: .05, speed: .03, durability: .09, defense: .05 },
  starter: { context: .27, era: .16, whip: .14, durability: .14, strikeouts: .10, walks: .07, starts: .08, ratePerformance: .04 },
  reliever: { context: .28, era: .18, whip: .16, saves: .06, strikeouts: .12, walks: .08, workload: .09, ratePerformance: .03 },
} as const

// Small assignment-position adjustments; these cannot outweigh player quality.
export const POSITIONAL_ADJUSTMENTS: Record<Extract<Position, 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH'>, number> = {
  C: 4, SS: 3.5, CF: 3, '2B': 2.5, '3B': 2, RF: 1.5, LF: 1, '1B': .5, DH: 0,
}

export const DEFENSE_FALLBACK = {
  neutralWeight: .35,
  workloadWeight: .65,
} as const

export const CONFIDENCE_CONFIG = {
  minimumUsableWeight: .35,
  highWeight: .85,
  mediumWeight: .60,
  highMetricCount: 6,
  mediumMetricCount: 4,
  neutralFallbackScore: 68,
} as const

export const CATEGORY_WEIGHTS = {
  offense: .34,
  defense: .18,
  startingPitching: .25,
  reliefPitching: .13,
  speed: .02,
  rosterBalance: .08,
} as const

export const BALANCE_WEIGHTS = {
  categoryConsistency: .35,
  lineupDepth: .25,
  rotationDepth: .20,
  bullpenDepth: .10,
  productionCoverage: .10,
} as const

export const CATEGORY_COMPONENT_WEIGHTS = {
  contact: { avg: 1, obp: 1.4, ops: .6 },
  powerContactDifferenceRate: 1.5,
  speedBalanceRate: .05,
  categorySpreadRate: .15,
} as const

export const OVERALL_TRANSFORM = {
  points: [
    { input: 0, output: 0 }, { input: 35, output: 32 }, { input: 50, output: 47 },
    { input: 65, output: 63 }, { input: 75, output: 75 }, { input: 85, output: 87 },
    { input: 93, output: 95 }, { input: 98, output: 99 }, { input: 100, output: 100 },
  ],
} as const

// Category scores already include quality and depth, so overall adjustments
// are deliberately modest and do not repeat rotation/bullpen/defense penalties.
export const OVERALL_ADJUSTMENTS = {
  weakCategoryThreshold: 55,
  weakCategoryRate: .15,
  weakCategoryMaximum: 4,
  allStrongThreshold: 88,
  allStrongBonus: 1.5,
  exceptionalBalanceThreshold: 90,
  exceptionalBalanceBonus: 1,
} as const

export const GRADE_THRESHOLDS: ReadonlyArray<{ minimum: number; grade: LetterGrade }> = [
  { minimum: 96, grade: 'S' },
  { minimum: 93, grade: 'A+' },
  { minimum: 90, grade: 'A' },
  { minimum: 86, grade: 'A-' },
  { minimum: 82, grade: 'B+' },
  { minimum: 78, grade: 'B' },
  { minimum: 74, grade: 'B-' },
  { minimum: 70, grade: 'C+' },
  { minimum: 65, grade: 'C' },
  { minimum: 55, grade: 'D' },
  { minimum: 0, grade: 'F' },
]

// Piecewise interpolation keeps average teams grounded while expanding the
// upper tail. A flat bonus would erase meaningful differences between great,
// historic, and nearly perfect rosters.
export const WIN_CURVE = {
  seasonGames: 162,
  minimumWins: 55,
  maximumWins: 162,
  points: [
    { score: 0, wins: 55 }, { score: 35, wins: 58 }, { score: 45, wins: 65 },
    { score: 55, wins: 74 }, { score: 60, wins: 78 }, { score: 65, wins: 81 },
    { score: 68, wins: 87 }, { score: 72, wins: 93 }, { score: 76, wins: 99 },
    { score: 80, wins: 105 }, { score: 84, wins: 112 }, { score: 88, wins: 121 },
    { score: 92, wins: 133 }, { score: 95, wins: 144 }, { score: 97, wins: 153 },
    { score: 98.5, wins: 158 }, { score: 99.5, wins: 161 }, { score: 100, wins: 162 },
  ],
  perfect: {
    overallMinimum: 95,
    offenseMinimum: 94.5,
    defenseMinimum: 85,
    startingPitchingMinimum: 94,
    reliefPitchingMinimum: 95,
    balanceMinimum: 93,
    weakestPlayerMinimum: 88,
  },
} as const

export const TIER_THRESHOLDS = [
  { minimumWins: 162, label: 'Perfect Season' },
  { minimumWins: 156, label: 'Near Perfect' },
  { minimumWins: 145, label: 'All-Time Great' },
  { minimumWins: 130, label: 'Historic Powerhouse' },
  { minimumWins: 115, label: 'World Series Favorite' },
  { minimumWins: 105, label: 'Championship Contender' },
  { minimumWins: 95, label: 'Playoff Contender' },
  { minimumWins: 85, label: 'Competitive' },
  { minimumWins: 75, label: 'Developing Club' },
  { minimumWins: 0, label: 'Rebuild' },
] as const
