import readiness from '../data/generated/readiness.json'
import metadata from './versionMetadata.json'

export const VERSION_METADATA_SCHEMA_VERSION = metadata.schemaVersion
// Literal bridges preserve compile-time compatibility while JSON remains the single runtime source.
export const APP_VERSION = metadata.appVersion as '1.0.0'
export const GAME_RULES_VERSION = metadata.gameRulesVersion as 'classic-rules-v1'
export const SCORING_VERSION = metadata.scoringVersion as '2.3'
export const DATA_VERSION = metadata.dataVersion as 'lahman-2025-v1'
export const DATA_DIGEST_ALGORITHM = readiness.dataDigestAlgorithm
export const DATA_DIGEST_SCHEMA = readiness.dataDigestSchema
export const DATA_DIGEST = readiness.dataDigest
export const SUBMISSION_SCHEMA_VERSION: null = metadata.submissionSchemaVersion
export const RNG_VERSION: null = metadata.rngVersion
export const LEADERBOARD_VERSION: null = metadata.leaderboardVersion

export type ScoringVersion = typeof SCORING_VERSION

export const VERSION_METADATA = Object.freeze({
  schemaVersion: VERSION_METADATA_SCHEMA_VERSION,
  appVersion: APP_VERSION,
  gameRulesVersion: GAME_RULES_VERSION,
  scoringVersion: SCORING_VERSION,
  dataVersion: DATA_VERSION,
  dataDigestAlgorithm: DATA_DIGEST_ALGORITHM,
  dataDigestSchema: DATA_DIGEST_SCHEMA,
  dataDigest: DATA_DIGEST,
  submissionSchemaVersion: SUBMISSION_SCHEMA_VERSION,
  rngVersion: RNG_VERSION,
  leaderboardVersion: LEADERBOARD_VERSION,
})
