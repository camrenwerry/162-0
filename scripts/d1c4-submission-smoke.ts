import path from 'node:path'
import {
  digestSubmissionTicketToken,
  digestSubmissionTranscript,
} from '../functions/lib/draft-submission'
import {
  DRAFT_SUBMISSION_RETENTION_MS,
  DRAFT_SUBMISSION_SCHEMA_VERSION,
} from '../functions/lib/draft-submission-constants'
import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from '../src/game/DraftTranscript'
import { gradeForScore, tierForWins } from '../src/game/scoring'
import {
  boundedJsonRequest,
  D1C4_DEFAULT_REQUEST_TIMEOUT_MS,
  D1C4_ENDPOINT_RESPONSE_LIMIT_BYTES,
  rawBytesEqual,
  utf8Bytes,
  type D1C4Fetch,
} from './lib/d1c4-bounded-fetch'
import {
  authorizePreviewD1Mutations,
  createPreviewD1Client,
  createPreviewD1MutationClient,
  draftSubmissionFingerprintsEqual,
  exactFingerprintChunks,
  type DraftSubmissionFingerprint,
  type PreviewD1MutationClient,
  type PreviewD1ReadClient,
  type SubmissionPersistenceRow,
} from './lib/d1c4-d1-client'
import {
  commonTargetFromArguments,
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  parseStrictArguments,
  requirePreviewApiToken,
  validatePreviewSmokeTarget,
  type ValidatedPreviewSmokeTarget,
} from './lib/d1c4-preview-guard'
import {
  buildPreviewSubmissionTranscript,
  deterministicReplayFailure,
  type IssuedPreviewTicket,
} from './lib/d1c4-submission-fixture'

const COMPILED_SCRIPT_BASENAME = 'd1c4-submission-smoke.js'
const COMMON_VALUE_OPTIONS = [
  'preview-base-url',
  'preview-worker',
  'preview-environment',
  'account-id',
  'database-id',
  'ack',
] as const
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' })
const RECEIPT_FIELDS = ['ok', 'verified', 'submitted', 'submissionSchema', 'submittedAt', 'versions', 'result'] as const
const VERSION_FIELDS = ['transcriptSchema', 'app', 'gameRules', 'rng', 'scoring', 'data', 'canonicalDataDigest'] as const
const RESULT_FIELDS = [
  'projectedWins', 'projectedLosses', 'overallScore', 'overallGrade', 'tier',
  'categories', 'strongestCategory', 'weakestCategory',
] as const
const CATEGORY_FIELDS = ['offense', 'defense', 'startingPitching', 'reliefPitching', 'rosterBalance'] as const
const CATEGORY_RESULT_FIELDS = ['score', 'grade'] as const
const STORED_SUCCESS_RECEIPT_LIMIT_BYTES = 8_192

type ReceiptCategory = (typeof CATEGORY_FIELDS)[number]

export interface ApiResult {
  readonly status: number
  readonly bytes: Uint8Array
  readonly text: string
  readonly body: Record<string, unknown>
}

export interface SubmissionSmokeD1 {
  readonly read: PreviewD1ReadClient
  readonly mutate: PreviewD1MutationClient
}

export interface SubmissionCleanupD1 {
  readonly read: Pick<PreviewD1ReadClient, 'readSubmissionRows'>
  readonly mutate: Pick<PreviewD1MutationClient, 'deleteDraftSubmissionFingerprints'>
}

export type SubmissionCleanupMutationOutcome =
  | 'confirmed-expected-change-count'
  | 'zero-change'
  | 'unexpected-change-count'
  | 'thrown-ambiguous-failure'

export type SubmissionCleanupOwnershipStatus =
  | 'deleted'
  | 'absent'
  | 'confirmed-owned'
  | 'mismatched-non-owned'
  | 'unresolved'

export interface SubmissionCleanupOwnershipRecord {
  readonly ticketId: string
  readonly expectedFingerprint: DraftSubmissionFingerprint
  readonly mutationOutcome: SubmissionCleanupMutationOutcome
  readonly status: SubmissionCleanupOwnershipStatus
}

export interface SubmissionCleanupAttemptResult {
  readonly mutationOutcome: SubmissionCleanupMutationOutcome
  readonly reportedChanges: number | null
  readonly mutationFailureMessage: string | null
  readonly reconciliationPerformed: boolean
  readonly reconciliationFailed: boolean
  readonly ownershipRecords: readonly SubmissionCleanupOwnershipRecord[]
}

export class SubmissionCleanupFailure extends Error {
  readonly ownershipRecords: readonly SubmissionCleanupOwnershipRecord[]

  constructor(message: string, ownershipRecords: readonly SubmissionCleanupOwnershipRecord[]) {
    super(message)
    this.name = 'SubmissionCleanupFailure'
    this.ownershipRecords = ownershipRecords
  }
}

export interface SubmissionSmokeDependencies {
  readonly fetcher?: D1C4Fetch
  readonly requestTimeoutMs?: number
  readonly createD1?: (
    target: ValidatedPreviewSmokeTarget,
    apiToken: string,
    fetcher: D1C4Fetch,
  ) => SubmissionSmokeD1
}

export interface SubmissionSmokeExecution {
  readonly target: ValidatedPreviewSmokeTarget
  readonly apiToken: string
}

export interface ExpectedSubmissionIdentity {
  readonly ticketId: string
  readonly ticketTokenDigest: string
  readonly transcriptDigest: string
  readonly submissionSchemaVersion: string
}

export interface ValidatedSubmissionSuccessReceipt {
  readonly submittedAtMs: number
}

function fail(message: string): never {
  throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
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
  return isRecord(value)
    && hasExactKeys(value, CATEGORY_RESULT_FIELDS)
    && isReceiptScore(value.score)
    && value.grade === gradeForScore(value.score)
}

function rankedReceiptCategories(categories: Record<ReceiptCategory, Record<string, unknown>>) {
  return [...CATEGORY_FIELDS].sort((left, right) => {
    const leftScore = categories[left].score
    const rightScore = categories[right].score
    if (typeof leftScore !== 'number' || typeof rightScore !== 'number') return 0
    return rightScore - leftScore || left.localeCompare(right)
  })
}

function defaultD1(
  target: ValidatedPreviewSmokeTarget,
  apiToken: string,
  fetcher: D1C4Fetch,
): SubmissionSmokeD1 {
  const read = createPreviewD1Client(target, apiToken, fetcher)
  const authorization = authorizePreviewD1Mutations(target, target.acknowledgement)
  return Object.freeze({ read, mutate: createPreviewD1MutationClient(read, authorization) })
}

async function requestJson(
  fetcher: D1C4Fetch,
  requestTimeoutMs: number,
  url: string,
  init: RequestInit,
  description: string,
): Promise<ApiResult> {
  const result = await boundedJsonRequest(url, {
    description,
    timeoutMs: requestTimeoutMs,
    maxResponseBytes: D1C4_ENDPOINT_RESPONSE_LIMIT_BYTES,
    fetcher,
    init,
  })
  if (!isRecord(result.body)) fail(`${description} returned a malformed JSON object.`)
  return Object.freeze({ status: result.status, bytes: result.bytes, text: result.text, body: result.body })
}

async function postJson(
  fetcher: D1C4Fetch,
  requestTimeoutMs: number,
  origin: string,
  pathname: string,
  value: unknown,
  description: string,
) {
  return requestJson(fetcher, requestTimeoutMs, `${origin}${pathname}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Origin: origin },
    body: JSON.stringify(value),
  }, description)
}

async function issueTicket(
  fetcher: D1C4Fetch,
  requestTimeoutMs: number,
  origin: string,
): Promise<IssuedPreviewTicket> {
  const result = await postJson(fetcher, requestTimeoutMs, origin, '/api/v1/draft-ticket', {
    ticketRequestSchemaVersion: 'pennant-draft-ticket-request-v1',
    gameMode: 'classic',
  }, 'Preview ticket issuance')
  const ticket = result.body.ticket
  if (
    result.status !== 201 || result.body.ok !== true || !isRecord(ticket)
    || typeof ticket.value !== 'string' || ticket.value.length === 0
    || typeof ticket.ticketId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ticket.ticketId)
    || typeof ticket.draftSeed !== 'string' || !/^seeded-v1:[0-9a-f]{32}$/.test(ticket.draftSeed)
    || typeof ticket.issuedAt !== 'number' || !Number.isSafeInteger(ticket.issuedAt) || ticket.issuedAt < 0
  ) fail(`Preview ticket issuance failed closed at HTTP ${result.status}.`)
  return {
    value: ticket.value,
    ticketId: ticket.ticketId,
    draftSeed: ticket.draftSeed as IssuedPreviewTicket['draftSeed'],
    issuedAt: ticket.issuedAt,
  }
}

export function validateSubmissionSuccessReceipt(result: ApiResult): ValidatedSubmissionSuccessReceipt {
  const body = result.body
  if (
    result.status !== 201
    || !hasExactKeys(body, RECEIPT_FIELDS)
    || body.ok !== true
    || body.verified !== true
    || body.submitted !== true
    || body.submissionSchema !== DRAFT_SUBMISSION_SCHEMA_VERSION
    || result.bytes.byteLength < 2
    || result.bytes.byteLength > STORED_SUCCESS_RECEIPT_LIMIT_BYTES
    || !rawBytesEqual(utf8Bytes(result.text), result.bytes)
    || JSON.stringify(body) !== result.text
  ) fail(`Expected a complete canonical persisted-submission receipt; received HTTP ${result.status}.`)

  const submittedAtMs = canonicalSubmittedAtMs(body.submittedAt)
  const versions = body.versions
  if (
    submittedAtMs === null
    || !isRecord(versions)
    || !hasExactKeys(versions, VERSION_FIELDS)
    || versions.transcriptSchema !== TRANSCRIPT_SCHEMA_VERSION
    || versions.app !== APP_VERSION
    || versions.gameRules !== GAME_RULES_VERSION
    || versions.rng !== RNG_VERSION
    || versions.scoring !== SCORING_VERSION
    || versions.data !== DATA_VERSION
    || versions.canonicalDataDigest !== DATA_DIGEST
  ) fail('Submission success receipt has invalid timestamp or version fields.')

  const receiptResult = body.result
  if (
    !isRecord(receiptResult)
    || !hasExactKeys(receiptResult, RESULT_FIELDS)
    || typeof receiptResult.projectedWins !== 'number'
    || !Number.isSafeInteger(receiptResult.projectedWins)
    || receiptResult.projectedWins < 0
    || receiptResult.projectedWins > 162
    || typeof receiptResult.projectedLosses !== 'number'
    || !Number.isSafeInteger(receiptResult.projectedLosses)
    || receiptResult.projectedLosses !== 162 - receiptResult.projectedWins
    || !isReceiptScore(receiptResult.overallScore)
    || receiptResult.overallGrade !== gradeForScore(receiptResult.overallScore)
    || receiptResult.tier !== tierForWins(receiptResult.projectedWins)
    || !isReceiptCategory(receiptResult.strongestCategory)
    || !isReceiptCategory(receiptResult.weakestCategory)
  ) fail('Submission success receipt has an invalid authoritative result.')

  const categories = receiptResult.categories
  if (!isRecord(categories) || !hasExactKeys(categories, CATEGORY_FIELDS)) {
    fail('Submission success receipt has invalid result categories.')
  }
  for (const category of CATEGORY_FIELDS) {
    if (!validCategoryResult(categories[category])) {
      fail('Submission success receipt has invalid result categories.')
    }
  }
  const typedCategories = categories as Record<ReceiptCategory, Record<string, unknown>>
  const ranked = rankedReceiptCategories(typedCategories)
  if (
    receiptResult.strongestCategory !== ranked[0]
    || receiptResult.weakestCategory !== ranked.at(-1)
  ) fail('Submission success receipt has inconsistent category rankings.')

  return Object.freeze({ submittedAtMs })
}

export function assertSubmissionCreated(result: ApiResult) {
  return validateSubmissionSuccessReceipt(result)
}

export function assertIdempotentSubmissionRetry(created: ApiResult, retry: ApiResult) {
  if (retry.status !== 200 || !rawBytesEqual(retry.bytes, created.bytes)) {
    fail('Identical ticket and transcript did not return the stored raw-byte-identical success receipt.')
  }
}

export function assertReplaySubstitutionRejected(result: ApiResult) {
  const error = result.body.error
  if (result.status !== 409 || !isRecord(error) || error.code !== 'draft_ticket_already_consumed') {
    fail('Ticket replay with a substituted transcript was not rejected as consumed.')
  }
}

export function assertDeterministicReplayFailed(result: ApiResult) {
  const error = result.body.error
  if (
    result.status !== 422 || result.body.ok !== false || !isRecord(error)
    || error.code !== 'invalid_roll_sequence'
  ) fail('The deliberately invalid deterministic replay did not fail at the replay boundary.')
}

export function assertStoredSuccessReceipt(
  row: Pick<SubmissionPersistenceRow, 'successResponseJson'>,
  expectedBytes: Uint8Array,
  description = 'stored success receipt',
) {
  if (typeof row.successResponseJson !== 'string' || row.successResponseJson.length === 0) {
    fail(`${description} is missing.`)
  }
  try {
    JSON.parse(row.successResponseJson)
  } catch {
    fail(`${description} is not valid JSON.`)
  }
  if (!rawBytesEqual(utf8Bytes(row.successResponseJson), expectedBytes)) {
    fail(`${description} does not match the canonical UTF-8 response bytes.`)
  }
}

export function assertExactSubmissionRows(
  rows: readonly SubmissionPersistenceRow[],
  expectedRows: readonly DraftSubmissionFingerprint[],
) {
  const expected = new Map(expectedRows.map((row) => [row.ticketId, row]))
  if (expected.size !== expectedRows.length || rows.length !== expected.size) {
    fail('D1 exact submission rows did not match this smoke run.')
  }
  const actual = new Set<string>()
  for (const row of rows) {
    if (
      !/^[0-9a-f]{64}$/.test(row.ticketTokenDigest)
      || !/^[0-9a-f]{64}$/.test(row.transcriptDigest)
      || row.submissionSchemaVersion !== DRAFT_SUBMISSION_SCHEMA_VERSION
    ) fail('D1 exact submission query returned a malformed sentinel row.')
    const expectedRow = expected.get(row.ticketId)
    if (
      !expectedRow || actual.has(row.ticketId)
      || !draftSubmissionFingerprintsEqual(row, expectedRow)
    ) fail('D1 exact submission fingerprint did not match this smoke run.')
    assertStoredSuccessReceipt(
      row,
      utf8Bytes(expectedRow.successResponseJson),
      'Stored receipt for an owned submission row',
    )
    actual.add(row.ticketId)
  }
}

async function assertHealth(fetcher: D1C4Fetch, requestTimeoutMs: number, origin: string) {
  const result = await requestJson(fetcher, requestTimeoutMs, `${origin}/api/v1/health`, {
    method: 'GET',
    headers: { Origin: origin },
  }, 'Preview health')
  const versions = result.body.versions
  const features = result.body.features
  const submission = result.body.submission
  const backend = result.body.backend
  const d1 = isRecord(backend) ? backend.d1 : null
  if (
    result.status !== 200 || result.body.status !== 'healthy'
    || !isRecord(versions) || versions.submissionSchema !== DRAFT_SUBMISSION_SCHEMA_VERSION
    || !isRecord(submission) || submission.configured !== true || submission.schemaReady !== true
    || submission.operationalWriteReadiness !== 'externally-unverified'
    || !isRecord(features) || features.submissions !== 'schema-ready'
    || features.writes !== 'externally-unverified' || features.d1 !== 'schema-ready'
    || !isRecord(d1) || d1.schemaVersion !== 2 || d1.reachable !== true
  ) fail('Preview health does not prove Pages-visible submission schema readiness; private write execution remains externally unverified.')
}

async function submit(
  fetcher: D1C4Fetch,
  requestTimeoutMs: number,
  origin: string,
  ticket: IssuedPreviewTicket,
  transcript: DraftTranscript,
) {
  return postJson(
    fetcher,
    requestTimeoutMs,
    origin,
    '/api/v1/submit-draft',
    { ticket: ticket.value, transcript },
    'Preview draft submission',
  )
}

function exactRow(rows: readonly SubmissionPersistenceRow[], description: string) {
  if (rows.length !== 1) fail(`${description} did not have exactly one persisted D1 row.`)
  return rows[0]
}

async function reserveIssuedTicket(read: PreviewD1ReadClient, ticketId: string) {
  if (await read.countSubmissionTickets([ticketId]) !== 0) {
    fail('Freshly issued ticket collided with a pre-existing D1 row; no cleanup ownership was assumed.')
  }
}

async function expectedSubmissionIdentity(
  ticket: IssuedPreviewTicket,
  transcript: DraftTranscript,
): Promise<ExpectedSubmissionIdentity> {
  return Object.freeze({
    ticketId: ticket.ticketId,
    ticketTokenDigest: await digestSubmissionTicketToken(ticket.value),
    transcriptDigest: await digestSubmissionTranscript(transcript),
    submissionSchemaVersion: DRAFT_SUBMISSION_SCHEMA_VERSION,
  })
}

function identityMatchesRow(identity: ExpectedSubmissionIdentity, row: SubmissionPersistenceRow) {
  return row.ticketId === identity.ticketId
    && row.ticketTokenDigest === identity.ticketTokenDigest
    && row.transcriptDigest === identity.transcriptDigest
    && row.submissionSchemaVersion === identity.submissionSchemaVersion
}

function canonicalSubmittedAtMs(value: unknown) {
  if (typeof value !== 'string') return null
  const milliseconds = Date.parse(value)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return null
  try {
    return new Date(milliseconds).toISOString() === value ? milliseconds : null
  } catch {
    return null
  }
}

function fingerprintFromCreatedResponse(
  identity: ExpectedSubmissionIdentity,
  result: ApiResult,
  receipt: ValidatedSubmissionSuccessReceipt,
): DraftSubmissionFingerprint {
  const submittedAtMs = receipt.submittedAtMs
  const retainUntilMs = submittedAtMs + DRAFT_SUBMISSION_RETENTION_MS
  if (
    !Number.isSafeInteger(retainUntilMs)
    || !rawBytesEqual(utf8Bytes(result.text), result.bytes)
  ) fail('The success response is incompatible with the canonical UTF-8 D1 receipt storage contract.')
  return Object.freeze({
    ...identity,
    submittedAtMs,
    retainUntilMs,
    successResponseJson: result.text,
  })
}

async function diagnoseAmbiguousSubmission(
  read: PreviewD1ReadClient,
  identity: ExpectedSubmissionIdentity,
  description: string,
) {
  let rows: readonly SubmissionPersistenceRow[]
  try {
    rows = await read.readSubmissionRows([identity.ticketId])
  } catch {
    fail(`${description} could not complete its read-only D1 diagnostic; submission ownership could not be established and no cleanup was attempted.`)
  }
  if (rows.length === 0) return
  const row = exactRow(rows, description)
  if (!identityMatchesRow(identity, row)) {
    fail(`${description} found a mismatching row; the read was diagnostic only, submission ownership could not be established, and the row was left untouched.`)
  }
  fail(`${description} found a same-identity row, but no valid HTTP success receipt was received; the read was diagnostic only, submission ownership could not be established, and the row was left untouched.`)
}

async function readExpectedSubmissionFingerprint(
  read: PreviewD1ReadClient,
  expected: DraftSubmissionFingerprint,
  description: string,
) {
  const rows = await read.readSubmissionRows([expected.ticketId])
  if (rows.length === 0) return null
  const row = exactRow(rows, description)
  if (!draftSubmissionFingerprintsEqual(row, expected)) {
    fail(`${description} found the ticket ID with a mismatching complete immutable fingerprint; the row was left untouched.`)
  }
  return row
}

async function submitExpectedSuccess(
  d1: SubmissionSmokeD1,
  fetcher: D1C4Fetch,
  requestTimeoutMs: number,
  origin: string,
  ticket: IssuedPreviewTicket,
  transcript: DraftTranscript,
  owned: Map<string, DraftSubmissionFingerprint>,
  description: string,
) {
  const identity = await expectedSubmissionIdentity(ticket, transcript)
  let result: ApiResult | undefined
  let validatedReceipt: ValidatedSubmissionSuccessReceipt
  try {
    result = await submit(fetcher, requestTimeoutMs, origin, ticket, transcript)
    validatedReceipt = assertSubmissionCreated(result)
  } catch (error) {
    await diagnoseAmbiguousSubmission(d1.read, identity, `${description} ambiguous response`)
    throw error
  }

  const expected = fingerprintFromCreatedResponse(identity, result, validatedReceipt)
  const persisted = await readExpectedSubmissionFingerprint(d1.read, expected, `${description} persistence verification`)
  if (!persisted) {
    fail(`${description} did not persist the exact expected immutable fingerprint; no cleanup ownership was assumed.`)
  }
  assertStoredSuccessReceipt(persisted, result.bytes, `${description} stored receipt`)
  owned.set(expected.ticketId, expected)
  return Object.freeze({ result, fingerprint: expected })
}

function freezeSubmissionCleanupRecords(
  records: readonly SubmissionCleanupOwnershipRecord[],
) {
  return Object.freeze(records.map((record) => Object.freeze({
    ...record,
    expectedFingerprint: Object.freeze({ ...record.expectedFingerprint }),
  })))
}

async function reconcileSubmissionCleanup(
  read: SubmissionCleanupD1['read'],
  expectedRows: readonly DraftSubmissionFingerprint[],
  mutationOutcome: SubmissionCleanupMutationOutcome,
) {
  let rows: readonly SubmissionPersistenceRow[]
  try {
    rows = await read.readSubmissionRows(expectedRows.map((row) => row.ticketId))
  } catch {
    return Object.freeze({
      failed: true,
      records: freezeSubmissionCleanupRecords(expectedRows.map((expectedFingerprint) => ({
        ticketId: expectedFingerprint.ticketId,
        expectedFingerprint,
        mutationOutcome,
        status: 'unresolved',
      }))),
    })
  }

  const actual = new Map(rows.map((row) => [row.ticketId, row]))
  return Object.freeze({
    failed: false,
    records: freezeSubmissionCleanupRecords(expectedRows.map((expectedFingerprint) => {
      const current = actual.get(expectedFingerprint.ticketId)
      const status: SubmissionCleanupOwnershipStatus = !current
        ? 'absent'
        : draftSubmissionFingerprintsEqual(current, expectedFingerprint)
          ? 'confirmed-owned'
          : 'mismatched-non-owned'
      return {
        ticketId: expectedFingerprint.ticketId,
        expectedFingerprint,
        mutationOutcome,
        status,
      }
    })),
  })
}

export async function cleanupSubmissionFingerprintChunk(
  d1: SubmissionCleanupD1,
  expectedRows: readonly DraftSubmissionFingerprint[],
): Promise<SubmissionCleanupAttemptResult> {
  let reportedChanges: number | null = null
  let mutationFailureMessage: string | null = null
  let mutationThrew = false
  try {
    reportedChanges = await d1.mutate.deleteDraftSubmissionFingerprints(expectedRows)
  } catch (error) {
    mutationThrew = true
    mutationFailureMessage = error instanceof Error ? error.message : 'unknown mutation failure'
  }

  const mutationOutcome: SubmissionCleanupMutationOutcome = mutationThrew
    ? 'thrown-ambiguous-failure'
    : reportedChanges === expectedRows.length
      ? 'confirmed-expected-change-count'
      : reportedChanges === 0
        ? 'zero-change'
        : 'unexpected-change-count'

  if (mutationOutcome === 'confirmed-expected-change-count') {
    return Object.freeze({
      mutationOutcome,
      reportedChanges,
      mutationFailureMessage,
      reconciliationPerformed: false,
      reconciliationFailed: false,
      ownershipRecords: freezeSubmissionCleanupRecords(expectedRows.map((expectedFingerprint) => ({
        ticketId: expectedFingerprint.ticketId,
        expectedFingerprint,
        mutationOutcome,
        status: 'deleted',
      }))),
    })
  }

  const reconciliation = await reconcileSubmissionCleanup(d1.read, expectedRows, mutationOutcome)
  return Object.freeze({
    mutationOutcome,
    reportedChanges,
    mutationFailureMessage,
    reconciliationPerformed: true,
    reconciliationFailed: reconciliation.failed,
    ownershipRecords: reconciliation.records,
  })
}

function submissionCleanupFailure(attempt: SubmissionCleanupAttemptResult) {
  const absent = attempt.ownershipRecords.filter((record) => record.status === 'absent').length
  const mismatched = attempt.ownershipRecords
    .filter((record) => record.status === 'mismatched-non-owned').length
  const stillOwned = attempt.ownershipRecords
    .filter((record) => record.status === 'confirmed-owned').length
  if (attempt.reconciliationFailed) {
    return new SubmissionCleanupFailure(
      `Fingerprint-constrained submission deletion and its single read-only reconciliation were unresolved; the delete was not retried: ${attempt.mutationFailureMessage ?? 'unexpected mutation change count'}`,
      attempt.ownershipRecords,
    )
  }
  if (attempt.mutationOutcome === 'thrown-ambiguous-failure') {
    return new SubmissionCleanupFailure(
      `Fingerprint-constrained submission deletion had an ambiguous outcome and was not retried; reconciliation found ${absent} absent, ${mismatched} mismatching/non-owned, and ${stillOwned} still-owned row(s): ${attempt.mutationFailureMessage ?? 'unknown mutation failure'}`,
      attempt.ownershipRecords,
    )
  }
  const countDescription = attempt.mutationOutcome === 'zero-change'
    ? 'reported zero changes'
    : `reported an unexpected count of ${attempt.reportedChanges ?? 'unknown'}`
  return new SubmissionCleanupFailure(
    mismatched > 0
      ? `Fingerprint-constrained submission cleanup ${countDescription} and found an ownership mismatch; the mismatching row was left untouched.`
      : absent > 0
        ? `Fingerprint-constrained submission cleanup ${countDescription}; its single subsequent read classified affected rows as already absent.`
        : `Fingerprint-constrained submission cleanup ${countDescription} while exact owned rows remained.`,
    attempt.ownershipRecords,
  )
}

async function cleanupOwnedSubmissionRows(
  d1: SubmissionSmokeD1,
  ownedRows: readonly DraftSubmissionFingerprint[],
) {
  if (ownedRows.length === 0) return
  const rows = await d1.read.readSubmissionRows(ownedRows.map((row) => row.ticketId))
  const actual = new Map(rows.map((row) => [row.ticketId, row]))
  const deletable: DraftSubmissionFingerprint[] = []
  const mismatches: string[] = []
  for (const expected of ownedRows) {
    const current = actual.get(expected.ticketId)
    if (!current) continue
    if (!draftSubmissionFingerprintsEqual(current, expected)) mismatches.push(expected.ticketId)
    else deletable.push(expected)
  }

  let deletionFailure: Error | null = null
  for (const chunk of exactFingerprintChunks(deletable)) {
    const attempt = await cleanupSubmissionFingerprintChunk(d1, chunk)
    if (attempt.mutationOutcome !== 'confirmed-expected-change-count') {
      deletionFailure = submissionCleanupFailure(attempt)
    }
    if (deletionFailure) break
  }
  if (mismatches.length > 0) {
    fail(`Submission cleanup refused ${mismatches.length} row(s) whose current immutable fingerprint no longer matched this run.`)
  }
  if (deletionFailure) throw deletionFailure
}

export async function runSubmissionSmoke(
  execution: SubmissionSmokeExecution,
  dependencies: SubmissionSmokeDependencies = {},
) {
  const fetcher = dependencies.fetcher ?? fetch
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? D1C4_DEFAULT_REQUEST_TIMEOUT_MS
  const d1 = (dependencies.createD1 ?? defaultD1)(execution.target, execution.apiToken, fetcher)
  const reservedTicketIds: string[] = []
  const ownedRows = new Map<string, DraftSubmissionFingerprint>()
  try {
    await assertHealth(fetcher, requestTimeoutMs, execution.target.previewBaseUrl)

    const primaryTicket = await issueTicket(fetcher, requestTimeoutMs, execution.target.previewBaseUrl)
    await reserveIssuedTicket(d1.read, primaryTicket.ticketId)
    reservedTicketIds.push(primaryTicket.ticketId)
    const primaryTranscript = buildPreviewSubmissionTranscript(primaryTicket)

    const primary = await submitExpectedSuccess(
      d1,
      fetcher,
      requestTimeoutMs,
      execution.target.previewBaseUrl,
      primaryTicket,
      primaryTranscript,
      ownedRows,
      'Primary endpoint submission',
    )

    const idempotentRetry = await submit(
      fetcher,
      requestTimeoutMs,
      execution.target.previewBaseUrl,
      primaryTicket,
      primaryTranscript,
    )
    assertIdempotentSubmissionRetry(primary.result, idempotentRetry)
    const retriedRow = exactRow(await d1.read.readSubmissionRows([primaryTicket.ticketId]), 'Identical retry')
    if (!draftSubmissionFingerprintsEqual(retriedRow, primary.fingerprint)) {
      fail('Identical retry changed the owned immutable submission fingerprint.')
    }
    assertStoredSuccessReceipt(retriedRow, primary.result.bytes, 'Stored receipt after identical retry')

    const substitution = await submit(
      fetcher,
      requestTimeoutMs,
      execution.target.previewBaseUrl,
      primaryTicket,
      deterministicReplayFailure(primaryTranscript),
    )
    assertReplaySubstitutionRejected(substitution)
    const substitutedRow = exactRow(await d1.read.readSubmissionRows([primaryTicket.ticketId]), 'Rejected substitution')
    if (!draftSubmissionFingerprintsEqual(substitutedRow, primary.fingerprint)) {
      fail('Rejected substitution changed the owned immutable submission fingerprint.')
    }
    assertStoredSuccessReceipt(substitutedRow, primary.result.bytes, 'Stored receipt after rejected substitution')

    const recoveryTicket = await issueTicket(fetcher, requestTimeoutMs, execution.target.previewBaseUrl)
    await reserveIssuedTicket(d1.read, recoveryTicket.ticketId)
    reservedTicketIds.push(recoveryTicket.ticketId)
    const recoveryTranscript = buildPreviewSubmissionTranscript(recoveryTicket)
    const failedReplay = await submit(
      fetcher,
      requestTimeoutMs,
      execution.target.previewBaseUrl,
      recoveryTicket,
      deterministicReplayFailure(recoveryTranscript),
    )
    assertDeterministicReplayFailed(failedReplay)
    if ((await d1.read.readSubmissionRows([recoveryTicket.ticketId])).length !== 0) {
      fail('Failed deterministic replay was not row-free; no cleanup ownership was assumed for that ticket ID.')
    }

    const recovered = await submitExpectedSuccess(
      d1,
      fetcher,
      requestTimeoutMs,
      execution.target.previewBaseUrl,
      recoveryTicket,
      recoveryTranscript,
      ownedRows,
      'Recovered endpoint submission',
    )
    assertStoredSuccessReceipt(
      exactRow(await d1.read.readSubmissionRows([recoveryTicket.ticketId]), 'Recovered submission'),
      recovered.result.bytes,
    )

    assertExactSubmissionRows(await d1.read.readSubmissionRows(reservedTicketIds), [
      primary.fingerprint,
      recovered.fingerprint,
    ])
  } finally {
    await cleanupOwnedSubmissionRows(d1, [...ownedRows.values()])
  }
  return Object.freeze({
    persistedRows: 2,
    exactRetry: true,
    failedReplayPreservedTicket: true,
    storedReceiptsVerified: true,
  })
}

function usage() {
  return [
    'D1C.4 guarded preview submission smoke',
    '',
    'Required target arguments:',
    '  --preview-base-url https://<branch>.<pages-project>.pages.dev',
    '  --preview-worker <preview-worker-name>',
    '  --preview-environment preview',
    '  --account-id <cloudflare-account-id>',
    '  --database-id <preview-d1-database-id>',
    `  --ack ${D1C4_PREVIEW_ACKNOWLEDGEMENT}`,
    '',
    'Without --execute this is a dry run. --execute also requires CLOUDFLARE_API_TOKEN.',
    'Every request has a finite timeout and body bound, rejects redirects, and never forwards tickets or request bodies to another origin.',
    'Touches /api/v1/health, /api/v1/draft-ticket, /api/v1/submit-draft, and exact D1 rows; absence is only preflight, while cleanup requires a complete immutable fingerprint.',
  ].join('\n')
}

export async function submissionSmokeCli(
  argv: readonly string[],
  dependencies: SubmissionSmokeDependencies = {},
  environment: NodeJS.ProcessEnv = process.env,
  output: Pick<Console, 'log' | 'error'> = console,
) {
  try {
    if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
      output.log(usage())
      return 0
    }
    if (argv.includes('--help')) fail('--help cannot be combined with other arguments.')
    const arguments_ = parseStrictArguments(argv, COMMON_VALUE_OPTIONS)
    const target = validatePreviewSmokeTarget(commonTargetFromArguments(arguments_))
    if (arguments_.execute !== true) {
      output.log([
        'Dry run only; no endpoint or D1 request was made and no API token was required.',
        `Preview origin: ${target.previewBaseUrl}`,
        'Planned endpoints: /api/v1/health, /api/v1/draft-ticket, /api/v1/submit-draft',
        'Planned D1 scope: exact ticket IDs with cleanup restricted to complete fingerprints proven owned after submission',
      ].join('\n'))
      return 0
    }
    const result = await runSubmissionSmoke({
      target,
      apiToken: requirePreviewApiToken(environment),
    }, dependencies)
    output.log(`Submission smoke passed: ${result.persistedRows} exact D1 rows and stored receipts verified and removed; retry, substitution, and failed-replay preservation passed.`)
    return 0
  } catch (error) {
    output.error(error instanceof Error ? error.message : 'Guarded preview submission smoke failed closed.')
    return 1
  }
}

if (path.basename(process.argv[1] ?? '') === COMPILED_SCRIPT_BASENAME) {
  process.exitCode = await submissionSmokeCli(process.argv.slice(2))
}
