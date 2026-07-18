import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from '../../../src/game/DraftTranscript'
import { CURRENT_REPLAY_VERSION_SUPPORT } from '../../../src/game/ReplayDraft'
import { replayDraftWithCatalog } from '../../../src/game/replay/replayDraft'
import { DraftReplayError, type ReplayCatalog, type ValidatedDraftRoster } from '../../../src/game/replay/types'
import { calculateDraftResult, gradeForScore, tierForWins } from '../../../src/game/scoring'
import type { DraftResult } from '../../../src/types/draft'
import {
  DraftValidationPublicError,
  handleApiNotFoundRequest,
  type DraftValidationErrorCode,
} from '../../../functions/lib/api-response'
import { parseStrictJson, readBoundedJson } from '../../../functions/lib/bounded-json'
import {
  constantTimeDigestEqual,
  digestSubmissionTicketToken,
  digestSubmissionTranscript,
  DRAFT_SUBMISSION_RETENTION_MS,
  DRAFT_SUBMISSION_SCHEMA_VERSION,
} from '../../../functions/lib/draft-submission'
import {
  DraftSubmissionPublicError,
  draftSubmissionErrorResponse,
  draftSubmissionSuccessResponse,
  type DraftSubmissionErrorCode,
} from '../../../functions/lib/draft-submission-response'
import {
  parseDraftRequestEnvelope,
  validateDraftSupportedVersions,
} from '../../../functions/lib/draft-validation-schema'
import {
  verifyDraftTicket,
  type DraftTicketVerificationResult,
} from '../../../functions/lib/draft-ticket'
import {
  draftTicketMatchesTranscript,
  getAuthoritativeReplayCatalog,
  replayFailureCode,
  requestOriginIsAllowed,
} from './authoritative-validation'

export const DRAFT_SUBMISSION_ALLOWED_METHODS = 'POST'

const EXPECTED_DATABASE_SCHEMA_VERSION = 2
const SELECT_SCHEMA_SQL = 'SELECT version FROM backend_schema WHERE id = 1'
const SELECT_SUBMISSION_SQL = `
  SELECT
    ticket_id,
    ticket_token_digest,
    transcript_digest,
    submitted_at_ms,
    retain_until_ms,
    submission_schema_version,
    success_response_json
  FROM draft_submissions
  WHERE ticket_id = ?
  LIMIT 1
`
const INSERT_SUBMISSION_SQL = `
  INSERT INTO draft_submissions (
    ticket_id,
    ticket_token_digest,
    transcript_digest,
    submitted_at_ms,
    retain_until_ms,
    submission_schema_version,
    success_response_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ticket_id) DO NOTHING
`

const RECEIPT_FIELDS = ['ok', 'verified', 'submitted', 'submissionSchema', 'submittedAt', 'versions', 'result'] as const
const VERSION_FIELDS = ['transcriptSchema', 'app', 'gameRules', 'rng', 'scoring', 'data', 'canonicalDataDigest'] as const
const RESULT_FIELDS = [
  'projectedWins', 'projectedLosses', 'overallScore', 'overallGrade', 'tier',
  'categories', 'strongestCategory', 'weakestCategory',
] as const
const CATEGORY_FIELDS = ['offense', 'defense', 'startingPitching', 'reliefPitching', 'rosterBalance'] as const
const CATEGORY_RESULT_FIELDS = ['score', 'grade'] as const

type ReceiptCategory = (typeof CATEGORY_FIELDS)[number]

interface SubmissionPreparedStatement {
  bind(...values: unknown[]): SubmissionPreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
}

interface SubmissionDatabase {
  prepare(query: string): SubmissionPreparedStatement
  batch(statements: SubmissionPreparedStatement[]): Promise<unknown>
}

export interface SubmissionModeEnv {
  readonly DRAFT_SUBMISSION_MODE?: unknown
  readonly DRAFT_TICKET_SIGNING_KEY?: unknown
  readonly DB?: unknown
}

interface StoredSubmissionRow {
  readonly ticket_id: string
  readonly ticket_token_digest: string
  readonly transcript_digest: string
  readonly submitted_at_ms: number
  readonly retain_until_ms: number
  readonly submission_schema_version: string
  readonly success_response_json: string
}

type ProposedSubmissionRow = StoredSubmissionRow

interface SubmissionSources {
  readonly now: () => number
  readonly verifyTicket: (
    token: unknown,
    signingKey: unknown,
    now?: number,
  ) => Promise<DraftTicketVerificationResult>
  readonly getCatalog: () => ReplayCatalog | null
  readonly replay: (transcript: DraftTranscript, catalog: ReplayCatalog) => ValidatedDraftRoster
  readonly score: (roster: ValidatedDraftRoster) => DraftResult<unknown>
}

const defaultSources: SubmissionSources = Object.freeze({
  now: () => Date.now(),
  verifyTicket: verifyDraftTicket,
  getCatalog: getAuthoritativeReplayCatalog,
  replay: (transcript: DraftTranscript, catalog: ReplayCatalog) => replayDraftWithCatalog(transcript, catalog, CURRENT_REPLAY_VERSION_SUPPORT),
  score: (roster: ValidatedDraftRoster) => calculateDraftResult(roster).result,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

function isSubmissionDatabase(value: unknown): value is SubmissionDatabase {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'prepare') === 'function'
    && typeof Reflect.get(value, 'batch') === 'function'
}

function submissionDatabase(value: unknown): SubmissionDatabase | null {
  return isSubmissionDatabase(value) ? value : null
}

export function isSubmissionEnabled(env: SubmissionModeEnv) {
  return env.DRAFT_SUBMISSION_MODE === 'enabled'
}

function submissionCodeFromValidation(code: DraftValidationErrorCode): DraftSubmissionErrorCode {
  if (code === 'not_found' || code === 'temporarily_unavailable') return 'submission_unavailable'
  return code
}

function errorResponse(code: DraftSubmissionErrorCode, headers: Readonly<Record<string, string>> = {}) {
  return draftSubmissionErrorResponse(new DraftSubmissionPublicError(code), headers)
}

function validationErrorResponse(error: DraftValidationPublicError) {
  return errorResponse(submissionCodeFromValidation(error.code))
}

function safeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function canonicalTimestamp(value: number) {
  try {
    return new Date(value).toISOString()
  } catch {
    return null
  }
}

function storedSubmissionRow(value: unknown, ticketId: string): StoredSubmissionRow | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'ticket_id', 'ticket_token_digest', 'transcript_digest', 'submitted_at_ms',
    'retain_until_ms', 'submission_schema_version', 'success_response_json',
  ])) return null

  if (
    value.ticket_id !== ticketId
    || typeof value.ticket_token_digest !== 'string'
    || typeof value.transcript_digest !== 'string'
    || constantTimeDigestEqual(value.ticket_token_digest, value.ticket_token_digest) !== true
    || constantTimeDigestEqual(value.transcript_digest, value.transcript_digest) !== true
    || !safeTimestamp(value.submitted_at_ms)
    || !safeTimestamp(value.retain_until_ms)
    || canonicalTimestamp(value.submitted_at_ms) === null
    || !Number.isSafeInteger(value.submitted_at_ms + DRAFT_SUBMISSION_RETENTION_MS)
    || value.retain_until_ms !== value.submitted_at_ms + DRAFT_SUBMISSION_RETENTION_MS
    || value.submission_schema_version !== DRAFT_SUBMISSION_SCHEMA_VERSION
    || typeof value.success_response_json !== 'string'
    || value.success_response_json.length < 2
    || value.success_response_json.length > 8_192
  ) return null

  return {
    ticket_id: value.ticket_id,
    ticket_token_digest: value.ticket_token_digest,
    transcript_digest: value.transcript_digest,
    submitted_at_ms: value.submitted_at_ms,
    retain_until_ms: value.retain_until_ms,
    submission_schema_version: value.submission_schema_version,
    success_response_json: value.success_response_json,
  }
}

function isReceiptScore(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 100
    && !Object.is(value, -0)
    && Math.round(value * 10) / 10 === value
}

function isReceiptCategory(value: unknown): value is ReceiptCategory {
  return typeof value === 'string' && CATEGORY_FIELDS.some((category) => category === value)
}

function validCategoryResult(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, CATEGORY_RESULT_FIELDS)) return false
  return isReceiptScore(value.score) && value.grade === gradeForScore(value.score)
}

function rankedReceiptCategories(categories: Record<ReceiptCategory, Record<string, unknown>>) {
  return [...CATEGORY_FIELDS].sort((left, right) => {
    const leftScore = categories[left].score
    const rightScore = categories[right].score
    if (typeof leftScore !== 'number' || typeof rightScore !== 'number') return 0
    return rightScore - leftScore || left.localeCompare(right)
  })
}

function validStoredReceipt(value: unknown, submittedAtMs: number) {
  if (!isRecord(value) || !hasExactKeys(value, RECEIPT_FIELDS)) return false
  if (
    value.ok !== true
    || value.verified !== true
    || value.submitted !== true
    || value.submissionSchema !== DRAFT_SUBMISSION_SCHEMA_VERSION
    || value.submittedAt !== canonicalTimestamp(submittedAtMs)
  ) return false

  const versions = value.versions
  if (!isRecord(versions) || !hasExactKeys(versions, VERSION_FIELDS)) return false
  if (
    versions.transcriptSchema !== TRANSCRIPT_SCHEMA_VERSION
    || versions.app !== APP_VERSION
    || versions.gameRules !== GAME_RULES_VERSION
    || versions.rng !== RNG_VERSION
    || versions.scoring !== SCORING_VERSION
    || versions.data !== DATA_VERSION
    || versions.canonicalDataDigest !== DATA_DIGEST
  ) return false

  const result = value.result
  if (!isRecord(result) || !hasExactKeys(result, RESULT_FIELDS)) return false
  if (
    typeof result.projectedWins !== 'number'
    || !Number.isSafeInteger(result.projectedWins)
    || result.projectedWins < 0
    || result.projectedWins > 162
    || typeof result.projectedLosses !== 'number'
    || !Number.isSafeInteger(result.projectedLosses)
    || result.projectedLosses !== 162 - result.projectedWins
    || !isReceiptScore(result.overallScore)
    || result.overallGrade !== gradeForScore(result.overallScore)
    || result.tier !== tierForWins(result.projectedWins)
    || !isReceiptCategory(result.strongestCategory)
    || !isReceiptCategory(result.weakestCategory)
  ) return false

  const categories = result.categories
  if (!isRecord(categories) || !hasExactKeys(categories, CATEGORY_FIELDS)) return false
  for (const category of CATEGORY_FIELDS) {
    if (!validCategoryResult(categories[category])) return false
  }
  const typedCategories = categories as Record<ReceiptCategory, Record<string, unknown>>
  const ranked = rankedReceiptCategories(typedCategories)
  return result.strongestCategory === ranked[0]
    && result.weakestCategory === ranked.at(-1)
}

function storedReceiptIsValid(row: StoredSubmissionRow) {
  let parsed: unknown
  try {
    parsed = parseStrictJson(row.success_response_json)
  } catch {
    return false
  }
  return JSON.stringify(parsed) === row.success_response_json
    && validStoredReceipt(parsed, row.submitted_at_ms)
}

function digestMatches(left: string, right: string) {
  return constantTimeDigestEqual(left, right)
}

function reconcileRetainedRow(
  row: StoredSubmissionRow,
  ticketTokenDigest: string,
  transcriptDigest: string,
) {
  const tokenMatches = digestMatches(row.ticket_token_digest, ticketTokenDigest)
  if (tokenMatches === null) return errorResponse('submission_unavailable')
  if (!tokenMatches) return errorResponse('invalid_draft_ticket')

  const transcriptMatches = digestMatches(row.transcript_digest, transcriptDigest)
  if (transcriptMatches === null) return errorResponse('submission_unavailable')
  if (!transcriptMatches) return errorResponse('draft_ticket_already_consumed')
  if (!storedReceiptIsValid(row)) return errorResponse('submission_unavailable')
  return draftSubmissionSuccessResponse(row.success_response_json, 200)
}

function publicCategory(result: DraftResult<unknown>, key: ReceiptCategory) {
  return Object.freeze({ score: result.categoryScores[key], grade: result.categoryGrades[key] })
}

function createSuccessReceipt(result: DraftResult<unknown>, submittedAtMs: number) {
  const submittedAt = canonicalTimestamp(submittedAtMs)
  if (!submittedAt) return null
  const receipt = {
    ok: true,
    verified: true,
    submitted: true,
    submissionSchema: DRAFT_SUBMISSION_SCHEMA_VERSION,
    submittedAt,
    versions: Object.freeze({
      transcriptSchema: TRANSCRIPT_SCHEMA_VERSION,
      app: APP_VERSION,
      gameRules: GAME_RULES_VERSION,
      rng: RNG_VERSION,
      scoring: SCORING_VERSION,
      data: DATA_VERSION,
      canonicalDataDigest: DATA_DIGEST,
    }),
    result: Object.freeze({
      projectedWins: result.wins,
      projectedLosses: result.losses,
      overallScore: result.overallScore,
      overallGrade: result.overallGrade,
      tier: result.tierLabel,
      categories: Object.freeze({
        offense: publicCategory(result, 'offense'),
        defense: publicCategory(result, 'defense'),
        startingPitching: publicCategory(result, 'startingPitching'),
        reliefPitching: publicCategory(result, 'reliefPitching'),
        rosterBalance: publicCategory(result, 'rosterBalance'),
      }),
      strongestCategory: result.strongestCategory,
      weakestCategory: result.weakestCategory,
    }),
  }
  const serialized = JSON.stringify(receipt)
  if (!validStoredReceipt(receipt, submittedAtMs) || serialized.length > 8_192) return null
  return serialized
}

async function databaseSchemaIsReady(database: SubmissionDatabase) {
  const schema = await database.prepare(SELECT_SCHEMA_SQL).first<unknown>()
  return isRecord(schema)
    && hasExactKeys(schema, ['version'])
    && schema.version === EXPECTED_DATABASE_SCHEMA_VERSION
}

async function readRetainedRow(database: SubmissionDatabase, ticketId: string) {
  const value = await database.prepare(SELECT_SUBMISSION_SQL).bind(ticketId).first<unknown>()
  if (value === null) return null
  return storedSubmissionRow(value, ticketId) ?? false
}

function insertedRowMatchesProposal(row: StoredSubmissionRow, proposal: ProposedSubmissionRow) {
  const tokenMatches = digestMatches(row.ticket_token_digest, proposal.ticket_token_digest)
  const transcriptMatches = digestMatches(row.transcript_digest, proposal.transcript_digest)
  return tokenMatches === true
    && transcriptMatches === true
    && row.ticket_id === proposal.ticket_id
    && row.submitted_at_ms === proposal.submitted_at_ms
    && row.retain_until_ms === proposal.retain_until_ms
    && row.submission_schema_version === proposal.submission_schema_version
    && row.success_response_json === proposal.success_response_json
    && storedReceiptIsValid(row)
}

async function persistSubmissionAtomically(
  database: SubmissionDatabase,
  proposal: ProposedSubmissionRow,
) {
  let batchValue: unknown
  try {
    const insert = database.prepare(INSERT_SUBMISSION_SQL).bind(
      proposal.ticket_id,
      proposal.ticket_token_digest,
      proposal.transcript_digest,
      proposal.submitted_at_ms,
      proposal.retain_until_ms,
      proposal.submission_schema_version,
      proposal.success_response_json,
    )
    const select = database.prepare(SELECT_SUBMISSION_SQL).bind(proposal.ticket_id)
    batchValue = await database.batch([insert, select])
  } catch {
    return errorResponse('submission_unavailable')
  }

  if (!Array.isArray(batchValue) || batchValue.length !== 2) return errorResponse('submission_unavailable')
  const [insertResult, selectResult] = batchValue
  if (!isRecord(insertResult) || insertResult.success !== true || !isRecord(insertResult.meta)) {
    return errorResponse('submission_unavailable')
  }
  const changes = insertResult.meta.changes
  if (changes !== 0 && changes !== 1) return errorResponse('submission_unavailable')
  if (!isRecord(selectResult) || selectResult.success !== true || !Array.isArray(selectResult.results) || selectResult.results.length !== 1) {
    return errorResponse('submission_unavailable')
  }
  const selected = storedSubmissionRow(selectResult.results[0], proposal.ticket_id)
  if (!selected) return errorResponse('submission_unavailable')

  if (changes === 1) {
    if (!insertedRowMatchesProposal(selected, proposal)) return errorResponse('submission_unavailable')
    return draftSubmissionSuccessResponse(selected.success_response_json, 201)
  }
  return reconcileRetainedRow(selected, proposal.ticket_token_digest, proposal.transcript_digest)
}

/**
 * Private, server-authoritative submission. The outer Worker applies the
 * Service Binding rate-key and both limits before invoking this handler.
 */
export async function handleAuthoritativeSubmissionRequest(
  request: Request,
  env: SubmissionModeEnv = {},
  sourceOverrides: Partial<SubmissionSources> = {},
) {
  if (!isSubmissionEnabled(env)) return handleApiNotFoundRequest(request)
  if (request.method !== DRAFT_SUBMISSION_ALLOWED_METHODS) {
    return errorResponse('method_not_allowed', { Allow: DRAFT_SUBMISSION_ALLOWED_METHODS })
  }
  if (!requestOriginIsAllowed(request)) return errorResponse('origin_not_allowed')

  let ticket: string
  let transcript: DraftTranscript
  try {
    const envelope = parseDraftRequestEnvelope(await readBoundedJson(request))
    ticket = envelope.ticket
    transcript = envelope.transcript
  } catch (error) {
    return error instanceof DraftValidationPublicError
      ? validationErrorResponse(error)
      : errorResponse('submission_unavailable')
  }

  if (typeof env.DRAFT_TICKET_SIGNING_KEY !== 'string' || env.DRAFT_TICKET_SIGNING_KEY.length === 0) {
    return errorResponse('submission_unavailable')
  }
  const database = submissionDatabase(env.DB)
  if (!database) return errorResponse('submission_unavailable')

  let ticketTokenDigest: string
  let transcriptDigest: string
  try {
    [ticketTokenDigest, transcriptDigest] = await Promise.all([
      digestSubmissionTicketToken(ticket),
      digestSubmissionTranscript(transcript),
    ])
  } catch {
    return errorResponse('submission_unavailable')
  }

  let retained: StoredSubmissionRow | null | false
  try {
    if (!await databaseSchemaIsReady(database)) return errorResponse('submission_unavailable')
    retained = await readRetainedRow(database, transcript.header.draftId)
  } catch {
    return errorResponse('submission_unavailable')
  }
  if (retained === false) return errorResponse('submission_unavailable')
  if (retained) return reconcileRetainedRow(retained, ticketTokenDigest, transcriptDigest)

  const sources: SubmissionSources = { ...defaultSources, ...sourceOverrides }
  let verification: DraftTicketVerificationResult
  try {
    verification = await sources.verifyTicket(ticket, env.DRAFT_TICKET_SIGNING_KEY, sources.now())
  } catch {
    return errorResponse('submission_unavailable')
  }
  if (!verification.ok) return errorResponse('invalid_draft_ticket')
  if (!draftTicketMatchesTranscript(verification.payload, transcript)) return errorResponse('draft_ticket_mismatch')
  try {
    validateDraftSupportedVersions(transcript)
  } catch (error) {
    return error instanceof DraftValidationPublicError
      ? validationErrorResponse(error)
      : errorResponse('submission_unavailable')
  }

  let catalog: ReplayCatalog | null
  try {
    catalog = sources.getCatalog()
  } catch {
    return errorResponse('submission_unavailable')
  }
  if (!catalog) return errorResponse('submission_unavailable')
  let roster: ValidatedDraftRoster
  try {
    roster = sources.replay(transcript, catalog)
  } catch (error) {
    if (!(error instanceof DraftReplayError)) return errorResponse('submission_unavailable')
    return errorResponse(submissionCodeFromValidation(replayFailureCode(error, transcript, catalog)))
  }

  let result: DraftResult<unknown>
  try {
    result = sources.score(roster)
  } catch {
    return errorResponse('scoring_failed')
  }

  const submittedAtMs = sources.now()
  const retainUntilMs = submittedAtMs + DRAFT_SUBMISSION_RETENTION_MS
  if (
    !safeTimestamp(submittedAtMs)
    || !safeTimestamp(retainUntilMs)
    || !Number.isSafeInteger(retainUntilMs)
  ) return errorResponse('submission_unavailable')
  const successResponseJson = createSuccessReceipt(result, submittedAtMs)
  if (!successResponseJson) return errorResponse('submission_unavailable')

  return persistSubmissionAtomically(database, {
    ticket_id: transcript.header.draftId,
    ticket_token_digest: ticketTokenDigest,
    transcript_digest: transcriptDigest,
    submitted_at_ms: submittedAtMs,
    retain_until_ms: retainUntilMs,
    submission_schema_version: DRAFT_SUBMISSION_SCHEMA_VERSION,
    success_response_json: successResponseJson,
  })
}
