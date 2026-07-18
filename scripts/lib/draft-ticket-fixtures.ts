import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION } from '../../src/game/DraftTranscript'
import { validateTranscriptShape } from '../../src/game/replay/validateTranscript'
import {
  DRAFT_TICKET_GAME_MODE,
  DRAFT_TICKET_SCHEMA_VERSION,
  DRAFT_TICKET_TTL_MS,
  encodeSignedDraftTicket,
  type DraftTicketPayload,
} from '../../functions/lib/draft-ticket'

export const TEST_DRAFT_TICKET_SIGNING_KEY = 'test-only-draft-ticket-signing-key-v1'

interface BoundValidationFixtureOptions {
  readonly issuedAt?: number
  readonly signingKey?: string
  readonly payloadOverrides?: Partial<DraftTicketPayload>
  readonly transcriptHeaderOverrides?: Readonly<Record<string, unknown>>
  readonly bindTranscriptToTicket?: boolean
}

export async function createBoundValidationFixture(
  source: unknown,
  options: BoundValidationFixtureOptions = {},
) {
  validateTranscriptShape(source)
  const transcript = structuredClone(source)
  const issuedAt = options.issuedAt ?? Date.now()
  const payload: DraftTicketPayload = Object.freeze({
    ticketSchemaVersion: DRAFT_TICKET_SCHEMA_VERSION,
    ticketId: transcript.header.draftId,
    draftSeed: transcript.header.gameplaySeed,
    issuedAt,
    expiresAt: issuedAt + DRAFT_TICKET_TTL_MS,
    appVersion: APP_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    rngVersion: RNG_VERSION,
    scoringVersion: SCORING_VERSION,
    dataVersion: DATA_VERSION,
    canonicalDataDigest: DATA_DIGEST,
    transcriptSchemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    gameMode: DRAFT_TICKET_GAME_MODE,
    ...options.payloadOverrides,
  })

  if (options.bindTranscriptToTicket !== false) {
    Object.assign(transcript.header, {
      transcriptSchemaVersion: payload.transcriptSchemaVersion,
      appVersion: payload.appVersion,
      gameRulesVersion: payload.gameRulesVersion,
      rngVersion: payload.rngVersion,
      scoringVersion: payload.scoringVersion,
      dataVersion: payload.dataVersion,
      canonicalDataDigest: payload.canonicalDataDigest,
      draftId: payload.ticketId,
      gameplaySeed: payload.draftSeed,
      createdAt: new Date(payload.issuedAt).toISOString(),
    })
  }
  Object.assign(transcript.header, options.transcriptHeaderOverrides)

  return Object.freeze({
    ticket: await encodeSignedDraftTicket(
      DRAFT_TICKET_SCHEMA_VERSION,
      payload,
      options.signingKey ?? TEST_DRAFT_TICKET_SIGNING_KEY,
    ),
    transcript,
    payload,
  })
}
