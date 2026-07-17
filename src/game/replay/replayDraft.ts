import { POSITIONS, ROSTER_SLOTS, type RosterSlotId, type TeamDecade } from '../../types/draft'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript, type PickTranscriptEvent } from '../DraftTranscript'
import { isPlayerSelectable, resolveAssignmentSlot } from '../Eligibility'
import { Randomizer } from '../Randomizer'
import { createSeededRandom, SEEDED_RNG_VERSION } from '../SeededRandom'
import { rejectDraftReplay, type HydratedReplayCard, type ReplayCatalog, type SupportedReplayVersionMetadata, type ValidatedDraftRoster } from './types'
import { validateTranscriptShape } from './validateTranscript'

function requireSupported(value: string, supported: readonly string[], label: string) {
  if (!supported.includes(value)) rejectDraftReplay(`Unsupported ${label}: ${value}`)
}

function requireEvent<T extends DraftTranscript['events'][number]['type']>(
  transcript: DraftTranscript,
  index: number,
  type: T,
  round: number,
) {
  const event = transcript.events[index]
  if (!event) rejectDraftReplay(`Transcript ended before round ${round} ${type} event.`)
  if (event.type !== type) rejectDraftReplay(`Altered event order at index ${index}: expected ${type} for round ${round}.`)
  return event as Extract<DraftTranscript['events'][number], { type: T }>
}

function validateHeader(
  transcript: DraftTranscript,
  catalog: ReplayCatalog,
  supported: SupportedReplayVersionMetadata,
) {
  const { header } = transcript
  if (header.transcriptSchemaVersion !== TRANSCRIPT_SCHEMA_VERSION) rejectDraftReplay(`Unsupported transcript schema version: ${header.transcriptSchemaVersion}`)
  if (header.rngVersion !== SEEDED_RNG_VERSION) rejectDraftReplay(`Unsupported RNG version: ${header.rngVersion}`)
  requireSupported(header.transcriptSchemaVersion, supported.transcriptSchemaVersions, 'transcript schema version')
  requireSupported(header.appVersion, supported.appVersions, 'app version')
  requireSupported(header.gameRulesVersion, supported.gameRulesVersions, 'game rules version')
  requireSupported(header.rngVersion, supported.rngVersions, 'RNG version')
  requireSupported(header.scoringVersion, supported.scoringVersions, 'scoring version')
  requireSupported(header.dataVersion, supported.dataVersions, 'data version')
  if (header.canonicalDataDigest !== catalog.dataDigest) rejectDraftReplay('Canonical data digest does not match the supplied game data.')
  if (!header.draftId.trim()) rejectDraftReplay('Draft ID must be present.')
  const createdAt = new Date(header.createdAt)
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== header.createdAt) {
    rejectDraftReplay('Creation timestamp must be canonical ISO-8601 UTC.')
  }
}

function validatePickMetadata(event: PickTranscriptEvent, player: HydratedReplayCard) {
  if (event.sourcePlayerId !== player.playerId) rejectDraftReplay(`Source player ID was altered for card ${event.canonicalCardId}.`)
  if (event.featuredSeason !== player.featuredSeason) rejectDraftReplay(`Featured season was altered for card ${event.canonicalCardId}.`)
}

/** Pure deterministic replay against an injected canonical catalog. */
export function replayDraftWithCatalog<TCard extends HydratedReplayCard>(
  transcript: DraftTranscript,
  catalog: ReplayCatalog<TCard>,
  supportedVersions: SupportedReplayVersionMetadata,
): ValidatedDraftRoster<TCard> {
  validateTranscriptShape(transcript)
  validateHeader(transcript, catalog, supportedVersions)

  let random: () => number
  try {
    random = createSeededRandom(transcript.header.gameplaySeed)
  } catch (error) {
    rejectDraftReplay(`Invalid gameplay seed: ${error instanceof Error ? error.message : 'unknown seed error'}`)
  }

  const combinations = catalog.getCombinations()
  if (combinations.length < ROSTER_SLOTS.length + 2) rejectDraftReplay('Canonical game data cannot support 14 rounds and both rerolls.')
  const combinationIds = combinations.map(({ id }) => id)
  if (new Set(combinationIds).size !== combinationIds.length) rejectDraftReplay('Canonical game data contains duplicate combination IDs.')

  const randomizer = new Randomizer({
    getCombinations: () => combinations,
    getTeams: () => [...new Map(combinations.map(({ franchiseId, team, teamName }) => [franchiseId, { franchiseId, team, teamName }])).values()],
    getDecades: () => [...new Set(combinations.map(({ decade }) => decade))],
  }, random)
  const usedCombinationIds = new Set<string>()
  const selectedCardIds = new Set<string>()
  let roster: Partial<Record<RosterSlotId, TCard>> = {}
  let currentCombination = combinations[0]
  let teamRerollAvailable = true
  let eraRerollAvailable = true
  let eventIndex = 0

  const combinationIsPlayable = (combination: TeamDecade) => catalog.getCardViews(combination).some((player) => (
    !selectedCardIds.has(player.id) && isPlayerSelectable(player, roster)
  ))

  const selectExpectedCombination = (mode: 'both' | 'team' | 'era') => randomizer.select({
    mode,
    current: currentCombination,
    usedCombinationIds,
    teamRerollAvailable,
    eraRerollAvailable,
    roundsRemaining: ROSTER_SLOTS.length - selectedCardIds.size,
    isPlayable: catalog.getCombinationPlayability?.(selectedCardIds, roster) ?? combinationIsPlayable,
  })

  for (let round = 1; round <= ROSTER_SLOTS.length; round += 1) {
    const initialRoll = requireEvent(transcript, eventIndex, 'initial-roll', round)
    eventIndex += 1
    if (initialRoll.round !== round) rejectDraftReplay(`Initial roll has invalid round ${initialRoll.round}; expected ${round}.`)
    const expectedInitial = selectExpectedCombination('both')
    if (!expectedInitial) rejectDraftReplay(`Round ${round} has no possible initial combination.`)
    if (initialRoll.combinationId !== expectedInitial.id) rejectDraftReplay(`Round ${round} landed combination was altered.`)
    if (usedCombinationIds.has(expectedInitial.id)) rejectDraftReplay(`Combination ${expectedInitial.id} landed more than once.`)
    currentCombination = expectedInitial
    usedCombinationIds.add(expectedInitial.id)

    while (transcript.events[eventIndex]?.type === 'reroll') {
      const reroll = requireEvent(transcript, eventIndex, 'reroll', round)
      eventIndex += 1
      if (reroll.round !== round) rejectDraftReplay(`Reroll has invalid round ${reroll.round}; expected ${round}.`)
      if (reroll.reroll !== 'team' && reroll.reroll !== 'era') rejectDraftReplay(`Invalid reroll type in round ${round}.`)
      if (reroll.discardedCombinationId !== currentCombination.id) rejectDraftReplay(`Reroll discarded combination is invalid in round ${round}.`)
      if (reroll.reroll === 'team' && !teamRerollAvailable) rejectDraftReplay('More than one team reroll is not permitted.')
      if (reroll.reroll === 'era' && !eraRerollAvailable) rejectDraftReplay('More than one era reroll is not permitted.')

      const expectedReroll = selectExpectedCombination(reroll.reroll)
      if (!expectedReroll) rejectDraftReplay(`Round ${round} ${reroll.reroll} reroll has no possible result.`)
      if (reroll.resultingCombinationId !== expectedReroll.id) rejectDraftReplay(`Round ${round} ${reroll.reroll} reroll result was altered.`)
      if (usedCombinationIds.has(expectedReroll.id)) rejectDraftReplay(`Combination ${expectedReroll.id} landed more than once.`)
      currentCombination = expectedReroll
      usedCombinationIds.add(expectedReroll.id)
      if (reroll.reroll === 'team') teamRerollAvailable = false
      else eraRerollAvailable = false
    }

    const pick = requireEvent(transcript, eventIndex, 'pick', round)
    eventIndex += 1
    if (pick.round !== round) rejectDraftReplay(`Pick has invalid round ${pick.round}; expected ${round}.`)
    if (pick.pickOrder !== round) rejectDraftReplay(`Pick order ${pick.pickOrder} is invalid; expected ${round}.`)
    if (pick.combinationId !== currentCombination.id) rejectDraftReplay(`Pick ${round} references the wrong franchise-decade pool.`)
    if (selectedCardIds.has(pick.canonicalCardId)) rejectDraftReplay(`Duplicate canonical card ID: ${pick.canonicalCardId}`)

    const player = catalog.hydrateCard(currentCombination, pick.canonicalCardId)
    if (!player) rejectDraftReplay(`Card ${pick.canonicalCardId} is not in combination ${currentCombination.id}.`)
    if (player.franchiseId !== currentCombination.franchiseId || player.decade !== currentCombination.decade) {
      rejectDraftReplay(`Canonical card ${player.id} is inconsistent with its franchise-decade pool.`)
    }
    validatePickMetadata(pick, player)
    if (!POSITIONS.includes(pick.assignedPosition)) rejectDraftReplay(`Assigned position is invalid for pick ${round}.`)
    const slot = resolveAssignmentSlot(player, pick.assignedPosition, roster)
    if (!slot) rejectDraftReplay(`Card ${player.id} cannot be assigned to ${pick.assignedPosition} at pick ${round}.`)
    roster = { ...roster, [slot]: player }
    selectedCardIds.add(player.id)
  }

  if (eventIndex !== transcript.events.length) rejectDraftReplay(`Transcript has ${transcript.events.length - eventIndex} extra event(s).`)
  if (selectedCardIds.size !== ROSTER_SLOTS.length) rejectDraftReplay('Transcript does not contain exactly 14 unique canonical cards.')
  for (const { id } of ROSTER_SLOTS) if (!roster[id]) rejectDraftReplay(`Final roster is missing slot ${id}.`)
  return Object.freeze({ ...roster }) as ValidatedDraftRoster<TCard>
}
