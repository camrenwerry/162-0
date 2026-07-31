export const LEADERBOARD_PERIODS = ['daily', 'weekly', 'all-time'] as const
export type LeaderboardPeriod = typeof LEADERBOARD_PERIODS[number]

export interface PublicLeaderboardEntry {
  readonly stableKey: string
  readonly projectedWins: number
  readonly overallScore: number
  readonly displayName: string
  readonly timeContext: string
  readonly mode: 'Classic'
  readonly isPersonal: boolean
  readonly rank: number
}

export function createPublicLeaderboardEntryStableKey(entry: Readonly<{
  rank: number
  playerLabel: string
  projectedWins: number
  overallScore: number
  tier: string
  submittedAt: string
  mode: 'classic'
}>): string {
  return JSON.stringify([
    entry.rank,
    entry.playerLabel,
    entry.projectedWins,
    entry.overallScore,
    entry.tier,
    entry.submittedAt,
    entry.mode,
  ])
}

interface LeaderboardSnapshotBase {
  readonly period: LeaderboardPeriod
}

export interface ReadyLeaderboardSnapshot extends LeaderboardSnapshotBase {
  readonly kind: 'ready'
  readonly entries: readonly PublicLeaderboardEntry[]
  readonly personalEntry: PublicLeaderboardEntry | null
  readonly personalStatus: 'visible' | 'anchored' | 'unavailable' | 'none'
  readonly updatedLabel: string
}

export type LeaderboardSnapshot =
  | ReadyLeaderboardSnapshot
  | (LeaderboardSnapshotBase & {
    readonly kind: 'loading' | 'empty' | 'error' | 'offline' | 'disabled'
  })

export function createLeaderboardStateSnapshot(
  kind: Exclude<LeaderboardSnapshot['kind'], 'ready'>,
  period: LeaderboardPeriod = 'daily',
): LeaderboardSnapshot {
  return Object.freeze({ kind, period })
}
