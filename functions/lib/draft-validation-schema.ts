import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from '../../src/game/DraftTranscript'
import { validateTranscriptShape } from '../../src/game/replay/validateTranscript'
import { POSITIONS } from '../../src/types/draft'
import { draftValidationError } from './api-response'

const HEADER_FIELDS = [
  'transcriptSchemaVersion', 'appVersion', 'gameRulesVersion', 'rngVersion', 'scoringVersion',
  'dataVersion', 'canonicalDataDigest', 'draftId', 'gameplaySeed', 'createdAt',
] as const
const TRANSCRIPT_FIELDS = ['header', 'events'] as const
const ENVELOPE_FIELDS = ['ticket', 'transcript'] as const
const INITIAL_ROLL_FIELDS = ['type', 'round', 'combinationId'] as const
const REROLL_FIELDS = ['type', 'reroll', 'round', 'discardedCombinationId', 'resultingCombinationId'] as const
const PICK_FIELDS = [
  'type', 'round', 'pickOrder', 'combinationId', 'canonicalCardId', 'sourcePlayerId',
  'assignedPosition', 'featuredSeason',
] as const

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const GAMEPLAY_SEED_PATTERN = /^seeded-v1:([0-9a-f]{32})$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const COMBINATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}s$/
const CARD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SOURCE_PLAYER_ID_PATTERN = /^[a-z0-9]+$/
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const VERSION_MAX_LENGTH = 64
const COMBINATION_ID_MAX_LENGTH = 64
const CARD_ID_MAX_LENGTH = 96
const SOURCE_PLAYER_ID_MAX_LENGTH = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    draftValidationError('invalid_request_schema')
  }
}

function requireString(value: unknown, maximumLength: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    draftValidationError('invalid_request_schema')
  }
  return value
}

function requireSafeRound(value: unknown) {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1 || value > 14) {
    draftValidationError('invalid_request_schema')
  }
}

function requireCombinationId(value: unknown) {
  const id = requireString(value, COMBINATION_ID_MAX_LENGTH)
  if (!COMBINATION_ID_PATTERN.test(id)) draftValidationError('invalid_request_schema')
}

function requireCardId(value: unknown) {
  const id = requireString(value, CARD_ID_MAX_LENGTH)
  if (!CARD_ID_PATTERN.test(id)) draftValidationError('invalid_request_schema')
}

function requireSourcePlayerId(value: unknown) {
  const id = requireString(value, SOURCE_PLAYER_ID_MAX_LENGTH)
  if (!SOURCE_PLAYER_ID_PATTERN.test(id)) draftValidationError('invalid_request_schema')
}

function requireCanonicalTimestamp(value: unknown) {
  const timestamp = requireString(value, 32)
  const parsed = new Date(timestamp)
  if (!CANONICAL_TIMESTAMP_PATTERN.test(timestamp) || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    draftValidationError('invalid_request_schema')
  }
}

function validateHeader(header: Record<string, unknown>) {
  requireExactKeys(header, HEADER_FIELDS)
  const transcriptSchemaVersion = requireString(header.transcriptSchemaVersion, VERSION_MAX_LENGTH)
  const appVersion = requireString(header.appVersion, VERSION_MAX_LENGTH)
  const gameRulesVersion = requireString(header.gameRulesVersion, VERSION_MAX_LENGTH)
  const rngVersion = requireString(header.rngVersion, VERSION_MAX_LENGTH)
  const scoringVersion = requireString(header.scoringVersion, VERSION_MAX_LENGTH)
  const dataVersion = requireString(header.dataVersion, VERSION_MAX_LENGTH)
  const digest = requireString(header.canonicalDataDigest, 64)
  const draftId = requireString(header.draftId, 36)
  const gameplaySeed = requireString(header.gameplaySeed, 42)
  requireCanonicalTimestamp(header.createdAt)

  if (transcriptSchemaVersion !== TRANSCRIPT_SCHEMA_VERSION) draftValidationError('unsupported_transcript_version')
  if (appVersion !== APP_VERSION) draftValidationError('unsupported_app_version')
  if (gameRulesVersion !== GAME_RULES_VERSION) draftValidationError('unsupported_rules_version')
  if (rngVersion !== RNG_VERSION) draftValidationError('unsupported_rng_version')
  if (scoringVersion !== SCORING_VERSION) draftValidationError('unsupported_scoring_version')
  if (dataVersion !== DATA_VERSION) draftValidationError('unsupported_data_version')
  if (!DIGEST_PATTERN.test(digest) || digest !== DATA_DIGEST) draftValidationError('canonical_data_mismatch')
  if (!UUID_V4_PATTERN.test(draftId)) draftValidationError('invalid_request_schema')
  const seedMatch = GAMEPLAY_SEED_PATTERN.exec(gameplaySeed)
  if (!seedMatch || seedMatch[1] === '0'.repeat(32)) draftValidationError('invalid_seed')
}

function validateInitialRoll(event: Record<string, unknown>) {
  requireExactKeys(event, INITIAL_ROLL_FIELDS)
  requireSafeRound(event.round)
  requireCombinationId(event.combinationId)
}

function validateReroll(event: Record<string, unknown>) {
  requireExactKeys(event, REROLL_FIELDS)
  if (event.reroll !== 'team' && event.reroll !== 'era') draftValidationError('invalid_reroll')
  requireSafeRound(event.round)
  requireCombinationId(event.discardedCombinationId)
  requireCombinationId(event.resultingCombinationId)
}

function validatePick(event: Record<string, unknown>) {
  requireExactKeys(event, PICK_FIELDS)
  requireSafeRound(event.round)
  requireSafeRound(event.pickOrder)
  requireCombinationId(event.combinationId)
  requireCardId(event.canonicalCardId)
  requireSourcePlayerId(event.sourcePlayerId)
  if (typeof event.assignedPosition !== 'string' || !POSITIONS.some((position) => position === event.assignedPosition)) {
    draftValidationError('invalid_position')
  }
  if (
    typeof event.featuredSeason !== 'number'
    || !Number.isSafeInteger(event.featuredSeason)
    || event.featuredSeason < 1920
    || event.featuredSeason > 2025
  ) draftValidationError('invalid_request_schema')
}

function validateEvents(events: unknown[]) {
  if (events.length < 28) draftValidationError('incomplete_roster')
  if (events.length > 30) draftValidationError('unexpected_event_order')
  let initialRolls = 0
  let picks = 0
  let teamRerolls = 0
  let eraRerolls = 0

  for (const event of events) {
    if (!isRecord(event)) draftValidationError('invalid_request_schema')
    if (event.type === 'initial-roll') {
      initialRolls += 1
      validateInitialRoll(event)
    } else if (event.type === 'reroll') {
      validateReroll(event)
      if (event.reroll === 'team') teamRerolls += 1
      else eraRerolls += 1
    } else if (event.type === 'pick') {
      picks += 1
      validatePick(event)
    } else {
      draftValidationError('invalid_request_schema')
    }
  }
  if (initialRolls < 14 || picks < 14) draftValidationError('incomplete_roster')
  if (initialRolls > 14 || picks > 14) draftValidationError('unexpected_event_order')
  if (teamRerolls > 1 || eraRerolls > 1) draftValidationError('invalid_reroll')
}

export interface DraftValidationRequestEnvelope {
  readonly ticket: string
  readonly transcript: DraftTranscript
}

export function validateDraftRequestEnvelope(value: unknown): DraftValidationRequestEnvelope {
  if (!isRecord(value)) draftValidationError('invalid_request_schema')
  requireExactKeys(value, ENVELOPE_FIELDS)
  const ticket = requireString(value.ticket, 4_096)
  const transcript = value.transcript
  if (!isRecord(transcript)) draftValidationError('invalid_request_schema')
  requireExactKeys(transcript, TRANSCRIPT_FIELDS)
  if (!isRecord(transcript.header) || !Array.isArray(transcript.events)) draftValidationError('invalid_request_schema')
  validateHeader(transcript.header)
  validateEvents(transcript.events)
  validateTranscriptShape(transcript)
  return { ticket, transcript }
}
