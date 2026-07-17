import workerCatalogData from '../../data/generated/worker-catalog.json'
import { DATA_DIGEST, DATA_VERSION, SCORING_VERSION } from '../../config/versions'
import { POSITIONS, type Decade, type Position, type TeamDecade } from '../../types/draft'
import type {
  ScoringHitter,
  ScoringHitterStats,
  ScoringHitterVisibleStats,
  ScoringPitcher,
  ScoringPitcherStats,
  ScoringPitcherVisibleStats,
  ScoringTwoWayPlayer,
} from '../scoring/types'
import type { HydratedReplayCard, ReplayCardIdentity, ReplayCatalog } from './types'

const WORKER_CATALOG_SCHEMA_VERSION = 1
const POSITION_BITS = POSITIONS.map((position, index) => [position, 1 << index] as const)

type NullableNumber = number | null
type HitterVisibleTuple = readonly [NullableNumber, NullableNumber, NullableNumber, NullableNumber, NullableNumber, NullableNumber, NullableNumber]
type PitcherVisibleTuple = readonly [NullableNumber, NullableNumber, NullableNumber, NullableNumber]
type HitterScoringTuple = readonly [number, number, NullableNumber, NullableNumber, NullableNumber]
type PitcherScoringTuple = readonly [NullableNumber, number, NullableNumber, NullableNumber, NullableNumber, NullableNumber, number, NullableNumber]
type WorkerCardTuple = readonly [
  string,
  string,
  string,
  number,
  number,
  0 | 1 | 2,
  HitterVisibleTuple | null,
  PitcherVisibleTuple | null,
  HitterScoringTuple | null,
  PitcherScoringTuple | null,
]
type WorkerCombinationTuple = readonly [string, string, string, string, Decade, readonly WorkerCardTuple[]]

interface WorkerCatalogFile {
  readonly schemaVersion: number
  readonly scoringVersion: string
  readonly dataVersion: string
  readonly dataDigest: string
  readonly combinations: readonly WorkerCombinationTuple[]
}

export class WorkerCatalogError extends Error {
  override readonly name = 'WorkerCatalogError'
  readonly code = 'worker_catalog_invalid'
}

function invalidCatalog(message: string): never {
  throw new WorkerCatalogError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isNullableFiniteNumber(value: unknown): value is NullableNumber {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isNumberTuple(value: unknown, length: number): value is readonly NullableNumber[] {
  return Array.isArray(value) && value.length === length && value.every(isNullableFiniteNumber)
}

function isWorkerCardTuple(value: unknown): value is WorkerCardTuple {
  if (!Array.isArray(value) || value.length !== 10) return false
  const [id, playerId, name, featuredSeason, positionMask, kind, hitterVisible, pitcherVisible, hitterScoring, pitcherScoring] = value
  if (
    typeof id !== 'string'
    || typeof playerId !== 'string'
    || typeof name !== 'string'
    || !Number.isInteger(featuredSeason)
    || !Number.isInteger(positionMask)
    || positionMask <= 0
    || positionMask >= 1 << POSITIONS.length
    || (kind !== 0 && kind !== 1 && kind !== 2)
  ) return false
  if (kind === 0) return isNumberTuple(hitterVisible, 7) && pitcherVisible === null && isNumberTuple(hitterScoring, 5) && pitcherScoring === null
  if (kind === 1) return hitterVisible === null && isNumberTuple(pitcherVisible, 4) && hitterScoring === null && isNumberTuple(pitcherScoring, 8)
  return isNumberTuple(hitterVisible, 7) && isNumberTuple(pitcherVisible, 4) && isNumberTuple(hitterScoring, 5) && isNumberTuple(pitcherScoring, 8)
}

function isWorkerCombinationTuple(value: unknown): value is WorkerCombinationTuple {
  return Array.isArray(value)
    && value.length === 6
    && value.slice(0, 5).every((field) => typeof field === 'string' && field.length > 0)
    && /^\d{4}s$/.test(value[4])
    && Array.isArray(value[5])
    && value[5].every(isWorkerCardTuple)
}

function parseWorkerCatalog(value: unknown): WorkerCatalogFile {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'scoringVersion', 'dataVersion', 'dataDigest', 'combinations'])) {
    return invalidCatalog('Worker catalog header is malformed.')
  }
  const combinations = value.combinations
  if (
    typeof value.schemaVersion !== 'number'
    || typeof value.scoringVersion !== 'string'
    || typeof value.dataVersion !== 'string'
    || typeof value.dataDigest !== 'string'
    || !Array.isArray(combinations)
    || !combinations.every(isWorkerCombinationTuple)
  ) return invalidCatalog('Worker catalog payload is malformed.')
  return {
    schemaVersion: value.schemaVersion,
    scoringVersion: value.scoringVersion,
    dataVersion: value.dataVersion,
    dataDigest: value.dataDigest,
    combinations,
  }
}

function positionsForMask(mask: number): readonly Position[] {
  return Object.freeze(POSITION_BITS.filter(([, bit]) => (mask & bit) !== 0).map(([position]) => position))
}

function toHitterVisible(tuple: HitterVisibleTuple): ScoringHitterVisibleStats {
  return Object.freeze({ ops: tuple[0], obp: tuple[1], slg: tuple[2], hr: tuple[3], rbi: tuple[4], sb: tuple[5], avg: tuple[6] })
}

function toPitcherVisible(tuple: PitcherVisibleTuple): ScoringPitcherVisibleStats {
  return Object.freeze({ era: tuple[0], whip: tuple[1], so: tuple[2], sv: tuple[3] })
}

function toHitterScoring(tuple: HitterScoringTuple): ScoringHitterStats {
  return Object.freeze({
    plateAppearances: tuple[0], games: tuple[1], baserunningValue: tuple[2],
    defensiveValue: tuple[3], eraAdjustedOffense: tuple[4],
  })
}

function toPitcherScoring(tuple: PitcherScoringTuple): ScoringPitcherStats {
  return Object.freeze({
    fip: tuple[0], inningsPitched: tuple[1], strikeoutRate: tuple[2], walkRate: tuple[3],
    starts: tuple[4] ?? undefined, gamesStarted: tuple[5] ?? undefined,
    reliefAppearances: tuple[6], eraAdjustedPitching: tuple[7],
  })
}

function cardIdentity(combination: WorkerCombinationTuple, card: WorkerCardTuple): ReplayCardIdentity {
  const kind = card[5]
  return Object.freeze({
    id: card[0],
    playerId: card[1],
    franchiseId: combination[1],
    decade: combination[4],
    featuredSeason: card[3],
    eligiblePositions: positionsForMask(card[4]),
    type: kind === 1 ? 'pitcher' : 'hitter',
    isTwoWay: kind === 2,
  })
}

function hydrateCard(combination: WorkerCombinationTuple, card: WorkerCardTuple): HydratedReplayCard {
  const identity = cardIdentity(combination, card)
  const name = card[2]
  if (card[5] === 0 && card[6] && card[8]) {
    const hitter: ReplayCardIdentity & ScoringHitter = Object.freeze({
      ...identity,
      name,
      playerType: 'hitter',
      visibleStats: toHitterVisible(card[6]),
      pitchingVisibleStats: null,
      scoringStats: toHitterScoring(card[8]),
      pitchingScoringStats: null,
    })
    return hitter
  }
  if (card[5] === 1 && card[7] && card[9]) {
    const pitcher: ReplayCardIdentity & ScoringPitcher = Object.freeze({
      ...identity,
      name,
      playerType: 'pitcher',
      visibleStats: toPitcherVisible(card[7]),
      pitchingVisibleStats: null,
      scoringStats: toPitcherScoring(card[9]),
      pitchingScoringStats: null,
    })
    return pitcher
  }
  if (card[5] === 2 && card[6] && card[7] && card[8] && card[9]) {
    const twoWay: ReplayCardIdentity & ScoringTwoWayPlayer = Object.freeze({
      ...identity,
      name,
      playerType: 'twoWay',
      visibleStats: toHitterVisible(card[6]),
      pitchingVisibleStats: toPitcherVisible(card[7]),
      scoringStats: toHitterScoring(card[8]),
      pitchingScoringStats: toPitcherScoring(card[9]),
    })
    return twoWay
  }
  return invalidCatalog(`Worker catalog card ${card[0]} has inconsistent scoring fields.`)
}

/**
 * Validate and adapt the compact artifact. Only combination descriptors are
 * materialized eagerly; scoring-rich players are hydrated by selected card ID.
 */
export function createWorkerReplayCatalog(input: unknown = workerCatalogData): ReplayCatalog {
  const catalog = parseWorkerCatalog(input)
  if (catalog.schemaVersion !== WORKER_CATALOG_SCHEMA_VERSION) invalidCatalog('Worker catalog schema version is unsupported.')
  if (catalog.scoringVersion !== SCORING_VERSION) invalidCatalog('Worker catalog scoring version is unsupported.')
  if (catalog.dataVersion !== DATA_VERSION) invalidCatalog('Worker catalog data version is unsupported.')
  if (catalog.dataDigest !== DATA_DIGEST) invalidCatalog('Worker catalog canonical digest is unsupported.')

  const combinations = Object.freeze(catalog.combinations.map((combination) => Object.freeze({
    id: combination[0],
    franchiseId: combination[1],
    team: combination[2],
    teamName: combination[3],
    decade: combination[4],
  })))
  const tuplesByCombinationId = new Map(catalog.combinations.map((combination) => [combination[0], combination]))
  if (tuplesByCombinationId.size !== catalog.combinations.length) invalidCatalog('Worker catalog contains duplicate combination IDs.')
  const cardViews = new Map<string, readonly ReplayCardIdentity[]>()

  return Object.freeze({
    dataDigest: catalog.dataDigest,
    getCombinations: () => combinations,
    getCardViews: (combination: TeamDecade) => {
      const cached = cardViews.get(combination.id)
      if (cached) return cached
      const tuple = tuplesByCombinationId.get(combination.id)
      if (!tuple) return []
      const views = Object.freeze(tuple[5].map((card) => cardIdentity(tuple, card)))
      cardViews.set(combination.id, views)
      return views
    },
    hydrateCard: (combination: TeamDecade, canonicalCardId: string) => {
      const tuple = tuplesByCombinationId.get(combination.id)
      if (!tuple) return null
      const card = tuple[5].find((candidate) => candidate[0] === canonicalCardId)
      return card ? hydrateCard(tuple, card) : null
    },
  })
}
