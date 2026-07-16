import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../config/versions'
import { PLAYER_POOLS, TEAM_DECADES } from '../data/generated'
import { POSITIONS, ROSTER_SLOTS, type Player, type Roster, type RosterSlotId, type TeamDecade } from '../types/draft'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript, type PickTranscriptEvent } from './DraftTranscript'
import { isPlayerSelectable, resolveAssignmentSlot } from './Eligibility'
import { Randomizer } from './Randomizer'
import { createSeededRandom, SEEDED_RNG_VERSION } from './SeededRandom'
import { TeamPool } from './TeamPool'

export interface CanonicalDraftData {
  readonly combinations: readonly TeamDecade[]
  readonly playerPools: Readonly<Record<string, readonly Player[]>>
  readonly dataDigest: string
}

export interface SupportedReplayVersionMetadata {
  readonly transcriptSchemaVersions: readonly string[]
  readonly appVersions: readonly string[]
  readonly gameRulesVersions: readonly string[]
  readonly rngVersions: readonly string[]
  readonly scoringVersions: readonly string[]
  readonly dataVersions: readonly string[]
}

export type ValidatedDraftRoster = Readonly<Record<RosterSlotId, Player>>

export const CURRENT_CANONICAL_DRAFT_DATA: CanonicalDraftData = Object.freeze({
  combinations: TEAM_DECADES,
  playerPools: PLAYER_POOLS,
  dataDigest: DATA_DIGEST,
})

export const CURRENT_REPLAY_VERSION_SUPPORT: SupportedReplayVersionMetadata = Object.freeze({
  transcriptSchemaVersions: Object.freeze([TRANSCRIPT_SCHEMA_VERSION]),
  appVersions: Object.freeze([APP_VERSION]),
  gameRulesVersions: Object.freeze([GAME_RULES_VERSION]),
  rngVersions: Object.freeze([RNG_VERSION]),
  scoringVersions: Object.freeze([SCORING_VERSION]),
  dataVersions: Object.freeze([DATA_VERSION]),
})

export class DraftReplayError extends Error {
  override readonly name = 'DraftReplayError'
}

function reject(message: string): never {
  throw new DraftReplayError(message)
}

function requireSupported(value: string, supported: readonly string[], label: string) {
  if (!supported.includes(value)) reject(`Unsupported ${label}: ${value}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    reject(`${label} does not match the ${TRANSCRIPT_SCHEMA_VERSION} schema.`)
  }
}

function validateTranscriptShape(transcript: DraftTranscript) {
  if (!isRecord(transcript)) reject('Transcript must be an object.')
  requireExactKeys(transcript, ['header', 'events'], 'Transcript')
  if (!isRecord(transcript.header)) reject('Transcript header must be an object.')
  requireExactKeys(transcript.header, [
    'transcriptSchemaVersion', 'appVersion', 'gameRulesVersion', 'rngVersion', 'scoringVersion',
    'dataVersion', 'canonicalDataDigest', 'draftId', 'gameplaySeed', 'createdAt',
  ], 'Transcript header')
  for (const field of Object.keys(transcript.header)) {
    if (typeof transcript.header[field as keyof typeof transcript.header] !== 'string') {
      reject(`Transcript header field ${field} must be a string.`)
    }
  }
  if (!Array.isArray(transcript.events)) reject('Transcript events must be an array.')
  transcript.events.forEach((event, index) => {
    if (!isRecord(event)) reject(`Transcript event ${index} must be an object.`)
    if (event.type === 'initial-roll') {
      requireExactKeys(event, ['type', 'round', 'combinationId'], `Initial-roll event ${index}`)
      if (!Number.isInteger(event.round) || typeof event.combinationId !== 'string') reject(`Initial-roll event ${index} has invalid fields.`)
      return
    }
    if (event.type === 'reroll') {
      requireExactKeys(event, ['type', 'reroll', 'round', 'discardedCombinationId', 'resultingCombinationId'], `Reroll event ${index}`)
      if (
        (event.reroll !== 'team' && event.reroll !== 'era')
        || !Number.isInteger(event.round)
        || typeof event.discardedCombinationId !== 'string'
        || typeof event.resultingCombinationId !== 'string'
      ) reject(`Reroll event ${index} has invalid fields.`)
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
      ) reject(`Pick event ${index} has invalid fields.`)
      return
    }
    reject(`Transcript event ${index} has an unsupported type.`)
  })
}

function requireEvent<T extends DraftTranscript['events'][number]['type']>(
  transcript: DraftTranscript,
  index: number,
  type: T,
  round: number,
) {
  const event = transcript.events[index]
  if (!event) reject(`Transcript ended before round ${round} ${type} event.`)
  if (event.type !== type) reject(`Altered event order at index ${index}: expected ${type} for round ${round}.`)
  return event as Extract<DraftTranscript['events'][number], { type: T }>
}

function validateHeader(
  transcript: DraftTranscript,
  canonicalData: CanonicalDraftData,
  supported: SupportedReplayVersionMetadata,
) {
  const { header } = transcript
  if (header.transcriptSchemaVersion !== TRANSCRIPT_SCHEMA_VERSION) reject(`Unsupported transcript schema version: ${header.transcriptSchemaVersion}`)
  if (header.rngVersion !== SEEDED_RNG_VERSION) reject(`Unsupported RNG version: ${header.rngVersion}`)
  requireSupported(header.transcriptSchemaVersion, supported.transcriptSchemaVersions, 'transcript schema version')
  requireSupported(header.appVersion, supported.appVersions, 'app version')
  requireSupported(header.gameRulesVersion, supported.gameRulesVersions, 'game rules version')
  requireSupported(header.rngVersion, supported.rngVersions, 'RNG version')
  requireSupported(header.scoringVersion, supported.scoringVersions, 'scoring version')
  requireSupported(header.dataVersion, supported.dataVersions, 'data version')
  if (header.canonicalDataDigest !== canonicalData.dataDigest) reject('Canonical data digest does not match the supplied game data.')
  if (!header.draftId.trim()) reject('Draft ID must be present.')
  const createdAt = new Date(header.createdAt)
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== header.createdAt) {
    reject('Creation timestamp must be canonical ISO-8601 UTC.')
  }
}

function validatePickMetadata(event: PickTranscriptEvent, player: Player) {
  if (event.sourcePlayerId !== player.playerId) reject(`Source player ID was altered for card ${event.canonicalCardId}.`)
  if (event.featuredSeason !== player.featuredSeason) reject(`Featured season was altered for card ${event.canonicalCardId}.`)
}

/**
 * Replay a complete transcript using only canonical data and declared version
 * support. The returned objects come from canonical pools; transcript scores or
 * statistics are never accepted or calculated here.
 */
export function replayDraft(
  transcript: DraftTranscript,
  canonicalData: CanonicalDraftData,
  supportedVersions: SupportedReplayVersionMetadata,
): ValidatedDraftRoster {
  validateTranscriptShape(transcript)
  validateHeader(transcript, canonicalData, supportedVersions)

  let random: () => number
  try {
    random = createSeededRandom(transcript.header.gameplaySeed)
  } catch (error) {
    reject(`Invalid gameplay seed: ${error instanceof Error ? error.message : 'unknown seed error'}`)
  }

  const pool = new TeamPool(canonicalData.combinations, canonicalData.playerPools)
  const combinations = pool.getCombinations()
  if (combinations.length < ROSTER_SLOTS.length + 2) reject('Canonical game data cannot support 14 rounds and both rerolls.')
  const combinationIds = combinations.map(({ id }) => id)
  if (new Set(combinationIds).size !== combinationIds.length) reject('Canonical game data contains duplicate combination IDs.')

  const randomizer = new Randomizer(pool, random)
  const usedCombinationIds = new Set<string>()
  const selectedCardIds = new Set<string>()
  let roster: Roster = {}
  let currentCombination = combinations[0]
  let teamRerollAvailable = true
  let eraRerollAvailable = true
  let eventIndex = 0

  const combinationIsPlayable = (combination: TeamDecade) => pool.getPlayers(combination).some((player) => (
    !selectedCardIds.has(player.id) && isPlayerSelectable(player, roster)
  ))

  const selectExpectedCombination = (mode: 'both' | 'team' | 'era') => randomizer.select({
    mode,
    current: currentCombination,
    usedCombinationIds,
    teamRerollAvailable,
    eraRerollAvailable,
    roundsRemaining: ROSTER_SLOTS.length - selectedCardIds.size,
    isPlayable: combinationIsPlayable,
  })

  for (let round = 1; round <= ROSTER_SLOTS.length; round += 1) {
    const initialRoll = requireEvent(transcript, eventIndex, 'initial-roll', round)
    eventIndex += 1
    if (initialRoll.round !== round) reject(`Initial roll has invalid round ${initialRoll.round}; expected ${round}.`)
    const expectedInitial = selectExpectedCombination('both')
    if (!expectedInitial) reject(`Round ${round} has no possible initial combination.`)
    if (initialRoll.combinationId !== expectedInitial.id) reject(`Round ${round} landed combination was altered.`)
    if (usedCombinationIds.has(expectedInitial.id)) reject(`Combination ${expectedInitial.id} landed more than once.`)
    currentCombination = expectedInitial
    usedCombinationIds.add(expectedInitial.id)

    while (transcript.events[eventIndex]?.type === 'reroll') {
      const reroll = requireEvent(transcript, eventIndex, 'reroll', round)
      eventIndex += 1
      if (reroll.round !== round) reject(`Reroll has invalid round ${reroll.round}; expected ${round}.`)
      if (reroll.reroll !== 'team' && reroll.reroll !== 'era') reject(`Invalid reroll type in round ${round}.`)
      if (reroll.discardedCombinationId !== currentCombination.id) reject(`Reroll discarded combination is invalid in round ${round}.`)
      if (reroll.reroll === 'team' && !teamRerollAvailable) reject('More than one team reroll is not permitted.')
      if (reroll.reroll === 'era' && !eraRerollAvailable) reject('More than one era reroll is not permitted.')

      const expectedReroll = selectExpectedCombination(reroll.reroll)
      if (!expectedReroll) reject(`Round ${round} ${reroll.reroll} reroll has no possible result.`)
      if (reroll.resultingCombinationId !== expectedReroll.id) reject(`Round ${round} ${reroll.reroll} reroll result was altered.`)
      if (usedCombinationIds.has(expectedReroll.id)) reject(`Combination ${expectedReroll.id} landed more than once.`)
      currentCombination = expectedReroll
      usedCombinationIds.add(expectedReroll.id)
      if (reroll.reroll === 'team') teamRerollAvailable = false
      else eraRerollAvailable = false
    }

    const pick = requireEvent(transcript, eventIndex, 'pick', round)
    eventIndex += 1
    if (pick.round !== round) reject(`Pick has invalid round ${pick.round}; expected ${round}.`)
    if (pick.pickOrder !== round) reject(`Pick order ${pick.pickOrder} is invalid; expected ${round}.`)
    if (pick.combinationId !== currentCombination.id) reject(`Pick ${round} references the wrong franchise-decade pool.`)
    if (selectedCardIds.has(pick.canonicalCardId)) reject(`Duplicate canonical card ID: ${pick.canonicalCardId}`)

    const player = pool.getPlayers(currentCombination).find(({ id }) => id === pick.canonicalCardId)
    if (!player) reject(`Card ${pick.canonicalCardId} is not in combination ${currentCombination.id}.`)
    if (player.franchiseId !== currentCombination.franchiseId || player.decade !== currentCombination.decade) {
      reject(`Canonical card ${player.id} is inconsistent with its franchise-decade pool.`)
    }
    validatePickMetadata(pick, player)
    if (!POSITIONS.includes(pick.assignedPosition)) reject(`Assigned position is invalid for pick ${round}.`)
    const slot = resolveAssignmentSlot(player, pick.assignedPosition, roster)
    if (!slot) reject(`Card ${player.id} cannot be assigned to ${pick.assignedPosition} at pick ${round}.`)
    roster = { ...roster, [slot]: player }
    selectedCardIds.add(player.id)
  }

  if (eventIndex !== transcript.events.length) reject(`Transcript has ${transcript.events.length - eventIndex} extra event(s).`)
  if (selectedCardIds.size !== ROSTER_SLOTS.length) reject('Transcript does not contain exactly 14 unique canonical cards.')
  for (const { id } of ROSTER_SLOTS) if (!roster[id]) reject(`Final roster is missing slot ${id}.`)
  return Object.freeze({ ...roster }) as ValidatedDraftRoster
}
