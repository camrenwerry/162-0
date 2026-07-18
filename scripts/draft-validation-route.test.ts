import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import fixed113Data from './fixtures/transcripts/fixed-113.json'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import allTime145Data from './fixtures/transcripts/all-time-145.json'
import { handleApiNotFoundRequest } from '../functions/api/[[path]]'
import { handleHealthRequest } from '../functions/api/v1/health'
import {
  draftTicketMatchesTranscript,
  handleAuthoritativeValidationRequest,
} from '../workers/draft-validation/src/authoritative-validation'
import {
  DRAFT_VALIDATION_ERROR_DEFINITIONS,
  type DraftValidationErrorCode,
} from '../functions/lib/api-response'
import { MAX_DRAFT_VALIDATION_BODY_BYTES } from '../functions/lib/bounded-json'
import type { BackendEnv } from '../functions/lib/env'
import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../src/config/versions'
import { PLAYER_CARDS } from '../src/data/generated'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from '../src/game/DraftTranscript'
import {
  CURRENT_CANONICAL_DRAFT_DATA,
  CURRENT_REPLAY_VERSION_SUPPORT,
  replayDraft,
} from '../src/game/ReplayDraft'
import { calculateDraftResult } from '../src/game/scoring'
import { replayDraftWithCatalog } from '../src/game/replay/replayDraft'
import { createWorkerReplayCatalog } from '../src/game/replay/WorkerCatalog'
import { validateTranscriptShape } from '../src/game/replay/validateTranscript'
import { ROSTER_SLOTS, type Player, type Position } from '../src/types/draft'
import {
  createBoundValidationFixture,
  TEST_DRAFT_TICKET_SIGNING_KEY,
} from './lib/draft-ticket-fixtures'
import {
  DRAFT_TICKET_GAME_MODE,
  DRAFT_TICKET_MAX_CLOCK_SKEW_MS,
  DRAFT_TICKET_TTL_MS,
  type DraftTicketPayload,
} from '../functions/lib/draft-ticket'

const ENDPOINT = 'https://preview.example.test/api/v1/validate-draft'
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const enabledEnv = {
  DRAFT_VALIDATION_MODE: 'enabled',
  DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY,
} as BackendEnv
const disabledEnv = { DRAFT_VALIDATION_MODE: 'disabled' } as BackendEnv

const expectedPublicErrors = {
  not_found: [404, 'API route not found'],
  rate_limited: [429, 'Too Many Requests'],
  method_not_allowed: [405, 'Method Not Allowed'],
  origin_not_allowed: [403, 'Request origin is not allowed.'],
  unsupported_media_type: [415, 'Request must use application/json without content encoding.'],
  payload_too_large: [413, 'Request body exceeds the allowed size.'],
  malformed_json: [400, 'Request body must contain valid JSON.'],
  invalid_request_schema: [400, 'Request does not match the required schema.'],
  invalid_draft_ticket: [422, 'Draft ticket is invalid or expired.'],
  draft_ticket_mismatch: [422, 'Draft ticket does not match the submitted draft.'],
  unsupported_transcript_version: [422, 'Transcript schema version is not supported.'],
  unsupported_app_version: [422, 'Application version is not supported.'],
  unsupported_rng_version: [422, 'RNG version is not supported.'],
  unsupported_rules_version: [422, 'Game rules version is not supported.'],
  unsupported_scoring_version: [422, 'Scoring version is not supported.'],
  unsupported_data_version: [422, 'Data version is not supported.'],
  canonical_data_mismatch: [422, 'Canonical game data does not match.'],
  invalid_seed: [422, 'Gameplay seed is invalid.'],
  invalid_roll_sequence: [422, 'Draft roll sequence is invalid.'],
  invalid_reroll: [422, 'Draft reroll sequence is invalid.'],
  invalid_card: [422, 'Draft card is invalid.'],
  wrong_pool: [422, 'Draft card does not belong to the required pool.'],
  invalid_position: [422, 'Draft position assignment is invalid.'],
  duplicate_card: [422, 'Draft contains a duplicate canonical card.'],
  incomplete_roster: [422, 'Draft roster is incomplete.'],
  unexpected_event_order: [422, 'Draft events are not in the required order.'],
  scoring_failed: [500, 'Authoritative scoring failed.'],
  temporarily_unavailable: [503, 'Draft validation is temporarily unavailable.'],
} as const satisfies Record<DraftValidationErrorCode, readonly [number, string]>

for (const [code, [status, message]] of Object.entries(expectedPublicErrors)) {
  assert.deepEqual(DRAFT_VALIDATION_ERROR_DEFINITIONS[code as DraftValidationErrorCode], { status, message })
}
assert.equal(SCORING_VERSION, '2.3')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface MutableTranscript {
  header: Record<string, unknown>
  events: Record<string, unknown>[]
}

function mutableTranscript(source: unknown): MutableTranscript {
  const candidate: unknown = structuredClone(source)
  if (
    !isRecord(candidate)
    || !isRecord(candidate.header)
    || !Array.isArray(candidate.events)
    || !candidate.events.every(isRecord)
  ) throw new TypeError('Fixture transcript is malformed.')
  return { header: candidate.header, events: candidate.events }
}

function jsonRequest(
  body: unknown,
  options: { method?: string, headers?: Record<string, string>, origin?: string } = {},
) {
  const headers = new Headers({ ...JSON_HEADERS, ...options.headers })
  if (options.origin) headers.set('Origin', options.origin)
  return new Request(ENDPOINT, {
    method: options.method ?? 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function rawRequest(body: BodyInit, headers: Record<string, string> = JSON_HEADERS) {
  return new Request(ENDPOINT, { method: 'POST', headers, body })
}

async function responseBody(response: Response) {
  const body: unknown = await response.json()
  assert(isRecord(body))
  return body
}

function assertJsonHeaders(response: Response) {
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(response.headers.get('Set-Cookie'), null)
}

async function assertError(
  response: Response,
  code: DraftValidationErrorCode,
  forbidden: RegExp = /(?:stack|database|sql|seeded-v1:|signature|ticketId|test-only-draft-ticket-signing-key)/i,
) {
  const [status, message] = expectedPublicErrors[code]
  assert.equal(response.status, status, code)
  assertJsonHeaders(response)
  const body = await response.text()
  assert.deepEqual(JSON.parse(body), {
    ok: false,
    verified: false,
    error: { code, message },
  })
  assert.doesNotMatch(body, forbidden)
}

const fixtures = [fixed113Data, noRerollsData, twoRerollsData, allTime145Data] as const
const expectedRecords = [[113, 49], [103, 59], [101, 61], [145, 17]] as const
for (const [index, fixture] of fixtures.entries()) {
  const untrustedTranscript: unknown = fixture.transcript
  validateTranscriptShape(untrustedTranscript)
  const localResult = calculateDraftResult(replayDraft(
    untrustedTranscript,
    CURRENT_CANONICAL_DRAFT_DATA,
    CURRENT_REPLAY_VERSION_SUPPORT,
  )).result
  const bound = await createBoundValidationFixture(fixture.transcript)
  const response = await handleAuthoritativeValidationRequest(jsonRequest({ ticket: bound.ticket, transcript: bound.transcript }), enabledEnv)
  assert.equal(response.status, 200, fixture.label)
  assertJsonHeaders(response)
  const body = await responseBody(response)
  assert.deepEqual(Object.keys(body), ['ok', 'verified', 'versions', 'result'])
  assert.equal(body.ok, true)
  assert.equal(body.verified, true)
  assert.deepEqual(body.versions, {
    transcriptSchema: TRANSCRIPT_SCHEMA_VERSION,
    app: APP_VERSION,
    gameRules: GAME_RULES_VERSION,
    rng: RNG_VERSION,
    scoring: SCORING_VERSION,
    data: DATA_VERSION,
    canonicalDataDigest: DATA_DIGEST,
  })
  assert(isRecord(body.result))
  assert.deepEqual(Object.keys(body.result), [
    'projectedWins', 'projectedLosses', 'overallScore', 'overallGrade', 'tier',
    'categories', 'strongestCategory', 'weakestCategory', 'roster',
  ])
  assert.deepEqual([body.result.projectedWins, body.result.projectedLosses], expectedRecords[index])
  assert.deepEqual([body.result.projectedWins, body.result.projectedLosses], [localResult.wins, localResult.losses])
  assert.equal(body.result.overallScore, fixture.expected.overallScore)
  assert.equal(body.result.overallScore, localResult.overallScore)
  assert.equal(body.result.overallGrade, fixture.expected.overallGrade)
  assert.equal(body.result.tier, fixture.expected.tierLabel)
  assert.equal(body.result.strongestCategory, fixture.expected.strongestCategory)
  assert.equal(body.result.weakestCategory, fixture.expected.weakestCategory)
  assert(isRecord(body.result.categories))
  assert.deepEqual(Object.keys(body.result.categories), [
    'offense', 'defense', 'startingPitching', 'reliefPitching', 'rosterBalance',
  ])
  for (const category of Object.keys(body.result.categories)) {
    const publicCategory = body.result.categories[category]
    assert(isRecord(publicCategory))
    assert.deepEqual(Object.keys(publicCategory), ['score', 'grade'])
    const expectedCategory = category as keyof typeof fixture.expected.categoryScores
    assert.equal(publicCategory.score, fixture.expected.categoryScores[expectedCategory])
    assert.equal(publicCategory.grade, fixture.expected.categoryGrades[expectedCategory])
  }
  assert(Array.isArray(body.result.roster))
  assert.equal(body.result.roster.length, ROSTER_SLOTS.length)
  assert.deepEqual(body.result.roster.map((player) => isRecord(player) ? player.slot : null), ROSTER_SLOTS.map(({ id }) => id))
  for (const [rosterIndex, rosterValue] of body.result.roster.entries()) {
    assert(isRecord(rosterValue))
    assert.deepEqual(Object.keys(rosterValue), [
      'slot', 'assignedPosition', 'canonicalCardId', 'playerName', 'featuredSeason',
      'franchiseId', 'team', 'decade',
    ])
    const rosterSlot = ROSTER_SLOTS[rosterIndex]
    assert.equal(rosterValue.assignedPosition, rosterSlot.position)
    assert.equal(rosterValue.canonicalCardId, fixture.expected.roster[rosterSlot.id].canonicalCardId)
    assert.equal(typeof rosterValue.playerName, 'string')
    assert.equal(typeof rosterValue.featuredSeason, 'number')
    assert.equal(typeof rosterValue.franchiseId, 'string')
    assert.equal(typeof rosterValue.team, 'string')
    assert.match(String(rosterValue.decade), /^\d{4}s$/)
  }
  const serialized = JSON.stringify(body)
  assert.doesNotMatch(serialized, /"(?:power|contact|speed|stats|diagnostics|transcript|gameplaySeed|seed)"/)
}

const ticketGateFixture = await createBoundValidationFixture(fixed113Data.transcript)
const validTicketEnvelope = { ticket: ticketGateFixture.ticket, transcript: ticketGateFixture.transcript }
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ transcript: ticketGateFixture.transcript }), enabledEnv),
  'invalid_request_schema',
)
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ ticket: 'not-a-ticket', transcript: ticketGateFixture.transcript }), enabledEnv),
  'invalid_draft_ticket',
)
const alteredTicket = `${ticketGateFixture.ticket.slice(0, -1)}${ticketGateFixture.ticket.endsWith('a') ? 'b' : 'a'}`
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ ticket: alteredTicket, transcript: ticketGateFixture.transcript }), enabledEnv),
  'invalid_draft_ticket',
)
const wrongKeyFixture = await createBoundValidationFixture(fixed113Data.transcript, { signingKey: 'wrong-test-signing-key' })
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ ticket: wrongKeyFixture.ticket, transcript: wrongKeyFixture.transcript }), enabledEnv),
  'invalid_draft_ticket',
)
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest(validTicketEnvelope), { DRAFT_VALIDATION_MODE: 'enabled' }),
  'temporarily_unavailable',
)
const expiredFixture = await createBoundValidationFixture(fixed113Data.transcript, {
  issuedAt: Date.now() - DRAFT_TICKET_TTL_MS,
})
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ ticket: expiredFixture.ticket, transcript: expiredFixture.transcript }), enabledEnv),
  'invalid_draft_ticket',
)
const futureFixture = await createBoundValidationFixture(fixed113Data.transcript, {
  issuedAt: Date.now() + DRAFT_TICKET_MAX_CLOCK_SKEW_MS + 1_000,
})
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ ticket: futureFixture.ticket, transcript: futureFixture.transcript }), enabledEnv),
  'invalid_draft_ticket',
)

const bindingMismatchCases: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
  ['ticket ID', { draftId: '22222222-2222-4222-8222-222222222222' }],
  ['gameplay seed', { gameplaySeed: 'seeded-v1:11111111111111111111111111111111' }],
  ['creation time', { createdAt: new Date(ticketGateFixture.payload.issuedAt + 1).toISOString() }],
]
for (const [, transcriptHeaderOverrides] of bindingMismatchCases) {
  const mismatch = await createBoundValidationFixture(fixed113Data.transcript, { transcriptHeaderOverrides })
  await assertError(
    await handleAuthoritativeValidationRequest(jsonRequest({ ticket: mismatch.ticket, transcript: mismatch.transcript }), enabledEnv),
    'draft_ticket_mismatch',
  )
}

const invalidClaimCases: ReadonlyArray<readonly [keyof DraftTicketPayload, string]> = [
  ['ticketSchemaVersion', 'unsupported-ticket'],
  ['appVersion', 'unsupported-app'],
  ['gameRulesVersion', 'unsupported-rules'],
  ['rngVersion', 'unsupported-rng'],
  ['scoringVersion', 'unsupported-scoring'],
  ['dataVersion', 'unsupported-data'],
  ['transcriptSchemaVersion', 'unsupported-transcript'],
  ['canonicalDataDigest', '0'.repeat(64)],
  ['gameMode', 'unsupported-mode'],
]
for (const [field, value] of invalidClaimCases) {
  const invalidClaim = await createBoundValidationFixture(fixed113Data.transcript, {
    bindTranscriptToTicket: false,
    payloadOverrides: { [field]: value },
  })
  await assertError(
    await handleAuthoritativeValidationRequest(jsonRequest({ ticket: invalidClaim.ticket, transcript: invalidClaim.transcript }), enabledEnv),
    'invalid_draft_ticket',
  )
}

const directBindingCases = [
  ['ticketId', 'draftId'],
  ['draftSeed', 'gameplaySeed'],
  ['appVersion', 'appVersion'],
  ['gameRulesVersion', 'gameRulesVersion'],
  ['rngVersion', 'rngVersion'],
  ['scoringVersion', 'scoringVersion'],
  ['dataVersion', 'dataVersion'],
  ['canonicalDataDigest', 'canonicalDataDigest'],
  ['transcriptSchemaVersion', 'transcriptSchemaVersion'],
] as const
for (const [, headerField] of directBindingCases) {
  const changed = structuredClone(ticketGateFixture.transcript)
  changed.header[headerField] = `${changed.header[headerField]}-changed` as never
  assert.equal(draftTicketMatchesTranscript(ticketGateFixture.payload, changed), false, `${headerField} must be bound`)
}
const changedTime = structuredClone(ticketGateFixture.transcript)
changedTime.header.createdAt = new Date(ticketGateFixture.payload.issuedAt + 1).toISOString()
assert.equal(draftTicketMatchesTranscript(ticketGateFixture.payload, changedTime), false, 'createdAt must be bound')
assert.equal(draftTicketMatchesTranscript({ ...ticketGateFixture.payload, gameMode: 'other' }, ticketGateFixture.transcript), false, 'game mode must be authoritative')
assert.equal(ticketGateFixture.payload.gameMode, DRAFT_TICKET_GAME_MODE)

const invalidBeforeReplay = structuredClone(ticketGateFixture.transcript)
invalidBeforeReplay.header.draftId = '22222222-2222-4222-8222-222222222222'
invalidBeforeReplay.events[0].combinationId = 'ana-1960s'
await assertError(
  await handleAuthoritativeValidationRequest(jsonRequest({ ticket: ticketGateFixture.ticket, transcript: invalidBeforeReplay }), enabledEnv),
  'draft_ticket_mismatch',
)

const duplicateTicketKey = `{"ticket":${JSON.stringify(ticketGateFixture.ticket)},"ticket":${JSON.stringify(ticketGateFixture.ticket)},"transcript":${JSON.stringify(ticketGateFixture.transcript)}}`
await assertError(await handleAuthoritativeValidationRequest(rawRequest(duplicateTicketKey), enabledEnv), 'invalid_request_schema')

const workerCatalog = createWorkerReplayCatalog()
const canonicalById = new Map(PLAYER_CARDS.map((player) => [player.id, player]))
function duplicatePersonVariant(source: DraftTranscript) {
  const indexedPicks = source.events.flatMap((event, index) => event.type === 'pick' ? [{ event, index }] : [])
  const supportsPosition = (player: Player, position: Position) => (
    position === 'DH' ? player.type === 'hitter' || player.isTwoWay : player.eligiblePositions.includes(position)
  )
  for (let leftIndex = 0; leftIndex < indexedPicks.length; leftIndex += 1) {
    const left = indexedPicks[leftIndex]
    const leftPlayers = CURRENT_CANONICAL_DRAFT_DATA.playerPools[left.event.combinationId]
      .filter((player) => supportsPosition(player, left.event.assignedPosition))
    for (let rightIndex = leftIndex + 1; rightIndex < indexedPicks.length; rightIndex += 1) {
      const right = indexedPicks[rightIndex]
      const rightPlayers = CURRENT_CANONICAL_DRAFT_DATA.playerPools[right.event.combinationId]
        .filter((player) => supportsPosition(player, right.event.assignedPosition))
      for (const leftPlayer of leftPlayers) {
        const rightPlayer = rightPlayers.find((player) => player.playerId === leftPlayer.playerId && player.id !== leftPlayer.id)
        if (!rightPlayer || !canonicalById.has(leftPlayer.id) || !canonicalById.has(rightPlayer.id)) continue
        const candidate = mutableTranscript(source)
        Object.assign(candidate.events[left.index], {
          canonicalCardId: leftPlayer.id,
          sourcePlayerId: leftPlayer.playerId,
          featuredSeason: leftPlayer.featuredSeason,
        })
        Object.assign(candidate.events[right.index], {
          canonicalCardId: rightPlayer.id,
          sourcePlayerId: rightPlayer.playerId,
          featuredSeason: rightPlayer.featuredSeason,
        })
        try {
          validateTranscriptShape(candidate)
          replayDraftWithCatalog(candidate, workerCatalog, CURRENT_REPLAY_VERSION_SUPPORT)
          return candidate
        } catch {
          // Deterministically continue until both legal canonical cards fit the replayed roster.
        }
      }
    }
  }
  return null
}

const duplicatePerson = fixtures
  .map(({ transcript }) => duplicatePersonVariant(transcript))
  .find((candidate) => candidate !== null)
assert(duplicatePerson, 'two canonical cards for one source person must remain legal')
const duplicatePersonBound = await createBoundValidationFixture(duplicatePerson)
assert.equal((await handleAuthoritativeValidationRequest(jsonRequest({ ticket: duplicatePersonBound.ticket, transcript: duplicatePersonBound.transcript }), enabledEnv)).status, 200)

const pickIndices = fixed113Data.transcript.events.flatMap((event, index) => event.type === 'pick' ? [index] : [])
const initialIndices = fixed113Data.transcript.events.flatMap((event, index) => event.type === 'initial-roll' ? [index] : [])
const rerollIndex = fixed113Data.transcript.events.findIndex((event) => event.type === 'reroll')
assert(rerollIndex >= 0)

async function tamper(
  code: DraftValidationErrorCode,
  mutate: (candidate: MutableTranscript) => void,
) {
  const bound = await createBoundValidationFixture(fixed113Data.transcript)
  const candidate = mutableTranscript(bound.transcript)
  mutate(candidate)
  await assertError(await handleAuthoritativeValidationRequest(jsonRequest({ ticket: bound.ticket, transcript: candidate }), enabledEnv), code)
}

await tamper('draft_ticket_mismatch', (candidate) => { candidate.header.gameplaySeed = noRerollsData.transcript.header.gameplaySeed })
await tamper('invalid_roll_sequence', (candidate) => { candidate.events[initialIndices[0]].combinationId = 'ana-1960s' })
await tamper('invalid_reroll', (candidate) => { candidate.events[rerollIndex].resultingCombinationId = 'ana-1960s' })
await tamper('invalid_card', (candidate) => { candidate.events[pickIndices[0]].canonicalCardId = 'not-a-canonical-card' })
await tamper('wrong_pool', (candidate) => { candidate.events[pickIndices[0]].canonicalCardId = 'ana-1960s-adcocjo01' })
await tamper('invalid_card', (candidate) => { candidate.events[pickIndices[0]].sourcePlayerId = 'alteredsource' })
await tamper('invalid_card', (candidate) => { candidate.events[pickIndices[0]].featuredSeason = 2013 })
await tamper('invalid_position', (candidate) => { candidate.events[pickIndices[0]].assignedPosition = 'RP' })
await tamper('duplicate_card', (candidate) => { candidate.events[pickIndices[1]].canonicalCardId = candidate.events[pickIndices[0]].canonicalCardId })
await tamper('unexpected_event_order', (candidate) => { candidate.events[pickIndices[0]].round = 2 })
await tamper('unexpected_event_order', (candidate) => { [candidate.events[0], candidate.events[1]] = [candidate.events[1], candidate.events[0]] })
await tamper('incomplete_roster', (candidate) => { candidate.events.splice(pickIndices[0], 1) })
await tamper('unexpected_event_order', (candidate) => { candidate.events.push(structuredClone(candidate.events[0])) })
await tamper('incomplete_roster', (candidate) => { candidate.events.splice(27) })

const versionCases: readonly [keyof typeof fixed113Data.transcript.header, DraftValidationErrorCode][] = [
  ['transcriptSchemaVersion', 'unsupported_transcript_version'],
  ['appVersion', 'unsupported_app_version'],
  ['gameRulesVersion', 'unsupported_rules_version'],
  ['rngVersion', 'unsupported_rng_version'],
  ['scoringVersion', 'unsupported_scoring_version'],
  ['dataVersion', 'unsupported_data_version'],
]
for (const [field, code] of versionCases) {
  await tamper(code, (candidate) => { candidate.header[field] = 'unsupported-v999' })
}
await tamper('canonical_data_mismatch', (candidate) => { candidate.header.canonicalDataDigest = '0'.repeat(64) })
await tamper('invalid_seed', (candidate) => { candidate.header.gameplaySeed = `seeded-v1:${'0'.repeat(32)}` })

const schemaCases: Array<(candidate: MutableTranscript) => void> = [
  (candidate) => { delete candidate.header.createdAt },
  (candidate) => { delete candidate.events[0].combinationId },
  (candidate) => { candidate.header.extra = true },
  (candidate) => { candidate.events[0].extra = true },
  (candidate) => { candidate.header.draftId = 'C1000000-0000-4000-8000-000016201130' },
  (candidate) => { candidate.header.draftId = 'c1000000-0000-1000-8000-000016201130' },
  (candidate) => { candidate.header.createdAt = '2026-07-17' },
  (candidate) => { candidate.header.appVersion = 'v'.repeat(65) },
  (candidate) => { candidate.events[0].round = Number.MAX_SAFE_INTEGER + 1 },
  (candidate) => { candidate.events[0].round = 1.5 },
  (candidate) => { candidate.events[pickIndices[0]].pickOrder = 0 },
  (candidate) => { candidate.events[pickIndices[0]].pickOrder = '1' },
  (candidate) => { candidate.events[pickIndices[0]].featuredSeason = Number.MAX_SAFE_INTEGER + 1 },
  (candidate) => { candidate.events[0].type = 'roll' },
  (candidate) => { candidate.events[pickIndices[0]].sourcePlayerId = 'poséybu01' },
  (candidate) => { candidate.events[pickIndices[0]].sourcePlayerId = 'a'.repeat(33) },
  (candidate) => { candidate.events[pickIndices[0]].canonicalCardId = 'SFG-2010s-poseybu01' },
  (candidate) => { candidate.events[pickIndices[0]].canonicalCardId = 'a'.repeat(97) },
  (candidate) => { candidate.events[0].combinationId = 'sfg 2010s' },
  (candidate) => { candidate.events[0].combinationId = 'a'.repeat(65) },
  (candidate) => { candidate.events[pickIndices[0]].featuredSeason = 1919 },
  (candidate) => { candidate.events[pickIndices[0]].featuredSeason = 2026 },
]
for (const mutate of schemaCases) await tamper('invalid_request_schema', mutate)
await tamper('invalid_position', (candidate) => { candidate.events[pickIndices[0]].assignedPosition = 'P' })
await tamper('invalid_seed', (candidate) => { candidate.header.gameplaySeed = 'seeded-v1:not-hex' })
await tamper('canonical_data_mismatch', (candidate) => { candidate.header.canonicalDataDigest = DATA_DIGEST.toUpperCase() })
await tamper('invalid_reroll', (candidate) => { candidate.events[rerollIndex].reroll = 'franchise' })

await assertError(await handleAuthoritativeValidationRequest(rawRequest('{'), enabledEnv), 'malformed_json')
await assertError(await handleAuthoritativeValidationRequest(rawRequest(''), enabledEnv), 'malformed_json')
await assertError(await handleAuthoritativeValidationRequest(rawRequest('   '), enabledEnv), 'malformed_json')
await assertError(await handleAuthoritativeValidationRequest(rawRequest(new Uint8Array([0xc3, 0x28])), enabledEnv), 'malformed_json')
await assertError(await handleAuthoritativeValidationRequest(rawRequest('1e400'), enabledEnv), 'invalid_request_schema')
await assertError(await handleAuthoritativeValidationRequest(jsonRequest([]), enabledEnv), 'invalid_request_schema')
await assertError(await handleAuthoritativeValidationRequest(jsonRequest(null), enabledEnv), 'invalid_request_schema')
const parserFixture = await createBoundValidationFixture(fixed113Data.transcript)
const parserEnvelope = { ticket: parserFixture.ticket, transcript: parserFixture.transcript }
const nonFiniteEvent = JSON.stringify(parserEnvelope).replace('"round":1', '"round":1e400')
await assertError(await handleAuthoritativeValidationRequest(rawRequest(nonFiniteEvent), enabledEnv), 'invalid_request_schema')
await assertError(await handleAuthoritativeValidationRequest(rawRequest(' '.repeat(MAX_DRAFT_VALIDATION_BODY_BYTES)), enabledEnv), 'malformed_json')
await assertError(await handleAuthoritativeValidationRequest(rawRequest(' '.repeat(MAX_DRAFT_VALIDATION_BODY_BYTES + 1)), enabledEnv), 'payload_too_large')
await assertError(await handleAuthoritativeValidationRequest(rawRequest('{}', { 'Content-Type': 'text/plain' }), enabledEnv), 'unsupported_media_type')
await assertError(await handleAuthoritativeValidationRequest(rawRequest('{}', {
  'Content-Type': 'application/json; charset=utf-8',
}), enabledEnv), 'unsupported_media_type')
await assertError(await handleAuthoritativeValidationRequest(rawRequest('{}', {
  'Content-Type': 'application/json',
  'Content-Encoding': 'gzip',
}), enabledEnv), 'unsupported_media_type')
await assertError(await handleAuthoritativeValidationRequest(rawRequest('{}', {
  'Content-Type': 'application/json',
  'Content-Length': String(MAX_DRAFT_VALIDATION_BODY_BYTES + 1),
}), enabledEnv), 'payload_too_large')
await assertError(await handleAuthoritativeValidationRequest(jsonRequest(parserEnvelope, {
  origin: 'https://attacker.example',
}), enabledEnv), 'origin_not_allowed')
await assertError(await handleAuthoritativeValidationRequest(jsonRequest(parserEnvelope, {
  headers: { Host: 'attacker.example' },
}), enabledEnv), 'origin_not_allowed')
assert.equal((await handleAuthoritativeValidationRequest(jsonRequest(parserEnvelope, {
  origin: 'https://preview.example.test',
}), enabledEnv)).status, 200)

let streamedChunks = 0
let streamCancelled = false
const oversizedStream = new ReadableStream<Uint8Array>({
  pull(controller) {
    streamedChunks += 1
    controller.enqueue(new Uint8Array(8_193))
  },
  cancel() {
    streamCancelled = true
  },
})
await assertError(await handleAuthoritativeValidationRequest(new Request(ENDPOINT, {
  method: 'POST',
  headers: JSON_HEADERS,
  body: oversizedStream,
  duplex: 'half',
} as RequestInit & { duplex: 'half' }), enabledEnv), 'payload_too_large')
assert.equal(streamedChunks, 2, 'bounded reader must stop immediately after crossing 16,384 bytes')
assert.equal(streamCancelled, true)

const unknownEnvelope = { ...parserEnvelope, extra: true }
await assertError(await handleAuthoritativeValidationRequest(jsonRequest(unknownEnvelope), enabledEnv), 'invalid_request_schema')
const unknownTranscript = structuredClone(fixed113Data.transcript) as Record<string, unknown>
unknownTranscript.extra = true
await assertError(await handleAuthoritativeValidationRequest(jsonRequest({ ticket: parserFixture.ticket, transcript: unknownTranscript }), enabledEnv), 'invalid_request_schema')

for (const method of ['GET', 'HEAD', 'PUT']) {
  const methodResponse = await handleAuthoritativeValidationRequest(new Request(ENDPOINT, { method }), enabledEnv)
  await assertError(methodResponse, 'method_not_allowed')
  assert.equal(methodResponse.headers.get('Allow'), 'POST')
}

let bodyPulls = 0
const unreadBody = new ReadableStream<Uint8Array>({
  pull() {
    bodyPulls += 1
    throw new Error('disabled route must never read its body')
  },
})
const unreadRequest = new Request(ENDPOINT, {
  method: 'POST',
  headers: JSON_HEADERS,
  body: unreadBody,
  duplex: 'half',
} as RequestInit & { duplex: 'half' })
await Promise.resolve()
const pullsBeforeDisabledHandler = bodyPulls
const disabledResponse = await handleAuthoritativeValidationRequest(unreadRequest, disabledEnv)
assert.equal(disabledResponse.status, 404)
assertJsonHeaders(disabledResponse)
const disabledPayload = await disabledResponse.text()
assert.deepEqual(JSON.parse(disabledPayload), {
  ok: false,
  error: { code: 'not_found', message: 'API route not found' },
})
assert.equal(bodyPulls, pullsBeforeDisabledHandler)
await unreadRequest.body?.cancel().catch(() => undefined)
for (const env of [{}, { DRAFT_VALIDATION_MODE: 'ENABLED' }, { DRAFT_VALIDATION_MODE: true }]) {
  const response = await handleAuthoritativeValidationRequest(jsonRequest(parserEnvelope), env as BackendEnv)
  assert.equal(response.status, 404, 'missing and malformed flags must fail closed')
}

let databaseReads = 0
const throwingDatabaseEnv = new Proxy({
  DRAFT_VALIDATION_MODE: 'enabled',
  DRAFT_TICKET_SIGNING_KEY: TEST_DRAFT_TICKET_SIGNING_KEY,
}, {
  get(target, property, receiver) {
    if (property === 'DB') {
      databaseReads += 1
      throw new Error('secret D1 failure')
    }
    return Reflect.get(target, property, receiver)
  },
}) as BackendEnv
assert.equal((await handleAuthoritativeValidationRequest(jsonRequest(parserEnvelope), throwingDatabaseEnv)).status, 200)
assert.equal(databaseReads, 0)

for (const [env, expected] of [[enabledEnv, 'enabled'], [disabledEnv, 'disabled'], [{}, 'disabled']] as const) {
  const response = await handleHealthRequest(new Request('https://preview.example.test/api/v1/health'), env as BackendEnv)
  const body = await responseBody(response)
  assert(isRecord(body.features))
  assert.equal(body.features.draftValidation, expected)
  assert.equal(body.features.leaderboard, 'disabled')
  assert.equal(body.features.submissions, 'disabled')
  assert.equal(body.features.writes, 'disabled')
}

const notFound = handleApiNotFoundRequest(new Request('https://preview.example.test/api/v1/unknown'))
assert.equal(notFound.status, 404)
assertJsonHeaders(notFound)
const notFoundPayload = await notFound.text()
assert.equal(disabledPayload, notFoundPayload)
assert.deepEqual(JSON.parse(notFoundPayload), {
  ok: false,
  error: { code: 'not_found', message: 'API route not found' },
})
assert.deepEqual(JSON.parse(readFileSync('public/_routes.json', 'utf8')), {
  version: 1,
  include: ['/api/*'],
  exclude: [],
})

console.log('Draft validation route passed: feature isolation, strict bounded parsing, four goldens, tamper rejection, sanitized output, and zero D1 access.')
