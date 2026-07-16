import type { Position } from '../types/draft'

export const TRANSCRIPT_SCHEMA_VERSION = 'draft-transcript-v1' as const

export interface DraftTranscriptHeader {
  readonly transcriptSchemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION
  readonly appVersion: string
  readonly gameRulesVersion: string
  readonly rngVersion: string
  readonly scoringVersion: string
  readonly dataVersion: string
  readonly canonicalDataDigest: string
  readonly draftId: string
  readonly gameplaySeed: string
  readonly createdAt: string
}

export interface InitialRollTranscriptEvent {
  readonly type: 'initial-roll'
  readonly round: number
  readonly combinationId: string
}

export interface RerollTranscriptEvent {
  readonly type: 'reroll'
  readonly reroll: 'team' | 'era'
  readonly round: number
  readonly discardedCombinationId: string
  readonly resultingCombinationId: string
}

export interface PickTranscriptEvent {
  readonly type: 'pick'
  readonly round: number
  readonly pickOrder: number
  readonly combinationId: string
  readonly canonicalCardId: string
  readonly sourcePlayerId: string
  readonly assignedPosition: Position
  readonly featuredSeason: number
}

export type DraftTranscriptEvent =
  | InitialRollTranscriptEvent
  | RerollTranscriptEvent
  | PickTranscriptEvent

export interface DraftTranscript {
  readonly header: Readonly<DraftTranscriptHeader>
  readonly events: readonly DraftTranscriptEvent[]
}

export type NewDraftTranscriptHeader = Omit<DraftTranscriptHeader, 'transcriptSchemaVersion'>

function freezeHeader(header: NewDraftTranscriptHeader): Readonly<DraftTranscriptHeader> {
  return Object.freeze({
    transcriptSchemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    ...header,
  })
}

function freezeEvent<T extends DraftTranscriptEvent>(event: T): Readonly<T> {
  return Object.freeze({ ...event }) as Readonly<T>
}

export function createDraftTranscript(header: NewDraftTranscriptHeader): DraftTranscript {
  return Object.freeze({
    header: freezeHeader(header),
    events: Object.freeze([]) as readonly DraftTranscriptEvent[],
  })
}

export function appendDraftTranscriptEvent(
  transcript: DraftTranscript,
  event: DraftTranscriptEvent,
): DraftTranscript {
  return Object.freeze({
    header: transcript.header,
    events: Object.freeze([...transcript.events, freezeEvent(event)]),
  })
}
