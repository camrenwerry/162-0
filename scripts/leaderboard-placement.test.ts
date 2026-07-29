import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  calculateLeaderboardPlacement,
  type LeaderboardPeriodPlacement,
} from '../functions/lib/leaderboard-placement'
import { SqliteD1Database } from './lib/sqlite-d1'

const NOW = Date.UTC(2026, 6, 29, 12, 0, 0)
const DAILY_START = Date.UTC(2026, 6, 29, 0, 0, 0)
const WEEKLY_START = Date.UTC(2026, 6, 27, 0, 0, 0)

function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    'migrations/0001_backend_foundation.sql',
    'migrations/0002_draft_submissions.sql',
    'migrations/0003_leaderboard_foundation.sql',
    'migrations/0004_leaderboard_identity_ranking.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'))
  return sqlite
}

function addPlayer(sqlite: DatabaseSync, seed: string, label: string) {
  const digest = seed.repeat(64).slice(0, 64)
  return Number(sqlite.prepare(`
    INSERT INTO leaderboard_players (
      identity_key_digest,
      public_label,
      status,
      created_at_ms,
      public_name_key,
      device_credential_digest,
      recovery_code_digest,
      recovery_version,
      credential_rotated_at_ms,
      identity_updated_at_ms,
      identity_state
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, 1, ?, ?, 'active')
  `).run(
    digest,
    label,
    WEEKLY_START - 1,
    label.toUpperCase().toLowerCase(),
    digest,
    digest,
    WEEKLY_START - 1,
    WEEKLY_START - 1,
  ).lastInsertRowid)
}

let runCounter = 0
function addRun(sqlite: DatabaseSync, values: {
  playerId: number | null
  submittedAtMs: number
  wins: number
  scoreTenths: number
  status?: 'eligible' | 'identity_pending'
}) {
  runCounter += 1
  const result = sqlite.prepare(`
    INSERT INTO leaderboard_runs (
      source_ticket_id,
      player_id,
      game_mode,
      environment,
      is_smoke,
      submitted_at_ms,
      verified_wins,
      verified_overall_score_tenths,
      tier_label,
      eligibility_status,
      eligibility_reason,
      invalidated_at_ms
    ) VALUES (?, ?, 'classic', 'production', 0, ?, ?, ?, 'Pennant Contender',
      ?, ?, NULL)
  `).run(
    `30000000-0000-4000-8000-${String(runCounter).padStart(12, '0')}`,
    values.playerId,
    values.submittedAtMs,
    values.wins,
    values.scoreTenths,
    values.status ?? 'eligible',
    values.status === 'identity_pending' ? 'identity_unavailable' : 'eligible',
  )
  return Number(result.lastInsertRowid)
}

function assertPeriod(
  period: LeaderboardPeriodPlacement,
  expected: Partial<LeaderboardPeriodPlacement>,
) {
  assert.deepEqual(period, {
    qualifies: false,
    rank: null,
    displacedPriorEntry: false,
    cutoff: null,
    proximity: null,
    ...expected,
  })
}

// A first anonymous candidate on an empty board qualifies in all three
// unbounded boards but still remains private until identity claim.
{
  const sqlite = migratedDatabase()
  const database = new SqliteD1Database(sqlite)
  const candidate = addRun(sqlite, {
    playerId: null,
    submittedAtMs: NOW,
    wins: 80,
    scoreTenths: 700,
    status: 'identity_pending',
  })
  const placement = await calculateLeaderboardPlacement(
    database,
    'production',
    candidate,
    NOW,
    true,
  )
  assert.equal(placement.snapshotAt, new Date(NOW).toISOString())
  for (const period of Object.values(placement.periods)) {
    assertPeriod(period, { qualifies: true, rank: 1 })
  }
  assert.equal(placement.newPersonalBest, true)
  assert.deepEqual(placement.identity, {
    setupRequired: true,
    reason: 'qualifying_run_requires_identity',
  })
  assert.deepEqual(placement.capabilities, {
    bestRun: true,
    cumulativePerformance: false,
  })
  sqlite.close()
}

// A stronger fourth run enters the player's top three independently on every
// in-window board and displaces the prior third entry.
{
  const sqlite = migratedDatabase()
  const database = new SqliteD1Database(sqlite)
  const player = addPlayer(sqlite, 'a', 'Player Aspen')
  const rival = addPlayer(sqlite, 'b', 'Player Birch')
  addRun(sqlite, { playerId: rival, submittedAtMs: DAILY_START + 1, wins: 130, scoreTenths: 900 })
  addRun(sqlite, { playerId: player, submittedAtMs: DAILY_START + 2, wins: 120, scoreTenths: 900 })
  addRun(sqlite, { playerId: player, submittedAtMs: DAILY_START + 3, wins: 110, scoreTenths: 900 })
  addRun(sqlite, { playerId: player, submittedAtMs: DAILY_START + 4, wins: 100, scoreTenths: 900 })
  const candidate = addRun(sqlite, {
    playerId: player,
    submittedAtMs: NOW,
    wins: 105,
    scoreTenths: 900,
  })
  const placement = await calculateLeaderboardPlacement(
    database,
    'production',
    candidate,
    NOW,
    false,
  )
  for (const period of Object.values(placement.periods)) {
    assertPeriod(period, {
      qualifies: true,
      rank: 4,
      displacedPriorEntry: true,
      cutoff: { projectedWins: 100, overallScore: 90 },
    })
  }
  assert.equal(placement.newPersonalBest, false)
  assert.deepEqual(placement.identity, { setupRequired: false, reason: null })
  sqlite.close()
}

// A fourth weaker run stays in history, reports the personal top-three cutoff,
// and exposes only consistent score proximity.
{
  const sqlite = migratedDatabase()
  const database = new SqliteD1Database(sqlite)
  const player = addPlayer(sqlite, 'c', 'Player Cedar')
  addRun(sqlite, { playerId: player, submittedAtMs: DAILY_START + 1, wins: 120, scoreTenths: 900 })
  addRun(sqlite, { playerId: player, submittedAtMs: DAILY_START + 2, wins: 110, scoreTenths: 900 })
  addRun(sqlite, { playerId: player, submittedAtMs: DAILY_START + 3, wins: 100, scoreTenths: 900 })
  const candidate = addRun(sqlite, {
    playerId: player,
    submittedAtMs: NOW,
    wins: 100,
    scoreTenths: 800,
  })
  const placement = await calculateLeaderboardPlacement(
    database,
    'production',
    candidate,
    NOW,
    false,
  )
  for (const period of Object.values(placement.periods)) {
    assertPeriod(period, {
      cutoff: { projectedWins: 100, overallScore: 90 },
      proximity: {
        projectedWinsBelowCutoff: 0,
        overallScoreBelowCutoff: 10,
      },
    })
  }
  assert.equal(placement.newPersonalBest, false)
  sqlite.close()
}

// Period caps are recomputed: older weekly runs affect Weekly and All-Time but
// do not prevent a Daily candidate from entering a less crowded daily top three.
{
  const sqlite = migratedDatabase()
  const database = new SqliteD1Database(sqlite)
  const player = addPlayer(sqlite, 'd', 'Player Dogwood')
  addRun(sqlite, { playerId: player, submittedAtMs: WEEKLY_START + 1, wins: 150, scoreTenths: 950 })
  addRun(sqlite, { playerId: player, submittedAtMs: WEEKLY_START + 2, wins: 140, scoreTenths: 940 })
  addRun(sqlite, { playerId: player, submittedAtMs: WEEKLY_START + 3, wins: 130, scoreTenths: 930 })
  const candidate = addRun(sqlite, {
    playerId: player,
    submittedAtMs: NOW,
    wins: 100,
    scoreTenths: 800,
  })
  const placement = await calculateLeaderboardPlacement(
    database,
    'production',
    candidate,
    NOW,
    false,
  )
  assertPeriod(placement.periods.daily, { qualifies: true, rank: 1 })
  assertPeriod(placement.periods.weekly, {
    cutoff: { projectedWins: 130, overallScore: 93 },
    proximity: { projectedWinsBelowCutoff: 30, overallScoreBelowCutoff: null },
  })
  assertPeriod(placement.periods['all-time'], {
    cutoff: { projectedWins: 130, overallScore: 93 },
    proximity: { projectedWinsBelowCutoff: 30, overallScoreBelowCutoff: null },
  })
  sqlite.close()
}

console.log('Leaderboard placement tests passed: empty-board qualification, period ranks, personal best, top-three displacement, cutoff ties, proximity, identity setup, and independent UTC period caps are verified.')
