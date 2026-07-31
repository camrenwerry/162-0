import type { DraftTranscript } from '../../game/DraftTranscript'
import type { GameplaySeed } from '../../game/SeededRandom'

const MAX_JSON_RESPONSE_BYTES = 128 * 1024
const TICKET_PATTERN = /^[A-Za-z0-9_-]{32,4096}$/
const TICKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DRAFT_SEED_PATTERN = /^seeded-v1:[0-9a-f]{32}$/
const DEVICE_CREDENTIAL_PATTERN = /^ppd1_[A-Za-z0-9_-]{43}$/
const CLAIM_CAPABILITY_PATTERN = /^ppc1_[A-Za-z0-9_-]{43}$/
const RECOVERY_OPERATION_PATTERN = /^ppr1_[A-Za-z0-9_-]{43}$/
const RECOVERY_CODE_PATTERN = /^PP1(?:-[0-9A-HJKMNP-TV-Z]{4}){7}$/
const SUBMISSION_SCHEMA = 'pennant-draft-submission-v1'
const LEADERBOARD_PLACEMENT_SCHEMA = 'pennant-leaderboard-placement-v1'
const LEADERBOARD_RESPONSE_SCHEMA = 'pennant-leaderboard-response-v2'
const IDENTITY_RESPONSE_SCHEMA = 'pennant-leaderboard-identity-v1'

export type PennantApiErrorKind =
  | 'aborted'
  | 'timeout'
  | 'disabled'
  | 'offline'
  | 'rate-limited'
  | 'invalid-request'
  | 'conflict'
  | 'cooldown'
  | 'invalid-credential'
  | 'invalid-recovery'
  | 'expired-ticket'
  | 'incompatible'
  | 'unavailable'

export interface PennantApiError {
  readonly kind: PennantApiErrorKind
  readonly retryAfterSeconds: number | null
}

export type PennantApiResult<T> =
  | Readonly<{ ok: true, value: T, status: number }>
  | Readonly<{ ok: false, error: PennantApiError }>

export interface DraftTicket {
  readonly value: string
  readonly ticketId: string
  readonly draftSeed: GameplaySeed
  readonly issuedAt: number
  readonly expiresAt: number
  readonly gameMode: 'classic'
}

export interface PeriodPlacement {
  readonly qualifies: boolean
  readonly rank: number | null
  readonly displacedPriorEntry: boolean
  readonly cutoff: Readonly<{ projectedWins: number, overallScore: number }> | null
  readonly proximity: Readonly<{
    projectedWinsBelowCutoff: number
    overallScoreBelowCutoff: number | null
  }> | null
}

export interface SubmissionPlacement {
  readonly snapshotAt: string
  readonly periods: Readonly<Record<'daily' | 'weekly' | 'all-time', PeriodPlacement>>
  readonly newPersonalBest: boolean
  readonly identity: Readonly<{
    setupRequired: boolean
    reason: 'qualifying_run_requires_identity' | null
  }>
  readonly claim:
    | Readonly<{ state: 'not-required' | 'disabled' | 'expired' | 'claimed' }>
    | Readonly<{ state: 'available', capability: string, expiresAt: string }>
}

export interface DraftSubmissionReceipt {
  readonly submittedAt: string
  readonly idempotentRetry: boolean
  readonly result: Readonly<{
    projectedWins: number
    projectedLosses: number
    overallScore: number
    overallGrade: string
    tier: string
  }>
  readonly leaderboard: SubmissionPlacement
}

export interface PublicLeaderboardEntry {
  readonly rank: number
  readonly playerLabel: string
  readonly projectedWins: number
  readonly overallScore: number
  readonly tier: string
  readonly submittedAt: string
  readonly mode: 'classic'
}

export interface LeaderboardPage {
  readonly generatedAt: string
  readonly period: 'daily' | 'weekly' | 'all-time'
  readonly entries: readonly PublicLeaderboardEntry[]
  readonly nextCursor: string | null
}

export interface PublicIdentityStatus {
  readonly displayName: string
  readonly renameEligible: boolean
  readonly nextEligibleRenameAt: string | null
  readonly recoveryVersion: number
}

export interface ClaimedIdentity {
  readonly displayName: string
  readonly deviceCredential: string
  readonly recoveryCode: string
  readonly recoveryVersion: number
}

export interface RecoveredIdentity extends ClaimedIdentity {
  readonly recoveryRetryExpiresAt: string
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type Validator<T> = (value: unknown) => T | null

export const PENNANT_API_DEADLINES_MS = Object.freeze({
  ticket: 4_000,
  submission: 10_000,
  leaderboard: 8_000,
  availability: 5_000,
  claim: 8_000,
  identityStatus: 6_000,
  rename: 8_000,
  recovery: 10_000,
})

export type PennantApiOperation = keyof typeof PENNANT_API_DEADLINES_MS
export type PennantApiDeadlineOverrides = Partial<Record<PennantApiOperation, number>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function safeTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 32) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function safeWins(value: unknown): value is number {
  return safeInteger(value) && value <= 162
}

function safeEpochMilliseconds(value: unknown): value is number {
  return safeInteger(value) && value <= 8_640_000_000_000_000
}

function safeScore(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 100
    && Math.round(value * 10) / 10 === value
}

function safeText(value: unknown, maximum = 80): value is string {
  return typeof value === 'string'
    && value.length > 0
    && [...value].length <= maximum
    && [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1f && !(codePoint >= 0x7f && codePoint <= 0x9f)
    })
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('Retry-After')
  if (value === null || !/^\d{1,5}$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function errorKind(status: number, code: string | null): PennantApiErrorKind {
  if (status === 404 || code === 'not_found') return 'disabled'
  if (status === 429 || code === 'rate_limited') return 'rate-limited'
  if (status === 401 || code === 'identity_credential_invalid') return 'invalid-credential'
  if (code === 'identity_recovery_invalid') return 'invalid-recovery'
  if (code === 'invalid_draft_ticket') return 'expired-ticket'
  if (code === 'rename_cooldown') return 'cooldown'
  if (status === 409) return 'conflict'
  if (
    code === 'unsupported_transcript_version'
    || code === 'unsupported_app_version'
    || code === 'unsupported_rng_version'
    || code === 'unsupported_rules_version'
    || code === 'unsupported_scoring_version'
    || code === 'unsupported_data_version'
    || code === 'canonical_data_mismatch'
  ) return 'incompatible'
  if (status >= 400 && status < 500) return 'invalid-request'
  return 'unavailable'
}

function publicError(response: Response, value: unknown): PennantApiError {
  const code = isRecord(value)
    && isRecord(value.error)
    && typeof value.error.code === 'string'
    ? value.error.code
    : null
  return Object.freeze({
    kind: errorKind(response.status, code),
    retryAfterSeconds: retryAfterSeconds(response),
  })
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('Content-Length')
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_JSON_RESPONSE_BYTES)) {
    throw new Error('Response is too large.')
  }
  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new Error('Response is not JSON.')
  if (!response.body) throw new Error('Response has no body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined)
  }
  if (signal.aborted) {
    cancelReader()
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  signal.addEventListener('abort', cancelReader, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      if (done) break
      total += value.byteLength
      if (total > MAX_JSON_RESPONSE_BYTES) {
        cancelReader()
        throw new Error('Response is too large.')
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancelReader)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  return JSON.parse(text) as unknown
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  validate: Validator<T>,
  fetcher: Fetcher,
  deadlineMs: number,
): Promise<PennantApiResult<T>> {
  const callerSignal = init.signal
  if (callerSignal?.aborted) {
    return Object.freeze({ ok: false, error: Object.freeze({ kind: 'aborted', retryAfterSeconds: null }) })
  }
  const controller = new AbortController()
  let settled = false
  let resolveInterruption: (value: PennantApiResult<T>) => void = () => undefined
  const interruption = new Promise<PennantApiResult<T>>((resolve) => {
    resolveInterruption = resolve
  })
  const interrupt = (kind: 'aborted' | 'timeout') => {
    if (settled) return
    controller.abort()
    resolveInterruption(Object.freeze({
      ok: false,
      error: Object.freeze({ kind, retryAfterSeconds: null }),
    }))
  }
  const callerAbort = () => interrupt('aborted')
  callerSignal?.addEventListener('abort', callerAbort, { once: true })
  const timeout = setTimeout(() => interrupt('timeout'), deadlineMs)
  const request = requestJsonWithinSignal(path, init, validate, fetcher, controller.signal)
  try {
    return await Promise.race([request, interruption])
  } finally {
    settled = true
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', callerAbort)
  }
}

async function requestJsonWithinSignal<T>(
  path: string,
  init: RequestInit,
  validate: Validator<T>,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<PennantApiResult<T>> {
  let response: Response
  try {
    response = await fetcher(path, {
      ...init,
      signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return Object.freeze({ ok: false, error: Object.freeze({ kind: 'aborted', retryAfterSeconds: null }) })
    }
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        kind: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unavailable',
        retryAfterSeconds: null,
      }),
    })
  }
  let value: unknown
  try {
    value = await boundedJson(response, signal)
  } catch {
    if (signal.aborted) {
      return Object.freeze({ ok: false, error: Object.freeze({ kind: 'aborted', retryAfterSeconds: null }) })
    }
    return Object.freeze({ ok: false, error: Object.freeze({ kind: 'incompatible', retryAfterSeconds: null }) })
  }
  if (!response.ok) return Object.freeze({ ok: false, error: publicError(response, value) })
  const validated = validate(value)
  return validated === null
    ? Object.freeze({ ok: false, error: Object.freeze({ kind: 'incompatible', retryAfterSeconds: null }) })
    : Object.freeze({ ok: true, value: validated, status: response.status })
}

function validateDraftTicket(value: unknown): DraftTicket | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.ticket)) return null
  const ticket = value.ticket
  if (
    !exactKeys(ticket, ['value', 'ticketId', 'draftSeed', 'issuedAt', 'expiresAt', 'gameMode'])
    || typeof ticket.value !== 'string'
    || !TICKET_PATTERN.test(ticket.value)
    || typeof ticket.ticketId !== 'string'
    || !TICKET_ID_PATTERN.test(ticket.ticketId)
    || typeof ticket.draftSeed !== 'string'
    || !DRAFT_SEED_PATTERN.test(ticket.draftSeed)
    || !safeEpochMilliseconds(ticket.issuedAt)
    || !safeEpochMilliseconds(ticket.expiresAt)
    || ticket.expiresAt <= ticket.issuedAt
    || ticket.gameMode !== 'classic'
  ) return null
  return Object.freeze({
    value: ticket.value,
    ticketId: ticket.ticketId,
    draftSeed: ticket.draftSeed as GameplaySeed,
    issuedAt: ticket.issuedAt,
    expiresAt: ticket.expiresAt,
    gameMode: 'classic',
  })
}

function validatePeriodPlacement(value: unknown): PeriodPlacement | null {
  if (
    !isRecord(value)
    || typeof value.qualifies !== 'boolean'
    || !(value.rank === null || safeInteger(value.rank, 1))
    || typeof value.displacedPriorEntry !== 'boolean'
  ) return null
  const cutoff = value.cutoff === null
    ? null
    : isRecord(value.cutoff)
      && safeWins(value.cutoff.projectedWins)
      && safeScore(value.cutoff.overallScore)
      ? Object.freeze({
        projectedWins: value.cutoff.projectedWins,
        overallScore: value.cutoff.overallScore,
      })
      : undefined
  const proximity = value.proximity === null
    ? null
    : isRecord(value.proximity)
      && safeWins(value.proximity.projectedWinsBelowCutoff)
      && (value.proximity.overallScoreBelowCutoff === null || safeScore(value.proximity.overallScoreBelowCutoff))
      ? Object.freeze({
        projectedWinsBelowCutoff: value.proximity.projectedWinsBelowCutoff,
        overallScoreBelowCutoff: value.proximity.overallScoreBelowCutoff,
      })
      : undefined
  if (cutoff === undefined || proximity === undefined) return null
  return Object.freeze({
    qualifies: value.qualifies,
    rank: value.rank,
    displacedPriorEntry: value.displacedPriorEntry,
    cutoff,
    proximity,
  })
}

function validateClaim(value: unknown): SubmissionPlacement['claim'] | null {
  if (!isRecord(value) || typeof value.state !== 'string') return null
  if (value.state === 'not-required' || value.state === 'disabled' || value.state === 'expired' || value.state === 'claimed') {
    return Object.freeze({ state: value.state })
  }
  if (
    value.state !== 'available'
    || typeof value.capability !== 'string'
    || !CLAIM_CAPABILITY_PATTERN.test(value.capability)
    || !safeTimestamp(value.expiresAt)
  ) return null
  return Object.freeze({ state: 'available', capability: value.capability, expiresAt: value.expiresAt })
}

function validateSubmission(value: unknown): DraftSubmissionReceipt | null {
  if (
    !isRecord(value)
    || value.ok !== true
    || value.verified !== true
    || value.submitted !== true
    || value.submissionSchema !== SUBMISSION_SCHEMA
    || !safeTimestamp(value.submittedAt)
    || !isRecord(value.result)
    || !isRecord(value.leaderboard)
  ) return null
  const result = value.result
  if (
    !safeWins(result.projectedWins)
    || !safeWins(result.projectedLosses)
    || result.projectedWins + result.projectedLosses !== 162
    || !safeScore(result.overallScore)
    || !safeText(result.overallGrade, 8)
    || !safeText(result.tier, 48)
  ) return null
  const leaderboard = value.leaderboard
  if (
    leaderboard.schemaVersion !== LEADERBOARD_PLACEMENT_SCHEMA
    || !safeTimestamp(leaderboard.snapshotAt)
    || !isRecord(leaderboard.periods)
    || !isRecord(leaderboard.identity)
    || typeof leaderboard.newPersonalBest !== 'boolean'
    || typeof leaderboard.identity.setupRequired !== 'boolean'
  ) return null
  const daily = validatePeriodPlacement(leaderboard.periods.daily)
  const weekly = validatePeriodPlacement(leaderboard.periods.weekly)
  const allTime = validatePeriodPlacement(leaderboard.periods['all-time'])
  const claim = validateClaim(leaderboard.claim)
  if (!daily || !weekly || !allTime || !claim) return null
  const reason = leaderboard.identity.reason
  if (reason !== null && reason !== 'qualifying_run_requires_identity') return null
  return Object.freeze({
    submittedAt: value.submittedAt,
    idempotentRetry: false,
    result: Object.freeze({
      projectedWins: result.projectedWins,
      projectedLosses: result.projectedLosses,
      overallScore: result.overallScore,
      overallGrade: result.overallGrade,
      tier: result.tier,
    }),
    leaderboard: Object.freeze({
      snapshotAt: leaderboard.snapshotAt,
      periods: Object.freeze({ daily, weekly, 'all-time': allTime }),
      newPersonalBest: leaderboard.newPersonalBest,
      identity: Object.freeze({
        setupRequired: leaderboard.identity.setupRequired,
        reason,
      }),
      claim,
    }),
  })
}

function validateLeaderboard(value: unknown): LeaderboardPage | null {
  if (
    !isRecord(value)
    || value.ok !== true
    || value.schemaVersion !== LEADERBOARD_RESPONSE_SCHEMA
    || !safeTimestamp(value.generatedAt)
    || !isRecord(value.board)
    || !Array.isArray(value.entries)
    || !isRecord(value.page)
  ) return null
  const period = value.board.period
  if (
    (period !== 'daily' && period !== 'weekly' && period !== 'all-time')
    || value.board.mode !== 'classic'
    || value.board.rankingFamily !== 'best-run'
    || value.board.rankPolicy !== 'competition-shared'
  ) return null
  const entries: PublicLeaderboardEntry[] = []
  for (const entry of value.entries) {
    if (
      !isRecord(entry)
      || !safeInteger(entry.rank, 1)
      || !safeText(entry.playerLabel, 20)
      || !safeWins(entry.projectedWins)
      || !safeScore(entry.overallScore)
      || !safeText(entry.tier, 48)
      || !safeTimestamp(entry.submittedAt)
      || entry.mode !== 'classic'
    ) return null
    entries.push(Object.freeze({
      rank: entry.rank,
      playerLabel: entry.playerLabel,
      projectedWins: entry.projectedWins,
      overallScore: entry.overallScore,
      tier: entry.tier,
      submittedAt: entry.submittedAt,
      mode: 'classic',
    }))
  }
  const nextCursor = value.page.nextCursor
  if (!(nextCursor === null || (typeof nextCursor === 'string' && nextCursor.length > 0 && nextCursor.length <= 2048))) {
    return null
  }
  return Object.freeze({
    generatedAt: value.generatedAt,
    period,
    entries: Object.freeze(entries),
    nextCursor,
  })
}

function validateIdentityStatus(value: unknown): PublicIdentityStatus | null {
  if (
    !isRecord(value)
    || value.ok !== true
    || value.schemaVersion !== IDENTITY_RESPONSE_SCHEMA
    || !isRecord(value.identity)
    || !safeText(value.identity.displayName, 20)
    || typeof value.identity.renameEligible !== 'boolean'
    || !(value.identity.nextEligibleRenameAt === null || safeTimestamp(value.identity.nextEligibleRenameAt))
    || !safeInteger(value.identity.recoveryVersion, 1)
  ) return null
  return Object.freeze({
    displayName: value.identity.displayName,
    renameEligible: value.identity.renameEligible,
    nextEligibleRenameAt: value.identity.nextEligibleRenameAt,
    recoveryVersion: value.identity.recoveryVersion,
  })
}

function validateClaimedIdentity(value: unknown): ClaimedIdentity | null {
  if (
    !isRecord(value)
    || value.ok !== true
    || value.schemaVersion !== IDENTITY_RESPONSE_SCHEMA
    || !isRecord(value.identity)
  ) return null
  const identity = value.identity
  if (
    !safeText(identity.displayName, 20)
    || typeof identity.deviceCredential !== 'string'
    || !DEVICE_CREDENTIAL_PATTERN.test(identity.deviceCredential)
    || typeof identity.recoveryCode !== 'string'
    || !RECOVERY_CODE_PATTERN.test(identity.recoveryCode)
    || identity.recoveryCodeMustBeStored !== true
    || !(identity.recoveryVersion === undefined || safeInteger(identity.recoveryVersion, 1))
  ) return null
  return Object.freeze({
    displayName: identity.displayName,
    deviceCredential: identity.deviceCredential,
    recoveryCode: identity.recoveryCode,
    recoveryVersion: identity.recoveryVersion ?? 1,
  })
}

function validateRecoveredIdentity(value: unknown): RecoveredIdentity | null {
  const identity = validateClaimedIdentity(value)
  if (!identity || !isRecord(value) || !safeTimestamp(value.recoveryRetryExpiresAt)) return null
  return Object.freeze({ ...identity, recoveryRetryExpiresAt: value.recoveryRetryExpiresAt })
}

function validateAvailability(value: unknown): Readonly<{ displayName: string, available: boolean }> | null {
  if (
    !isRecord(value)
    || value.ok !== true
    || value.schemaVersion !== IDENTITY_RESPONSE_SCHEMA
    || !safeText(value.displayName, 20)
    || typeof value.available !== 'boolean'
  ) return null
  return Object.freeze({ displayName: value.displayName, available: value.available })
}

export function createRecoveryOperationId(
  randomValues: (values: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (values) => crypto.getRandomValues(values),
): string {
  const bytes = randomValues(new Uint8Array(new ArrayBuffer(32)))
  if (bytes.byteLength !== 32) throw new Error('Recovery operation randomness is unavailable.')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const id = `ppr1_${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`
  if (!RECOVERY_OPERATION_PATTERN.test(id)) throw new Error('Recovery operation ID is invalid.')
  return id
}

export class PennantApi {
  private readonly fetcher: Fetcher
  private readonly deadlines: Readonly<Record<PennantApiOperation, number>>

  constructor(fetcher: Fetcher = fetch, deadlineOverrides: PennantApiDeadlineOverrides = {}) {
    this.fetcher = fetcher
    const deadlines: Record<PennantApiOperation, number> = { ...PENNANT_API_DEADLINES_MS }
    for (const [operation, value] of Object.entries(deadlineOverrides)) {
      if (!(operation in PENNANT_API_DEADLINES_MS) || !Number.isSafeInteger(value) || (value ?? 0) < 1) {
        throw new TypeError(`Invalid ${operation} API deadline.`)
      }
      deadlines[operation as PennantApiOperation] = value as number
    }
    this.deadlines = Object.freeze(deadlines)
  }

  requestDraftTicket(signal?: AbortSignal) {
    return requestJson('/api/v1/draft-ticket', {
      method: 'POST',
      body: JSON.stringify({
        ticketRequestSchemaVersion: 'pennant-draft-ticket-request-v1',
        gameMode: 'classic',
      }),
      signal,
    }, validateDraftTicket, this.fetcher, this.deadlines.ticket)
  }

  async submitDraft(
    ticket: string,
    transcript: DraftTranscript,
    identityCredential: string | null,
    signal?: AbortSignal,
  ): Promise<PennantApiResult<DraftSubmissionReceipt>> {
    const result = await requestJson('/api/v1/submit-draft', {
      method: 'POST',
      body: JSON.stringify({ ticket, transcript, identityCredential }),
      signal,
    }, validateSubmission, this.fetcher, this.deadlines.submission)
    if (!result.ok) return result
    return Object.freeze({
      ...result,
      value: Object.freeze({
        ...result.value,
        idempotentRetry: result.status === 200,
      }),
    })
  }

  async readLeaderboard(
    period: 'daily' | 'weekly' | 'all-time',
    cursor: string | null,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      mode: 'classic',
      period,
      family: 'best-run',
      limit: '25',
    })
    if (cursor !== null) query.set('cursor', cursor)
    const result = await requestJson(`/api/v1/leaderboards?${query.toString()}`, {
      method: 'GET',
      signal,
    }, validateLeaderboard, this.fetcher, this.deadlines.leaderboard)
    if (!result.ok || result.value.period === period) return result
    return Object.freeze({
      ok: false,
      error: Object.freeze({ kind: 'incompatible', retryAfterSeconds: null }),
    } satisfies PennantApiResult<LeaderboardPage>)
  }

  checkDisplayName(displayName: string, signal?: AbortSignal) {
    return requestJson('/api/v1/leaderboard-name-availability', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
      signal,
    }, validateAvailability, this.fetcher, this.deadlines.availability)
  }

  claimIdentity(claimCapability: string, displayName: string, signal?: AbortSignal) {
    return requestJson('/api/v1/leaderboard-identity-claim', {
      method: 'POST',
      body: JSON.stringify({ claimCapability, displayName }),
      signal,
    }, validateClaimedIdentity, this.fetcher, this.deadlines.claim)
  }

  identityStatus(deviceCredential: string, signal?: AbortSignal) {
    return requestJson('/api/v1/leaderboard-identity-status', {
      method: 'POST',
      body: JSON.stringify({ deviceCredential }),
      signal,
    }, validateIdentityStatus, this.fetcher, this.deadlines.identityStatus)
  }

  renameIdentity(deviceCredential: string, displayName: string, signal?: AbortSignal) {
    return requestJson('/api/v1/leaderboard-identity-rename', {
      method: 'POST',
      body: JSON.stringify({ deviceCredential, displayName }),
      signal,
    }, validateIdentityStatus, this.fetcher, this.deadlines.rename)
  }

  recoverIdentity(recoveryCode: string, recoveryOperationId: string, signal?: AbortSignal) {
    return requestJson('/api/v1/leaderboard-identity-recover', {
      method: 'POST',
      body: JSON.stringify({ recoveryCode, recoveryOperationId }),
      signal,
    }, validateRecoveredIdentity, this.fetcher, this.deadlines.recovery)
  }
}

export function playerFacingApiMessage(error: PennantApiError, context: 'ticket' | 'submission' | 'leaderboard' | 'identity' | 'recovery'): string {
  if (error.kind === 'disabled') {
    if (context === 'leaderboard') return 'Public standings are not open yet.'
    if (context === 'recovery') return 'Recovery is not available in this Preview.'
    return context === 'ticket' || context === 'submission'
      ? 'This draft will stay on this device because public submissions are off.'
      : 'Identity features are not available in this Preview.'
  }
  if (error.kind === 'offline') return 'You appear to be offline. Reconnect and try again.'
  if (error.kind === 'rate-limited') return 'Too many requests were made. Wait a moment, then try again.'
  if (error.kind === 'invalid-credential') return 'This device identity is no longer valid. Remove it or recover your identity.'
  if (error.kind === 'invalid-recovery') return 'That recovery code could not be verified.'
  if (error.kind === 'expired-ticket') return 'This draft ticket expired. Your local result is safe, but it cannot be submitted.'
  if (error.kind === 'cooldown') return 'A name change is not available yet. Refresh your identity status for the eligibility date.'
  if (error.kind === 'conflict') return context === 'identity'
    ? 'That display name is no longer available.'
    : 'This draft ticket was already used for a different result.'
  if (error.kind === 'incompatible') return 'This app version cannot use the current leaderboard service.'
  if (error.kind === 'invalid-request') return 'The server could not verify this request.'
  if (error.kind === 'aborted') {
    return context === 'ticket' ? 'Ticket preparation stopped. This draft will stay on this device.' : ''
  }
  if (error.kind === 'timeout') {
    if (context === 'ticket') return 'The ticket service took too long to respond. This draft will stay on this device.'
    if (context === 'submission') return 'The result check took too long. Your local result is safe; try submission again when you are ready.'
    if (context === 'leaderboard') return 'The standings took too long to respond. Try loading them again.'
    if (context === 'recovery') return 'Recovery took too long to respond. No automatic retry was made.'
    return 'The identity service took too long to respond. No automatic retry was made.'
  }
  return 'The leaderboard service is temporarily unavailable. Try again when you are ready.'
}
