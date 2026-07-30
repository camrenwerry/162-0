import { SCORING_VERSION } from '../../config/versions'
import { PLAYER_CARDS } from '../../data/generated'
import {
  LEADERBOARD_PERIODS,
  createLeaderboardStateSnapshot,
  createReadyLeaderboardSnapshot,
  createResultPlacement,
  type DevelopmentResultJourneyData,
  type LeaderboardCandidate,
  type LeaderboardPeriod,
  type LeaderboardSnapshot,
  type LocalIdentityStorage,
  type RankableLeaderboardResult,
} from './leaderboardFixtures'
import {
  PRIVATE_DEVELOPMENT_RECOVERY_CODE,
  readLocalDevelopmentIdentity,
  storeLocalDevelopmentIdentity,
} from './leaderboardPrivateFixture'
import { validateDisplayName } from '../../../shared/leaderboard-display-name'
import {
  ROSTER_SLOTS,
  type DraftResult,
  type Player,
  type Roster,
} from '../../types/draft'

export const DEVELOPMENT_LEADERBOARD_SCENARIOS = [
  'ready',
  'long',
  'outside',
  'no-personal',
  'loading',
  'empty',
  'error',
  'offline',
  'disabled',
] as const
export type DevelopmentLeaderboardScenario = typeof DEVELOPMENT_LEADERBOARD_SCENARIOS[number]

export interface DevelopmentLeaderboardView {
  readonly scenario: DevelopmentLeaderboardScenario
  readonly snapshot: LeaderboardSnapshot
  readonly developmentNotice: string | null
  readonly personalDisplayName: string | null
}

export interface DevelopmentResultPreview {
  readonly roster: Roster
  readonly result: DraftResult<Player>
  readonly journey: DevelopmentResultJourneyData
}

const PREVIEW_RESULT = Object.freeze({
  projectedWins: 143,
  overallScore: 94.6,
})

const STRONGER_RESULT_COUNTS: Readonly<Record<LeaderboardPeriod, number>> = Object.freeze({
  daily: 6,
  weekly: 10,
  'all-time': 83,
})

const FIXTURE_NAMES = [
  'Grandstand Grace',
  'October Atlas',
  'Double Play Dee',
  'Extra Innings Oracle',
  'Bullpen Poet',
  'Warning Track Walt',
  'Southpaw Sage',
  'Rally Cap Rae',
  'Fastball Fern',
  'Diamond June',
  'Line Drive Leo',
  'Seventh Inning Sol',
  'Dugout Quinn',
  'Moonshot Morgan',
  'Box Score Bo',
] as const

function knownValue<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value)
}

function fixtureName(index: number) {
  return FIXTURE_NAMES[index] ?? `Pennant Hopeful ${String(index + 1).padStart(2, '0')}`
}

function timeContext(period: LeaderboardPeriod, index: number) {
  if (period === 'daily') return index === 0 ? '12 minutes ago' : `${(index % 23) + 1}h ago`
  if (period === 'weekly') return ['Today', 'Yesterday', 'Mon', 'Sun', 'Sat'][index % 5]
  return `Jul ${Math.max(1, 29 - (index % 29))}, 2026`
}

function leaderboardCompetitors(
  period: LeaderboardPeriod,
  count = 100,
): readonly LeaderboardCandidate[] {
  const strongerCount = STRONGER_RESULT_COUNTS[period]
  return Object.freeze(Array.from({ length: count }, (_, index): LeaderboardCandidate => {
    const stronger = index < strongerCount
    const offset = stronger ? index : index - strongerCount
    return Object.freeze({
      displayName: fixtureName(index),
      projectedWins: stronger
        ? 161 - Math.floor(offset / 5)
        : Math.max(90, 142 - Math.floor(offset / 4)),
      overallScore: Number((stronger
        ? 99.5 - Math.floor(offset / 2) * 0.05
        : Math.max(68, 94.5 - Math.floor(offset / 2) * 0.1)).toFixed(1)),
      timeContext: timeContext(period, index),
      mode: 'Classic',
      isPersonal: false,
    })
  }))
}

export const DEVELOPMENT_COMPETITORS = Object.freeze(Object.fromEntries(
  LEADERBOARD_PERIODS.map((period) => [period, leaderboardCompetitors(period)]),
)) as Readonly<Record<LeaderboardPeriod, readonly LeaderboardCandidate[]>>

const UNAVAILABLE_DISPLAY_NAME_KEYS = new Set(
  DEVELOPMENT_COMPETITORS.daily.map((entry) => {
    const validated = validateDisplayName(entry.displayName)
    if (!validated) throw new Error('Development leaderboard fixture name is invalid.')
    return validated.nameKey
  }),
)

export function isDevelopmentDisplayNameAvailable(nameKey: string): boolean {
  return !UNAVAILABLE_DISPLAY_NAME_KEYS.has(nameKey)
}

function personalCandidate(
  displayName: string,
  result: RankableLeaderboardResult,
  period: LeaderboardPeriod,
): LeaderboardCandidate {
  return Object.freeze({
    ...result,
    displayName,
    timeContext: period === 'daily'
      ? '48 minutes ago'
      : period === 'weekly'
        ? 'Yesterday'
        : 'Jul 12, 2026',
    mode: 'Classic',
    isPersonal: true,
  })
}

export function developmentLeaderboardFixture(
  scenario: DevelopmentLeaderboardScenario,
  period: LeaderboardPeriod,
  displayName = 'Pennant Ace',
): LeaderboardSnapshot {
  if (scenario !== 'ready' && scenario !== 'long' && scenario !== 'outside' && scenario !== 'no-personal') {
    return createLeaderboardStateSnapshot(scenario, period)
  }
  const competitors = DEVELOPMENT_COMPETITORS[period]
  const personalResult = scenario === 'outside'
    ? Object.freeze({ projectedWins: 89, overallScore: 67.8 })
    : PREVIEW_RESULT
  const candidates = scenario === 'no-personal'
    ? competitors
    : Object.freeze([...competitors, personalCandidate(displayName, personalResult, period)])
  return createReadyLeaderboardSnapshot(
    period,
    candidates,
    scenario === 'long' ? 50 : 12,
    'Updated Jul 30, 2026 at 10:14 AM',
  )
}

export function resolveDevelopmentLeaderboard(
  search: string,
  online: boolean,
  storage: Pick<LocalIdentityStorage, 'getItem'>,
): DevelopmentLeaderboardView {
  const parameters = new URLSearchParams(search)
  const periodValue = parameters.get('period')
  const period = knownValue(LEADERBOARD_PERIODS, periodValue) ? periodValue : 'daily'
  const scenarioValue = parameters.get('leaderboardFixture')
  const requested = knownValue(DEVELOPMENT_LEADERBOARD_SCENARIOS, scenarioValue)
    ? scenarioValue
    : 'disabled'
  const scenario = !online && requested !== 'disabled' ? 'offline' : requested
  const identity = readLocalDevelopmentIdentity(storage)
  const personalDisplayName = identity.kind === 'ready' ? identity.displayName : 'Pennant Ace'
  return Object.freeze({
    scenario,
    snapshot: developmentLeaderboardFixture(
      scenario,
      period,
      personalDisplayName,
    ),
    developmentNotice: scenario === 'disabled'
      ? null
      : 'These sample standings exist only in this local preview. Public standings remain off.',
    personalDisplayName,
  })
}

function buildPreviewRoster(): Roster {
  const usedPlayers = new Set<string>()
  return Object.fromEntries(ROSTER_SLOTS.map((slot) => {
    const player = PLAYER_CARDS.find((candidate) => (
      !usedPlayers.has(candidate.playerId)
      && candidate.eligiblePositions.includes(slot.position)
      && (slot.position !== 'SP' || candidate.pitchingRole === 'SP')
      && (slot.position !== 'RP' || candidate.pitchingRole === 'RP')
    ))
    if (!player) throw new Error('Leaderboard result preview roster is unavailable.')
    usedPlayers.add(player.playerId)
    return [slot.id, player]
  })) as Roster
}

const categoryScores = Object.freeze({
  offense: 91.2,
  power: 92.1,
  contact: 89.6,
  speed: 78.4,
  defense: 88.9,
  startingPitching: 93.4,
  reliefPitching: 94.1,
  rosterBalance: 90.8,
  overall: PREVIEW_RESULT.overallScore,
})

const categoryGrades = Object.freeze({
  offense: 'A',
  power: 'A',
  contact: 'A-',
  speed: 'B',
  defense: 'A-',
  startingPitching: 'A+',
  reliefPitching: 'A+',
  rosterBalance: 'A',
  overall: 'A+',
} as const)

function resultJourneyScenario(search: string): 'first-time' | 'returning' | 'near-miss' | null {
  const value = new URLSearchParams(search).get('leaderboardResult')
  return value === 'first-time' || value === 'returning' || value === 'near-miss'
    ? value
    : null
}

export function getDevelopmentResultPreview(
  search: string,
  storage: LocalIdentityStorage,
): DevelopmentResultPreview | null {
  const scenario = resultJourneyScenario(search)
  if (!scenario) return null
  const roster = buildPreviewRoster()
  const identityState = readLocalDevelopmentIdentity(storage)
  const displayName = identityState.kind === 'ready' ? identityState.displayName : null
  const placement = createResultPlacement(PREVIEW_RESULT, DEVELOPMENT_COMPETITORS, {
    displayName,
    newPersonalBest: scenario !== 'near-miss',
    rankMovement: scenario === 'returning' ? 5 : null,
  })
  return Object.freeze({
    roster,
    result: Object.freeze({
      wins: PREVIEW_RESULT.projectedWins,
      losses: 162 - PREVIEW_RESULT.projectedWins,
      overallScore: PREVIEW_RESULT.overallScore,
      overallGrade: 'A+',
      tierLabel: 'All-Time Great',
      categoryScores,
      categoryGrades,
      roster,
      strongestCategory: 'reliefPitching',
      weakestCategory: 'speed',
      bestPlayerValue: null,
      scoringVersion: SCORING_VERSION,
    }),
    journey: Object.freeze({
      scenario,
      placement,
      identityState,
      recoveryCode: PRIVATE_DEVELOPMENT_RECOVERY_CODE,
      isDisplayNameAvailable: isDevelopmentDisplayNameAvailable,
      saveIdentity: storeLocalDevelopmentIdentity,
    }),
  })
}
