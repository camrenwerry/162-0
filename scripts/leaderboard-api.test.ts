import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  CUMULATIVE_PERFORMANCE_PUBLICLY_AVAILABLE,
  decodeLeaderboardCursor,
  handleLeaderboardRequest,
  LEADERBOARD_MAX_LIMIT,
  LEADERBOARD_RESPONSE_SCHEMA_VERSION,
  leaderboardPeriodWindow,
  queryBestRunLeaderboard,
  queryCumulativePerformanceInputs,
  type LeaderboardEnv,
} from '../functions/lib/leaderboard'
import { SqliteD1Database } from './lib/sqlite-d1'

const CURSOR_KEY = 'leaderboard-test-cursor-key-with-at-least-thirty-two-bytes'
const NOW = Date.UTC(2026, 6, 29, 12, 0, 0)
const DAILY_START = Date.UTC(2026, 6, 29, 0, 0, 0)
const DAILY_END = DAILY_START + 86_400_000
const WEEKLY_START = Date.UTC(2026, 6, 27, 0, 0, 0)
const ENDPOINT = 'https://example.test/api/v1/leaderboards'

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

function addPlayer(
  sqlite: DatabaseSync,
  digestSeed: string,
  label: string,
  status: 'active' | 'disabled' = 'active',
) {
  const digest = digestSeed.repeat(Math.ceil(64 / digestSeed.length)).slice(0, 64)
  const nameKey = label.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC')
  const result = sqlite.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'active')
  `).run(
    digest,
    label,
    status,
    DAILY_START - 1,
    nameKey,
    digest,
    digest,
    DAILY_START - 1,
    DAILY_START - 1,
  )
  return Number(result.lastInsertRowid)
}

let runCounter = 0
function addRun(sqlite: DatabaseSync, values: {
  playerId: number | null
  submittedAtMs: number
  wins: number
  scoreTenths: number
  tier?: string
  mode?: 'classic' | 'hard'
  environment?: 'preview' | 'production' | 'test'
  isSmoke?: 0 | 1
  status?: 'eligible' | 'identity_pending' | 'excluded_test'
  reason?: 'eligible' | 'identity_unavailable' | 'test_or_smoke_data'
}) {
  runCounter += 1
  const ticketId = `00000000-0000-4000-8000-${String(runCounter).padStart(12, '0')}`
  sqlite.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    ticketId,
    values.playerId,
    values.mode ?? 'classic',
    values.environment ?? 'production',
    values.isSmoke ?? 0,
    values.submittedAtMs,
    values.wins,
    values.scoreTenths,
    values.tier ?? 'Pennant Contender',
    values.status ?? 'eligible',
    values.reason ?? 'eligible',
  )
}

function enabledEnv(database: SqliteD1Database): LeaderboardEnv {
  return {
    LEADERBOARD_READ_MODE: 'enabled',
    LEADERBOARD_ENVIRONMENT: 'production',
    LEADERBOARD_CURSOR_SIGNING_KEY: CURSOR_KEY,
    DB: database,
  }
}

const sqlite = migratedDatabase()
const database = new SqliteD1Database(sqlite)
const playerA = addPlayer(sqlite, 'a', 'Player Ash')
const playerB = addPlayer(sqlite, 'b', 'Player Birch')
const playerC = addPlayer(sqlite, 'c', 'Player Cedar')
const playerD = addPlayer(sqlite, 'd', 'Player Dogwood')
const disabledPlayer = addPlayer(sqlite, 'e', 'Player Elm', 'disabled')

addRun(sqlite, { playerId: playerA, submittedAtMs: DAILY_START, wins: 100, scoreTenths: 800 })
addRun(sqlite, { playerId: playerA, submittedAtMs: DAILY_START + 1_000, wins: 110, scoreTenths: 900 })
addRun(sqlite, { playerId: playerA, submittedAtMs: DAILY_START + 2_000, wins: 90, scoreTenths: 990 })
addRun(sqlite, { playerId: playerA, submittedAtMs: DAILY_START + 2_100, wins: 95, scoreTenths: 850 })
addRun(sqlite, { playerId: playerB, submittedAtMs: DAILY_START + 500, wins: 110, scoreTenths: 900 })
addRun(sqlite, { playerId: playerC, submittedAtMs: DAILY_START + 1_500, wins: 109, scoreTenths: 910 })
addRun(sqlite, { playerId: playerD, submittedAtMs: DAILY_START + 2_500, wins: 108, scoreTenths: 920 })
addRun(sqlite, { playerId: playerD, submittedAtMs: DAILY_END, wins: 162, scoreTenths: 1000 })
addRun(sqlite, { playerId: playerD, submittedAtMs: WEEKLY_START, wins: 107, scoreTenths: 880 })
addRun(sqlite, { playerId: playerD, submittedAtMs: WEEKLY_START - 1, wins: 162, scoreTenths: 1000 })
addRun(sqlite, { playerId: playerA, submittedAtMs: DAILY_START + 3_000, wins: 162, scoreTenths: 1000, mode: 'hard' })
addRun(sqlite, { playerId: playerA, submittedAtMs: DAILY_START + 3_100, wins: 162, scoreTenths: 1000, environment: 'preview' })
addRun(sqlite, {
  playerId: null,
  submittedAtMs: DAILY_START + 3_200,
  wins: 162,
  scoreTenths: 1000,
  status: 'identity_pending',
  reason: 'identity_unavailable',
})
addRun(sqlite, {
  playerId: null,
  submittedAtMs: DAILY_START + 3_300,
  wins: 162,
  scoreTenths: 1000,
  environment: 'test',
  isSmoke: 1,
  status: 'excluded_test',
  reason: 'test_or_smoke_data',
})
addRun(sqlite, {
  playerId: null,
  submittedAtMs: DAILY_START + 3_400,
  wins: 162,
  scoreTenths: 1000,
  environment: 'production',
  isSmoke: 1,
  status: 'excluded_test',
  reason: 'test_or_smoke_data',
})
addRun(sqlite, { playerId: disabledPlayer, submittedAtMs: DAILY_START + 3_500, wins: 162, scoreTenths: 1000 })

assert.deepEqual(leaderboardPeriodWindow('daily', NOW), {
  period: 'daily',
  asOfMs: NOW,
  startMs: DAILY_START,
  endMs: DAILY_END,
})
assert.deepEqual(leaderboardPeriodWindow('weekly', NOW), {
  period: 'weekly',
  asOfMs: NOW,
  startMs: WEEKLY_START,
  endMs: WEEKLY_START + 7 * 86_400_000,
})
assert.deepEqual(leaderboardPeriodWindow('all-time', NOW), {
  period: 'all-time',
  asOfMs: NOW,
  startMs: null,
  endMs: null,
})

const daily = await queryBestRunLeaderboard(
  database,
  'production',
  { period: 'daily', asOfMs: DAILY_END, startMs: DAILY_START, endMs: DAILY_END },
  0,
  10,
)
assert(daily)
assert.deepEqual(daily.entries.map((entry) => ({
  rank: entry.rank,
  label: entry.playerLabel,
  wins: entry.projectedWins,
  score: entry.overallScore,
  submittedAt: entry.submittedAt,
})), [
  { rank: 1, label: 'Player Birch', wins: 110, score: 90, submittedAt: new Date(DAILY_START + 500).toISOString() },
  { rank: 1, label: 'Player Ash', wins: 110, score: 90, submittedAt: new Date(DAILY_START + 1_000).toISOString() },
  { rank: 3, label: 'Player Cedar', wins: 109, score: 91, submittedAt: new Date(DAILY_START + 1_500).toISOString() },
  { rank: 4, label: 'Player Dogwood', wins: 108, score: 92, submittedAt: new Date(DAILY_START + 2_500).toISOString() },
  { rank: 5, label: 'Player Ash', wins: 100, score: 80, submittedAt: new Date(DAILY_START).toISOString() },
  { rank: 6, label: 'Player Ash', wins: 95, score: 85, submittedAt: new Date(DAILY_START + 2_100).toISOString() },
])
assert.equal(daily.entries.some(({ projectedWins }) => projectedWins === 162), false)
assert.equal(daily.entries.some(({ projectedWins }) => projectedWins === 90), false)

const weekly = await queryBestRunLeaderboard(database, 'production', leaderboardPeriodWindow('weekly', NOW), 0, 10)
assert(weekly)
assert.equal(weekly.entries.find(({ playerLabel }) => playerLabel === 'Player Dogwood')?.projectedWins, 108)
const allTime = await queryBestRunLeaderboard(database, 'production', leaderboardPeriodWindow('all-time', DAILY_END + 1), 0, 10)
assert(allTime)
assert.equal(allTime.entries[0].playerLabel, 'Player Dogwood')
assert.equal(allTime.entries[0].projectedWins, 162)

const cumulativeInputs = await queryCumulativePerformanceInputs(
  database,
  'production',
  { period: 'daily', asOfMs: DAILY_END, startMs: DAILY_START, endMs: DAILY_END },
)
assert(cumulativeInputs)
const playerAInputs = cumulativeInputs.find(({ playerId }) => playerId === playerA)
assert.deepEqual(playerAInputs, {
  playerId: playerA,
  qualifyingRunCount: 4,
  verifiedWinsSum: 395,
  verifiedScoreTenthsSum: 3540,
  firstSubmittedAtMs: DAILY_START,
  lastSubmittedAtMs: DAILY_START + 2_100,
})
assert.equal(CUMULATIVE_PERFORMANCE_PUBLICLY_AVAILABLE, false)

// Disabled mode is indistinguishable from an unknown route and touches no D1.
const disabledDatabase = new Proxy({}, {
  get() {
    throw new Error('disabled leaderboard must not touch D1')
  },
})
const disabledResponse = await handleLeaderboardRequest(new Request(ENDPOINT), {
  LEADERBOARD_READ_MODE: 'disabled',
  DB: disabledDatabase,
})
assert.equal(disabledResponse.status, 404)
assert.deepEqual(await disabledResponse.json(), {
  ok: false,
  error: { code: 'not_found', message: 'API route not found' },
})

const environment = enabledEnv(database)
const firstPageResponse = await handleLeaderboardRequest(
  new Request(`${ENDPOINT}?mode=classic&period=daily&family=best-run&limit=2`),
  environment,
  () => NOW,
)
assert.equal(firstPageResponse.status, 200)
assert.match(firstPageResponse.headers.get('Cache-Control') ?? '', /^public,/)
assert.equal(firstPageResponse.headers.get('Access-Control-Allow-Origin'), null)
const firstPageText = await firstPageResponse.text()
const firstPage = JSON.parse(firstPageText) as {
  schemaVersion: string
  generatedAt: string
  board: { periodWindow: { start: string, end: string, interval: string, weekStartsOn: null } }
  capabilities: { bestRun: boolean, cumulativePerformance: boolean }
  entries: Array<{ rank: number, playerLabel: string }>
  page: { limit: number, nextCursor: string | null }
}
assert.equal(firstPage.schemaVersion, LEADERBOARD_RESPONSE_SCHEMA_VERSION)
assert.equal(firstPage.generatedAt, new Date(NOW).toISOString())
assert.deepEqual(firstPage.board.periodWindow, {
  timeZone: 'UTC',
  start: new Date(DAILY_START).toISOString(),
  end: new Date(DAILY_END).toISOString(),
  interval: 'start-inclusive-end-exclusive',
  weekStartsOn: null,
})
assert.deepEqual(firstPage.capabilities, { bestRun: true, cumulativePerformance: false })
assert.deepEqual(firstPage.entries.map(({ rank, playerLabel }) => ({ rank, playerLabel })), [
  { rank: 1, playerLabel: 'Player Birch' },
  { rank: 1, playerLabel: 'Player Ash' },
])
assert.equal(firstPage.page.limit, 2)
assert(firstPage.page.nextCursor)
assert.doesNotMatch(
  firstPageText,
  /(?:source_ticket_id|run_id|player_id|identity_key_digest|eligibility_reason|invalidated_at|ticketId|draftId|digest)/i,
)

const decodedCursor = await decodeLeaderboardCursor(firstPage.page.nextCursor, CURSOR_KEY)
assert(decodedCursor)
assert.equal(decodedCursor.afterOrdinal, 2)
assert.equal(decodedCursor.asOfMs, NOW)
const secondPageResponse = await handleLeaderboardRequest(
  new Request(`${ENDPOINT}?mode=classic&period=daily&family=best-run&limit=2&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`),
  environment,
  () => { throw new Error('cursor page must not sample a new time') },
)
assert.equal(secondPageResponse.status, 200)
const secondPage = await secondPageResponse.json() as {
  generatedAt: string
  entries: Array<{ rank: number, playerLabel: string }>
  page: { nextCursor: string | null }
}
assert.equal(secondPage.generatedAt, firstPage.generatedAt)
assert.deepEqual(secondPage.entries, [
  {
    rank: 3,
    playerLabel: 'Player Cedar',
    projectedWins: 109,
    overallScore: 91,
    tier: 'Pennant Contender',
    submittedAt: new Date(DAILY_START + 1_500).toISOString(),
    mode: 'classic',
  },
  {
    rank: 4,
    playerLabel: 'Player Dogwood',
    projectedWins: 108,
    overallScore: 92,
    tier: 'Pennant Contender',
    submittedAt: new Date(DAILY_START + 2_500).toISOString(),
    mode: 'classic',
  },
])
assert(secondPage.page.nextCursor)
const thirdPageResponse = await handleLeaderboardRequest(
  new Request(`${ENDPOINT}?mode=classic&period=daily&family=best-run&limit=2&cursor=${encodeURIComponent(secondPage.page.nextCursor)}`),
  environment,
  () => { throw new Error('cursor page must not sample a new time') },
)
assert.equal(thirdPageResponse.status, 200)
const thirdPage = await thirdPageResponse.json() as {
  entries: Array<{ rank: number, playerLabel: string, projectedWins: number }>
  page: { nextCursor: string | null }
}
assert.deepEqual(thirdPage.entries.map(({ rank, playerLabel, projectedWins }) => ({
  rank,
  playerLabel,
  projectedWins,
})), [
  { rank: 5, playerLabel: 'Player Ash', projectedWins: 100 },
  { rank: 6, playerLabel: 'Player Ash', projectedWins: 95 },
])
assert.equal(thirdPage.page.nextCursor, null)

sqlite.prepare(`
  UPDATE leaderboard_runs
  SET
    eligibility_status = 'invalidated',
    eligibility_reason = 'invalidated',
    invalidated_at_ms = ?
  WHERE player_id = ?
`).run(DAILY_END + 1, playerC)
const afterInvalidation = await queryBestRunLeaderboard(
  database,
  'production',
  { period: 'daily', asOfMs: DAILY_END, startMs: DAILY_START, endMs: DAILY_END },
  0,
  10,
)
assert(afterInvalidation)
assert.equal(afterInvalidation.entries.some(({ playerLabel }) => playerLabel === 'Player Cedar'), false)
sqlite.prepare(`
  UPDATE leaderboard_runs
  SET
    eligibility_status = 'eligible',
    eligibility_reason = 'eligible',
    invalidated_at_ms = NULL
  WHERE player_id = ?
`).run(playerC)

sqlite.prepare(`
  UPDATE leaderboard_runs
  SET
    eligibility_status = 'moderated',
    eligibility_reason = 'moderated',
    invalidated_at_ms = ?
  WHERE player_id = ?
`).run(DAILY_END + 2, playerC)
const afterRunModeration = await queryBestRunLeaderboard(
  database,
  'production',
  { period: 'daily', asOfMs: DAILY_END, startMs: DAILY_START, endMs: DAILY_END },
  0,
  10,
)
assert(afterRunModeration)
assert.equal(afterRunModeration.entries.some(({ playerLabel }) => playerLabel === 'Player Cedar'), false)
sqlite.prepare(`
  UPDATE leaderboard_runs
  SET
    eligibility_status = 'eligible',
    eligibility_reason = 'eligible',
    invalidated_at_ms = NULL
  WHERE player_id = ?
`).run(playerC)

sqlite.prepare(`
  UPDATE leaderboard_players
  SET identity_state = 'moderated'
  WHERE player_id = ?
`).run(playerD)
const afterIdentityModeration = await queryBestRunLeaderboard(
  database,
  'production',
  { period: 'daily', asOfMs: DAILY_END, startMs: DAILY_START, endMs: DAILY_END },
  0,
  10,
)
assert(afterIdentityModeration)
assert.equal(afterIdentityModeration.entries.some(({ playerLabel }) => playerLabel === 'Player Dogwood'), false)
sqlite.prepare(`
  UPDATE leaderboard_players
  SET identity_state = 'active'
  WHERE player_id = ?
`).run(playerD)

const tamperedCursor = `${firstPage.page.nextCursor.slice(0, -1)}${firstPage.page.nextCursor.endsWith('a') ? 'b' : 'a'}`
for (const url of [
  `${ENDPOINT}?cursor=${encodeURIComponent(tamperedCursor)}&period=daily`,
  `${ENDPOINT}?cursor=${encodeURIComponent(firstPage.page.nextCursor)}&period=weekly`,
]) {
  const response = await handleLeaderboardRequest(new Request(url), environment, () => NOW)
  assert.equal(response.status, 400)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'invalid_query')
}

for (const query of [
  '?mode=hard',
  '?mode=classic%27%20OR%201%3D1--',
  '?period=monthly',
  '?family=unknown',
  '?limit=0',
  '?limit=01',
  `?limit=${LEADERBOARD_MAX_LIMIT + 1}`,
  '?unknown=value',
  '?mode=classic&mode=classic',
  `?cursor=${'a'.repeat(2_049)}`,
]) {
  const response = await handleLeaderboardRequest(new Request(ENDPOINT + query), environment, () => NOW)
  assert.equal(response.status, 400, query)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'invalid_query')
}

const cumulativeResponse = await handleLeaderboardRequest(
  new Request(`${ENDPOINT}?family=cumulative-performance`),
  environment,
  () => NOW,
)
assert.equal(cumulativeResponse.status, 422)
assert.deepEqual(await cumulativeResponse.json(), {
  ok: false,
  error: {
    code: 'unsupported_board',
    message: 'The requested leaderboard is not available.',
  },
  capabilities: { bestRun: true, cumulativePerformance: false },
})

const methodResponse = await handleLeaderboardRequest(
  new Request(ENDPOINT, { method: 'POST' }),
  environment,
)
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('Allow'), 'GET, HEAD')
const headResponse = await handleLeaderboardRequest(
  new Request(ENDPOINT, { method: 'HEAD' }),
  environment,
)
assert.equal(headResponse.status, 200)
assert.equal(headResponse.body, null)

const missingKeyResponse = await handleLeaderboardRequest(new Request(ENDPOINT), {
  ...environment,
  LEADERBOARD_CURSOR_SIGNING_KEY: 'short',
})
assert.equal(missingKeyResponse.status, 503)
for (const incompatibleVersion of [2, 3, 5]) {
  sqlite.prepare('UPDATE backend_schema SET version = ? WHERE id = 1').run(incompatibleVersion)
  const incompatibleSchemaResponse = await handleLeaderboardRequest(
    new Request(ENDPOINT),
    environment,
    () => NOW,
  )
  assert.equal(incompatibleSchemaResponse.status, 503)
}
sqlite.prepare('UPDATE backend_schema SET version = 4 WHERE id = 1').run()
const failingDatabaseResponse = await handleLeaderboardRequest(new Request(ENDPOINT), {
  ...environment,
  DB: {
    prepare() {
      throw new Error('private D1 SQL failure with ticket and stack details')
    },
  },
}, () => NOW)
const failingDatabaseText = await failingDatabaseResponse.text()
assert.equal(failingDatabaseResponse.status, 503)
assert.doesNotMatch(failingDatabaseText, /D1|SQL|ticket|stack|private/i)

// Malformed stored labels fail closed and are never reflected.
const unsafePlayer = addPlayer(sqlite, 'f', 'Player\u202eUnsafe')
addRun(sqlite, { playerId: unsafePlayer, submittedAtMs: DAILY_START + 100, wins: 161, scoreTenths: 999 })
const unsafeResponse = await handleLeaderboardRequest(new Request(`${ENDPOINT}?period=daily`), environment, () => NOW)
const unsafeText = await unsafeResponse.text()
assert.equal(unsafeResponse.status, 503)
assert.doesNotMatch(unsafeText, /\u202e|Unsafe/)
sqlite.prepare('UPDATE leaderboard_players SET status = ? WHERE player_id = ?').run('disabled', unsafePlayer)

for (let index = 0; index < 55; index += 1) {
  const hexadecimal = (index + 16).toString(16).padStart(2, '0')
  const playerId = addPlayer(sqlite, hexadecimal.repeat(1), `Player Extra ${String(index).padStart(2, '0')}`)
  addRun(sqlite, { playerId, submittedAtMs: DAILY_START + 4_000 + index, wins: 1, scoreTenths: index })
}
const boundedResponse = await handleLeaderboardRequest(
  new Request(`${ENDPOINT}?period=daily&limit=${LEADERBOARD_MAX_LIMIT}`),
  environment,
  () => NOW,
)
const boundedText = await boundedResponse.text()
const bounded = JSON.parse(boundedText) as { entries: unknown[], page: { nextCursor: string | null } }
assert.equal(bounded.entries.length, LEADERBOARD_MAX_LIMIT)
assert(bounded.page.nextCursor)
assert(boundedText.length < 32_768)

// An empty, valid board has the same stable schema.
const emptyResponse = await handleLeaderboardRequest(new Request(`${ENDPOINT}?period=daily`), {
  ...environment,
  LEADERBOARD_ENVIRONMENT: 'preview',
}, () => Date.UTC(2020, 0, 1))
assert.equal(emptyResponse.status, 200)
const empty = await emptyResponse.json() as { entries: unknown[], page: { nextCursor: string | null } }
assert.deepEqual(empty.entries, [])
assert.equal(empty.page.nextCursor, null)

sqlite.close()

console.log('Leaderboard API tests passed: top-three Best Run selection, shared competition ranks, UTC windows, mode/data isolation, tie-safe authenticated cursor pagination, cumulative blocking, privacy, bounds, and redacted failures are verified.')
