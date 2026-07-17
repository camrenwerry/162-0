import type { ScoringPlayer } from '../scoring/types'
import type { EligibilityPlayer, EligibilityRoster } from '../Eligibility'
import type { Decade, RosterSlotId, TeamDecade } from '../../types/draft'

export interface ReplayCardIdentity extends EligibilityPlayer {
  readonly id: string
  readonly playerId: string
  readonly franchiseId: string
  readonly decade: Decade
  readonly featuredSeason: number
}

export type HydratedReplayCard = ReplayCardIdentity & ScoringPlayer

export interface ReplayCatalog<TCard extends HydratedReplayCard = HydratedReplayCard> {
  readonly dataDigest: string
  getCombinations(): readonly TeamDecade[]
  getCardViews(combination: TeamDecade): readonly ReplayCardIdentity[]
  hydrateCard(combination: TeamDecade, canonicalCardId: string): TCard | null
  /** Optional Worker fast path that must preserve isPlayerSelectable semantics. */
  getCombinationPlayability?(
    selectedCardIds: ReadonlySet<string>,
    roster: EligibilityRoster,
  ): (combination: TeamDecade) => boolean
  /** Optional immutable catalog indexes used only for sanitized error mapping. */
  findCombination?(combinationId: string): TeamDecade | null
  findCardCombination?(canonicalCardId: string): TeamDecade | null
}

export interface SupportedReplayVersionMetadata {
  readonly transcriptSchemaVersions: readonly string[]
  readonly appVersions: readonly string[]
  readonly gameRulesVersions: readonly string[]
  readonly rngVersions: readonly string[]
  readonly scoringVersions: readonly string[]
  readonly dataVersions: readonly string[]
}

export type ValidatedDraftRoster<TCard extends HydratedReplayCard = HydratedReplayCard> = Readonly<Record<RosterSlotId, TCard>>

export class DraftReplayError extends Error {
  override readonly name = 'DraftReplayError'
}

export function rejectDraftReplay(message: string): never {
  throw new DraftReplayError(message)
}
