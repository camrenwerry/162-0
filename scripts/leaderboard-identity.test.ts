import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  deriveClaimCapability,
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_MIN_CHARACTERS,
  handleLeaderboardIdentityRequest,
  isCanonicalRecoveryOperationId,
  LEADERBOARD_RECOVERY_RETRY_TTL_MS,
  LEADERBOARD_RENAME_COOLDOWN_MS,
  resolveLeaderboardIdentityCredential,
  validateDisplayName,
  type LeaderboardIdentityEnv,
} from '../functions/lib/leaderboard-identity'
import {
  handleLeaderboardRequest,
  type LeaderboardEnv,
} from '../functions/lib/leaderboard'
import { handleLeaderboardIdentityProxyRequest } from '../functions/lib/leaderboard-identity-proxy'
import { SqliteD1Database } from './lib/sqlite-d1'

const IDENTITY_KEY = 'leaderboard-identity-test-key-with-at-least-thirty-two-bytes'
const CURSOR_KEY = 'leaderboard-cursor-test-key-with-at-least-thirty-two-bytes'
const NOW = Date.UTC(2026, 6, 29, 12, 0, 0)
const ENDPOINT = 'https://example.test/api/v1/leaderboard-identity'
const RECOVERY_OPERATION_A = `ppr1_${'A'.repeat(42)}E`
const RECOVERY_OPERATION_B = `ppr1_${'B'.repeat(42)}Q`
const RECOVERY_OPERATION_C = `ppr1_${'C'.repeat(42)}g`
const RECOVERY_OPERATION_D = `ppr1_${'D'.repeat(42)}w`
const RECOVERY_OPERATION_E = `ppr1_${'E'.repeat(42)}A`
const CANONICAL_OPERATION_FINAL_CHARACTERS = [
  'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c', 'g', 'k', 'o', 's', 'w', '0', '4', '8',
] as const

function recoveryOperationIdFromBytes(bytes: Uint8Array) {
  return `ppr1_${Buffer.from(bytes).toString('base64url')}`
}

const canonicalOperationIds = CANONICAL_OPERATION_FINAL_CHARACTERS.map((expectedFinalCharacter, value) => {
  const bytes = new Uint8Array(32)
  bytes[31] = value
  const operationId = recoveryOperationIdFromBytes(bytes)
  const payload = operationId.slice('ppr1_'.length)
  const decoded = Buffer.from(payload, 'base64url')
  assert.equal(decoded.length, 32)
  assert.equal(decoded.toString('base64url'), payload)
  assert.equal(payload.at(-1), expectedFinalCharacter)
  assert.equal(isCanonicalRecoveryOperationId(operationId), true)
  return operationId
})
assert.deepEqual(
  canonicalOperationIds.map((operationId) => operationId.at(-1)),
  CANONICAL_OPERATION_FINAL_CHARACTERS,
)

for (let sample = 0; sample < 128; sample += 1) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const operationId = recoveryOperationIdFromBytes(bytes)
  assert.equal(isCanonicalRecoveryOperationId(operationId), true)
  assert.equal(Buffer.from(operationId.slice('ppr1_'.length), 'base64url').length, 32)
}

const zeroOperationId = canonicalOperationIds[0]
const zeroPayload = zeroOperationId.slice('ppr1_'.length)
for (const noncanonicalFinalCharacter of ['B', 'C', 'D']) {
  const noncanonical = `ppr1_${zeroPayload.slice(0, -1)}${noncanonicalFinalCharacter}`
  assert.equal(Buffer.from(noncanonical.slice('ppr1_'.length), 'base64url').length, 32)
  assert.equal(isCanonicalRecoveryOperationId(noncanonical), false)
}
for (const invalidOperationId of [
  `${zeroOperationId}=`,
  `${zeroOperationId}==`,
  zeroOperationId.replace('A', '+'),
  zeroOperationId.replace('A', '/'),
  zeroOperationId.replace('A', '*'),
  recoveryOperationIdFromBytes(new Uint8Array(31)),
  recoveryOperationIdFromBytes(new Uint8Array(33)),
  zeroOperationId.replace('ppr1_', 'ppr0_'),
  zeroOperationId.replace('ppr1_', 'ppd1_'),
  zeroOperationId.replace('ppr1_', 'PPR1_'),
  zeroOperationId.slice(0, -1),
  `${zeroOperationId}A`,
  ` ${zeroOperationId}`,
  `${zeroOperationId} `,
  `${zeroOperationId}\n`,
  zeroOperationId.replace('ppr1_', 'ppr1_ '),
]) assert.equal(isCanonicalRecoveryOperationId(invalidOperationId), false, JSON.stringify(invalidOperationId))
for (const invalidOperationId of [null, undefined, 0, {}, []]) {
  assert.equal(isCanonicalRecoveryOperationId(invalidOperationId), false)
}

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

function identityRequest(body: unknown, method = 'POST') {
  return new Request(ENDPOINT, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

let runCounter = 0
async function pendingClaim(sqlite: DatabaseSync, digestCharacter: string, expiresAtMs = NOW + 60_000) {
  runCounter += 1
  const ticketId = `10000000-0000-4000-8000-${String(runCounter).padStart(12, '0')}`
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
    ) VALUES (?, NULL, 'classic', 'production', 0, ?, ?, ?, ?, 'identity_pending', 'identity_unavailable', NULL)
  `).run(
    ticketId,
    NOW,
    100 + runCounter,
    800 + runCounter,
    'Pennant Contender',
  )
  const runId = Number(result.lastInsertRowid)
  const capability = await deriveClaimCapability(IDENTITY_KEY, digestCharacter.repeat(64))
  sqlite.prepare(`
    INSERT INTO leaderboard_identity_claims (
      run_id,
      claim_token_digest,
      created_at_ms,
      expires_at_ms
    ) VALUES (?, ?, ?, ?)
  `).run(runId, capability.digest, NOW - 1_000, expiresAtMs)
  return { runId, ticketId, capability: capability.token }
}

const validNames = [
  'Ace',
  'Player One',
  'José-42',
  'MVP_2026',
  '界界界',
  'A'.repeat(DISPLAY_NAME_MAX_CHARACTERS),
]
for (const name of validNames) {
  const validated = validateDisplayName(name)
  assert(validated, name)
  assert.equal(validated.displayName, name.normalize('NFKC'))
}
assert.equal(validateDisplayName('A'.repeat(DISPLAY_NAME_MIN_CHARACTERS - 1)), null)
assert.equal(validateDisplayName('A'.repeat(DISPLAY_NAME_MAX_CHARACTERS + 1)), null)
for (const name of [
  ' Player',
  'Player ',
  'Player  One',
  'Player\tOne',
  'Player.One',
  'Player/One',
  'Player\u0000One',
  'Player\u200dOne',
  'Player\u2028One',
  'Player😀',
]) assert.equal(validateDisplayName(name), null, JSON.stringify(name))
assert.equal(validateDisplayName('ＦＯＯ')?.displayName, 'FOO')
assert.equal(validateDisplayName('Straße')?.nameKey, validateDisplayName('STRASSE')?.nameKey)
assert.equal(validateDisplayName('ὈΔΥΣΣΕΎΣ')?.nameKey, validateDisplayName('ὀδυσσεύς')?.nameKey)

const sqlite = migratedDatabase()
const database = new SqliteD1Database(sqlite)
const env: LeaderboardIdentityEnv = {
  LEADERBOARD_IDENTITY_MODE: 'enabled',
  LEADERBOARD_RECOVERY_MODE: 'enabled',
  LEADERBOARD_IDENTITY_SIGNING_KEY: IDENTITY_KEY,
  DB: database,
}

const recoveryGateDisabled = await handleLeaderboardIdentityRequest(
  identityRequest({
    recoveryCode: 'PP1-0000-0000-0000-0000-0000-0000-0000',
    recoveryOperationId: RECOVERY_OPERATION_E,
  }),
  { ...env, LEADERBOARD_RECOVERY_MODE: 'disabled' },
  'recover',
)
assert.equal(recoveryGateDisabled.status, 404)

const disabledDatabase = new Proxy({}, {
  get() {
    throw new Error('disabled identity route must not inspect bindings')
  },
})
const disabled = await handleLeaderboardIdentityRequest(
  identityRequest({ displayName: 'Player One' }),
  { LEADERBOARD_IDENTITY_MODE: 'disabled', DB: disabledDatabase },
  'availability',
)
assert.equal(disabled.status, 404)

const method = await handleLeaderboardIdentityRequest(
  identityRequest({}, 'GET'),
  env,
  'availability',
)
assert.equal(method.status, 405)
assert.equal(method.headers.get('Allow'), 'POST')

const wrongMedia = await handleLeaderboardIdentityRequest(
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  }),
  env,
  'availability',
)
assert.equal(wrongMedia.status, 415)
const oversized = await handleLeaderboardIdentityRequest(
  new Request(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '20000',
    },
    body: '{}',
  }),
  env,
  'availability',
)
assert.equal(oversized.status, 413)
const duplicateKey = await handleLeaderboardIdentityRequest(
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"displayName":"Player One","displayName":"Player Two"}',
  }),
  env,
  'availability',
)
assert.equal(duplicateKey.status, 400)

let forwardedIdentityRequest: Request | null = null
const proxyResponse = await handleLeaderboardIdentityProxyRequest(
  new Request('https://example.test/api/v1/leaderboard-name-availability', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.25',
      Authorization: 'redacted-test-value',
      Cookie: 'identity=must-not-cross-service-binding',
    },
    body: JSON.stringify({ displayName: 'Proxy Name' }),
  }),
  {
    LEADERBOARD_IDENTITY_MODE: 'enabled',
    VALIDATION_SERVICE: {
      async fetch(request) {
        forwardedIdentityRequest = request
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
  '/api/v1/leaderboard-name-availability',
)
assert.equal(proxyResponse.status, 200)
assert(forwardedIdentityRequest)
assert.equal(new URL(forwardedIdentityRequest.url).pathname, '/api/v1/leaderboard-name-availability')
assert.match(
  forwardedIdentityRequest.headers.get('X-Pennant-Pursuit-Rate-Key') ?? '',
  /^v1:[0-9a-f]{64}$/,
)
for (const header of ['Authorization', 'Cookie', 'CF-Connecting-IP']) {
  assert.equal(forwardedIdentityRequest.headers.get(header), null)
}

const unknownField = await handleLeaderboardIdentityRequest(
  identityRequest({ displayName: 'Player One', extra: true }),
  env,
  'availability',
)
assert.equal((await body(unknownField)).error && unknownField.status, 400)

const injection = await handleLeaderboardIdentityRequest(
  identityRequest({ displayName: "Ace'); DROP TABLE leaderboard_players;--" }),
  env,
  'availability',
)
assert.equal(injection.status, 422)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'leaderboard_players'").get().count, 1)

const firstPending = await pendingClaim(sqlite, 'a')
const arbitraryPending = await pendingClaim(sqlite, 'b')
const available = await handleLeaderboardIdentityRequest(
  identityRequest({ displayName: 'Player One' }),
  env,
  'availability',
  () => NOW,
)
assert.deepEqual(await body(available), {
  ok: true,
  schemaVersion: 'pennant-leaderboard-identity-v1',
  displayName: 'Player One',
  available: true,
})

const claimed = await handleLeaderboardIdentityRequest(
  identityRequest({
    claimCapability: firstPending.capability,
    displayName: 'Player One',
  }),
  env,
  'claim',
  () => NOW,
)
assert.equal(claimed.status, 201)
assert.equal(claimed.headers.get('Cache-Control'), 'no-store')
const claimedText = await claimed.text()
const claimedBody = JSON.parse(claimedText) as {
  identity: {
    displayName: string
    deviceCredential: string
    recoveryCode: string
    nextEligibleRenameAt: null
  }
  idempotentRetry: boolean
}
assert.equal(claimedBody.identity.displayName, 'Player One')
assert.match(claimedBody.identity.deviceCredential, /^ppd1_[A-Za-z0-9_-]{43}$/)
assert.match(claimedBody.identity.recoveryCode, /^PP1-(?:[0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/)
assert.equal(claimedBody.identity.nextEligibleRenameAt, null)
assert.equal(claimedBody.idempotentRetry, false)
assert.equal(
  sqlite.prepare('SELECT eligibility_status FROM leaderboard_runs WHERE run_id = ?').get(firstPending.runId).eligibility_status,
  'eligible',
)
assert.equal(
  sqlite.prepare('SELECT eligibility_status FROM leaderboard_runs WHERE run_id = ?').get(arbitraryPending.runId).eligibility_status,
  'identity_pending',
)

const persistedSecrets = JSON.stringify(sqlite.prepare(`
  SELECT *
  FROM leaderboard_players
  JOIN leaderboard_identity_claims ON claimed_player_id = player_id
  WHERE player_id = 1
`).get())
assert.doesNotMatch(persistedSecrets, new RegExp(claimedBody.identity.deviceCredential))
assert.doesNotMatch(persistedSecrets, new RegExp(claimedBody.identity.recoveryCode.replaceAll('-', '')))
assert.doesNotMatch(persistedSecrets, /ppd1_|PP1-/)

const retry = await handleLeaderboardIdentityRequest(
  identityRequest({
    claimCapability: firstPending.capability,
    displayName: 'Player One',
  }),
  env,
  'claim',
  () => NOW + 1,
)
assert.equal(retry.status, 200)
const retryBody = await body(retry) as {
  identity: { deviceCredential: string, recoveryCode: string }
  idempotentRetry: boolean
}
assert.equal(retryBody.idempotentRetry, true)
assert.equal(retryBody.identity.deviceCredential, claimedBody.identity.deviceCredential)
assert.equal(retryBody.identity.recoveryCode, claimedBody.identity.recoveryCode)

const changedRetry = await handleLeaderboardIdentityRequest(
  identityRequest({
    claimCapability: firstPending.capability,
    displayName: 'Different Name',
  }),
  env,
  'claim',
  () => NOW + 1,
)
assert.equal(changedRetry.status, 422)

const concurrentPending = await pendingClaim(sqlite, '4')
const concurrentClaimResults = await Promise.all([
  handleLeaderboardIdentityRequest(
    identityRequest({
      claimCapability: concurrentPending.capability,
      displayName: 'Retry Safe',
    }),
    env,
    'claim',
    () => NOW + 2,
  ),
  handleLeaderboardIdentityRequest(
    identityRequest({
      claimCapability: concurrentPending.capability,
      displayName: 'Retry Safe',
    }),
    env,
    'claim',
    () => NOW + 3,
  ),
])
assert.deepEqual(
  concurrentClaimResults.map(({ status }) => status).sort(),
  [200, 201],
)
assert.deepEqual(
  (await Promise.all(concurrentClaimResults.map((response) => body(response))))
    .map((result) => result.idempotentRetry)
    .sort(),
  [false, true],
)

const expiredPending = await pendingClaim(sqlite, 'c', NOW)
const expired = await handleLeaderboardIdentityRequest(
  identityRequest({
    claimCapability: expiredPending.capability,
    displayName: 'Expired Name',
  }),
  env,
  'claim',
  () => NOW,
)
assert.equal(expired.status, 422)

const secondPending = await pendingClaim(sqlite, 'd')
const secondClaim = await handleLeaderboardIdentityRequest(
  identityRequest({
    claimCapability: secondPending.capability,
    displayName: 'Rival Name',
  }),
  env,
  'claim',
  () => NOW,
)
assert.equal(secondClaim.status, 201)
const secondClaimBody = await body(secondClaim) as {
  identity: { deviceCredential: string, recoveryCode: string }
}

const collisionAvailability = await handleLeaderboardIdentityRequest(
  identityRequest({ displayName: 'ＰＬＡＹＥＲ　ＯＮＥ' }),
  env,
  'availability',
  () => NOW,
)
assert.equal(collisionAvailability.status, 200)
assert.equal((await body(collisionAvailability)).available, false)
const caseCollision = await handleLeaderboardIdentityRequest(
  identityRequest({ displayName: 'PLAYER ONE' }),
  env,
  'availability',
  () => NOW,
)
assert.equal((await body(caseCollision)).available, false)

const resolved = await resolveLeaderboardIdentityCredential(
  database,
  IDENTITY_KEY,
  claimedBody.identity.deviceCredential,
)
assert(resolved)
assert.equal(resolved.publicLabel, 'Player One')
assert.equal(await resolveLeaderboardIdentityCredential(database, IDENTITY_KEY, 'ppd1_' + 'x'.repeat(43)), null)

const conflictRename = await handleLeaderboardIdentityRequest(
  identityRequest({
    deviceCredential: claimedBody.identity.deviceCredential,
    displayName: 'Rival Name',
  }),
  env,
  'rename',
  () => NOW + 1_000,
)
assert.equal(conflictRename.status, 409)
assert.equal(
  sqlite.prepare('SELECT last_renamed_at_ms FROM leaderboard_players WHERE player_id = 1').get().last_renamed_at_ms,
  null,
)

const renamedAt = NOW + 2_000
const rename = await handleLeaderboardIdentityRequest(
  identityRequest({
    deviceCredential: claimedBody.identity.deviceCredential,
    displayName: 'Renamed One',
  }),
  env,
  'rename',
  () => renamedAt,
)
assert.equal(rename.status, 200)
const renameBody = await body(rename) as {
  identity: { nextEligibleRenameAt: string }
}
assert.equal(
  renameBody.identity.nextEligibleRenameAt,
  new Date(renamedAt + LEADERBOARD_RENAME_COOLDOWN_MS).toISOString(),
)

const cooldown = await handleLeaderboardIdentityRequest(
  identityRequest({
    deviceCredential: claimedBody.identity.deviceCredential,
    displayName: 'Another Name',
  }),
  env,
  'rename',
  () => renamedAt + 1,
)
assert.equal(cooldown.status, 409)
assert.equal((await body(cooldown)).nextEligibleRenameAt, renameBody.identity.nextEligibleRenameAt)

const leaderboardEnv: LeaderboardEnv = {
  LEADERBOARD_READ_MODE: 'enabled',
  LEADERBOARD_ENVIRONMENT: 'production',
  LEADERBOARD_CURSOR_SIGNING_KEY: CURSOR_KEY,
  DB: database,
}
const board = await handleLeaderboardRequest(
  new Request('https://example.test/api/v1/leaderboards?period=all-time'),
  leaderboardEnv,
  () => NOW + 10_000,
)
assert.equal(board.status, 200)
const boardText = await board.text()
assert.match(boardText, /Renamed One/)
assert.doesNotMatch(boardText, /Player One|ppd1_|PP1-|claimCapability|player_id|run_id/)

const wrongRecovery = await handleLeaderboardIdentityRequest(
  identityRequest({
    recoveryCode: 'PP1-0000-0000-0000-0000-0000-0000-0000',
    recoveryOperationId: RECOVERY_OPERATION_E,
  }),
  env,
  'recover',
  () => NOW + 20_000,
)
assert.equal(wrongRecovery.status, 422)
const genericRecoveryError = {
  code: 'identity_recovery_invalid',
  message: 'Recovery code is invalid.',
}
assert.deepEqual((await body(wrongRecovery)).error, genericRecoveryError)

const recoveryStartedAt = NOW + 20_000
const recoveryRequestA = {
  recoveryCode: claimedBody.identity.recoveryCode.toLowerCase(),
  recoveryOperationId: RECOVERY_OPERATION_A,
}
// Treat this successful response as discarded after the transaction commits.
const discardedRecoveryResponse = await handleLeaderboardIdentityRequest(
  identityRequest(recoveryRequestA),
  env,
  'recover',
  () => recoveryStartedAt,
)
assert.equal(discardedRecoveryResponse.status, 200)
assert.equal(discardedRecoveryResponse.headers.get('Cache-Control'), 'no-store')
const discardedRecoveryBody = await body(discardedRecoveryResponse) as {
  identity: {
    displayName: string
    deviceCredential: string
    recoveryCode: string
    recoveryVersion: number
  }
  idempotentRetry: boolean
  recoveryRetryExpiresAt: string
}
assert.equal(discardedRecoveryBody.idempotentRetry, false)
assert.equal(JSON.stringify(discardedRecoveryBody).includes(RECOVERY_OPERATION_A), false)
assert.equal(
  discardedRecoveryBody.recoveryRetryExpiresAt,
  new Date(recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS).toISOString(),
)

const recoveredRetry = await handleLeaderboardIdentityRequest(
  identityRequest(recoveryRequestA),
  env,
  'recover',
  () => recoveryStartedAt + 1,
)
assert.equal(recoveredRetry.status, 200)
assert.equal(recoveredRetry.headers.get('Cache-Control'), 'no-store')
const recoveredBody = await body(recoveredRetry) as typeof discardedRecoveryBody
assert.equal(recoveredBody.idempotentRetry, true)
assert.deepEqual(recoveredBody.identity, discardedRecoveryBody.identity)
assert.equal(recoveredBody.recoveryRetryExpiresAt, discardedRecoveryBody.recoveryRetryExpiresAt)
assert.equal(recoveredBody.identity.displayName, 'Renamed One')
assert.equal(recoveredBody.identity.recoveryVersion, 2)
assert.notEqual(recoveredBody.identity.deviceCredential, claimedBody.identity.deviceCredential)
assert.notEqual(recoveredBody.identity.recoveryCode, claimedBody.identity.recoveryCode)
assert.equal(
  await resolveLeaderboardIdentityCredential(database, IDENTITY_KEY, claimedBody.identity.deviceCredential),
  null,
)
assert.equal(
  (await resolveLeaderboardIdentityCredential(database, IDENTITY_KEY, recoveredBody.identity.deviceCredential))?.playerId,
  1,
)

const crossPlayerOperationReuse = await handleLeaderboardIdentityRequest(
  identityRequest({
    recoveryCode: secondClaimBody.identity.recoveryCode,
    recoveryOperationId: RECOVERY_OPERATION_A,
  }),
  env,
  'recover',
  () => recoveryStartedAt + 2,
)
assert.equal(crossPlayerOperationReuse.status, 422)
assert.deepEqual((await body(crossPlayerOperationReuse)).error, genericRecoveryError)
assert.equal(
  (await resolveLeaderboardIdentityCredential(
    database,
    IDENTITY_KEY,
    secondClaimBody.identity.deviceCredential,
  ))?.publicLabel,
  'Rival Name',
)

const tamperedOperation = await handleLeaderboardIdentityRequest(
  identityRequest({
    recoveryCode: claimedBody.identity.recoveryCode,
    recoveryOperationId: RECOVERY_OPERATION_B,
  }),
  env,
  'recover',
  () => recoveryStartedAt + 2,
)
assert.equal(tamperedOperation.status, 422)
assert.deepEqual((await body(tamperedOperation)).error, genericRecoveryError)

const expiredRecoveryRetry = await handleLeaderboardIdentityRequest(
  identityRequest(recoveryRequestA),
  env,
  'recover',
  () => recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS,
)
assert.equal(expiredRecoveryRetry.status, 422)
assert.deepEqual((await body(expiredRecoveryRetry)).error, genericRecoveryError)

for (const crossPurposeBody of [
  {
    recoveryCode: recoveredBody.identity.deviceCredential,
    recoveryOperationId: RECOVERY_OPERATION_E,
  },
  {
    recoveryCode: recoveredBody.identity.recoveryCode,
    recoveryOperationId: firstPending.capability,
  },
  {
    recoveryCode: RECOVERY_OPERATION_E,
    recoveryOperationId: recoveredBody.identity.recoveryCode,
  },
  {
    recoveryCode: recoveredBody.identity.recoveryCode,
    recoveryOperationId: `ppr1_${'Z'.repeat(43)}`,
  },
]) {
  const rejected = await handleLeaderboardIdentityRequest(
    identityRequest(crossPurposeBody),
    env,
    'recover',
    () => recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS + 1,
  )
  assert.equal(rejected.status, 422)
  assert.deepEqual((await body(rejected)).error, genericRecoveryError)
}
const operationAsDevice = await handleLeaderboardIdentityRequest(
  identityRequest({ deviceCredential: RECOVERY_OPERATION_A }),
  env,
  'status',
  () => recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS + 1,
)
assert.equal(operationAsDevice.status, 401)
const missingOperation = await handleLeaderboardIdentityRequest(
  identityRequest({ recoveryCode: recoveredBody.identity.recoveryCode }),
  env,
  'recover',
  () => recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS + 1,
)
assert.equal(missingOperation.status, 400)

const rollbackSnapshot = {
  player: {
    ...sqlite.prepare(`
      SELECT device_credential_digest, recovery_code_digest, recovery_version
      FROM leaderboard_players
      WHERE player_id = 1
    `).get(),
  },
  operations: sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_recovery_operations').get().count,
  events: sqlite.prepare("SELECT COUNT(*) AS count FROM leaderboard_identity_events WHERE event_type = 'recovered'").get().count,
}
const rollbackDatabase = {
  prepare(query: string) {
    return database.prepare(query)
  },
  batch(statements: Parameters<SqliteD1Database['batch']>[0]) {
    return database.batch([
      ...statements.slice(0, 2),
      database.prepare("SELECT json('forced recovery rollback')"),
    ])
  },
}
const rollbackResponse = await handleLeaderboardIdentityRequest(
  identityRequest({
    recoveryCode: recoveredBody.identity.recoveryCode,
    recoveryOperationId: RECOVERY_OPERATION_B,
  }),
  { ...env, DB: rollbackDatabase },
  'recover',
  () => recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS + 2,
)
assert.equal(rollbackResponse.status, 422)
assert.deepEqual(
  {
    player: {
      ...sqlite.prepare(`
        SELECT device_credential_digest, recovery_code_digest, recovery_version
        FROM leaderboard_players
        WHERE player_id = 1
      `).get(),
    },
    operations: sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_recovery_operations').get().count,
    events: sqlite.prepare("SELECT COUNT(*) AS count FROM leaderboard_identity_events WHERE event_type = 'recovered'").get().count,
  },
  rollbackSnapshot,
)

const sameOperationStartedAt = recoveryStartedAt + LEADERBOARD_RECOVERY_RETRY_TTL_MS + 3
const sameOperationRequest = {
  recoveryCode: recoveredBody.identity.recoveryCode,
  recoveryOperationId: RECOVERY_OPERATION_B,
}
const sameOperationRace = await Promise.all([
  handleLeaderboardIdentityRequest(
    identityRequest(sameOperationRequest),
    env,
    'recover',
    () => sameOperationStartedAt,
  ),
  handleLeaderboardIdentityRequest(
    identityRequest(sameOperationRequest),
    env,
    'recover',
    () => sameOperationStartedAt + 1,
  ),
])
assert.deepEqual(sameOperationRace.map(({ status: responseStatus }) => responseStatus), [200, 200])
const sameOperationBodies = await Promise.all(
  sameOperationRace.map((responseValue) => body(responseValue) as Promise<typeof discardedRecoveryBody>),
)
assert.deepEqual(sameOperationBodies[0].identity, sameOperationBodies[1].identity)
assert.equal(sameOperationBodies[0].recoveryRetryExpiresAt, sameOperationBodies[1].recoveryRetryExpiresAt)
assert.deepEqual(
  sameOperationBodies.map(({ idempotentRetry }) => idempotentRetry).sort(),
  [false, true],
)
const sameOperationBody = sameOperationBodies[0]
assert.equal(sameOperationBody.identity.recoveryVersion, 3)
assert.equal(
  (await resolveLeaderboardIdentityCredential(
    database,
    IDENTITY_KEY,
    sameOperationBody.identity.deviceCredential,
  ))?.playerId,
  1,
)

const differentOperationStartedAt = sameOperationStartedAt + 2
const differentOperationRequests = [
  {
    recoveryCode: sameOperationBody.identity.recoveryCode,
    recoveryOperationId: RECOVERY_OPERATION_C,
  },
  {
    recoveryCode: sameOperationBody.identity.recoveryCode,
    recoveryOperationId: RECOVERY_OPERATION_D,
  },
] as const
const differentOperationRace = await Promise.all(
  differentOperationRequests.map((requestBody, index) => handleLeaderboardIdentityRequest(
    identityRequest(requestBody),
    env,
    'recover',
    () => differentOperationStartedAt + index,
  )),
)
assert.deepEqual(
  differentOperationRace.map(({ status: responseStatus }) => responseStatus).sort(),
  [200, 422],
)
const differentOperationBodies = await Promise.all(
  differentOperationRace.map((responseValue) => body(responseValue)),
)
const winnerIndex = differentOperationRace.findIndex(({ status: responseStatus }) => responseStatus === 200)
const loserIndex = winnerIndex === 0 ? 1 : 0
const finalRecoveredBody = differentOperationBodies[winnerIndex] as typeof discardedRecoveryBody
assert.equal(finalRecoveredBody.identity.recoveryVersion, 4)
assert.deepEqual(differentOperationBodies[loserIndex].error, genericRecoveryError)
const loserRetry = await handleLeaderboardIdentityRequest(
  identityRequest(differentOperationRequests[loserIndex]),
  env,
  'recover',
  () => differentOperationStartedAt + 2,
)
assert.equal(loserRetry.status, 422)
assert.deepEqual((await body(loserRetry)).error, genericRecoveryError)
assert.equal(
  sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM leaderboard_recovery_operations
    WHERE source_recovery_version = 3
  `).get().count,
  1,
)

sqlite.prepare(`
  UPDATE leaderboard_players
  SET identity_state = 'invalidated'
  WHERE player_id = 1
`).run()
const invalidatedRetry = await handleLeaderboardIdentityRequest(
  identityRequest(differentOperationRequests[winnerIndex]),
  env,
  'recover',
  () => differentOperationStartedAt + 3,
)
assert.equal(invalidatedRetry.status, 422)
assert.deepEqual((await body(invalidatedRetry)).error, genericRecoveryError)
sqlite.prepare(`
  UPDATE leaderboard_players
  SET identity_state = 'active'
  WHERE player_id = 1
`).run()

const caseRenameAt = renamedAt + LEADERBOARD_RENAME_COOLDOWN_MS
const caseRename = await handleLeaderboardIdentityRequest(
  identityRequest({
    deviceCredential: finalRecoveredBody.identity.deviceCredential,
    displayName: 'RENAMED ONE',
  }),
  env,
  'rename',
  () => caseRenameAt,
)
assert.equal(caseRename.status, 200)
assert.equal(
  sqlite.prepare('SELECT public_name_key FROM leaderboard_players WHERE player_id = 1').get().public_name_key,
  validateDisplayName('Renamed One')?.nameKey,
)

const raceA = await pendingClaim(sqlite, 'e')
const raceB = await pendingClaim(sqlite, 'f')
const raceResults = await Promise.all([
  handleLeaderboardIdentityRequest(
    identityRequest({ claimCapability: raceA.capability, displayName: 'Race Winner' }),
    env,
    'claim',
    () => NOW + 30_000,
  ),
  handleLeaderboardIdentityRequest(
    identityRequest({ claimCapability: raceB.capability, displayName: 'RACE WINNER' }),
    env,
    'claim',
    () => NOW + 30_000,
  ),
])
assert.deepEqual(raceResults.map(({ status }) => status).sort(), [201, 409])
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM leaderboard_players WHERE public_name_key = ?')
    .get(validateDisplayName('Race Winner')?.nameKey).count,
  1,
)

const status = await handleLeaderboardIdentityRequest(
  identityRequest({ deviceCredential: finalRecoveredBody.identity.deviceCredential }),
  env,
  'status',
  () => caseRenameAt,
)
assert.equal(status.status, 200)
const statusText = await status.text()
assert.doesNotMatch(statusText, /deviceCredential|recoveryCode|digest|playerId|runId/)
assert.match(statusText, /cumulativePerformance":false/)
assert.match(statusText, /recovery":true/)

const persistedRecoveryState = JSON.stringify({
  players: sqlite.prepare('SELECT * FROM leaderboard_players').all().map((row) => ({ ...row })),
  operations: sqlite.prepare('SELECT * FROM leaderboard_recovery_operations').all().map((row) => ({ ...row })),
  events: sqlite.prepare('SELECT * FROM leaderboard_identity_events').all().map((row) => ({ ...row })),
  claims: sqlite.prepare('SELECT * FROM leaderboard_identity_claims').all().map((row) => ({ ...row })),
})
for (const rawSecret of [
  claimedBody.identity.deviceCredential,
  claimedBody.identity.recoveryCode,
  secondClaimBody.identity.deviceCredential,
  secondClaimBody.identity.recoveryCode,
  recoveredBody.identity.deviceCredential,
  recoveredBody.identity.recoveryCode,
  sameOperationBody.identity.deviceCredential,
  sameOperationBody.identity.recoveryCode,
  finalRecoveredBody.identity.deviceCredential,
  finalRecoveredBody.identity.recoveryCode,
  RECOVERY_OPERATION_A,
  RECOVERY_OPERATION_B,
  RECOVERY_OPERATION_C,
  RECOVERY_OPERATION_D,
]) assert.equal(persistedRecoveryState.includes(rawSecret), false, rawSecret.slice(0, 5))
assert.doesNotMatch(persistedRecoveryState, /ppd1_|ppr1_|PP1-/)
assert.equal(
  sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM leaderboard_identity_events
    WHERE event_type = 'recovered'
  `).get().count,
  3,
)

const source = readFileSync('functions/lib/leaderboard-identity.ts', 'utf8')
assert.doesNotMatch(source, /\bconsole\.|\bMath\.random\b|SELECT \*|Authorization/)

sqlite.close()

console.log('Leaderboard identity tests passed: canonical 32-byte recovery operation IDs, structural Unicode names, database uniqueness, bound/idempotent claims, response-loss recovery retry, same/different-operation concurrency, rollback, expiry, cross-purpose rejection, rename cooldowns, historical relabeling, and secret redaction are verified.')
