import { handleApiNotFoundRequest, SAFE_JSON_RESPONSE_HEADERS } from './api-response'
import { parseStrictJson } from './bounded-json'
import {
  isLeaderboardCursorSigningKey,
  isLeaderboardReadEnabled,
  type LeaderboardReadModeEnv,
} from './leaderboard-mode'
import { validateDisplayName } from './leaderboard-identity'

export const LEADERBOARD_RESPONSE_SCHEMA_VERSION = 'pennant-leaderboard-response-v2'
export const LEADERBOARD_DEFAULT_LIMIT = 25
export const LEADERBOARD_MAX_LIMIT = 50
export const LEADERBOARD_CURSOR_VERSION = 2
export const CUMULATIVE_PERFORMANCE_PUBLICLY_AVAILABLE = false

export type LeaderboardMode = 'classic'
export type LeaderboardPeriod = 'daily' | 'weekly' | 'all-time'
export type LeaderboardRankingFamily = 'best-run' | 'cumulative-performance'
export type LeaderboardEnvironment = 'preview' | 'production'

export interface LeaderboardEnv extends LeaderboardReadModeEnv {
  readonly DB?: unknown
}

export interface LeaderboardPeriodWindow {
  readonly period: LeaderboardPeriod
  readonly asOfMs: number
  readonly startMs: number | null
  readonly endMs: number | null
}

export interface LeaderboardCursor {
  readonly v: typeof LEADERBOARD_CURSOR_VERSION
  readonly mode: LeaderboardMode
  readonly period: LeaderboardPeriod
  readonly family: 'best-run'
  readonly environment: LeaderboardEnvironment
  readonly asOfMs: number
  readonly startMs: number | null
  readonly endMs: number | null
  readonly afterOrdinal: number
}

interface LeaderboardPreparedStatement {
  bind(...values: unknown[]): LeaderboardPreparedStatement
  all<T = Record<string, unknown>>(): Promise<Readonly<{
    success?: boolean
    results?: T[]
  }>>
}

export interface LeaderboardDatabase {
  prepare(query: string): LeaderboardPreparedStatement
}

interface BestRunRow {
  readonly public_label: unknown
  readonly verified_wins: unknown
  readonly verified_overall_score_tenths: unknown
  readonly tier_label: unknown
  readonly submitted_at_ms: unknown
  readonly public_rank: unknown
  readonly page_ordinal: unknown
}

interface CumulativeInputRow {
  readonly player_id: unknown
  readonly qualifying_run_count: unknown
  readonly verified_wins_sum: unknown
  readonly verified_score_tenths_sum: unknown
  readonly first_submitted_at_ms: unknown
  readonly last_submitted_at_ms: unknown
}

export interface CumulativePerformanceInput {
  readonly playerId: number
  readonly qualifyingRunCount: number
  readonly verifiedWinsSum: number
  readonly verifiedScoreTenthsSum: number
  readonly firstSubmittedAtMs: number
  readonly lastSubmittedAtMs: number
}

export interface PublicLeaderboardEntry {
  readonly rank: number
  readonly playerLabel: string
  readonly projectedWins: number
  readonly overallScore: number
  readonly tier: string
  readonly submittedAt: string
  readonly mode: LeaderboardMode
}

const ALLOWED_METHODS = 'GET, HEAD'
const ALLOWED_QUERY_PARAMETERS = new Set(['mode', 'period', 'family', 'limit', 'cursor'])
const CURSOR_FIELDS = [
  'v', 'mode', 'period', 'family', 'environment', 'asOfMs', 'startMs', 'endMs', 'afterOrdinal',
] as const
const MAX_CURSOR_BYTES = 2_048
const EXPECTED_LEADERBOARD_SCHEMA_VERSION = 4
const SELECT_SCHEMA_SQL = 'SELECT version FROM backend_schema WHERE id = 1'

const TIMED_BEST_RUN_SQL = `
  WITH scoped AS (
    SELECT
      r.run_id,
      r.player_id,
      p.public_label,
      r.verified_wins,
      r.verified_overall_score_tenths,
      r.tier_label,
      r.submitted_at_ms,
      ROW_NUMBER() OVER (
        PARTITION BY r.player_id
        ORDER BY
          r.verified_wins DESC,
          r.verified_overall_score_tenths DESC,
          r.submitted_at_ms ASC,
          r.run_id ASC
      ) AS player_best
    FROM leaderboard_runs AS r
    JOIN leaderboard_players AS p ON p.player_id = r.player_id
    WHERE r.environment = ?
      AND r.game_mode = ?
      AND r.eligibility_status = 'eligible'
      AND r.is_smoke = 0
      AND p.status = 'active'
      AND p.identity_state = 'active'
      AND p.public_name_key IS NOT NULL
      AND p.device_credential_digest IS NOT NULL
      AND p.recovery_code_digest IS NOT NULL
      AND r.submitted_at_ms >= ?
      AND r.submitted_at_ms < ?
      AND r.submitted_at_ms <= ?
  ),
  ranked AS (
    SELECT
      public_label,
      verified_wins,
      verified_overall_score_tenths,
      tier_label,
      submitted_at_ms,
      RANK() OVER (
        ORDER BY
          verified_wins DESC,
          verified_overall_score_tenths DESC
      ) AS public_rank,
      ROW_NUMBER() OVER (
        ORDER BY
          verified_wins DESC,
          verified_overall_score_tenths DESC,
          submitted_at_ms ASC,
          run_id ASC
      ) AS page_ordinal
    FROM scoped
    WHERE player_best <= 3
  )
  SELECT
    public_label,
    verified_wins,
    verified_overall_score_tenths,
    tier_label,
    submitted_at_ms,
    public_rank,
    page_ordinal
  FROM ranked
  WHERE page_ordinal > ?
  ORDER BY page_ordinal ASC
  LIMIT ?
`

const ALL_TIME_BEST_RUN_SQL = `
  WITH scoped AS (
    SELECT
      r.run_id,
      r.player_id,
      p.public_label,
      r.verified_wins,
      r.verified_overall_score_tenths,
      r.tier_label,
      r.submitted_at_ms,
      ROW_NUMBER() OVER (
        PARTITION BY r.player_id
        ORDER BY
          r.verified_wins DESC,
          r.verified_overall_score_tenths DESC,
          r.submitted_at_ms ASC,
          r.run_id ASC
      ) AS player_best
    FROM leaderboard_runs AS r
    JOIN leaderboard_players AS p ON p.player_id = r.player_id
    WHERE r.environment = ?
      AND r.game_mode = ?
      AND r.eligibility_status = 'eligible'
      AND r.is_smoke = 0
      AND p.status = 'active'
      AND p.identity_state = 'active'
      AND p.public_name_key IS NOT NULL
      AND p.device_credential_digest IS NOT NULL
      AND p.recovery_code_digest IS NOT NULL
      AND r.submitted_at_ms <= ?
  ),
  ranked AS (
    SELECT
      public_label,
      verified_wins,
      verified_overall_score_tenths,
      tier_label,
      submitted_at_ms,
      RANK() OVER (
        ORDER BY
          verified_wins DESC,
          verified_overall_score_tenths DESC
      ) AS public_rank,
      ROW_NUMBER() OVER (
        ORDER BY
          verified_wins DESC,
          verified_overall_score_tenths DESC,
          submitted_at_ms ASC,
          run_id ASC
      ) AS page_ordinal
    FROM scoped
    WHERE player_best <= 3
  )
  SELECT
    public_label,
    verified_wins,
    verified_overall_score_tenths,
    tier_label,
    submitted_at_ms,
    public_rank,
    page_ordinal
  FROM ranked
  WHERE page_ordinal > ?
  ORDER BY page_ordinal ASC
  LIMIT ?
`

const TIMED_CUMULATIVE_INPUTS_SQL = `
  SELECT
    r.player_id,
    COUNT(*) AS qualifying_run_count,
    SUM(r.verified_wins) AS verified_wins_sum,
    SUM(r.verified_overall_score_tenths) AS verified_score_tenths_sum,
    MIN(r.submitted_at_ms) AS first_submitted_at_ms,
    MAX(r.submitted_at_ms) AS last_submitted_at_ms
  FROM leaderboard_runs AS r
  JOIN leaderboard_players AS p ON p.player_id = r.player_id
  WHERE r.environment = ?
    AND r.game_mode = ?
    AND r.eligibility_status = 'eligible'
    AND r.is_smoke = 0
    AND p.status = 'active'
    AND p.identity_state = 'active'
    AND p.public_name_key IS NOT NULL
    AND r.submitted_at_ms >= ?
    AND r.submitted_at_ms < ?
    AND r.submitted_at_ms <= ?
  GROUP BY r.player_id
  ORDER BY r.player_id ASC
`

const ALL_TIME_CUMULATIVE_INPUTS_SQL = `
  SELECT
    r.player_id,
    COUNT(*) AS qualifying_run_count,
    SUM(r.verified_wins) AS verified_wins_sum,
    SUM(r.verified_overall_score_tenths) AS verified_score_tenths_sum,
    MIN(r.submitted_at_ms) AS first_submitted_at_ms,
    MAX(r.submitted_at_ms) AS last_submitted_at_ms
  FROM leaderboard_runs AS r
  JOIN leaderboard_players AS p ON p.player_id = r.player_id
  WHERE r.environment = ?
    AND r.game_mode = ?
    AND r.eligibility_status = 'eligible'
    AND r.is_smoke = 0
    AND p.status = 'active'
    AND p.identity_state = 'active'
    AND p.public_name_key IS NOT NULL
    AND r.submitted_at_ms <= ?
  GROUP BY r.player_id
  ORDER BY r.player_id ASC
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSafeDisplayText(value: string, maximumLength: number, rejectFormatting: boolean) {
  const characters = [...value]
  if (characters.length < 1 || characters.length > maximumLength) return false
  return characters.every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return false
    return !rejectFormatting || !(
      (codePoint >= 0x200b && codePoint <= 0x200f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2060 && codePoint <= 0x206f)
      || codePoint === 0xfeff
    )
  })
}

function canonicalTimestamp(value: number) {
  try {
    return new Date(value).toISOString()
  } catch {
    return null
  }
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_CURSOR_BYTES) return null
  try {
    const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (value.length % 4)) % 4)}`
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return base64UrlEncode(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

async function signCursorPayload(payload: string, signingKey: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array) {
  const maximumLength = Math.max(left.byteLength, right.byteLength)
  let difference = left.byteLength ^ right.byteLength
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function canonicalCursor(cursor: LeaderboardCursor) {
  return JSON.stringify({
    v: cursor.v,
    mode: cursor.mode,
    period: cursor.period,
    family: cursor.family,
    environment: cursor.environment,
    asOfMs: cursor.asOfMs,
    startMs: cursor.startMs,
    endMs: cursor.endMs,
    afterOrdinal: cursor.afterOrdinal,
  })
}

export async function encodeLeaderboardCursor(cursor: LeaderboardCursor, signingKey: string) {
  if (!isLeaderboardCursorSigningKey(signingKey)) throw new Error('Leaderboard cursor signing key is unavailable.')
  const payload = base64UrlEncode(new TextEncoder().encode(canonicalCursor(cursor)))
  const signature = base64UrlEncode(await signCursorPayload(payload, signingKey))
  return `${payload}.${signature}`
}

function parseCursorPayload(value: unknown): LeaderboardCursor | null {
  if (!isRecord(value) || !hasExactKeys(value, CURSOR_FIELDS)) return null
  if (
    value.v !== LEADERBOARD_CURSOR_VERSION
    || value.mode !== 'classic'
    || !isLeaderboardPeriod(value.period)
    || value.family !== 'best-run'
    || !isLeaderboardEnvironment(value.environment)
    || !isSafeTimestamp(value.asOfMs)
    || !(value.startMs === null || isSafeTimestamp(value.startMs))
    || !(value.endMs === null || isSafeTimestamp(value.endMs))
    || typeof value.afterOrdinal !== 'number'
    || !Number.isSafeInteger(value.afterOrdinal)
    || value.afterOrdinal < 1
  ) return null
  const expectedWindow = leaderboardPeriodWindow(value.period, value.asOfMs)
  if (expectedWindow.startMs !== value.startMs || expectedWindow.endMs !== value.endMs) return null
  return {
    v: LEADERBOARD_CURSOR_VERSION,
    mode: 'classic',
    period: value.period,
    family: 'best-run',
    environment: value.environment,
    asOfMs: value.asOfMs,
    startMs: value.startMs,
    endMs: value.endMs,
    afterOrdinal: value.afterOrdinal,
  }
}

export async function decodeLeaderboardCursor(token: string, signingKey: string) {
  if (
    !isLeaderboardCursorSigningKey(signingKey)
    || new TextEncoder().encode(token).byteLength > MAX_CURSOR_BYTES
  ) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, signatureText] = parts
  const payloadBytes = base64UrlDecode(payload)
  const signature = base64UrlDecode(signatureText)
  if (!payloadBytes || !signature || signature.byteLength !== 32) return null
  const expected = await signCursorPayload(payload, signingKey)
  if (!constantTimeBytesEqual(signature, expected)) return null
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(payloadBytes)
    const parsed = parseStrictJson(decoded)
    if (JSON.stringify(parsed) !== decoded) return null
    return parseCursorPayload(parsed)
  } catch {
    return null
  }
}

function isLeaderboardPeriod(value: unknown): value is LeaderboardPeriod {
  return value === 'daily' || value === 'weekly' || value === 'all-time'
}

function isLeaderboardEnvironment(value: unknown): value is LeaderboardEnvironment {
  return value === 'preview' || value === 'production'
}

export function leaderboardPeriodWindow(period: LeaderboardPeriod, asOfMs: number): LeaderboardPeriodWindow {
  if (!isSafeTimestamp(asOfMs) || canonicalTimestamp(asOfMs) === null) {
    throw new Error('Leaderboard time source is invalid.')
  }
  if (period === 'all-time') return { period, asOfMs, startMs: null, endMs: null }
  const date = new Date(asOfMs)
  const dailyStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  if (period === 'daily') {
    return { period, asOfMs, startMs: dailyStart, endMs: dailyStart + 86_400_000 }
  }
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  const weeklyStart = dailyStart - daysSinceMonday * 86_400_000
  return { period, asOfMs, startMs: weeklyStart, endMs: weeklyStart + 7 * 86_400_000 }
}

function leaderboardDatabase(value: unknown): LeaderboardDatabase | null {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'prepare') === 'function'
    ? value as LeaderboardDatabase
    : null
}

async function leaderboardSchemaIsReady(database: LeaderboardDatabase) {
  const result = await database.prepare(SELECT_SCHEMA_SQL).all<{ version: unknown }>()
  return result.success === true
    && Array.isArray(result.results)
    && result.results.length === 1
    && result.results[0].version === EXPECTED_LEADERBOARD_SCHEMA_VERSION
}

function publicEntry(row: BestRunRow): PublicLeaderboardEntry | null {
  if (
    typeof row.public_label !== 'string'
    || validateDisplayName(row.public_label)?.displayName !== row.public_label
    || typeof row.verified_wins !== 'number'
    || !Number.isSafeInteger(row.verified_wins)
    || row.verified_wins < 0
    || row.verified_wins > 162
    || typeof row.verified_overall_score_tenths !== 'number'
    || !Number.isSafeInteger(row.verified_overall_score_tenths)
    || row.verified_overall_score_tenths < 0
    || row.verified_overall_score_tenths > 1000
    || typeof row.tier_label !== 'string'
    || !isSafeDisplayText(row.tier_label, 64, false)
    || row.tier_label !== row.tier_label.trim()
    || !isSafeTimestamp(row.submitted_at_ms)
    || typeof row.public_rank !== 'number'
    || !Number.isSafeInteger(row.public_rank)
    || row.public_rank < 1
    || typeof row.page_ordinal !== 'number'
    || !Number.isSafeInteger(row.page_ordinal)
    || row.page_ordinal < 1
  ) return null
  const submittedAt = canonicalTimestamp(row.submitted_at_ms)
  if (!submittedAt) return null
  return Object.freeze({
    rank: row.public_rank,
    playerLabel: row.public_label,
    projectedWins: row.verified_wins,
    overallScore: row.verified_overall_score_tenths / 10,
    tier: row.tier_label,
    submittedAt,
    mode: 'classic',
  })
}

export async function queryBestRunLeaderboard(
  database: LeaderboardDatabase,
  environment: LeaderboardEnvironment,
  window: LeaderboardPeriodWindow,
  afterOrdinal: number,
  limit: number,
) {
  const fetchLimit = limit + 1
  const statement = window.period === 'all-time'
    ? database.prepare(ALL_TIME_BEST_RUN_SQL).bind(
      environment,
      'classic',
      window.asOfMs,
      afterOrdinal,
      fetchLimit,
    )
    : database.prepare(TIMED_BEST_RUN_SQL).bind(
      environment,
      'classic',
      window.startMs,
      window.endMs,
      window.asOfMs,
      afterOrdinal,
      fetchLimit,
    )
  const result = await statement.all<BestRunRow>()
  if (result.success !== true || !Array.isArray(result.results)) return null
  const entries = result.results.map(publicEntry)
  if (entries.some((entry) => entry === null)) return null
  const validEntries = entries as PublicLeaderboardEntry[]
  const hasMore = validEntries.length > limit
  const visibleRows = result.results.slice(0, limit)
  const lastOrdinal = visibleRows.at(-1)?.page_ordinal
  if (
    lastOrdinal !== undefined
    && (
      typeof lastOrdinal !== 'number'
      || !Number.isSafeInteger(lastOrdinal)
      || lastOrdinal < 1
    )
  ) return null
  return {
    entries: validEntries.slice(0, limit),
    hasMore,
    lastOrdinal: typeof lastOrdinal === 'number' ? lastOrdinal : null,
  }
}

function cumulativeInput(row: CumulativeInputRow): CumulativePerformanceInput | null {
  if (
    typeof row.player_id !== 'number'
    || !Number.isSafeInteger(row.player_id)
    || row.player_id < 1
    || typeof row.qualifying_run_count !== 'number'
    || !Number.isSafeInteger(row.qualifying_run_count)
    || row.qualifying_run_count < 1
    || typeof row.verified_wins_sum !== 'number'
    || !Number.isSafeInteger(row.verified_wins_sum)
    || row.verified_wins_sum < 0
    || typeof row.verified_score_tenths_sum !== 'number'
    || !Number.isSafeInteger(row.verified_score_tenths_sum)
    || row.verified_score_tenths_sum < 0
    || !isSafeTimestamp(row.first_submitted_at_ms)
    || !isSafeTimestamp(row.last_submitted_at_ms)
    || row.first_submitted_at_ms > row.last_submitted_at_ms
  ) return null
  return {
    playerId: row.player_id,
    qualifyingRunCount: row.qualifying_run_count,
    verifiedWinsSum: row.verified_wins_sum,
    verifiedScoreTenthsSum: row.verified_score_tenths_sum,
    firstSubmittedAtMs: row.first_submitted_at_ms,
    lastSubmittedAtMs: row.last_submitted_at_ms,
  }
}

/**
 * Aggregate-ready inputs only. This function deliberately does not assign a
 * cumulative score or rank because the product formula remains unresolved.
 */
export async function queryCumulativePerformanceInputs(
  database: LeaderboardDatabase,
  environment: LeaderboardEnvironment,
  window: LeaderboardPeriodWindow,
) {
  const statement = window.period === 'all-time'
    ? database.prepare(ALL_TIME_CUMULATIVE_INPUTS_SQL).bind(
      environment,
      'classic',
      window.asOfMs,
    )
    : database.prepare(TIMED_CUMULATIVE_INPUTS_SQL).bind(
      environment,
      'classic',
      window.startMs,
      window.endMs,
      window.asOfMs,
    )
  const result = await statement.all<CumulativeInputRow>()
  if (result.success !== true || !Array.isArray(result.results)) return null
  const inputs = result.results.map(cumulativeInput)
  return inputs.some((input) => input === null)
    ? null
    : inputs as CumulativePerformanceInput[]
}

interface ParsedLeaderboardQuery {
  readonly mode: LeaderboardMode
  readonly period: LeaderboardPeriod
  readonly family: LeaderboardRankingFamily
  readonly limit: number
  readonly cursor: string | null
}

function parseLeaderboardQuery(url: URL): ParsedLeaderboardQuery | null {
  const counts = new Map<string, number>()
  for (const [key] of url.searchParams) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) return null
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if ([...counts.values()].some((count) => count !== 1)) return null

  const mode = url.searchParams.get('mode') ?? 'classic'
  const period = url.searchParams.get('period') ?? 'all-time'
  const family = url.searchParams.get('family') ?? 'best-run'
  const limitText = url.searchParams.get('limit')
  const limit = limitText === null ? LEADERBOARD_DEFAULT_LIMIT : Number(limitText)
  const cursor = url.searchParams.get('cursor')
  if (
    mode !== 'classic'
    || !isLeaderboardPeriod(period)
    || (family !== 'best-run' && family !== 'cumulative-performance')
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > LEADERBOARD_MAX_LIMIT
    || (limitText !== null && String(limit) !== limitText)
    || (cursor !== null && (cursor.length === 0 || new TextEncoder().encode(cursor).byteLength > MAX_CURSOR_BYTES))
  ) return null
  return { mode, period, family, limit, cursor }
}

function errorResponse(
  code: 'invalid_query' | 'unsupported_board' | 'leaderboard_unavailable',
  status: 400 | 422 | 503,
  extra: Readonly<Record<string, unknown>> = {},
) {
  const message = code === 'invalid_query'
    ? 'Leaderboard query parameters are invalid.'
    : code === 'unsupported_board'
      ? 'The requested leaderboard is not available.'
      : 'Leaderboard data is temporarily unavailable.'
  return new Response(JSON.stringify({
    ok: false,
    error: Object.freeze({ code, message }),
    ...extra,
  }), { status, headers: SAFE_JSON_RESPONSE_HEADERS })
}

function successHeaders() {
  return {
    ...SAFE_JSON_RESPONSE_HEADERS,
    'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=30',
  }
}

function capabilities() {
  return Object.freeze({
    bestRun: true,
    cumulativePerformance: CUMULATIVE_PERFORMANCE_PUBLICLY_AVAILABLE,
  })
}

function periodMetadata(window: LeaderboardPeriodWindow) {
  return Object.freeze({
    timeZone: 'UTC',
    start: window.startMs === null ? null : canonicalTimestamp(window.startMs),
    end: window.endMs === null ? null : canonicalTimestamp(window.endMs),
    interval: window.period === 'all-time' ? 'through-generated-at' : 'start-inclusive-end-exclusive',
    weekStartsOn: window.period === 'weekly' ? 'Monday' : null,
  })
}

export async function handleLeaderboardRequest(
  request: Request,
  env: LeaderboardEnv = {},
  now: () => number = () => Date.now(),
) {
  if (!isLeaderboardReadEnabled(env)) return handleApiNotFoundRequest(request)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({
      ok: false,
      error: Object.freeze({ code: 'method_not_allowed', message: 'Method Not Allowed' }),
    }), {
      status: 405,
      headers: { ...SAFE_JSON_RESPONSE_HEADERS, Allow: ALLOWED_METHODS },
    })
  }

  const parsed = parseLeaderboardQuery(new URL(request.url))
  if (!parsed) return errorResponse('invalid_query', 400)
  if (parsed.family === 'cumulative-performance') {
    return errorResponse('unsupported_board', 422, { capabilities: capabilities() })
  }
  if (!isLeaderboardEnvironment(env.LEADERBOARD_ENVIRONMENT)) {
    return errorResponse('leaderboard_unavailable', 503)
  }
  if (!isLeaderboardCursorSigningKey(env.LEADERBOARD_CURSOR_SIGNING_KEY)) {
    return errorResponse('leaderboard_unavailable', 503)
  }
  const database = leaderboardDatabase(env.DB)
  if (!database) return errorResponse('leaderboard_unavailable', 503)
  try {
    if (!await leaderboardSchemaIsReady(database)) {
      return errorResponse('leaderboard_unavailable', 503)
    }
  } catch {
    return errorResponse('leaderboard_unavailable', 503)
  }

  let window: LeaderboardPeriodWindow
  let afterOrdinal = 0
  try {
    if (parsed.cursor) {
      const cursor = await decodeLeaderboardCursor(parsed.cursor, env.LEADERBOARD_CURSOR_SIGNING_KEY)
      if (
        !cursor
        || cursor.mode !== parsed.mode
        || cursor.period !== parsed.period
        || cursor.family !== parsed.family
        || cursor.environment !== env.LEADERBOARD_ENVIRONMENT
      ) return errorResponse('invalid_query', 400)
      window = {
        period: cursor.period,
        asOfMs: cursor.asOfMs,
        startMs: cursor.startMs,
        endMs: cursor.endMs,
      }
      afterOrdinal = cursor.afterOrdinal
    } else {
      window = leaderboardPeriodWindow(parsed.period, now())
    }
  } catch {
    return errorResponse('leaderboard_unavailable', 503)
  }

  try {
    const page = await queryBestRunLeaderboard(database, env.LEADERBOARD_ENVIRONMENT, window, afterOrdinal, parsed.limit)
    if (!page) return errorResponse('leaderboard_unavailable', 503)
    const last = page.entries.at(-1)
    const nextCursor = page.hasMore && last && page.lastOrdinal !== null
      ? await encodeLeaderboardCursor({
        v: LEADERBOARD_CURSOR_VERSION,
        mode: parsed.mode,
        period: parsed.period,
        family: 'best-run',
        environment: env.LEADERBOARD_ENVIRONMENT,
        asOfMs: window.asOfMs,
        startMs: window.startMs,
        endMs: window.endMs,
        afterOrdinal: page.lastOrdinal,
      }, env.LEADERBOARD_CURSOR_SIGNING_KEY)
      : null
    const generatedAt = canonicalTimestamp(window.asOfMs)
    if (!generatedAt) return errorResponse('leaderboard_unavailable', 503)
    const payload = {
      ok: true,
      schemaVersion: LEADERBOARD_RESPONSE_SCHEMA_VERSION,
      generatedAt,
      board: Object.freeze({
        mode: parsed.mode,
        period: parsed.period,
        rankingFamily: parsed.family,
        rankPolicy: 'competition-shared',
        ordering: Object.freeze([
          'projected-wins-desc',
          'overall-score-desc',
          'submitted-at-asc',
          'stable-final-tiebreak-asc',
        ]),
        periodWindow: periodMetadata(window),
      }),
      eligibility: Object.freeze({
        verifiedOnly: true,
        bestThreeRunsPerPlayer: true,
        excludesTestAndSmokeData: true,
        serverSubmissionTimeAuthority: true,
      }),
      capabilities: capabilities(),
      entries: page.entries,
      page: Object.freeze({
        limit: parsed.limit,
        nextCursor,
      }),
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
      status: 200,
      headers: { ...successHeaders(), Allow: ALLOWED_METHODS },
    })
  } catch {
    return errorResponse('leaderboard_unavailable', 503)
  }
}
