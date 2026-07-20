import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript, type DraftTranscriptEvent } from '../../src/game/DraftTranscript'
import { getAvailablePositions, isPlayerSelectable, resolveAssignmentSlot } from '../../src/game/Eligibility'
import { Randomizer } from '../../src/game/Randomizer'
import { CURRENT_CANONICAL_DRAFT_DATA, CURRENT_REPLAY_VERSION_SUPPORT, replayDraft } from '../../src/game/ReplayDraft'
import { createSeededRandom, type GameplaySeed } from '../../src/game/SeededRandom'
import { TeamPool } from '../../src/game/TeamPool'
import { ROSTER_SLOTS, type Position, type Roster, type TeamDecade } from '../../src/types/draft'

export interface IssuedPreviewTicket {
  readonly value: string
  readonly ticketId: string
  readonly draftSeed: GameplaySeed
  readonly issuedAt: number
}

const POSITION_ORDER = new Map(ROSTER_SLOTS.map(({ position }, index) => [position, index]))

function fail(message: string): never {
  throw new Error(message)
}

export function buildPreviewSubmissionTranscript(ticket: IssuedPreviewTicket): DraftTranscript {
  const pool = new TeamPool()
  const randomizer = new Randomizer(pool, createSeededRandom(ticket.draftSeed))
  const usedCombinationIds = new Set<string>()
  const selectedCardIds = new Set<string>()
  const events: DraftTranscriptEvent[] = []
  let roster: Roster = {}
  let currentCombination = pool.getCombinations()[0]

  const combinationIsPlayable = (combination: TeamDecade) => pool.getPlayers(combination).some((player) => (
    !selectedCardIds.has(player.id) && isPlayerSelectable(player, roster)
  ))

  for (let round = 1; round <= ROSTER_SLOTS.length; round += 1) {
    const selectedCombination = randomizer.select({
      mode: 'both',
      current: currentCombination,
      usedCombinationIds,
      teamRerollAvailable: true,
      eraRerollAvailable: true,
      roundsRemaining: ROSTER_SLOTS.length - selectedCardIds.size,
      isPlayable: combinationIsPlayable,
    })
    if (!selectedCombination) fail('Unable to construct a canonical transcript for the issued preview ticket.')
    currentCombination = selectedCombination
    usedCombinationIds.add(selectedCombination.id)
    events.push({ type: 'initial-roll', round, combinationId: selectedCombination.id })

    const candidates = pool.query({
      combination: selectedCombination,
      excludedIds: selectedCardIds,
      filter: 'ALL',
      sort: 'name',
      search: '',
    }).flatMap((player) => getAvailablePositions(player, roster).map((position) => ({ player, position })))
      .sort((left, right) => (
        (POSITION_ORDER.get(left.position) ?? Number.MAX_SAFE_INTEGER) - (POSITION_ORDER.get(right.position) ?? Number.MAX_SAFE_INTEGER)
        || left.player.id.localeCompare(right.player.id)
      ))
    const choice = candidates[0]
    if (!choice) fail('Unable to choose a canonical player for the issued preview ticket.')
    const slotId = resolveAssignmentSlot(choice.player, choice.position as Position, roster)
    if (!slotId) fail('Unable to assign a canonical player for the issued preview ticket.')
    roster = { ...roster, [slotId]: choice.player }
    selectedCardIds.add(choice.player.id)
    events.push({
      type: 'pick',
      round,
      pickOrder: round,
      combinationId: selectedCombination.id,
      canonicalCardId: choice.player.id,
      sourcePlayerId: choice.player.playerId,
      assignedPosition: choice.position,
      featuredSeason: choice.player.featuredSeason,
    })
  }

  const transcript: DraftTranscript = Object.freeze({
    header: Object.freeze({
      transcriptSchemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      gameRulesVersion: GAME_RULES_VERSION,
      rngVersion: RNG_VERSION,
      scoringVersion: SCORING_VERSION,
      dataVersion: DATA_VERSION,
      canonicalDataDigest: DATA_DIGEST,
      draftId: ticket.ticketId,
      gameplaySeed: ticket.draftSeed,
      createdAt: new Date(ticket.issuedAt).toISOString(),
    }),
    events: Object.freeze(events.map((event) => Object.freeze(event))),
  })
  replayDraft(transcript, CURRENT_CANONICAL_DRAFT_DATA, CURRENT_REPLAY_VERSION_SUPPORT)
  return transcript
}

export function deterministicReplayFailure(transcript: DraftTranscript) {
  const mutated = structuredClone(transcript)
  const initialIndex = mutated.events.findIndex((event) => event.type === 'initial-roll')
  const initial = mutated.events[initialIndex]
  if (!initial || initial.type !== 'initial-roll') fail('Canonical transcript did not contain an initial roll.')
  const events = mutated.events.map((event, index) => index === initialIndex
    ? Object.freeze({
        ...initial,
        combinationId: initial.combinationId === 'ana-1960s' ? 'bal-1960s' : 'ana-1960s',
      })
    : event)
  return Object.freeze({ header: mutated.header, events: Object.freeze(events) })
}
