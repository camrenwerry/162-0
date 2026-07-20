import {
  boundedJsonRequest,
  BoundedFetchError,
  D1C4_DEFAULT_REQUEST_TIMEOUT_MS,
  D1C4_D1_RESPONSE_LIMIT_BYTES,
  type D1C4Fetch,
} from './d1c4-bounded-fetch'
import {
  assertValidatedPreviewSmokeTarget,
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  type ValidatedPreviewSmokeTarget,
} from './d1c4-preview-guard'

const EXACT_ID_CHUNK_SIZE = 80
export const D1_BOUND_PARAMETER_LIMIT = 100
export const DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT = 7
export const EXACT_FINGERPRINT_DELETE_LIMIT = Math.floor(
  D1_BOUND_PARAMETER_LIMIT / DRAFT_SUBMISSION_FINGERPRINT_PARAMETER_COUNT,
)
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i
const DATABASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const RETENTION_SCOPE_PATTERN = /^d1c4[0-9a-f]{24}$/
const TICKET_ID_PATTERN = /^[0-9a-z-]{36}$/i

type D1Parameter = string | number
type D1StatementForm = 'read' | 'insert' | 'delete'

export type D1MutationFailureKind =
  | 'confirmed-rejection'
  | 'response-lost'
  | 'timeout'
  | 'malformed-response'
  | 'unresolved'

export class D1MutationError extends Error {
  readonly kind: D1MutationFailureKind

  constructor(kind: D1MutationFailureKind, message: string) {
    super(message)
    this.name = 'D1MutationError'
    this.kind = kind
  }
}

export interface D1RequestOptions {
  readonly timeoutMs?: number
  readonly deadlineMs?: number
  readonly now?: () => number
}

export interface DraftSubmissionFingerprint {
  readonly ticketId: string
  readonly ticketTokenDigest: string
  readonly transcriptDigest: string
  readonly submittedAtMs: number
  readonly retainUntilMs: number
  readonly submissionSchemaVersion: string
  readonly successResponseJson: string
}

export type SubmissionPersistenceRow = DraftSubmissionFingerprint

export type RetentionPersistenceRow = DraftSubmissionFingerprint

export interface PreviewD1ReadClient {
  countSubmissionTickets(ticketIds: readonly string[], options?: D1RequestOptions): Promise<number>
  readSubmissionRows(ticketIds: readonly string[], options?: D1RequestOptions): Promise<readonly SubmissionPersistenceRow[]>
  readRetentionExactRows(ticketIds: readonly string[], options?: D1RequestOptions): Promise<readonly RetentionPersistenceRow[]>
  readRetentionScopeRows(scope: string, options?: D1RequestOptions): Promise<readonly RetentionPersistenceRow[]>
  readRetentionOrderingCompetitors(
    scope: string,
    sentinelRetainUntilMs: number,
    lastSentinelId: string,
    options?: D1RequestOptions,
  ): Promise<readonly RetentionPersistenceRow[]>
}

export interface PreviewD1MutationClient {
  insertExpiredRetentionRows(
    scope: string,
    offset: number,
    count: number,
    digest: string,
    submissionSchemaVersion: string,
    options?: D1RequestOptions,
  ): Promise<number>
  insertProtectedRetentionRow(
    ticketId: string,
    digest: string,
    submittedAtMs: number,
    retainUntilMs: number,
    submissionSchemaVersion: string,
    options?: D1RequestOptions,
  ): Promise<number>
  deleteDraftSubmissionFingerprints(
    fingerprints: readonly DraftSubmissionFingerprint[],
    options?: D1RequestOptions,
  ): Promise<number>
}

declare const mutationAuthorizationBrand: unique symbol

export interface PreviewD1MutationAuthorization {
  readonly [mutationAuthorizationBrand]: true
}

interface D1Core {
  readonly target: ValidatedPreviewSmokeTarget
  readonly apiToken: string
  readonly fetcher: D1C4Fetch
}

interface D1ResultSet {
  readonly results?: readonly Record<string, unknown>[]
  readonly changes?: number
}

const readClientCores = new WeakMap<object, D1Core>()
const mutationAuthorizations = new WeakMap<object, ValidatedPreviewSmokeTarget>()

function fail(message: string): never {
  throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function placeholders(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > EXACT_ID_CHUNK_SIZE) {
    fail(`Exact D1 operation must contain 1 through ${EXACT_ID_CHUNK_SIZE} IDs.`)
  }
  return Array.from({ length: count }, () => '?').join(', ')
}

function chunks<T>(values: readonly T[]) {
  const result: T[][] = []
  for (let offset = 0; offset < values.length; offset += EXACT_ID_CHUNK_SIZE) {
    result.push(values.slice(offset, offset + EXACT_ID_CHUNK_SIZE))
  }
  return result
}

function validateTicketIds(ticketIds: readonly string[]) {
  if (ticketIds.length === 0 || new Set(ticketIds).size !== ticketIds.length) {
    fail('Exact D1 ticket IDs must be a non-empty unique list.')
  }
  if (!ticketIds.every((ticketId) => TICKET_ID_PATTERN.test(ticketId))) {
    fail('Exact D1 ticket IDs must use the expected 36-character format.')
  }
}

function validateScope(scope: string) {
  if (!RETENTION_SCOPE_PATTERN.test(scope)) fail('Retention scope is malformed.')
}

function validateSafeTimestamp(value: number, description: string) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${description} must be a non-negative safe integer.`)
}

function validateFingerprint(fingerprint: DraftSubmissionFingerprint) {
  validateTicketIds([fingerprint.ticketId])
  if (
    !DIGEST_PATTERN.test(fingerprint.ticketTokenDigest)
    || !DIGEST_PATTERN.test(fingerprint.transcriptDigest)
  ) fail('Draft submission fingerprint digests are malformed.')
  validateSafeTimestamp(fingerprint.submittedAtMs, 'Draft submission timestamp')
  validateSafeTimestamp(fingerprint.retainUntilMs, 'Draft submission retention deadline')
  if (fingerprint.retainUntilMs <= fingerprint.submittedAtMs) {
    fail('Draft submission fingerprint retention deadline must follow submission.')
  }
  if (typeof fingerprint.submissionSchemaVersion !== 'string' || fingerprint.submissionSchemaVersion.length === 0) {
    fail('Draft submission fingerprint schema version is missing.')
  }
  if (
    typeof fingerprint.successResponseJson !== 'string'
    || fingerprint.successResponseJson.length < 2
    || fingerprint.successResponseJson.length > 8_192
  ) fail('Draft submission fingerprint receipt is malformed.')
}

function fingerprintParameters(fingerprint: DraftSubmissionFingerprint): readonly D1Parameter[] {
  return [
    fingerprint.ticketId,
    fingerprint.ticketTokenDigest,
    fingerprint.transcriptDigest,
    fingerprint.submissionSchemaVersion,
    fingerprint.submittedAtMs,
    fingerprint.retainUntilMs,
    fingerprint.successResponseJson,
  ]
}

export function draftSubmissionFingerprintsEqual(
  left: DraftSubmissionFingerprint,
  right: DraftSubmissionFingerprint,
) {
  return left.ticketId === right.ticketId
    && left.ticketTokenDigest === right.ticketTokenDigest
    && left.transcriptDigest === right.transcriptDigest
    && left.submittedAtMs === right.submittedAtMs
    && left.retainUntilMs === right.retainUntilMs
    && left.submissionSchemaVersion === right.submissionSchemaVersion
    && left.successResponseJson === right.successResponseJson
}

export function exactFingerprintChunks<T>(values: readonly T[]) {
  const result: T[][] = []
  for (let offset = 0; offset < values.length; offset += EXACT_FINGERPRINT_DELETE_LIMIT) {
    result.push(values.slice(offset, offset + EXACT_FINGERPRINT_DELETE_LIMIT))
  }
  return Object.freeze(result.map((chunk) => Object.freeze(chunk)))
}

export function assertSingleD1Statement(sql: string, form: D1StatementForm) {
  const normalized = sql.trim()
  if (!normalized || normalized.includes(';') || /--|\/\*/.test(normalized)) {
    fail('D1 statements must contain one comment-free statement without semicolons.')
  }
  const startsWithExpectedForm = form === 'read'
    ? /^SELECT\b/i.test(normalized)
    : form === 'delete'
      ? /^DELETE\b/i.test(normalized)
      : /^(?:INSERT\b|WITH\s+RECURSIVE\b[\s\S]*\bINSERT\s+INTO\s+draft_submissions\b)/i.test(normalized)
  if (!startsWithExpectedForm) fail(`D1 statement does not match the required ${form} operation form.`)
}

function validateParameters(params: readonly D1Parameter[]) {
  if (params.length > D1_BOUND_PARAMETER_LIMIT) {
    fail(`D1 statements cannot bind more than ${D1_BOUND_PARAMETER_LIMIT} parameters.`)
  }
  for (const parameter of params) {
    if (typeof parameter === 'number' && !Number.isSafeInteger(parameter)) {
      fail('D1 numeric parameters must be safe integers.')
    }
    if (typeof parameter !== 'string' && typeof parameter !== 'number') {
      fail('D1 parameters must be strings or safe integers.')
    }
  }
}

async function executeStatement(
  core: D1Core,
  operation: string,
  sql: string,
  form: D1StatementForm,
  params: readonly D1Parameter[],
  requirement: 'rows' | 'changes',
  options: D1RequestOptions = {},
): Promise<D1ResultSet> {
  assertSingleD1Statement(sql, form)
  validateParameters(params)
  const configuredTimeoutMs = options.timeoutMs ?? D1C4_DEFAULT_REQUEST_TIMEOUT_MS
  const remainingMs = options.deadlineMs === undefined
    ? configuredTimeoutMs
    : options.deadlineMs - (options.now ?? Date.now)()
  if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) {
    fail(`Preview D1 ${operation} cannot start after the overall smoke deadline.`)
  }
  const malformedResponse = (message: string): never => {
    if (form === 'read') fail(message)
    throw new D1MutationError('malformed-response', message)
  }
  let response
  try {
    response = await boundedJsonRequest(
      `https://api.cloudflare.com/client/v4/accounts/${core.target.accountId}/d1/database/${core.target.databaseId}/query`,
      {
        description: `Preview D1 ${operation}`,
        timeoutMs: Math.min(configuredTimeoutMs, remainingMs),
        maxResponseBytes: D1C4_D1_RESPONSE_LIMIT_BYTES,
        fetcher: core.fetcher,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${core.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params }),
        },
      },
    )
  } catch (error) {
    if (form === 'read') throw error
    const kind: D1MutationFailureKind = error instanceof BoundedFetchError
      ? error.kind === 'timeout'
        ? 'timeout'
        : error.kind === 'network'
          ? 'response-lost'
          : ['parse', 'encoding', 'body-limit', 'body-missing'].includes(error.kind)
            ? 'malformed-response'
            : 'unresolved'
      : 'unresolved'
    throw new D1MutationError(
      kind,
      `Preview D1 ${operation} had a ${kind} mutation outcome.`,
    )
  }

  if (!response.ok) {
    if (form === 'read') {
      throw new BoundedFetchError('http', `Preview D1 ${operation} failed with HTTP ${response.status}.`)
    }
    const kind: D1MutationFailureKind = response.status >= 400 && response.status < 500
      ? 'confirmed-rejection'
      : 'response-lost'
    throw new D1MutationError(kind, `Preview D1 ${operation} failed with HTTP ${response.status}.`)
  }

  const payload = isRecord(response.body)
    ? response.body
    : malformedResponse(`Preview D1 ${operation} returned a malformed API envelope.`)
  const resultSets = payload.success === true && Array.isArray(payload.result)
    ? payload.result
    : malformedResponse(`Preview D1 ${operation} returned a malformed API envelope.`)
  if (resultSets.length !== 1) {
    malformedResponse(`Preview D1 ${operation} must return exactly one result set.`)
  }
  const result = resultSets[0]
  if (!isRecord(result) || result.success !== true) {
    if (form !== 'read' && isRecord(result) && result.success === false) {
      throw new D1MutationError(
        'confirmed-rejection',
        `Preview D1 ${operation} returned an unsuccessful result set.`,
      )
    }
    malformedResponse(`Preview D1 ${operation} returned an unsuccessful result set.`)
  }

  if (requirement === 'rows') {
    if (!Array.isArray(result.results)) fail(`Preview D1 ${operation} requires result rows.`)
    if (!result.results.every(isRecord)) fail(`Preview D1 ${operation} returned a malformed row.`)
    return Object.freeze({ results: Object.freeze(result.results) })
  }

  const meta = result.meta
  if (!isRecord(meta) || !Number.isSafeInteger(meta.changes) || (meta.changes as number) < 0) {
    malformedResponse(`Preview D1 ${operation} requires a non-negative mutation count.`)
  }
  return Object.freeze({ changes: meta.changes as number })
}

function parseCount(rows: readonly Record<string, unknown>[], operation: string) {
  if (rows.length !== 1) fail(`Preview D1 ${operation} requires exactly one count row.`)
  const count = rows[0].row_count
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    fail(`Preview D1 ${operation} returned a malformed count.`)
  }
  return count as number
}

function parseFingerprintRows(rows: readonly Record<string, unknown>[], operation: string) {
  return Object.freeze(rows.map((row) => {
    if (
      typeof row.ticket_id !== 'string'
      || typeof row.ticket_token_digest !== 'string'
      || typeof row.transcript_digest !== 'string'
      || !Number.isSafeInteger(row.submitted_at_ms)
      || (row.submitted_at_ms as number) < 0
      || !Number.isSafeInteger(row.retain_until_ms)
      || (row.retain_until_ms as number) < 0
      || typeof row.submission_schema_version !== 'string'
      || typeof row.success_response_json !== 'string'
    ) fail(`Preview D1 ${operation} returned a malformed row.`)
    return Object.freeze({
      ticketId: row.ticket_id,
      ticketTokenDigest: row.ticket_token_digest,
      transcriptDigest: row.transcript_digest,
      submittedAtMs: row.submitted_at_ms as number,
      retainUntilMs: row.retain_until_ms as number,
      submissionSchemaVersion: row.submission_schema_version,
      successResponseJson: row.success_response_json,
    })
  }))
}

export function createPreviewD1Client(
  target: ValidatedPreviewSmokeTarget,
  apiToken: string,
  fetcher: D1C4Fetch = fetch,
): PreviewD1ReadClient {
  assertValidatedPreviewSmokeTarget(target)
  if (!ACCOUNT_ID_PATTERN.test(target.accountId)) fail('Preview D1 account ID is malformed.')
  if (!DATABASE_ID_PATTERN.test(target.databaseId)) fail('Preview D1 database ID is malformed.')
  if (typeof apiToken !== 'string' || apiToken.length === 0) fail('Preview D1 API token is missing.')

  const core: D1Core = Object.freeze({ target, apiToken, fetcher })
  const client: PreviewD1ReadClient = {
    async countSubmissionTickets(ticketIds, options) {
      validateTicketIds(ticketIds)
      let count = 0
      for (const chunk of chunks(ticketIds)) {
        const result = await executeStatement(
          core,
          'submission count',
          `SELECT COUNT(*) AS row_count FROM draft_submissions WHERE ticket_id IN (${placeholders(chunk.length)})`,
          'read',
          chunk,
          'rows',
          options,
        )
        count += parseCount(result.results ?? [], 'submission count')
      }
      return count
    },
    async readSubmissionRows(ticketIds, options) {
      validateTicketIds(ticketIds)
      const rows: SubmissionPersistenceRow[] = []
      for (const chunk of chunks(ticketIds)) {
        const result = await executeStatement(
          core,
          'submission persistence read',
          `SELECT ticket_id, ticket_token_digest, transcript_digest, submitted_at_ms,
                  retain_until_ms, submission_schema_version, success_response_json
           FROM draft_submissions
           WHERE ticket_id IN (${placeholders(chunk.length)})
           ORDER BY ticket_id`,
          'read',
          chunk,
          'rows',
          options,
        )
        rows.push(...parseFingerprintRows(result.results ?? [], 'submission persistence query'))
      }
      return Object.freeze(rows)
    },
    async readRetentionExactRows(ticketIds, options) {
      validateTicketIds(ticketIds)
      const rows: RetentionPersistenceRow[] = []
      for (const chunk of chunks(ticketIds)) {
        const result = await executeStatement(
          core,
          'exact retention read',
          `SELECT ticket_id, ticket_token_digest, transcript_digest, submitted_at_ms,
                  retain_until_ms, submission_schema_version, success_response_json
           FROM draft_submissions
           WHERE ticket_id IN (${placeholders(chunk.length)})
           ORDER BY ticket_id`,
          'read',
          chunk,
          'rows',
          options,
        )
        rows.push(...parseFingerprintRows(result.results ?? [], 'exact retention query'))
      }
      return Object.freeze(rows)
    },
    async readRetentionScopeRows(scope, options) {
      validateScope(scope)
      const result = await executeStatement(
        core,
        'retention scope read',
        `SELECT ticket_id, ticket_token_digest, transcript_digest, submitted_at_ms,
                retain_until_ms, submission_schema_version, success_response_json
         FROM draft_submissions
         WHERE substr(ticket_id, 1, 28) = ?
         ORDER BY ticket_id`,
        'read',
        [scope],
        'rows',
        options,
      )
      return parseFingerprintRows(result.results ?? [], 'retention scope query')
    },
    async readRetentionOrderingCompetitors(scope, sentinelRetainUntilMs, lastSentinelId, options) {
      validateScope(scope)
      validateSafeTimestamp(sentinelRetainUntilMs, 'Sentinel retention deadline')
      if (!TICKET_ID_PATTERN.test(lastSentinelId)) fail('Last retention sentinel ID is malformed.')
      const result = await executeStatement(
        core,
        'retention ordering preflight',
        `SELECT ticket_id, ticket_token_digest, transcript_digest, submitted_at_ms,
                retain_until_ms, submission_schema_version, success_response_json
         FROM draft_submissions
         WHERE substr(ticket_id, 1, 28) <> ?
           AND (retain_until_ms < ? OR (retain_until_ms = ? AND ticket_id <= ?))
         ORDER BY retain_until_ms, ticket_id
         LIMIT 2`,
        'read',
        [scope, sentinelRetainUntilMs, sentinelRetainUntilMs, lastSentinelId],
        'rows',
        options,
      )
      return parseFingerprintRows(result.results ?? [], 'retention ordering query')
    },
  }
  Object.freeze(client)
  readClientCores.set(client, core)
  return client
}

export function authorizePreviewD1Mutations(
  target: ValidatedPreviewSmokeTarget,
  acknowledgement: string,
): PreviewD1MutationAuthorization {
  assertValidatedPreviewSmokeTarget(target)
  if (acknowledgement !== D1C4_PREVIEW_ACKNOWLEDGEMENT) {
    fail('Preview D1 mutations require the exact D1C.4 acknowledgement.')
  }
  const authorization = Object.freeze({}) as PreviewD1MutationAuthorization
  mutationAuthorizations.set(authorization, target)
  return authorization
}

export function createPreviewD1MutationClient(
  readClient: PreviewD1ReadClient,
  authorization: PreviewD1MutationAuthorization,
): PreviewD1MutationClient {
  const core = readClientCores.get(readClient)
  const authorizedTarget = mutationAuthorizations.get(authorization)
  if (!core || !authorizedTarget || core.target !== authorizedTarget) {
    fail('Preview D1 mutation client requires matching guarded read access and explicit authorization.')
  }

  const client: PreviewD1MutationClient = {
    async insertExpiredRetentionRows(scope, offset, count, digest, submissionSchemaVersion, options) {
      validateScope(scope)
      if (!Number.isSafeInteger(offset) || offset < 0) fail('Expired retention insertion offset is invalid.')
      if (!Number.isSafeInteger(count) || count < 1 || count > 400) fail('Expired retention insertion count is invalid.')
      if (!DIGEST_PATTERN.test(digest)) fail('Retention sentinel digest is malformed.')
      if (!submissionSchemaVersion) fail('Submission schema version is required.')
      const result = await executeStatement(
        core,
        'expired retention insertion',
        `WITH RECURSIVE seq(n) AS (
           SELECT 0
           UNION ALL
           SELECT n + 1 FROM seq WHERE n + 1 < CAST(? AS INTEGER)
         )
         INSERT INTO draft_submissions (
           ticket_id, ticket_token_digest, transcript_digest, submitted_at_ms,
           retain_until_ms, submission_schema_version, success_response_json
         )
         SELECT
           ? || 'e' || printf('%07d', CAST(? AS INTEGER) + n),
           ?, ?, 0, 1, ?, '{}'
         FROM seq`,
        'insert',
        [count, scope, offset, digest, digest, submissionSchemaVersion],
        'changes',
        options,
      )
      return result.changes ?? fail('Expired retention insertion did not report changes.')
    },
    async insertProtectedRetentionRow(ticketId, digest, submittedAtMs, retainUntilMs, submissionSchemaVersion, options) {
      validateTicketIds([ticketId])
      if (!DIGEST_PATTERN.test(digest)) fail('Retention sentinel digest is malformed.')
      validateSafeTimestamp(submittedAtMs, 'Protected sentinel submission timestamp')
      validateSafeTimestamp(retainUntilMs, 'Protected sentinel retention deadline')
      if (retainUntilMs <= submittedAtMs) fail('Protected sentinel retention deadline must follow submission.')
      if (!submissionSchemaVersion) fail('Submission schema version is required.')
      const result = await executeStatement(
        core,
        'protected retention insertion',
        `INSERT INTO draft_submissions (
           ticket_id, ticket_token_digest, transcript_digest, submitted_at_ms,
           retain_until_ms, submission_schema_version, success_response_json
         ) VALUES (?, ?, ?, CAST(? AS INTEGER), CAST(? AS INTEGER), ?, '{}')`,
        'insert',
        [ticketId, digest, digest, submittedAtMs, retainUntilMs, submissionSchemaVersion],
        'changes',
        options,
      )
      return result.changes ?? fail('Protected retention insertion did not report changes.')
    },
    async deleteDraftSubmissionFingerprints(fingerprints, options) {
      if (fingerprints.length === 0 || fingerprints.length > EXACT_FINGERPRINT_DELETE_LIMIT) {
        fail(`Fingerprint-constrained deletion requires 1 through ${EXACT_FINGERPRINT_DELETE_LIMIT} rows.`)
      }
      if (new Set(fingerprints.map((fingerprint) => fingerprint.ticketId)).size !== fingerprints.length) {
        fail('Fingerprint-constrained deletion requires unique ticket IDs.')
      }
      for (const fingerprint of fingerprints) validateFingerprint(fingerprint)
      const predicate = fingerprints.map(() => `(
            ticket_id = ?
            AND ticket_token_digest = ?
            AND transcript_digest = ?
            AND submission_schema_version = ?
            AND submitted_at_ms = ?
            AND retain_until_ms = ?
            AND success_response_json = ?
          )`).join(' OR ')
      const result = await executeStatement(
        core,
        'fingerprint-constrained deletion',
        `DELETE FROM draft_submissions WHERE ${predicate}`,
        'delete',
        fingerprints.flatMap(fingerprintParameters),
        'changes',
        options,
      )
      return result.changes ?? fail('Fingerprint-constrained deletion did not report changes.')
    },
  }
  return Object.freeze(client)
}
