import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from '../DraftTranscript'
import { rejectDraftReplay } from './types'

const HEADER_FIELDS = [
  'transcriptSchemaVersion', 'appVersion', 'gameRulesVersion', 'rngVersion', 'scoringVersion',
  'dataVersion', 'canonicalDataDigest', 'draftId', 'gameplaySeed', 'createdAt',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    rejectDraftReplay(`${label} does not match the ${TRANSCRIPT_SCHEMA_VERSION} schema.`)
  }
}

export function validateTranscriptShape(transcript: unknown): asserts transcript is DraftTranscript {
  if (!isRecord(transcript)) rejectDraftReplay('Transcript must be an object.')
  requireExactKeys(transcript, ['header', 'events'], 'Transcript')
  const { header, events } = transcript
  if (!isRecord(header)) rejectDraftReplay('Transcript header must be an object.')
  requireExactKeys(header, HEADER_FIELDS, 'Transcript header')
  for (const field of HEADER_FIELDS) {
    if (typeof header[field] !== 'string') rejectDraftReplay(`Transcript header field ${field} must be a string.`)
  }
  if (!Array.isArray(events)) rejectDraftReplay('Transcript events must be an array.')
  events.forEach((event, index) => {
    if (!isRecord(event)) rejectDraftReplay(`Transcript event ${index} must be an object.`)
    if (event.type === 'initial-roll') {
      requireExactKeys(event, ['type', 'round', 'combinationId'], `Initial-roll event ${index}`)
      if (!Number.isInteger(event.round) || typeof event.combinationId !== 'string') rejectDraftReplay(`Initial-roll event ${index} has invalid fields.`)
      return
    }
    if (event.type === 'reroll') {
      requireExactKeys(event, ['type', 'reroll', 'round', 'discardedCombinationId', 'resultingCombinationId'], `Reroll event ${index}`)
      if (
        (event.reroll !== 'team' && event.reroll !== 'era')
        || !Number.isInteger(event.round)
        || typeof event.discardedCombinationId !== 'string'
        || typeof event.resultingCombinationId !== 'string'
      ) rejectDraftReplay(`Reroll event ${index} has invalid fields.`)
      return
    }
    if (event.type === 'pick') {
      requireExactKeys(event, [
        'type', 'round', 'pickOrder', 'combinationId', 'canonicalCardId', 'sourcePlayerId',
        'assignedPosition', 'featuredSeason',
      ], `Pick event ${index}`)
      if (
        !Number.isInteger(event.round)
        || !Number.isInteger(event.pickOrder)
        || typeof event.combinationId !== 'string'
        || typeof event.canonicalCardId !== 'string'
        || typeof event.sourcePlayerId !== 'string'
        || typeof event.assignedPosition !== 'string'
        || !Number.isInteger(event.featuredSeason)
      ) rejectDraftReplay(`Pick event ${index} has invalid fields.`)
      return
    }
    rejectDraftReplay(`Transcript event ${index} has an unsupported type.`)
  })
}
