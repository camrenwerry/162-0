export const LEADERBOARD_PERIODS = ['daily', 'weekly', 'all-time'] as const
export type LeaderboardPeriod = typeof LEADERBOARD_PERIODS[number]

export interface RankableLeaderboardResult {
  readonly projectedWins: number
  readonly overallScore: number
}

export interface LeaderboardCandidate extends RankableLeaderboardResult {
  readonly displayName: string
  readonly timeContext: string
  readonly mode: 'Classic'
  readonly isPersonal: boolean
}

export interface PublicLeaderboardEntry extends LeaderboardCandidate {
  readonly rank: number
}

interface LeaderboardSnapshotBase {
  readonly period: LeaderboardPeriod
}

export interface ReadyLeaderboardSnapshot extends LeaderboardSnapshotBase {
  readonly kind: 'ready'
  readonly entries: readonly PublicLeaderboardEntry[]
  readonly personalEntry: PublicLeaderboardEntry | null
  readonly personalStatus: 'visible' | 'anchored' | 'none'
  readonly updatedLabel: string
}

export type LeaderboardSnapshot =
  | ReadyLeaderboardSnapshot
  | (LeaderboardSnapshotBase & {
    readonly kind: 'loading' | 'empty' | 'error' | 'offline' | 'disabled'
  })

export type ResultJourneyScenario = 'first-time' | 'returning' | 'near-miss'
export type ResultJourneyStage =
  | 'suspense'
  | 'claim'
  | 'claimed'
  | 'recovery'
  | 'complete'
  | 'story'

export interface PlacementSummary {
  readonly rank: number
  readonly label: string
}

export interface ResultPlacement {
  readonly displayName: string | null
  readonly daily: PlacementSummary
  readonly weekly: PlacementSummary
  readonly allTime: PlacementSummary
  readonly newPersonalBest: boolean
  readonly rankMovement: number | null
  readonly topTenDistance: number | null
  readonly winsFromPerfect: number
}

export interface PlacementStory {
  readonly eyebrow: string
  readonly headline: string
  readonly detail: string
}

export type LocalIdentityPreviewState =
  | Readonly<{ kind: 'ready', displayName: string }>
  | Readonly<{ kind: 'missing' | 'corrupt' | 'outdated' | 'invalid' | 'unavailable' }>

export type LocalIdentityWriteResult =
  | Readonly<{ kind: 'stored', displayName: string }>
  | Readonly<{ kind: 'invalid' | 'unavailable' }>

export interface LocalIdentityStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface DevelopmentResultJourneyData {
  readonly scenario: ResultJourneyScenario
  readonly placement: ResultPlacement
  readonly identityState: LocalIdentityPreviewState
  readonly recoveryCode: string
  readonly isDisplayNameAvailable: (nameKey: string) => boolean
  readonly saveIdentity: (
    displayName: string,
    storage: LocalIdentityStorage,
  ) => LocalIdentityWriteResult
}

export function compareLeaderboardResults(
  left: RankableLeaderboardResult,
  right: RankableLeaderboardResult,
): number {
  if (left.projectedWins !== right.projectedWins) {
    return right.projectedWins - left.projectedWins
  }
  return right.overallScore - left.overallScore
}

export function rankLeaderboardCandidates(
  candidates: readonly LeaderboardCandidate[],
): readonly PublicLeaderboardEntry[] {
  const ordered = candidates
    .map((candidate, sourceIndex) => ({ candidate, sourceIndex }))
    .sort((left, right) => (
      compareLeaderboardResults(left.candidate, right.candidate)
      || left.sourceIndex - right.sourceIndex
    ))

  let rank = 0
  let previous: LeaderboardCandidate | null = null
  return Object.freeze(ordered.map(({ candidate }, index) => {
    if (!previous || compareLeaderboardResults(previous, candidate) !== 0) rank = index + 1
    previous = candidate
    return Object.freeze({ ...candidate, rank })
  }))
}

export function placementAgainstLeaderboard(
  result: RankableLeaderboardResult,
  competitors: readonly RankableLeaderboardResult[],
): number {
  return competitors.reduce(
    (rank, competitor) => rank + (compareLeaderboardResults(competitor, result) < 0 ? 1 : 0),
    1,
  )
}

export function createReadyLeaderboardSnapshot(
  period: LeaderboardPeriod,
  candidates: readonly LeaderboardCandidate[],
  visibleLimit: number,
  updatedLabel: string,
): ReadyLeaderboardSnapshot {
  if (!Number.isSafeInteger(visibleLimit) || visibleLimit < 1) {
    throw new Error('Leaderboard visible limit must be a positive integer.')
  }
  const ranked = rankLeaderboardCandidates(candidates)
  const entries = Object.freeze(ranked.slice(0, visibleLimit))
  const visiblePersonal = entries.find((entry) => entry.isPersonal) ?? null
  const bestPersonal = ranked.find((entry) => entry.isPersonal) ?? null
  return Object.freeze({
    kind: 'ready',
    period,
    entries,
    personalEntry: visiblePersonal ? null : bestPersonal,
    personalStatus: visiblePersonal ? 'visible' : bestPersonal ? 'anchored' : 'none',
    updatedLabel,
  })
}

export function createLeaderboardStateSnapshot(
  kind: Exclude<LeaderboardSnapshot['kind'], 'ready'>,
  period: LeaderboardPeriod = 'daily',
): LeaderboardSnapshot {
  return Object.freeze({ kind, period })
}

export function createResultPlacement(
  result: RankableLeaderboardResult,
  competitorsByPeriod: Readonly<Record<LeaderboardPeriod, readonly RankableLeaderboardResult[]>>,
  options: Readonly<{
    displayName: string | null
    newPersonalBest: boolean
    rankMovement: number | null
  }>,
): ResultPlacement {
  const dailyRank = placementAgainstLeaderboard(result, competitorsByPeriod.daily)
  const weeklyRank = placementAgainstLeaderboard(result, competitorsByPeriod.weekly)
  const allTimeRank = placementAgainstLeaderboard(result, competitorsByPeriod['all-time'])
  return Object.freeze({
    displayName: options.displayName,
    daily: Object.freeze({ rank: dailyRank, label: 'Daily' }),
    weekly: Object.freeze({ rank: weeklyRank, label: 'Weekly' }),
    allTime: Object.freeze({ rank: allTimeRank, label: 'All-Time' }),
    newPersonalBest: options.newPersonalBest,
    rankMovement: options.rankMovement,
    topTenDistance: weeklyRank > 10 ? weeklyRank - 10 : null,
    winsFromPerfect: Math.max(0, 162 - result.projectedWins),
  })
}

export function selectPlacementStories(placement: ResultPlacement): readonly PlacementStory[] {
  const stories: PlacementStory[] = []
  if (placement.newPersonalBest) {
    stories.push(Object.freeze({
      eyebrow: 'New personal best',
      headline: 'Your best club yet',
      detail: 'Every pick added up to a new high-water mark.',
    }))
  }
  if (placement.rankMovement && placement.rankMovement > 0) {
    stories.push(Object.freeze({
      eyebrow: 'Climbing',
      headline: `Up ${placement.rankMovement} places today`,
      detail: 'One more strong draft could move you closer to the top.',
    }))
  }
  if (stories.length < 2 && placement.topTenDistance) {
    stories.push(Object.freeze({
      eyebrow: 'Right on the line',
      headline: `${placement.topTenDistance} ${placement.topTenDistance === 1 ? 'place' : 'places'} from the Top 10`,
      detail: 'The next roster can close that gap.',
    }))
  }
  if (stories.length < 2) {
    stories.push(Object.freeze({
      eyebrow: 'Chasing perfect',
      headline: `${placement.winsFromPerfect} wins from 162–0`,
      detail: 'A sharper choice at one position can change the whole season.',
    }))
  }
  return Object.freeze(stories.slice(0, 2))
}

export function isResultJourneyBlocking(stage: ResultJourneyStage): boolean {
  return stage === 'suspense'
    || stage === 'claim'
    || stage === 'claimed'
    || stage === 'recovery'
}

export function confirmResultJourneyNavigation(
  blocking: boolean,
  confirmLeave: () => boolean,
): boolean {
  return !blocking || confirmLeave()
}

export function recoveryMaterialIsVisible(stage: ResultJourneyStage): boolean {
  return stage === 'recovery'
}

export const RESULT_JOURNEY_TRANSITION_LOCK_MS = 350

export function createJourneyTransitionGuard(
  now: () => number = Date.now,
  lockMilliseconds = RESULT_JOURNEY_TRANSITION_LOCK_MS,
) {
  if (!Number.isFinite(lockMilliseconds) || lockMilliseconds < 0) {
    throw new Error('Journey transition lock must be a non-negative duration.')
  }
  let lockedUntil = Number.NEGATIVE_INFINITY
  return Object.freeze({
    tryTransition(action: () => void) {
      const currentTime = now()
      if (currentTime < lockedUntil) return false
      lockedUntil = currentTime + lockMilliseconds
      action()
      return true
    },
    isLocked() {
      return now() < lockedUntil
    },
    remainingMilliseconds() {
      return Math.max(0, lockedUntil - now())
    },
    reset() {
      lockedUntil = Number.NEGATIVE_INFINITY
    },
  })
}
