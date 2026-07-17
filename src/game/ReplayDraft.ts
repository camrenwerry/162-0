import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../config/versions'
import { PLAYER_POOLS, TEAM_DECADES } from '../data/generated'
import type { Player, TeamDecade } from '../types/draft'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from './DraftTranscript'
import { replayDraftWithCatalog } from './replay/replayDraft'
import type { ReplayCatalog, SupportedReplayVersionMetadata, ValidatedDraftRoster } from './replay/types'

export interface CanonicalDraftData {
  readonly combinations: readonly TeamDecade[]
  readonly playerPools: Readonly<Record<string, readonly Player[]>>
  readonly dataDigest: string
}

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

function createBrowserReplayCatalog(canonicalData: CanonicalDraftData): ReplayCatalog<Player> {
  const combinations = canonicalData.combinations.filter((combination) => (
    (canonicalData.playerPools[combination.id]?.length ?? 0) > 0
  ))
  return {
    dataDigest: canonicalData.dataDigest,
    getCombinations: () => combinations,
    getCardViews: (combination) => canonicalData.playerPools[combination.id] ?? [],
    hydrateCard: (combination, canonicalCardId) => (
      canonicalData.playerPools[combination.id]?.find(({ id }) => id === canonicalCardId) ?? null
    ),
  }
}

/** Browser compatibility adapter for the original replay API. */
export function replayDraft(
  transcript: DraftTranscript,
  canonicalData: CanonicalDraftData,
  supportedVersions: SupportedReplayVersionMetadata,
): ValidatedDraftRoster<Player> {
  return replayDraftWithCatalog(transcript, createBrowserReplayCatalog(canonicalData), supportedVersions)
}

export { createBrowserReplayCatalog, replayDraftWithCatalog }
export { DraftReplayError } from './replay/types'
export type { SupportedReplayVersionMetadata, ValidatedDraftRoster } from './replay/types'
