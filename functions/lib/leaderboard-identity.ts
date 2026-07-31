import {
  DraftValidationPublicError,
  handleApiNotFoundRequest,
  SAFE_JSON_RESPONSE_HEADERS,
} from './api-response'
import { readBoundedJson } from './bounded-json'
import {
  isLeaderboardIdentityCapability,
  isLeaderboardIdentityCapabilityEnabled,
  isLeaderboardIdentityRecoveryEnabled,
  isLeaderboardIdentityRenameEnabled,
  isLeaderboardIdentitySigningKey,
  type LeaderboardIdentityModeEnv,
} from './leaderboard-identity-mode'
import { validateDisplayName } from '../../shared/leaderboard-display-name'
export {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_MIN_CHARACTERS,
  validateDisplayName,
} from '../../shared/leaderboard-display-name'
export type { ValidatedDisplayName } from '../../shared/leaderboard-display-name'

export const LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION = 'pennant-leaderboard-identity-v1'
export const LEADERBOARD_IDENTITY_SCHEMA_VERSION = 4
export const LEADERBOARD_CLAIM_TTL_MS = 15 * 60 * 1000
export const LEADERBOARD_RECOVERY_RETRY_TTL_MS = 15 * 60 * 1000
export const LEADERBOARD_RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

const ALLOWED_METHODS = 'POST'
const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/
const DEVICE_CREDENTIAL_PATTERN = /^ppd1_[A-Za-z0-9_-]{43}$/
const CLAIM_CAPABILITY_PATTERN = /^ppc1_[A-Za-z0-9_-]{43}$/
const RECOVERY_OPERATION_PREFIX = 'ppr1_'
const RECOVERY_OPERATION_PAYLOAD_LENGTH = 43
const RECOVERY_OPERATION_PAYLOAD_BYTES = 32
const BASE64URL_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/
const RECOVERY_PREFIX = 'PP1'
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_SYMBOLS = 26
const RECOVERY_CHECK_SYMBOLS = 2
const RECOVERY_GROUP_SIZE = 4
const RECOVERY_DERIVATION_VERSION = 1

const SELECT_SCHEMA_SQL = 'SELECT version FROM backend_schema WHERE id = 1'
const SELECT_NAME_SQL = `
  SELECT player_id
  FROM leaderboard_players
  WHERE public_name_key = ?
  LIMIT 1
`
const SELECT_CREDENTIAL_SQL = `
  SELECT
    player_id,
    identity_key_digest,
    public_label,
    public_name_key,
    recovery_version,
    last_renamed_at_ms,
    created_at_ms
  FROM leaderboard_players
  WHERE device_credential_digest = ?
    AND status = 'active'
    AND identity_state = 'active'
  LIMIT 1
`
const SELECT_RECOVERY_SQL = `
  SELECT
    player_id,
    public_label,
    public_name_key,
    recovery_version,
    created_at_ms
  FROM leaderboard_players
  WHERE recovery_code_digest = ?
    AND status = 'active'
    AND identity_state = 'active'
  LIMIT 1
`
const SELECT_RECOVERY_OPERATION_SQL = `
  SELECT
    o.operation_digest,
    o.request_binding_digest,
    o.player_id,
    o.source_recovery_version,
    o.replacement_recovery_version,
    o.replacement_device_digest,
    o.replacement_recovery_digest,
    o.derivation_version,
    o.created_at_ms,
    o.expires_at_ms,
    p.public_label,
    p.public_name_key,
    p.recovery_version,
    p.device_credential_digest,
    p.recovery_code_digest,
    p.status,
    p.identity_state
  FROM leaderboard_recovery_operations AS o
  JOIN leaderboard_players AS p ON p.player_id = o.player_id
  WHERE o.operation_digest = ?
    AND o.request_binding_digest = ?
  LIMIT 1
`
const SELECT_CLAIM_SQL = `
  SELECT
    c.claim_id,
    c.run_id,
    c.created_at_ms,
    c.expires_at_ms,
    c.used_at_ms,
    c.claimed_player_id,
    c.claimed_name_key,
    r.eligibility_status,
    r.eligibility_reason,
    r.environment,
    r.game_mode,
    r.is_smoke,
    p.public_label,
    p.public_name_key,
    p.device_credential_digest,
    p.recovery_code_digest
  FROM leaderboard_identity_claims AS c
  JOIN leaderboard_runs AS r ON r.run_id = c.run_id
  LEFT JOIN leaderboard_players AS p ON p.player_id = c.claimed_player_id
  WHERE c.claim_token_digest = ?
  LIMIT 1
`
const INSERT_CLAIM_PLAYER_SQL = `
  INSERT INTO leaderboard_players (
    identity_key_digest,
    public_label,
    status,
    created_at_ms,
    public_name_key,
    device_credential_digest,
    recovery_code_digest,
    recovery_version,
    last_renamed_at_ms,
    credential_rotated_at_ms,
    identity_updated_at_ms,
    identity_state
  ) VALUES (?, ?, 'active', ?, ?, ?, ?, 1, NULL, ?, ?, 'active')
  ON CONFLICT DO NOTHING
`
const LINK_CLAIM_RUN_SQL = `
  UPDATE leaderboard_runs
  SET
    player_id = (
      SELECT player_id
      FROM leaderboard_players
      WHERE identity_key_digest = ?
        AND public_name_key = ?
        AND device_credential_digest = ?
        AND recovery_code_digest = ?
        AND status = 'active'
        AND identity_state = 'active'
      LIMIT 1
    ),
    eligibility_status = 'eligible',
    eligibility_reason = 'eligible'
  WHERE run_id = ?
    AND eligibility_status = 'identity_pending'
    AND eligibility_reason = 'identity_unavailable'
    AND environment != 'test'
    AND game_mode = 'classic'
    AND is_smoke = 0
    AND EXISTS (
      SELECT 1
      FROM leaderboard_identity_claims
      WHERE run_id = ?
        AND claim_token_digest = ?
        AND used_at_ms IS NULL
        AND expires_at_ms > ?
    )
    AND EXISTS (
      SELECT 1
      FROM leaderboard_players
      WHERE identity_key_digest = ?
        AND public_name_key = ?
        AND device_credential_digest = ?
        AND recovery_code_digest = ?
        AND status = 'active'
        AND identity_state = 'active'
    )
`
const USE_CLAIM_SQL = `
  UPDATE leaderboard_identity_claims
  SET
    used_at_ms = ?,
    claimed_player_id = (
      SELECT player_id
      FROM leaderboard_players
      WHERE identity_key_digest = ?
        AND public_name_key = ?
        AND device_credential_digest = ?
        AND recovery_code_digest = ?
      LIMIT 1
    ),
    claimed_name_key = ?
  WHERE claim_token_digest = ?
    AND run_id = ?
    AND used_at_ms IS NULL
    AND expires_at_ms > ?
    AND EXISTS (
      SELECT 1
      FROM leaderboard_runs
      WHERE run_id = ?
        AND eligibility_status = 'eligible'
        AND player_id = (
          SELECT player_id
          FROM leaderboard_players
          WHERE identity_key_digest = ?
            AND public_name_key = ?
            AND device_credential_digest = ?
            AND recovery_code_digest = ?
          LIMIT 1
        )
    )
`
const INSERT_CLAIM_EVENT_SQL = `
  INSERT INTO leaderboard_identity_events (
    event_key,
    player_id,
    event_type,
    occurred_at_ms
  )
  SELECT
    'claim:' || claim_id,
    claimed_player_id,
    'claimed',
    used_at_ms
  FROM leaderboard_identity_claims
  WHERE claim_token_digest = ?
    AND used_at_ms = ?
    AND claimed_name_key = ?
  ON CONFLICT(event_key) DO NOTHING
`
const ROTATE_RECOVERY_SQL = `
  UPDATE leaderboard_players
  SET
    device_credential_digest = ?,
    recovery_code_digest = ?,
    recovery_version = ?,
    credential_rotated_at_ms = ?,
    identity_updated_at_ms = ?
  WHERE player_id = ?
    AND recovery_code_digest = ?
    AND recovery_version = ?
    AND status = 'active'
    AND identity_state = 'active'
    AND EXISTS (
      SELECT 1
      FROM leaderboard_recovery_operations
      WHERE operation_digest = ?
        AND request_binding_digest = ?
        AND player_id = ?
        AND source_recovery_version = ?
        AND replacement_recovery_version = ?
        AND replacement_device_digest = ?
        AND replacement_recovery_digest = ?
    )
`
const INSERT_RECOVERY_OPERATION_SQL = `
  INSERT INTO leaderboard_recovery_operations (
    operation_digest,
    request_binding_digest,
    player_id,
    source_recovery_version,
    replacement_recovery_version,
    replacement_device_digest,
    replacement_recovery_digest,
    derivation_version,
    created_at_ms,
    expires_at_ms
  )
  SELECT ?, ?, player_id, ?, ?, ?, ?, 1, ?, ?
  FROM leaderboard_players
  WHERE player_id = ?
    AND recovery_code_digest = ?
    AND recovery_version = ?
    AND status = 'active'
    AND identity_state = 'active'
`
const ASSERT_RECOVERY_ROTATION_SQL = `
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM leaderboard_recovery_operations AS o
      JOIN leaderboard_players AS p ON p.player_id = o.player_id
      WHERE o.operation_digest = ?
        AND o.request_binding_digest = ?
        AND o.player_id = ?
        AND o.source_recovery_version = ?
        AND o.replacement_recovery_version = ?
        AND o.replacement_device_digest = ?
        AND o.replacement_recovery_digest = ?
        AND p.recovery_version = o.replacement_recovery_version
        AND p.device_credential_digest = o.replacement_device_digest
        AND p.recovery_code_digest = o.replacement_recovery_digest
        AND p.status = 'active'
        AND p.identity_state = 'active'
    )
    THEN 1
    ELSE json('recovery rotation transaction invariant')
  END AS verified
`
const INSERT_RECOVERY_EVENT_SQL = `
  INSERT INTO leaderboard_identity_events (
    event_key,
    player_id,
    event_type,
    occurred_at_ms
  )
  VALUES (?, ?, 'recovered', ?)
`
const RENAME_SQL = `
  UPDATE leaderboard_players
  SET
    public_label = ?,
    public_name_key = ?,
    last_renamed_at_ms = ?,
    identity_updated_at_ms = ?
  WHERE player_id = ?
    AND device_credential_digest = ?
    AND status = 'active'
    AND identity_state = 'active'
    AND (
      last_renamed_at_ms IS NULL
      OR last_renamed_at_ms <= ?
    )
`
const INSERT_RENAME_EVENT_SQL = `
  INSERT INTO leaderboard_identity_events (
    event_key,
    player_id,
    event_type,
    occurred_at_ms
  )
  SELECT ?, player_id, 'renamed', ?
  FROM leaderboard_players
  WHERE player_id = ?
    AND last_renamed_at_ms = ?
    AND public_name_key = ?
  ON CONFLICT(event_key) DO NOTHING
`

interface CredentialLookupStatement {
  bind(...values: unknown[]): CredentialLookupStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
}

interface IdentityPreparedStatement extends CredentialLookupStatement {
  bind(...values: unknown[]): IdentityPreparedStatement
  all<T = Record<string, unknown>>(): Promise<Readonly<{
    success?: boolean
    results?: T[]
  }>>
  run(): Promise<unknown>
}

export interface CredentialLookupDatabase {
  prepare(query: string): CredentialLookupStatement
}

export interface IdentityDatabase {
  prepare(query: string): IdentityPreparedStatement
  batch(statements: IdentityPreparedStatement[]): Promise<unknown>
}

export interface LeaderboardIdentityEnv extends LeaderboardIdentityModeEnv {
  readonly DB?: unknown
}

type IdentityErrorCode =
  | 'method_not_allowed'
  | 'origin_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'malformed_json'
  | 'invalid_request_schema'
  | 'display_name_invalid'
  | 'display_name_unavailable'
  | 'identity_claim_invalid'
  | 'identity_credential_invalid'
  | 'identity_recovery_invalid'
  | 'rate_limited'
  | 'rename_cooldown'
  | 'identity_unavailable'

interface IdentityRow {
  readonly player_id: unknown
  readonly identity_key_digest?: unknown
  readonly public_label: unknown
  readonly public_name_key: unknown
  readonly recovery_version: unknown
  readonly last_renamed_at_ms?: unknown
  readonly created_at_ms: unknown
}

interface ClaimRow {
  readonly claim_id: unknown
  readonly run_id: unknown
  readonly created_at_ms: unknown
  readonly expires_at_ms: unknown
  readonly used_at_ms: unknown
  readonly claimed_player_id: unknown
  readonly claimed_name_key: unknown
  readonly eligibility_status: unknown
  readonly eligibility_reason: unknown
  readonly environment: unknown
  readonly game_mode: unknown
  readonly is_smoke: unknown
  readonly public_label: unknown
  readonly public_name_key: unknown
  readonly device_credential_digest: unknown
  readonly recovery_code_digest: unknown
}

interface RecoveryOperationRow {
  readonly operation_digest: string
  readonly request_binding_digest: string
  readonly player_id: number
  readonly source_recovery_version: number
  readonly replacement_recovery_version: number
  readonly replacement_device_digest: string
  readonly replacement_recovery_digest: string
  readonly derivation_version: number
  readonly created_at_ms: number
  readonly expires_at_ms: number
  readonly public_label: string
  readonly public_name_key: string
  readonly recovery_version: number
  readonly device_credential_digest: string
  readonly recovery_code_digest: string
  readonly status: string
  readonly identity_state: string
}

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

function canonicalTimestamp(value: number) {
  try {
    return new Date(value).toISOString()
  } catch {
    return null
  }
}

function databaseFrom(value: unknown): IdentityDatabase | null {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'prepare') === 'function'
    && typeof Reflect.get(value, 'batch') === 'function'
    ? value as IdentityDatabase
    : null
}

function response(payload: unknown, status: number, headers: Readonly<Record<string, string>> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, ...SAFE_JSON_RESPONSE_HEADERS },
  })
}

export function leaderboardIdentityErrorResponse(
  code: IdentityErrorCode,
  extra: Readonly<Record<string, unknown>> = {},
) {
  const definition: Readonly<Record<IdentityErrorCode, Readonly<{ status: number, message: string }>>> = {
    method_not_allowed: { status: 405, message: 'Method Not Allowed' },
    origin_not_allowed: { status: 403, message: 'Request origin is not allowed.' },
    unsupported_media_type: { status: 415, message: 'Request must use application/json without content encoding.' },
    payload_too_large: { status: 413, message: 'Request body exceeds the allowed size.' },
    malformed_json: { status: 400, message: 'Request body must contain valid JSON.' },
    invalid_request_schema: { status: 400, message: 'Request does not match the required schema.' },
    display_name_invalid: { status: 422, message: 'Display name does not meet the public-name rules.' },
    display_name_unavailable: { status: 409, message: 'Display name is unavailable.' },
    identity_claim_invalid: { status: 422, message: 'Identity claim is invalid or expired.' },
    identity_credential_invalid: { status: 401, message: 'Identity credential is invalid.' },
    identity_recovery_invalid: { status: 422, message: 'Recovery code is invalid.' },
    rate_limited: { status: 429, message: 'Too Many Requests' },
    rename_cooldown: { status: 409, message: 'Display name cannot be changed yet.' },
    identity_unavailable: { status: 503, message: 'Leaderboard identity is temporarily unavailable.' },
  }
  const selected = definition[code]
  return response({
    ok: false,
    error: Object.freeze({ code, message: selected.message }),
    ...extra,
  }, selected.status, code === 'method_not_allowed' ? { Allow: ALLOWED_METHODS } : {})
}

function mapBodyError(error: unknown) {
  if (!(error instanceof DraftValidationPublicError)) return leaderboardIdentityErrorResponse('identity_unavailable')
  if (
    error.code === 'unsupported_media_type'
    || error.code === 'payload_too_large'
    || error.code === 'malformed_json'
    || error.code === 'invalid_request_schema'
  ) return leaderboardIdentityErrorResponse(error.code)
  return leaderboardIdentityErrorResponse('invalid_request_schema')
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function isCanonicalRecoveryOperationId(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(RECOVERY_OPERATION_PREFIX)) return false
  const payload = value.slice(RECOVERY_OPERATION_PREFIX.length)
  if (
    payload.length !== RECOVERY_OPERATION_PAYLOAD_LENGTH
    || !BASE64URL_PAYLOAD_PATTERN.test(payload)
  ) return false

  let decoded: string
  try {
    decoded = atob(`${payload.replaceAll('-', '+').replaceAll('_', '/')}=`)
  } catch {
    return false
  }
  if (decoded.length !== RECOVERY_OPERATION_PAYLOAD_BYTES) return false

  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return base64UrlEncode(bytes) === payload
}

function hexadecimal(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hmac(signingKey: string, domain: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const input = new TextEncoder().encode(`${domain}\n${value}`)
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, input))
}

async function secretDigest(signingKey: string, domain: string, secret: string) {
  return hexadecimal(await hmac(signingKey, domain, secret))
}

function recoveryChecksum(symbols: string) {
  let checksum = 0
  for (const symbol of symbols) {
    checksum = ((checksum * 33) ^ RECOVERY_ALPHABET.indexOf(symbol)) & 1023
  }
  return `${RECOVERY_ALPHABET[(checksum >>> 5) & 31]}${RECOVERY_ALPHABET[checksum & 31]}`
}

function recoverySymbols(material: Uint8Array) {
  let bits = 0
  let bitCount = 0
  let result = ''
  for (const byte of material) {
    bits = (bits << 8) | byte
    bitCount += 8
    while (bitCount >= 5 && result.length < RECOVERY_SYMBOLS) {
      bitCount -= 5
      result += RECOVERY_ALPHABET[(bits >>> bitCount) & 31]
      bits &= (1 << bitCount) - 1
    }
    if (result.length === RECOVERY_SYMBOLS) break
  }
  if (result.length !== RECOVERY_SYMBOLS) throw new Error('Recovery material is unavailable.')
  return result
}

function formatRecoveryCode(symbols: string) {
  const grouped = symbols.match(new RegExp(`.{1,${RECOVERY_GROUP_SIZE}}`, 'g'))
  if (!grouped) throw new Error('Recovery material is unavailable.')
  return `${RECOVERY_PREFIX}-${grouped.join('-')}`
}

function canonicalRecoveryCode(value: unknown) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 80) return null
  const compact = value
    .trim()
    .toUpperCase()
    .replaceAll('O', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1')
    .replace(/[\s-]/gu, '')
  if (!compact.startsWith(RECOVERY_PREFIX)) return null
  const symbols = compact.slice(RECOVERY_PREFIX.length)
  if (
    symbols.length !== RECOVERY_SYMBOLS + RECOVERY_CHECK_SYMBOLS
    || [...symbols].some((symbol) => !RECOVERY_ALPHABET.includes(symbol))
  ) return null
  const payload = symbols.slice(0, RECOVERY_SYMBOLS)
  if (symbols.slice(RECOVERY_SYMBOLS) !== recoveryChecksum(payload)) return null
  return `${RECOVERY_PREFIX}-${symbols}`
}

async function recoveryCodeFromMaterial(material: Uint8Array) {
  const symbols = recoverySymbols(material)
  return formatRecoveryCode(`${symbols}${recoveryChecksum(symbols)}`)
}

export async function deriveClaimCapability(signingKey: string, ticketTokenDigest: string) {
  if (!isLeaderboardIdentitySigningKey(signingKey) || !HEX_DIGEST_PATTERN.test(ticketTokenDigest)) {
    throw new Error('Leaderboard identity capability is unavailable.')
  }
  const token = `ppc1_${base64UrlEncode(await hmac(signingKey, 'pennant-pursuit:claim-token:v1', ticketTokenDigest))}`
  return Object.freeze({
    token,
    digest: await secretDigest(signingKey, 'pennant-pursuit:claim-digest:v1', token),
  })
}

async function initialSecrets(signingKey: string, claimToken: string) {
  const deviceMaterial = await hmac(signingKey, 'pennant-pursuit:initial-device:v1', claimToken)
  const recoveryMaterial = await hmac(signingKey, 'pennant-pursuit:initial-recovery:v1', claimToken)
  const deviceCredential = `ppd1_${base64UrlEncode(deviceMaterial)}`
  const recoveryCode = await recoveryCodeFromMaterial(recoveryMaterial)
  return {
    deviceCredential,
    deviceDigest: await secretDigest(signingKey, 'pennant-pursuit:device-digest:v1', deviceCredential),
    recoveryCode,
    recoveryDigest: await secretDigest(signingKey, 'pennant-pursuit:recovery-digest:v1', canonicalRecoveryCode(recoveryCode) ?? recoveryCode),
    identityKeyDigest: await secretDigest(signingKey, 'pennant-pursuit:stable-identity:v1', claimToken),
  }
}

async function rotatedSecrets(
  signingKey: string,
  canonicalCode: string,
  recoveryOperationId: string,
  playerId: number,
  sourceVersion: number,
) {
  const rotationInput = [
    `player:${playerId}`,
    `source-version:${sourceVersion}`,
    `operation:${recoveryOperationId}`,
    `recovery:${canonicalCode}`,
  ].join('\n')
  const deviceCredential = `ppd1_${base64UrlEncode(
    await hmac(signingKey, 'pennant-pursuit:recovered-device:v2', rotationInput),
  )}`
  const recoveryCode = await recoveryCodeFromMaterial(
    await hmac(signingKey, 'pennant-pursuit:rotated-recovery:v2', rotationInput),
  )
  return {
    deviceCredential,
    deviceDigest: await secretDigest(signingKey, 'pennant-pursuit:device-digest:v1', deviceCredential),
    recoveryCode,
    recoveryDigest: await secretDigest(signingKey, 'pennant-pursuit:recovery-digest:v1', canonicalRecoveryCode(recoveryCode) ?? recoveryCode),
  }
}

async function recoveryOperationDigests(
  signingKey: string,
  canonicalCode: string,
  recoveryOperationId: string,
) {
  const [operationDigest, requestBindingDigest] = await Promise.all([
    secretDigest(
      signingKey,
      'pennant-pursuit:recovery-operation-digest:v1',
      recoveryOperationId,
    ),
    secretDigest(
      signingKey,
      'pennant-pursuit:recovery-request-binding:v1',
      `${recoveryOperationId}\n${canonicalCode}`,
    ),
  ])
  return Object.freeze({ operationDigest, requestBindingDigest })
}

async function schemaIsReady(database: IdentityDatabase) {
  const row = await database.prepare(SELECT_SCHEMA_SQL).first<{ version?: unknown }>()
  return row?.version === LEADERBOARD_IDENTITY_SCHEMA_VERSION
}

function validIdentityRow(value: unknown): value is IdentityRow {
  if (!isRecord(value)) return false
  return typeof value.player_id === 'number'
    && Number.isSafeInteger(value.player_id)
    && value.player_id >= 1
    && typeof value.public_label === 'string'
    && validateDisplayName(value.public_label)?.nameKey === value.public_name_key
    && typeof value.public_name_key === 'string'
    && typeof value.recovery_version === 'number'
    && Number.isSafeInteger(value.recovery_version)
    && value.recovery_version >= 1
    && isSafeTimestamp(value.created_at_ms)
    && canonicalTimestamp(value.created_at_ms) !== null
    && (
      value.last_renamed_at_ms === undefined
      || value.last_renamed_at_ms === null
      || (
        isSafeTimestamp(value.last_renamed_at_ms)
        && canonicalTimestamp(value.last_renamed_at_ms) !== null
      )
    )
}

function statementChanges(value: unknown) {
  if (!isRecord(value) || value.success !== true || !isRecord(value.meta)) return null
  const changes = value.meta.changes
  return typeof changes === 'number' && Number.isSafeInteger(changes) && changes >= 0
    ? changes
    : null
}

async function identityByCredential(
  database: CredentialLookupDatabase,
  signingKey: string,
  credential: unknown,
) {
  if (typeof credential !== 'string' || !DEVICE_CREDENTIAL_PATTERN.test(credential)) return null
  const digest = await secretDigest(signingKey, 'pennant-pursuit:device-digest:v1', credential)
  const row = await database.prepare(SELECT_CREDENTIAL_SQL).bind(digest).first<unknown>()
  return validIdentityRow(row) ? { row, digest } : null
}

export async function resolveLeaderboardIdentityCredential(
  database: CredentialLookupDatabase,
  signingKey: string,
  credential: unknown,
) {
  const resolved = await identityByCredential(database, signingKey, credential)
  if (!resolved || typeof resolved.row.identity_key_digest !== 'string' || !HEX_DIGEST_PATTERN.test(resolved.row.identity_key_digest)) {
    return null
  }
  return Object.freeze({
    playerId: resolved.row.player_id as number,
    identityKeyDigest: resolved.row.identity_key_digest,
    publicLabel: resolved.row.public_label as string,
  })
}

function identityPayload(row: IdentityRow, nowMs: number) {
  const lastRenamedAtMs = row.last_renamed_at_ms
  const nextEligibleMs = typeof lastRenamedAtMs === 'number'
    ? lastRenamedAtMs + LEADERBOARD_RENAME_COOLDOWN_MS
    : null
  if (
    nextEligibleMs !== null
    && (!isSafeTimestamp(nextEligibleMs) || canonicalTimestamp(nextEligibleMs) === null)
  ) throw new Error('Leaderboard identity timestamp is invalid.')
  return Object.freeze({
    displayName: row.public_label,
    renameEligible: nextEligibleMs === null || nowMs >= nextEligibleMs,
    nextEligibleRenameAt: nextEligibleMs === null ? null : canonicalTimestamp(nextEligibleMs),
    recoveryVersion: row.recovery_version,
  })
}

async function availability(
  body: Record<string, unknown>,
  database: IdentityDatabase,
) {
  if (!hasExactKeys(body, ['displayName'])) return leaderboardIdentityErrorResponse('invalid_request_schema')
  const validated = validateDisplayName(body.displayName)
  if (!validated) return leaderboardIdentityErrorResponse('display_name_invalid')
  const existing = await database.prepare(SELECT_NAME_SQL).bind(validated.nameKey).first<unknown>()
  return response({
    ok: true,
    schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
    displayName: validated.displayName,
    available: existing === null,
  }, 200)
}

function validClaimRow(value: unknown): value is ClaimRow {
  if (!isRecord(value)) return false
  return typeof value.claim_id === 'number'
    && Number.isSafeInteger(value.claim_id)
    && value.claim_id >= 1
    && typeof value.run_id === 'number'
    && Number.isSafeInteger(value.run_id)
    && value.run_id >= 1
    && isSafeTimestamp(value.created_at_ms)
    && isSafeTimestamp(value.expires_at_ms)
    && value.expires_at_ms > value.created_at_ms
    && (
      value.used_at_ms === null
      || (
        isSafeTimestamp(value.used_at_ms)
        && value.used_at_ms >= value.created_at_ms
        && value.used_at_ms < value.expires_at_ms
      )
    )
    && (value.claimed_player_id === null || (
      typeof value.claimed_player_id === 'number'
      && Number.isSafeInteger(value.claimed_player_id)
      && value.claimed_player_id >= 1
    ))
    && (value.claimed_name_key === null || typeof value.claimed_name_key === 'string')
    && (value.public_label === null || typeof value.public_label === 'string')
    && (value.public_name_key === null || typeof value.public_name_key === 'string')
    && (value.device_credential_digest === null || (
      typeof value.device_credential_digest === 'string'
      && HEX_DIGEST_PATTERN.test(value.device_credential_digest)
    ))
    && (value.recovery_code_digest === null || (
      typeof value.recovery_code_digest === 'string'
      && HEX_DIGEST_PATTERN.test(value.recovery_code_digest)
    ))
}

function validRecoveryOperationRow(value: unknown): value is RecoveryOperationRow {
  if (!isRecord(value)) return false
  return typeof value.operation_digest === 'string'
    && HEX_DIGEST_PATTERN.test(value.operation_digest)
    && typeof value.request_binding_digest === 'string'
    && HEX_DIGEST_PATTERN.test(value.request_binding_digest)
    && typeof value.player_id === 'number'
    && Number.isSafeInteger(value.player_id)
    && value.player_id >= 1
    && typeof value.source_recovery_version === 'number'
    && Number.isSafeInteger(value.source_recovery_version)
    && value.source_recovery_version >= 1
    && typeof value.replacement_recovery_version === 'number'
    && Number.isSafeInteger(value.replacement_recovery_version)
    && value.replacement_recovery_version === value.source_recovery_version + 1
    && typeof value.replacement_device_digest === 'string'
    && HEX_DIGEST_PATTERN.test(value.replacement_device_digest)
    && typeof value.replacement_recovery_digest === 'string'
    && HEX_DIGEST_PATTERN.test(value.replacement_recovery_digest)
    && value.derivation_version === RECOVERY_DERIVATION_VERSION
    && isSafeTimestamp(value.created_at_ms)
    && canonicalTimestamp(value.created_at_ms) !== null
    && isSafeTimestamp(value.expires_at_ms)
    && value.expires_at_ms > value.created_at_ms
    && canonicalTimestamp(value.expires_at_ms) !== null
    && typeof value.public_label === 'string'
    && validateDisplayName(value.public_label)?.nameKey === value.public_name_key
    && typeof value.public_name_key === 'string'
    && typeof value.recovery_version === 'number'
    && Number.isSafeInteger(value.recovery_version)
    && typeof value.device_credential_digest === 'string'
    && HEX_DIGEST_PATTERN.test(value.device_credential_digest)
    && typeof value.recovery_code_digest === 'string'
    && HEX_DIGEST_PATTERN.test(value.recovery_code_digest)
    && typeof value.status === 'string'
    && typeof value.identity_state === 'string'
}

async function completedRecoveryResponse(
  value: unknown,
  signingKey: string,
  canonicalCode: string,
  recoveryOperationId: string,
  operationDigest: string,
  requestBindingDigest: string,
  nowMs: number,
  idempotentRetry: boolean,
) {
  if (
    !validRecoveryOperationRow(value)
    || value.operation_digest !== operationDigest
    || value.request_binding_digest !== requestBindingDigest
    || nowMs >= value.expires_at_ms
    || value.status !== 'active'
    || value.identity_state !== 'active'
    || value.recovery_version !== value.replacement_recovery_version
    || value.device_credential_digest !== value.replacement_device_digest
    || value.recovery_code_digest !== value.replacement_recovery_digest
  ) return null
  const secrets = await rotatedSecrets(
    signingKey,
    canonicalCode,
    recoveryOperationId,
    value.player_id,
    value.source_recovery_version,
  )
  if (
    secrets.deviceDigest !== value.replacement_device_digest
    || secrets.recoveryDigest !== value.replacement_recovery_digest
  ) return null
  return response({
    ok: true,
    schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
    identity: Object.freeze({
      displayName: value.public_label,
      deviceCredential: secrets.deviceCredential,
      recoveryCode: secrets.recoveryCode,
      recoveryCodeMustBeStored: true,
      recoveryVersion: value.replacement_recovery_version,
    }),
    idempotentRetry,
    recoveryRetryExpiresAt: canonicalTimestamp(value.expires_at_ms),
  }, 200)
}

async function claimIdentity(
  body: Record<string, unknown>,
  database: IdentityDatabase,
  signingKey: string,
  nowMs: number,
) {
  if (!hasExactKeys(body, ['claimCapability', 'displayName'])) return leaderboardIdentityErrorResponse('invalid_request_schema')
  const claimToken = body.claimCapability
  const validated = validateDisplayName(body.displayName)
  if (!validated) return leaderboardIdentityErrorResponse('display_name_invalid')
  if (typeof claimToken !== 'string' || !CLAIM_CAPABILITY_PATTERN.test(claimToken)) {
    return leaderboardIdentityErrorResponse('identity_claim_invalid')
  }
  const claimDigest = await secretDigest(signingKey, 'pennant-pursuit:claim-digest:v1', claimToken)
  const claim = await database.prepare(SELECT_CLAIM_SQL).bind(claimDigest).first<unknown>()
  if (!validClaimRow(claim) || nowMs >= (claim.expires_at_ms as number)) {
    return leaderboardIdentityErrorResponse('identity_claim_invalid')
  }
  const secrets = await initialSecrets(signingKey, claimToken)

  if (claim.used_at_ms !== null) {
    if (
      claim.claimed_name_key !== validated.nameKey
      || claim.public_label !== validated.displayName
      || claim.public_name_key !== validated.nameKey
      || claim.device_credential_digest !== secrets.deviceDigest
      || claim.recovery_code_digest !== secrets.recoveryDigest
    ) return leaderboardIdentityErrorResponse('identity_claim_invalid')
    return response({
      ok: true,
      schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
      identity: Object.freeze({
        displayName: validated.displayName,
        deviceCredential: secrets.deviceCredential,
        recoveryCode: secrets.recoveryCode,
        recoveryCodeMustBeStored: true,
        nextEligibleRenameAt: null,
      }),
      idempotentRetry: true,
    }, 200)
  }

  if (
    claim.eligibility_status !== 'identity_pending'
    || claim.eligibility_reason !== 'identity_unavailable'
    || claim.environment === 'test'
    || claim.game_mode !== 'classic'
    || claim.is_smoke !== 0
  ) return leaderboardIdentityErrorResponse('identity_claim_invalid')

  let batch: unknown
  try {
    batch = await database.batch([
      database.prepare(INSERT_CLAIM_PLAYER_SQL).bind(
        secrets.identityKeyDigest,
        validated.displayName,
        nowMs,
        validated.nameKey,
        secrets.deviceDigest,
        secrets.recoveryDigest,
        nowMs,
        nowMs,
      ),
      database.prepare(LINK_CLAIM_RUN_SQL).bind(
        secrets.identityKeyDigest,
        validated.nameKey,
        secrets.deviceDigest,
        secrets.recoveryDigest,
        claim.run_id,
        claim.run_id,
        claimDigest,
        nowMs,
        secrets.identityKeyDigest,
        validated.nameKey,
        secrets.deviceDigest,
        secrets.recoveryDigest,
      ),
      database.prepare(USE_CLAIM_SQL).bind(
        nowMs,
        secrets.identityKeyDigest,
        validated.nameKey,
        secrets.deviceDigest,
        secrets.recoveryDigest,
        validated.nameKey,
        claimDigest,
        claim.run_id,
        nowMs,
        claim.run_id,
        secrets.identityKeyDigest,
        validated.nameKey,
        secrets.deviceDigest,
        secrets.recoveryDigest,
      ),
      database.prepare(INSERT_CLAIM_EVENT_SQL).bind(
        claimDigest,
        nowMs,
        validated.nameKey,
      ),
      database.prepare(SELECT_CLAIM_SQL).bind(claimDigest),
    ])
  } catch {
    const conflict = await database.prepare(SELECT_NAME_SQL).bind(validated.nameKey).first<unknown>()
    return conflict === null
      ? leaderboardIdentityErrorResponse('identity_unavailable')
      : leaderboardIdentityErrorResponse('display_name_unavailable')
  }
  if (!Array.isArray(batch) || batch.length !== 5) return leaderboardIdentityErrorResponse('identity_unavailable')
  const playerChanges = statementChanges(batch[0])
  const runChanges = statementChanges(batch[1])
  const claimChanges = statementChanges(batch[2])
  const eventChanges = statementChanges(batch[3])
  if (
    playerChanges === null
    || runChanges === null
    || claimChanges === null
    || eventChanges === null
  ) {
    return leaderboardIdentityErrorResponse('identity_unavailable')
  }
  const created = playerChanges === 1 && runChanges === 1 && claimChanges === 1 && eventChanges === 1
  const concurrentRetry = playerChanges === 0 && runChanges === 0 && claimChanges === 0 && eventChanges === 0
  if (!created && !concurrentRetry) return leaderboardIdentityErrorResponse('identity_unavailable')
  const selectedResult = batch[4]
  if (
    !isRecord(selectedResult)
    || selectedResult.success !== true
    || !Array.isArray(selectedResult.results)
    || selectedResult.results.length !== 1
  ) return leaderboardIdentityErrorResponse('identity_unavailable')
  const selected = selectedResult.results[0]
  const useTimeMatches = validClaimRow(selected)
    && (
      (created && selected.used_at_ms === nowMs)
      || (
        concurrentRetry
        && typeof selected.used_at_ms === 'number'
        && selected.used_at_ms >= (selected.created_at_ms as number)
        && selected.used_at_ms < (selected.expires_at_ms as number)
      )
    )
  if (
    !validClaimRow(selected)
    || !useTimeMatches
    || selected.claimed_name_key !== validated.nameKey
    || selected.public_label !== validated.displayName
    || selected.device_credential_digest !== secrets.deviceDigest
    || selected.recovery_code_digest !== secrets.recoveryDigest
  ) {
    if (concurrentRetry) {
      return leaderboardIdentityErrorResponse('display_name_unavailable')
    }
    return leaderboardIdentityErrorResponse('identity_unavailable')
  }
  return response({
    ok: true,
    schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
    identity: Object.freeze({
      displayName: validated.displayName,
      deviceCredential: secrets.deviceCredential,
      recoveryCode: secrets.recoveryCode,
      recoveryCodeMustBeStored: true,
      nextEligibleRenameAt: null,
    }),
    idempotentRetry: concurrentRetry,
  }, concurrentRetry ? 200 : 201)
}

async function recoverIdentity(
  body: Record<string, unknown>,
  database: IdentityDatabase,
  signingKey: string,
  nowMs: number,
) {
  if (!hasExactKeys(body, ['recoveryCode', 'recoveryOperationId'])) {
    return leaderboardIdentityErrorResponse('invalid_request_schema')
  }
  const canonicalCode = canonicalRecoveryCode(body.recoveryCode)
  const recoveryOperationId = body.recoveryOperationId
  if (
    !canonicalCode
    || !isCanonicalRecoveryOperationId(recoveryOperationId)
  ) return leaderboardIdentityErrorResponse('identity_recovery_invalid')
  const { operationDigest, requestBindingDigest } = await recoveryOperationDigests(
    signingKey,
    canonicalCode,
    recoveryOperationId,
  )
  const selectOperation = () => database
    .prepare(SELECT_RECOVERY_OPERATION_SQL)
    .bind(operationDigest, requestBindingDigest)
    .first<unknown>()
  const existingOperation = await selectOperation()
  if (existingOperation !== null) {
    const retried = await completedRecoveryResponse(
      existingOperation,
      signingKey,
      canonicalCode,
      recoveryOperationId,
      operationDigest,
      requestBindingDigest,
      nowMs,
      true,
    )
    return retried ?? leaderboardIdentityErrorResponse('identity_recovery_invalid')
  }
  const currentDigest = await secretDigest(signingKey, 'pennant-pursuit:recovery-digest:v1', canonicalCode)
  const row = await database.prepare(SELECT_RECOVERY_SQL).bind(currentDigest).first<unknown>()
  if (!validIdentityRow(row)) return leaderboardIdentityErrorResponse('identity_recovery_invalid')
  const nextVersion = (row.recovery_version as number) + 1
  const retryExpiresAtMs = nowMs + LEADERBOARD_RECOVERY_RETRY_TTL_MS
  if (
    !Number.isSafeInteger(nextVersion)
    || !isSafeTimestamp(retryExpiresAtMs)
    || canonicalTimestamp(retryExpiresAtMs) === null
  ) {
    return leaderboardIdentityErrorResponse('identity_recovery_invalid')
  }
  const secrets = await rotatedSecrets(
    signingKey,
    canonicalCode,
    recoveryOperationId,
    row.player_id as number,
    row.recovery_version as number,
  )
  let batch: unknown
  try {
    batch = await database.batch([
      database.prepare(INSERT_RECOVERY_OPERATION_SQL).bind(
        operationDigest,
        requestBindingDigest,
        row.recovery_version,
        nextVersion,
        secrets.deviceDigest,
        secrets.recoveryDigest,
        nowMs,
        retryExpiresAtMs,
        row.player_id,
        currentDigest,
        row.recovery_version,
      ),
      database.prepare(ROTATE_RECOVERY_SQL).bind(
        secrets.deviceDigest,
        secrets.recoveryDigest,
        nextVersion,
        nowMs,
        nowMs,
        row.player_id,
        currentDigest,
        row.recovery_version,
        operationDigest,
        requestBindingDigest,
        row.player_id,
        row.recovery_version,
        nextVersion,
        secrets.deviceDigest,
        secrets.recoveryDigest,
      ),
      database.prepare(ASSERT_RECOVERY_ROTATION_SQL).bind(
        operationDigest,
        requestBindingDigest,
        row.player_id,
        row.recovery_version,
        nextVersion,
        secrets.deviceDigest,
        secrets.recoveryDigest,
      ),
      database.prepare(INSERT_RECOVERY_EVENT_SQL).bind(
        `recovery:${operationDigest}`,
        row.player_id,
        nowMs,
      ),
      database.prepare(SELECT_RECOVERY_OPERATION_SQL).bind(
        operationDigest,
        requestBindingDigest,
      ),
    ])
  } catch {
    let reconciled: Response | null
    try {
      reconciled = await completedRecoveryResponse(
        await selectOperation(),
        signingKey,
        canonicalCode,
        recoveryOperationId,
        operationDigest,
        requestBindingDigest,
        nowMs,
        true,
      )
    } catch {
      return leaderboardIdentityErrorResponse('identity_unavailable')
    }
    return reconciled ?? leaderboardIdentityErrorResponse('identity_recovery_invalid')
  }
  if (
    !Array.isArray(batch)
    || batch.length !== 5
    || statementChanges(batch[0]) !== 1
    || statementChanges(batch[1]) !== 1
    || !isRecord(batch[2])
    || batch[2].success !== true
    || !Array.isArray(batch[2].results)
    || batch[2].results.length !== 1
    || !isRecord(batch[2].results[0])
    || batch[2].results[0].verified !== 1
    || statementChanges(batch[3]) !== 1
  ) {
    return leaderboardIdentityErrorResponse('identity_recovery_invalid')
  }
  const selected = batch[4]
  if (
    !isRecord(selected)
    || selected.success !== true
    || !Array.isArray(selected.results)
    || selected.results.length !== 1
  ) return leaderboardIdentityErrorResponse('identity_unavailable')
  return await completedRecoveryResponse(
    selected.results[0],
    signingKey,
    canonicalCode,
    recoveryOperationId,
    operationDigest,
    requestBindingDigest,
    nowMs,
    false,
  ) ?? leaderboardIdentityErrorResponse('identity_unavailable')
}

async function renameIdentity(
  body: Record<string, unknown>,
  database: IdentityDatabase,
  signingKey: string,
  nowMs: number,
) {
  if (!hasExactKeys(body, ['deviceCredential', 'displayName'])) return leaderboardIdentityErrorResponse('invalid_request_schema')
  const validated = validateDisplayName(body.displayName)
  if (!validated) return leaderboardIdentityErrorResponse('display_name_invalid')
  const identity = await identityByCredential(database, signingKey, body.deviceCredential)
  if (!identity) return leaderboardIdentityErrorResponse('identity_credential_invalid')
  const row = identity.row
  if (row.public_label === validated.displayName) {
    return response({
      ok: true,
      schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
      identity: identityPayload(row, nowMs),
      unchanged: true,
    }, 200)
  }
  const lastRenamedAtMs = row.last_renamed_at_ms
  const nextEligibleMs = typeof lastRenamedAtMs === 'number'
    ? lastRenamedAtMs + LEADERBOARD_RENAME_COOLDOWN_MS
    : null
  if (nextEligibleMs !== null && nowMs < nextEligibleMs) {
    return leaderboardIdentityErrorResponse('rename_cooldown', {
      nextEligibleRenameAt: canonicalTimestamp(nextEligibleMs),
    })
  }
  let batch: unknown
  try {
    batch = await database.batch([
      database.prepare(RENAME_SQL).bind(
        validated.displayName,
        validated.nameKey,
        nowMs,
        nowMs,
        row.player_id,
        identity.digest,
        nowMs - LEADERBOARD_RENAME_COOLDOWN_MS,
      ),
      database.prepare(INSERT_RENAME_EVENT_SQL).bind(
        `rename:${row.player_id}:${nowMs}`,
        nowMs,
        row.player_id,
        nowMs,
        validated.nameKey,
      ),
      database.prepare(SELECT_CREDENTIAL_SQL).bind(identity.digest),
    ])
  } catch {
    const conflict = await database.prepare(SELECT_NAME_SQL).bind(validated.nameKey).first<unknown>()
    return conflict === null
      ? leaderboardIdentityErrorResponse('identity_unavailable')
      : leaderboardIdentityErrorResponse('display_name_unavailable')
  }
  if (!Array.isArray(batch) || batch.length !== 3) return leaderboardIdentityErrorResponse('identity_unavailable')
  const changes = statementChanges(batch[0])
  const eventChanges = statementChanges(batch[1])
  const selected = batch[2]
  if (
    changes !== 1
    || eventChanges !== 1
    || !isRecord(selected)
    || selected.success !== true
    || !Array.isArray(selected.results)
    || selected.results.length !== 1
    || !validIdentityRow(selected.results[0])
  ) {
    const refreshed = await database.prepare(SELECT_CREDENTIAL_SQL).bind(identity.digest).first<unknown>()
    if (validIdentityRow(refreshed) && typeof refreshed.last_renamed_at_ms === 'number') {
      return leaderboardIdentityErrorResponse('rename_cooldown', {
        nextEligibleRenameAt: canonicalTimestamp(
          refreshed.last_renamed_at_ms + LEADERBOARD_RENAME_COOLDOWN_MS,
        ),
      })
    }
    return leaderboardIdentityErrorResponse('identity_unavailable')
  }
  return response({
    ok: true,
    schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
    identity: identityPayload(selected.results[0], nowMs),
    unchanged: false,
  }, 200)
}

async function identityStatus(
  body: Record<string, unknown>,
  database: IdentityDatabase,
  signingKey: string,
  nowMs: number,
  recoveryEnabled: boolean,
  renameEnabled: boolean,
) {
  if (!hasExactKeys(body, ['deviceCredential'])) return leaderboardIdentityErrorResponse('invalid_request_schema')
  const identity = await identityByCredential(database, signingKey, body.deviceCredential)
  if (!identity) return leaderboardIdentityErrorResponse('identity_credential_invalid')
  return response({
    ok: true,
    schemaVersion: LEADERBOARD_IDENTITY_RESPONSE_SCHEMA_VERSION,
    identity: identityPayload(identity.row, nowMs),
    capabilities: Object.freeze({
      bestRun: true,
      cumulativePerformance: false,
      recovery: recoveryEnabled,
      rename: renameEnabled,
    }),
  }, 200)
}

export async function handleLeaderboardIdentityRequest(
  request: Request,
  env: LeaderboardIdentityEnv,
  action: unknown,
  now: () => number = () => Date.now(),
) {
  if (
    !isLeaderboardIdentityCapability(action)
    || !isLeaderboardIdentityCapabilityEnabled(env, action)
  ) {
    return handleApiNotFoundRequest(request)
  }
  if (request.method !== ALLOWED_METHODS) return leaderboardIdentityErrorResponse('method_not_allowed')
  if (!isLeaderboardIdentitySigningKey(env.LEADERBOARD_IDENTITY_SIGNING_KEY)) {
    return leaderboardIdentityErrorResponse('identity_unavailable')
  }
  const database = databaseFrom(env.DB)
  if (!database) return leaderboardIdentityErrorResponse('identity_unavailable')
  let body: unknown
  try {
    body = await readBoundedJson(request)
  } catch (error) {
    return mapBodyError(error)
  }
  if (!isRecord(body)) return leaderboardIdentityErrorResponse('invalid_request_schema')
  const nowMs = now()
  if (!isSafeTimestamp(nowMs) || canonicalTimestamp(nowMs) === null) {
    return leaderboardIdentityErrorResponse('identity_unavailable')
  }
  try {
    if (!await schemaIsReady(database)) return leaderboardIdentityErrorResponse('identity_unavailable')
    switch (action) {
      case 'availability':
        return await availability(body, database)
      case 'claim':
        return await claimIdentity(body, database, env.LEADERBOARD_IDENTITY_SIGNING_KEY, nowMs)
      case 'recover':
        return await recoverIdentity(body, database, env.LEADERBOARD_IDENTITY_SIGNING_KEY, nowMs)
      case 'rename':
        return await renameIdentity(body, database, env.LEADERBOARD_IDENTITY_SIGNING_KEY, nowMs)
      case 'status':
        return await identityStatus(
          body,
          database,
          env.LEADERBOARD_IDENTITY_SIGNING_KEY,
          nowMs,
          isLeaderboardIdentityRecoveryEnabled(env),
          isLeaderboardIdentityRenameEnabled(env),
        )
      default:
        return assertNeverIdentityAction(action)
    }
  } catch {
    return leaderboardIdentityErrorResponse('identity_unavailable')
  }
}

function assertNeverIdentityAction(action: never): never {
  throw new TypeError(`Unhandled leaderboard identity action: ${String(action)}`)
}
