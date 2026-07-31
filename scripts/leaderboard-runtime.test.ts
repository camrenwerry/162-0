import assert from 'node:assert/strict'
import {
  readStoredLeaderboardIdentity,
  removeLeaderboardIdentity,
  storeLeaderboardIdentity,
  type IdentityStorageReadResult,
} from '../src/features/leaderboard/identityStorage'
import {
  deriveRuntimeIdentityState,
  resolveRuntimeSubmissionIdentity,
  type RuntimeIdentityFeatureSnapshot,
  type RuntimeIdentityState,
} from '../src/features/leaderboard/runtimeIdentityState'
import {
  createRecoveryOperationId,
  PennantApi,
  playerFacingApiMessage,
} from '../src/features/leaderboard/pennantApi'
import type { DraftTranscript } from '../src/game/DraftTranscript'
import { createPublicLeaderboardEntryStableKey } from '../src/features/leaderboard/leaderboardRuntimeModel'
import { importLazyRoute, isObsoleteLazyChunkError } from '../src/utils/lazyRoute'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const NOW = '2026-07-30T20:00:00.000Z'
const CREDENTIAL = `ppd1_${'A'.repeat(43)}`
const CLAIM = `ppc1_${'B'.repeat(43)}`
const RECOVERY = 'PP1-2345-6789-ABCD-EFGH-JKMP-QRST-VWXY'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

const storage = new MemoryStorage()
const stored = storeLeaderboardIdentity({
  deviceCredential: CREDENTIAL,
  displayName: 'Player Cedar',
  recoveryVersion: 2,
}, storage, () => new Date(NOW))
assert.equal(stored.kind, 'stored')
assert.equal(storage.values.size, 1)
const serializedIdentity = [...storage.values.values()][0]
assert.match(serializedIdentity, /"version":1/)
assert.doesNotMatch(serializedIdentity, /PP1-|recoveryCode|claimCapability|ticket/)
assert.equal(readStoredLeaderboardIdentity(storage).kind, 'ready')
storage.setItem([...storage.values.keys()][0], '{')
assert.equal(readStoredLeaderboardIdentity(storage).kind, 'corrupt')
storage.setItem([...storage.values.keys()][0], JSON.stringify({ version: 2 }))
assert.equal(readStoredLeaderboardIdentity(storage).kind, 'outdated')
assert.equal(storeLeaderboardIdentity({
  deviceCredential: 'malformed',
  displayName: 'Player Cedar',
  recoveryVersion: 1,
}, storage).kind, 'invalid')
const unavailableStorage = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('blocked') },
  removeItem() { throw new Error('blocked') },
}
assert.equal(readStoredLeaderboardIdentity(unavailableStorage).kind, 'unavailable')
assert.equal(storeLeaderboardIdentity({
  deviceCredential: CREDENTIAL,
  displayName: 'Player Cedar',
  recoveryVersion: 1,
}, unavailableStorage).kind, 'unavailable')
assert.equal(removeLeaderboardIdentity(unavailableStorage), 'unavailable')
assert.equal(removeLeaderboardIdentity(storage), 'removed')
assert.equal(removeLeaderboardIdentity({
  getItem: () => 'still-present',
  removeItem: () => undefined,
}), 'unavailable')

assert.equal(stored.kind, 'stored')
if (stored.kind !== 'stored') throw new Error('Runtime identity fixture must be stored.')
const identityFeatures = (
  overrides: Partial<RuntimeIdentityFeatureSnapshot> = {},
): RuntimeIdentityFeatureSnapshot => ({
  submission: false,
  identityClaim: false,
  identityStatus: false,
  identityRename: false,
  recovery: false,
  ...overrides,
})
const storageStates = [
  { kind: 'missing' },
  { kind: 'corrupt' },
  { kind: 'outdated' },
  { kind: 'unavailable' },
] as const satisfies readonly IdentityStorageReadResult[]
for (const storageState of storageStates) {
  const derived = deriveRuntimeIdentityState(
    storageState,
    identityFeatures({ submission: true, identityClaim: true }),
  )
  assert.equal(
    derived.kind,
    storageState.kind,
    `${storageState.kind} continuity must survive claim/submission with status disabled`,
  )
}
const localWithoutStatus = deriveRuntimeIdentityState(
  { kind: 'ready', identity: stored.identity },
  identityFeatures({ identityRename: true }),
)
assert.equal(localWithoutStatus.kind, 'local')
assert.equal(
  resolveRuntimeSubmissionIdentity(localWithoutStatus).kind,
  'credential',
  'valid local identity remains attributable and rename-capable without status',
)
const checkingWithStatus = deriveRuntimeIdentityState(
  { kind: 'ready', identity: stored.identity },
  identityFeatures({ identityStatus: true }),
)
assert.equal(checkingWithStatus.kind, 'checking')
assert.equal(resolveRuntimeSubmissionIdentity(checkingWithStatus).kind, 'checking')
const missingForSubmission = deriveRuntimeIdentityState(
  { kind: 'missing' },
  identityFeatures({ submission: true }),
)
assert.equal(missingForSubmission.kind, 'missing')
assert.equal(
  resolveRuntimeSubmissionIdentity(missingForSubmission).kind,
  'anonymous',
  'only genuinely missing continuity may submit anonymously',
)
const disabledIdentity = deriveRuntimeIdentityState(
  { kind: 'corrupt' },
  identityFeatures(),
)
assert.equal(disabledIdentity.kind, 'disabled')
assert.deepEqual(resolveRuntimeSubmissionIdentity(disabledIdentity), {
  kind: 'blocked',
  reason: 'disabled',
})
const recoveryOnlyMissing = deriveRuntimeIdentityState(
  { kind: 'missing' },
  identityFeatures({ recovery: true }),
)
assert.equal(recoveryOnlyMissing.kind, 'missing')
for (const blockedState of [
  { kind: 'corrupt' },
  { kind: 'outdated' },
  { kind: 'unavailable' },
  { kind: 'invalid' },
] as const satisfies readonly RuntimeIdentityState[]) {
  assert.deepEqual(resolveRuntimeSubmissionIdentity(blockedState), {
    kind: 'blocked',
    reason: blockedState.kind,
  })
}

const recoveryOperation = createRecoveryOperationId((bytes) => {
  bytes.fill(7)
  return bytes
})
assert.match(recoveryOperation, /^ppr1_[A-Za-z0-9_-]{43}$/)

const ticketPayload = {
  ok: true,
  ticket: {
    value: 'T'.repeat(32),
    ticketId: '12345678-1234-4123-8123-123456789abc',
    draftSeed: `seeded-v1:${'a'.repeat(32)}`,
    issuedAt: Date.parse(NOW),
    expiresAt: Date.parse(NOW) + 900_000,
    gameMode: 'classic',
  },
}
const periodPlacement = {
  qualifies: true,
  rank: 4,
  displacedPriorEntry: false,
  cutoff: { projectedWins: 90, overallScore: 72.5 },
  proximity: null,
}
const submissionPayload = {
  ok: true,
  verified: true,
  submitted: true,
  submissionSchema: 'pennant-draft-submission-v1',
  submittedAt: NOW,
  result: {
    projectedWins: 101,
    projectedLosses: 61,
    overallScore: 81.2,
    overallGrade: 'A-',
    tier: 'Pennant contender',
  },
  leaderboard: {
    schemaVersion: 'pennant-leaderboard-placement-v1',
    snapshotAt: NOW,
    periods: { daily: periodPlacement, weekly: periodPlacement, 'all-time': periodPlacement },
    newPersonalBest: true,
    identity: { setupRequired: true, reason: 'qualifying_run_requires_identity' },
    capabilities: { bestRun: true, cumulativePerformance: false },
    claim: { state: 'available', capability: CLAIM, expiresAt: '2026-07-30T20:15:00.000Z' },
  },
}
const leaderboardPayload = {
  ok: true,
  schemaVersion: 'pennant-leaderboard-response-v2',
  generatedAt: NOW,
  board: {
    mode: 'classic',
    period: 'daily',
    rankingFamily: 'best-run',
    rankPolicy: 'competition-shared',
  },
  entries: [{
    rank: 1,
    playerLabel: 'Player Cedar',
    projectedWins: 101,
    overallScore: 81.2,
    tier: 'Pennant contender',
    submittedAt: NOW,
    mode: 'classic',
  }],
  page: { limit: 25, nextCursor: 'cursor-one' },
}
const stableEntryKey = createPublicLeaderboardEntryStableKey(leaderboardPayload.entries[0])
assert.equal(stableEntryKey, createPublicLeaderboardEntryStableKey(leaderboardPayload.entries[0]))
assert.notEqual(stableEntryKey, createPublicLeaderboardEntryStableKey({
  ...leaderboardPayload.entries[0],
  submittedAt: '2026-07-30T20:01:00.000Z',
}))
assert.doesNotMatch(stableEntryKey, /ago|Today|Yesterday/, 'presentation time labels must not define row identity')
const identityPayload = {
  ok: true,
  schemaVersion: 'pennant-leaderboard-identity-v1',
  identity: {
    displayName: 'Player Cedar',
    renameEligible: false,
    nextEligibleRenameAt: '2026-08-29T20:00:00.000Z',
    recoveryVersion: 2,
  },
}
const claimPayload = {
  ok: true,
  schemaVersion: 'pennant-leaderboard-identity-v1',
  identity: {
    displayName: 'Player Cedar',
    deviceCredential: CREDENTIAL,
    recoveryCode: RECOVERY,
    recoveryCodeMustBeStored: true,
    recoveryVersion: 2,
  },
}

const requests: Request[] = []
const responses = [
  json(ticketPayload),
  json(submissionPayload, 201),
  json(submissionPayload, 200),
  json(leaderboardPayload),
  json({ ...identityPayload, displayName: 'Player Cedar', available: true }),
  json(claimPayload, 201),
  json(identityPayload),
  json(identityPayload),
  json({ ...claimPayload, idempotentRetry: true, recoveryRetryExpiresAt: '2026-07-30T20:15:00.000Z' }),
]
const api = new PennantApi(async (input, init) => {
  requests.push(new Request(new URL(String(input), 'https://local.example'), init))
  const response = responses.shift()
  assert(response, 'unexpected API call')
  return response
})

assert.equal((await api.requestDraftTicket()).ok, true)
const firstSubmit = await api.submitDraft('T'.repeat(32), {} as DraftTranscript, null)
assert.equal(firstSubmit.ok && firstSubmit.value.idempotentRetry, false)
const retrySubmit = await api.submitDraft('T'.repeat(32), {} as DraftTranscript, CREDENTIAL)
assert.equal(retrySubmit.ok && retrySubmit.value.idempotentRetry, true)
const board = await api.readLeaderboard('daily', null)
assert.equal(board.ok && board.value.nextCursor, 'cursor-one')
assert.equal((await api.checkDisplayName('Player Cedar')).ok, true)
assert.equal((await api.claimIdentity(CLAIM, 'Player Cedar')).ok, true)
assert.equal((await api.identityStatus(CREDENTIAL)).ok, true)
assert.equal((await api.renameIdentity(CREDENTIAL, 'Player Cedar')).ok, true)
assert.equal((await api.recoverIdentity(RECOVERY, recoveryOperation)).ok, true)
assert.equal(requests.length, 9)
assert.equal(new URL(requests[3].url).searchParams.get('cursor'), null)
assert.equal(new URL(requests[3].url).searchParams.get('period'), 'daily')
assert.deepEqual(await requests[1].json(), {
  ticket: 'T'.repeat(32),
  transcript: {},
  identityCredential: null,
})
assert.equal(requests.every((request) => request.credentials === 'same-origin'), true)

let calls = 0
const conflictApi = new PennantApi(async () => {
  calls += 1
  return json({
    ok: false,
    error: { code: 'draft_ticket_already_consumed', message: 'sensitive backend detail' },
  }, 409)
})
const conflict = await conflictApi.submitDraft('T'.repeat(32), {} as DraftTranscript, null)
assert.equal(conflict.ok, false)
assert.equal(!conflict.ok && conflict.error.kind, 'conflict')
assert.equal(calls, 1, 'mutations must not retry automatically')
assert.doesNotMatch(JSON.stringify(conflict), /sensitive|ticket|transcript/)

const rateLimited = new PennantApi(async () => json({
  ok: false,
  error: { code: 'rate_limited', message: 'wait' },
}, 429, { 'Retry-After': '12' }))
const limited = await rateLimited.readLeaderboard('weekly', null)
assert.equal(!limited.ok && limited.error.kind, 'rate-limited')
assert.equal(!limited.ok && limited.error.retryAfterSeconds, 12)

const incompatible = await new PennantApi(async () => json({
  ...leaderboardPayload,
  schemaVersion: 'future-schema',
})).readLeaderboard('daily', null)
assert.equal(!incompatible.ok && incompatible.error.kind, 'incompatible')
const wrongPeriod = await new PennantApi(async () => json({
  ...leaderboardPayload,
  board: { ...leaderboardPayload.board, period: 'weekly' },
})).readLeaderboard('daily', null)
assert.equal(!wrongPeriod.ok && wrongPeriod.error.kind, 'incompatible')
const impossibleWins = await new PennantApi(async () => json({
  ...leaderboardPayload,
  entries: [{ ...leaderboardPayload.entries[0], projectedWins: 163 }],
})).readLeaderboard('daily', null)
assert.equal(!impossibleWins.ok && impossibleWins.error.kind, 'incompatible')
const oversized = await new PennantApi(async () => new Response(
  new Uint8Array(128 * 1024 + 1),
  { headers: JSON_HEADERS },
)).readLeaderboard('daily', null)
assert.equal(!oversized.ok && oversized.error.kind, 'incompatible')

const neverResolvingApi = new PennantApi(
  async () => new Promise<Response>(() => undefined),
  { leaderboard: 5 },
)
const fetchDeadlineStarted = Date.now()
const fetchDeadline = await neverResolvingApi.readLeaderboard('daily', null)
assert.equal(!fetchDeadline.ok && fetchDeadline.error.kind, 'timeout')
assert(Date.now() - fetchDeadlineStarted < 250, 'a fetcher that ignores abort must still resolve at the client deadline')

let bodyCancelled = false
const neverEndingBodyApi = new PennantApi(async () => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('{"ok":'))
  },
  cancel() {
    bodyCancelled = true
  },
}), { headers: JSON_HEADERS }), { leaderboard: 5 })
const bodyDeadline = await neverEndingBodyApi.readLeaderboard('daily', null)
assert.equal(!bodyDeadline.ok && bodyDeadline.error.kind, 'timeout')
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(bodyCancelled, true, 'deadline abort must cancel a stalled response reader')

const callerController = new AbortController()
const callerAbortApi = new PennantApi(async () => new Promise<Response>(() => undefined), { leaderboard: 1_000 })
const callerRequest = callerAbortApi.readLeaderboard('daily', null, callerController.signal)
callerController.abort()
const callerAborted = await callerRequest
assert.equal(!callerAborted.ok && callerAborted.error.kind, 'aborted')

const offlineNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
const offline = await new PennantApi(async () => { throw new TypeError('network unavailable') })
  .readLeaderboard('all-time', null)
assert.equal(!offline.ok && offline.error.kind, 'offline')
if (offlineNavigator) Object.defineProperty(globalThis, 'navigator', offlineNavigator)
else Reflect.deleteProperty(globalThis, 'navigator')

assert.match(playerFacingApiMessage({ kind: 'expired-ticket', retryAfterSeconds: null }, 'submission'), /cannot be submitted/)
assert.match(playerFacingApiMessage({ kind: 'disabled', retryAfterSeconds: null }, 'recovery'), /not available/)
assert.match(playerFacingApiMessage({ kind: 'cooldown', retryAfterSeconds: null }, 'identity'), /eligibility date/)
assert.match(playerFacingApiMessage({ kind: 'timeout', retryAfterSeconds: null }, 'submission'), /local result is safe/)

const chunkFailure = new TypeError('Failed to fetch dynamically imported module: https://local.example/assets/old.js')
assert.equal(isObsoleteLazyChunkError(chunkFailure), true)
assert.equal(isObsoleteLazyChunkError(new Error('ordinary component failure')), false)
assert.equal(isObsoleteLazyChunkError(new TypeError('Network request failed')), false)
const chunkRecoveryValues = new Map<string, string>()
const chunkRecoveryStorage = {
  getItem(key: string) { return chunkRecoveryValues.get(key) ?? null },
  setItem(key: string, value: string) { chunkRecoveryValues.set(key, value) },
}
let chunkReloads = 0
let serviceWorkerUpdates = 0
void importLazyRoute(async () => { throw chunkFailure }, {
  version: 'test-build',
  storage: chunkRecoveryStorage,
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => { serviceWorkerUpdates += 1 },
  recoveryDeadlineMs: 100,
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(chunkReloads, 1)
assert.equal(serviceWorkerUpdates, 1)
await assert.rejects(() => importLazyRoute(async () => { throw chunkFailure }, {
  version: 'test-build',
  storage: chunkRecoveryStorage,
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => { serviceWorkerUpdates += 1 },
  recoveryDeadlineMs: 100,
}), /dynamically imported module/)
assert.equal(chunkReloads, 1, 'obsolete chunks may trigger at most one automatic reload per version and session')
await assert.rejects(() => importLazyRoute(async () => { throw new Error('ordinary component failure') }, {
  version: 'test-build',
  storage: chunkRecoveryStorage,
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => { serviceWorkerUpdates += 1 },
}), /ordinary component failure/)
assert.equal(chunkReloads, 1, 'ordinary component failures must not trigger update recovery')
await assert.rejects(() => importLazyRoute(async () => { throw chunkFailure }, {
  version: 'storage-failure-build',
  storage: {
    getItem() { throw new Error('storage unavailable') },
    setItem() { throw new Error('storage unavailable') },
  },
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => { serviceWorkerUpdates += 1 },
  recoveryDeadlineMs: 100,
}), /dynamically imported module/)
assert.equal(chunkReloads, 1, 'unavailable session storage must fall through without a reload loop')

const updateFailureValues = new Map<string, string>()
let failedUpdateAttempts = 0
await assert.rejects(() => importLazyRoute(async () => { throw chunkFailure }, {
  version: 'update-failure-build',
  storage: {
    getItem(key: string) { return updateFailureValues.get(key) ?? null },
    setItem(key: string, value: string) { updateFailureValues.set(key, value) },
  },
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => {
    failedUpdateAttempts += 1
    throw new Error('local update failure')
  },
  recoveryDeadlineMs: 100,
}), /dynamically imported module/)
assert.equal(failedUpdateAttempts, 1)
assert.equal(chunkReloads, 1, 'a failed service-worker update must not reload')
await assert.rejects(() => importLazyRoute(async () => { throw chunkFailure }, {
  version: 'update-failure-build',
  storage: {
    getItem(key: string) { return updateFailureValues.get(key) ?? null },
    setItem(key: string, value: string) { updateFailureValues.set(key, value) },
  },
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => { failedUpdateAttempts += 1 },
  recoveryDeadlineMs: 100,
}), /dynamically imported module/)
assert.equal(failedUpdateAttempts, 1, 'a failed update may be attempted only once per version and session')

const hangingUpdateValues = new Map<string, string>()
const hangingStartedAt = Date.now()
await assert.rejects(() => importLazyRoute(async () => { throw chunkFailure }, {
  version: 'hanging-update-build',
  storage: {
    getItem(key: string) { return hangingUpdateValues.get(key) ?? null },
    setItem(key: string, value: string) { hangingUpdateValues.set(key, value) },
  },
  reload: () => { chunkReloads += 1 },
  requestServiceWorkerUpdate: async () => new Promise<void>(() => undefined),
  recoveryDeadlineMs: 5,
}), /dynamically imported module/)
assert(Date.now() - hangingStartedAt < 250, 'service-worker readiness must have a bounded deadline')
assert.equal(chunkReloads, 1, 'a replacement worker that never becomes ready must not reload')

console.log('Leaderboard runtime tests passed: typed contracts, schema rejection, exact retry classification, composed abort/deadline handling, stalled-body cancellation, storage validation/failure, recovery-operation entropy shape, error normalization, and secret-free client failures are verified.')
