import {
  leaderboardPeriodWindow,
  type LeaderboardEnvironment,
  type LeaderboardPeriod,
  type LeaderboardPeriodWindow,
} from './leaderboard'

export const LEADERBOARD_PLACEMENT_RESPONSE_SCHEMA_VERSION = 'pennant-leaderboard-placement-v1'

interface PlacementPreparedStatement {
  bind(...values: unknown[]): PlacementPreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
}

export interface PlacementDatabase {
  prepare(query: string): PlacementPreparedStatement
}

interface PlacementRow {
  readonly public_rank: unknown
  readonly player_slot: unknown
  readonly prior_count: unknown
  readonly cutoff_wins: unknown
  readonly cutoff_score_tenths: unknown
}

interface PersonalBestRow {
  readonly is_personal_best: unknown
}

export interface LeaderboardPeriodPlacement {
  readonly qualifies: boolean
  readonly rank: number | null
  readonly displacedPriorEntry: boolean
  readonly cutoff: Readonly<{
    projectedWins: number
    overallScore: number
  }> | null
  readonly proximity: Readonly<{
    projectedWinsBelowCutoff: number
    overallScoreBelowCutoff: number | null
  }> | null
}

export interface LeaderboardPlacement {
  readonly schemaVersion: typeof LEADERBOARD_PLACEMENT_RESPONSE_SCHEMA_VERSION
  readonly snapshotAt: string
  readonly periods: Readonly<Record<LeaderboardPeriod, LeaderboardPeriodPlacement>>
  readonly newPersonalBest: boolean
  readonly identity: Readonly<{
    setupRequired: boolean
    reason: 'qualifying_run_requires_identity' | null
  }>
  readonly capabilities: Readonly<{
    bestRun: true
    cumulativePerformance: false
  }>
}

const TIMED_PLACEMENT_SQL = `
  WITH scoped AS (
    SELECT
      r.run_id,
      COALESCE(r.player_id, -r.run_id) AS player_scope,
      r.verified_wins,
      r.verified_overall_score_tenths,
      r.submitted_at_ms,
      CASE WHEN r.run_id = ? THEN 1 ELSE 0 END AS is_candidate
    FROM leaderboard_runs AS r
    LEFT JOIN leaderboard_players AS p ON p.player_id = r.player_id
    WHERE r.environment = ?
      AND r.game_mode = 'classic'
      AND r.is_smoke = 0
      AND r.submitted_at_ms >= ?
      AND r.submitted_at_ms < ?
      AND r.submitted_at_ms <= ?
      AND (
        (
          r.eligibility_status = 'eligible'
          AND p.status = 'active'
          AND p.identity_state = 'active'
          AND p.public_name_key IS NOT NULL
          AND p.device_credential_digest IS NOT NULL
          AND p.recovery_code_digest IS NOT NULL
        )
        OR (
          r.run_id = ?
          AND r.eligibility_status = 'identity_pending'
        )
      )
  ),
  player_ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY player_scope
        ORDER BY
          verified_wins DESC,
          verified_overall_score_tenths DESC,
          submitted_at_ms ASC,
          run_id ASC
      ) AS player_slot
    FROM scoped
  ),
  public_ranked AS (
    SELECT
      *,
      RANK() OVER (
        ORDER BY
          verified_wins DESC,
          verified_overall_score_tenths DESC
      ) AS public_rank
    FROM player_ranked
    WHERE player_slot <= 3
  )
  SELECT
    q.public_rank,
    candidate.player_slot,
    (
      SELECT COUNT(*)
      FROM scoped AS prior
      WHERE prior.player_scope = candidate.player_scope
        AND prior.is_candidate = 0
    ) AS prior_count,
    (
      SELECT prior.verified_wins
      FROM scoped AS prior
      WHERE prior.player_scope = candidate.player_scope
        AND prior.is_candidate = 0
      ORDER BY
        prior.verified_wins DESC,
        prior.verified_overall_score_tenths DESC,
        prior.submitted_at_ms ASC,
        prior.run_id ASC
      LIMIT 1 OFFSET 2
    ) AS cutoff_wins,
    (
      SELECT prior.verified_overall_score_tenths
      FROM scoped AS prior
      WHERE prior.player_scope = candidate.player_scope
        AND prior.is_candidate = 0
      ORDER BY
        prior.verified_wins DESC,
        prior.verified_overall_score_tenths DESC,
        prior.submitted_at_ms ASC,
        prior.run_id ASC
      LIMIT 1 OFFSET 2
    ) AS cutoff_score_tenths
  FROM player_ranked AS candidate
  LEFT JOIN public_ranked AS q ON q.run_id = candidate.run_id
  WHERE candidate.is_candidate = 1
  LIMIT 1
`

const ALL_TIME_PLACEMENT_SQL = TIMED_PLACEMENT_SQL
  .replace('      AND r.submitted_at_ms >= ?\n      AND r.submitted_at_ms < ?\n', '')

const PERSONAL_BEST_SQL = `
  SELECT
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM leaderboard_runs AS prior
      JOIN leaderboard_runs AS candidate ON candidate.run_id = ?
      WHERE candidate.player_id IS NOT NULL
        AND prior.player_id = candidate.player_id
        AND prior.run_id != candidate.run_id
        AND prior.environment = candidate.environment
        AND prior.game_mode = candidate.game_mode
        AND prior.eligibility_status = 'eligible'
        AND prior.is_smoke = 0
        AND prior.submitted_at_ms <= ?
        AND (
          prior.verified_wins > candidate.verified_wins
          OR (
            prior.verified_wins = candidate.verified_wins
            AND prior.verified_overall_score_tenths >= candidate.verified_overall_score_tenths
          )
        )
    ) THEN 1 ELSE 0 END AS is_personal_best
  FROM leaderboard_runs
  WHERE run_id = ?
    AND game_mode = 'classic'
    AND environment = ?
    AND is_smoke = 0
    AND eligibility_status IN ('eligible', 'identity_pending')
  LIMIT 1
`

function isSafeInteger(value: unknown, minimum: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function placementFromRow(row: PlacementRow | null): LeaderboardPeriodPlacement {
  if (!row) {
    return Object.freeze({
      qualifies: false,
      rank: null,
      displacedPriorEntry: false,
      cutoff: null,
      proximity: null,
    })
  }
  if (
    !isSafeInteger(row.player_slot, 1)
    || !isSafeInteger(row.prior_count, 0)
    || !(row.public_rank === null || isSafeInteger(row.public_rank, 1))
    || !(row.cutoff_wins === null || isSafeInteger(row.cutoff_wins, 0))
    || !(row.cutoff_score_tenths === null || isSafeInteger(row.cutoff_score_tenths, 0))
  ) throw new Error('Leaderboard placement data is invalid.')
  const qualifies = (row.player_slot as number) <= 3 && row.public_rank !== null
  const hasCutoff = typeof row.cutoff_wins === 'number'
    && typeof row.cutoff_score_tenths === 'number'
  const cutoff = hasCutoff
    ? Object.freeze({
      projectedWins: row.cutoff_wins as number,
      overallScore: (row.cutoff_score_tenths as number) / 10,
    })
    : null
  return Object.freeze({
    qualifies,
    rank: qualifies ? row.public_rank as number : null,
    displacedPriorEntry: qualifies && (row.prior_count as number) >= 3,
    cutoff,
    proximity: null,
  })
}

async function queryPeriod(
  database: PlacementDatabase,
  environment: LeaderboardEnvironment,
  runId: number,
  window: LeaderboardPeriodWindow,
) {
  const statement = window.period === 'all-time'
    ? database.prepare(ALL_TIME_PLACEMENT_SQL).bind(
      runId,
      environment,
      window.asOfMs,
      runId,
    )
    : database.prepare(TIMED_PLACEMENT_SQL).bind(
      runId,
      environment,
      window.startMs,
      window.endMs,
      window.asOfMs,
      runId,
    )
  const row = await statement.first<PlacementRow>()
  return placementFromRow(row)
}

async function personalBest(
  database: PlacementDatabase,
  environment: LeaderboardEnvironment,
  runId: number,
  asOfMs: number,
) {
  const row = await database.prepare(PERSONAL_BEST_SQL).bind(
    runId,
    asOfMs,
    runId,
    environment,
  ).first<PersonalBestRow>()
  if (!row || (row.is_personal_best !== 0 && row.is_personal_best !== 1)) {
    throw new Error('Leaderboard personal-best data is invalid.')
  }
  return row.is_personal_best === 1
}

async function candidateScore(
  database: PlacementDatabase,
  runId: number,
) {
  return database.prepare(`
    SELECT verified_wins, verified_overall_score_tenths
    FROM leaderboard_runs
    WHERE run_id = ?
    LIMIT 1
  `).bind(runId).first<{
    verified_wins: unknown
    verified_overall_score_tenths: unknown
  }>()
}

function withProximity(
  placement: LeaderboardPeriodPlacement,
  score: { verified_wins: unknown, verified_overall_score_tenths: unknown } | null,
) {
  if (
    placement.qualifies
    || !placement.cutoff
    || !score
    || !isSafeInteger(score.verified_wins, 0)
    || !isSafeInteger(score.verified_overall_score_tenths, 0)
  ) return placement
  const winsBelow = Math.max(0, placement.cutoff.projectedWins - (score.verified_wins as number))
  const scoreBelow = winsBelow === 0
    ? Math.max(0, placement.cutoff.overallScore - (score.verified_overall_score_tenths as number) / 10)
    : null
  return Object.freeze({
    ...placement,
    proximity: Object.freeze({
      projectedWinsBelowCutoff: winsBelow,
      overallScoreBelowCutoff: scoreBelow,
    }),
  })
}

export function emptyLeaderboardPlacement(asOfMs: number): LeaderboardPlacement {
  if (!isSafeInteger(asOfMs, 0)) throw new Error('Leaderboard placement input is invalid.')
  const empty = placementFromRow(null)
  return Object.freeze({
    schemaVersion: LEADERBOARD_PLACEMENT_RESPONSE_SCHEMA_VERSION,
    snapshotAt: new Date(asOfMs).toISOString(),
    periods: Object.freeze({
      daily: empty,
      weekly: empty,
      'all-time': empty,
    }),
    newPersonalBest: false,
    identity: Object.freeze({
      setupRequired: false,
      reason: null,
    }),
    capabilities: Object.freeze({
      bestRun: true,
      cumulativePerformance: false,
    }),
  })
}

export async function calculateLeaderboardPlacement(
  database: PlacementDatabase,
  environment: LeaderboardEnvironment,
  runId: number,
  asOfMs: number,
  identityPending: boolean,
): Promise<LeaderboardPlacement> {
  if (!isSafeInteger(runId, 1) || !isSafeInteger(asOfMs, 0)) {
    throw new Error('Leaderboard placement input is invalid.')
  }
  const snapshotAt = new Date(asOfMs).toISOString()
  const [daily, weekly, allTime, isPersonalBest, score] = await Promise.all([
    queryPeriod(database, environment, runId, leaderboardPeriodWindow('daily', asOfMs)),
    queryPeriod(database, environment, runId, leaderboardPeriodWindow('weekly', asOfMs)),
    queryPeriod(database, environment, runId, leaderboardPeriodWindow('all-time', asOfMs)),
    personalBest(database, environment, runId, asOfMs),
    candidateScore(database, runId),
  ])
  const periods = Object.freeze({
    daily: withProximity(daily, score),
    weekly: withProximity(weekly, score),
    'all-time': withProximity(allTime, score),
  })
  const setupRequired = identityPending
    && Object.values(periods).some(({ qualifies }) => qualifies)
  return Object.freeze({
    schemaVersion: LEADERBOARD_PLACEMENT_RESPONSE_SCHEMA_VERSION,
    snapshotAt,
    periods,
    newPersonalBest: isPersonalBest,
    identity: Object.freeze({
      setupRequired,
      reason: setupRequired ? 'qualifying_run_requires_identity' : null,
    }),
    capabilities: Object.freeze({
      bestRun: true,
      cumulativePerformance: false,
    }),
  })
}
