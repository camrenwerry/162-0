import assert from 'node:assert/strict'
import fixed113Data from './fixtures/transcripts/fixed-113.json'
import noRerollsData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import allTime145Data from './fixtures/transcripts/all-time-145.json'
import constructive162Data from './fixtures/rosters/constructive-162.json'
import { PLAYER_CARDS } from '../src/data/generated'
import type { DraftTranscript } from '../src/game/DraftTranscript'
import {
  CURRENT_CANONICAL_DRAFT_DATA,
  CURRENT_REPLAY_VERSION_SUPPORT,
  replayDraft,
} from '../src/game/ReplayDraft'
import { calculateDraftResult } from '../src/game/scoring'
import type { ScoringPlayer } from '../src/game/scoring/types'
import { createWorkerReplayCatalog, WorkerCatalogError } from '../src/game/replay/WorkerCatalog'
import { replayDraftWithCatalog } from '../src/game/replay/replayDraft'
import type { HydratedReplayCard } from '../src/game/replay/types'
import { validateTranscriptShape } from '../src/game/replay/validateTranscript'
import { ROSTER_SLOTS, type Player, type Position, type Roster, type RosterSlotId } from '../src/types/draft'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface MutableTranscript {
  header: Record<string, unknown>
  events: Record<string, unknown>[]
}

function mutableTranscript(source: unknown): MutableTranscript {
  const value: unknown = structuredClone(source)
  if (
    !isRecord(value)
    || !isRecord(value.header)
    || !Array.isArray(value.events)
    || !value.events.every(isRecord)
  ) throw new TypeError('Fixture transcript is malformed.')
  return { header: value.header, events: value.events }
}

function publicResult<TPlayer extends ScoringPlayer>(roster: Partial<Record<RosterSlotId, TPlayer>>) {
  const result = calculateDraftResult(roster).result
  return {
    wins: result.wins,
    losses: result.losses,
    overallScore: result.overallScore,
    overallGrade: result.overallGrade,
    tierLabel: result.tierLabel,
    categoryScores: result.categoryScores,
    categoryGrades: result.categoryGrades,
    strongestCategory: result.strongestCategory,
    weakestCategory: result.weakestCategory,
    bestPlayerValue: result.bestPlayerValue,
    scoringVersion: result.scoringVersion,
    roster: Object.fromEntries(ROSTER_SLOTS.map(({ id, position }) => [id, {
      canonicalCardId: roster[id]?.id,
      assignedPosition: position,
    }])),
  }
}

function rosterIds(roster: Partial<Record<RosterSlotId, { readonly id: string }>>) {
  return Object.fromEntries(ROSTER_SLOTS.map(({ id }) => [id, roster[id]?.id ?? null]))
}

const workerCatalog = createWorkerReplayCatalog()
const transcriptFixtures = [
  deepFreeze(fixed113Data),
  deepFreeze(noRerollsData),
  deepFreeze(twoRerollsData),
  deepFreeze(allTime145Data),
] as const

for (const fixture of transcriptFixtures) {
  assert(Object.isFrozen(fixture) && Object.isFrozen(fixture.transcript) && Object.isFrozen(fixture.transcript.events))
  const untrustedTranscript: unknown = fixture.transcript
  validateTranscriptShape(untrustedTranscript)
  const browserRoster = replayDraft(untrustedTranscript, CURRENT_CANONICAL_DRAFT_DATA, CURRENT_REPLAY_VERSION_SUPPORT)
  const workerRoster = replayDraftWithCatalog(untrustedTranscript, workerCatalog, CURRENT_REPLAY_VERSION_SUPPORT)
  assert.deepEqual(rosterIds(workerRoster), rosterIds(browserRoster), `${fixture.label}: browser/Worker roster parity`)
  assert.deepEqual(publicResult(workerRoster), publicResult(browserRoster), `${fixture.label}: browser/Worker scoring parity`)
  assert.deepEqual(publicResult(workerRoster), fixture.expected, `${fixture.label}: immutable public golden`)
  assert.equal(new Set(Object.values(rosterIds(workerRoster))).size, ROSTER_SLOTS.length, `${fixture.label}: unique canonical cards`)
}

assert.deepEqual([fixed113Data.expected.wins, fixed113Data.expected.losses], [113, 49])
assert.equal(noRerollsData.transcript.events.some(({ type }) => type === 'reroll'), false)
assert.deepEqual(
  twoRerollsData.transcript.events.filter(({ type }) => type === 'reroll').map((event) => event.type === 'reroll' ? event.reroll : null).sort(),
  ['era', 'team'],
)
assert.deepEqual([allTime145Data.expected.wins, allTime145Data.expected.losses], [145, 17])

const canonicalById = new Map(PLAYER_CARDS.map((player) => [player.id, player]))
const constructiveRoster: Roster = {}
for (const { id } of ROSTER_SLOTS) {
  const player = canonicalById.get(constructive162Data.roster[id])
  assert(player, `constructive roster card missing for ${id}`)
  constructiveRoster[id] = player
}
const constructiveCalculation = calculateDraftResult(constructiveRoster)
assert.deepEqual(publicResult(constructiveRoster), constructive162Data.expected)
assert.deepEqual([constructiveCalculation.result.wins, constructiveCalculation.result.losses], [162, 0])
assert.equal(constructiveCalculation.diagnostics.perfectRequirementsMet, true)
assert.equal(constructiveCalculation.diagnostics.projectedWinsBeforePerfectCheck, 152)
assert.equal(constructive162Data.fixtureKind, 'roster-golden')
assert.match(constructive162Data.label, /not a replay transcript/i)

function canonicalWorkerProjection(player: Player) {
  const hitterVisible = player.playerType === 'pitcher' ? null : {
    ops: player.visibleStats.ops, obp: player.visibleStats.obp, slg: player.visibleStats.slg,
    hr: player.visibleStats.hr, rbi: player.visibleStats.rbi, sb: player.visibleStats.sb, avg: player.visibleStats.avg,
  }
  const pitcherVisibleSource = player.playerType === 'hitter' ? null : player.playerType === 'pitcher' ? player.visibleStats : player.pitchingVisibleStats
  const pitcherScoringSource = player.playerType === 'hitter' ? null : player.playerType === 'pitcher' ? player.scoringStats : player.pitchingScoringStats
  return {
    id: player.id,
    playerId: player.playerId,
    name: player.name,
    franchiseId: player.franchiseId,
    decade: player.decade,
    featuredSeason: player.featuredSeason,
    eligiblePositions: player.eligiblePositions,
    isTwoWay: player.isTwoWay,
    type: player.type,
    playerType: player.playerType,
    visibleStats: player.playerType === 'pitcher' ? {
      era: player.visibleStats.era, whip: player.visibleStats.whip, so: player.visibleStats.so, sv: player.visibleStats.sv,
    } : hitterVisible,
    pitchingVisibleStats: player.playerType === 'twoWay' && pitcherVisibleSource ? {
      era: pitcherVisibleSource.era, whip: pitcherVisibleSource.whip, so: pitcherVisibleSource.so, sv: pitcherVisibleSource.sv,
    } : null,
    scoringStats: player.playerType === 'pitcher' && pitcherScoringSource ? {
      fip: pitcherScoringSource.fip,
      inningsPitched: pitcherScoringSource.inningsPitched,
      strikeoutRate: pitcherScoringSource.strikeoutRate,
      walkRate: pitcherScoringSource.walkRate,
      starts: pitcherScoringSource.starts ?? undefined,
      gamesStarted: pitcherScoringSource.gamesStarted ?? undefined,
      reliefAppearances: pitcherScoringSource.reliefAppearances,
      eraAdjustedPitching: pitcherScoringSource.eraAdjustedPitching ?? null,
    } : player.playerType !== 'pitcher' ? {
      plateAppearances: player.scoringStats.plateAppearances,
      games: player.scoringStats.games,
      baserunningValue: player.scoringStats.baserunningValue,
      defensiveValue: player.scoringStats.defensiveValue,
      eraAdjustedOffense: player.scoringStats.eraAdjustedOffense ?? null,
    } : null,
    pitchingScoringStats: player.playerType === 'twoWay' && pitcherScoringSource ? {
      fip: pitcherScoringSource.fip,
      inningsPitched: pitcherScoringSource.inningsPitched,
      strikeoutRate: pitcherScoringSource.strikeoutRate,
      walkRate: pitcherScoringSource.walkRate,
      starts: pitcherScoringSource.starts ?? undefined,
      gamesStarted: pitcherScoringSource.gamesStarted ?? undefined,
      reliefAppearances: pitcherScoringSource.reliefAppearances,
      eraAdjustedPitching: pitcherScoringSource.eraAdjustedPitching ?? null,
    } : null,
  }
}

function hydratedWorkerProjection(player: HydratedReplayCard) {
  return {
    id: player.id,
    playerId: player.playerId,
    name: player.name,
    franchiseId: player.franchiseId,
    decade: player.decade,
    featuredSeason: player.featuredSeason,
    eligiblePositions: player.eligiblePositions,
    isTwoWay: player.isTwoWay,
    type: player.type,
    playerType: player.playerType,
    visibleStats: player.visibleStats,
    pitchingVisibleStats: player.pitchingVisibleStats,
    scoringStats: player.scoringStats,
    pitchingScoringStats: player.pitchingScoringStats,
  }
}

let projectedCards = 0
const projectedIds = new Set<string>()
for (const combination of workerCatalog.getCombinations()) {
  const canonicalCards = CURRENT_CANONICAL_DRAFT_DATA.playerPools[combination.id]
  const workerViews = workerCatalog.getCardViews(combination)
  assert.deepEqual(workerViews.map(({ id }) => id), canonicalCards.map(({ id }) => id), `${combination.id}: deterministic card order`)
  for (const canonicalCard of canonicalCards) {
    const workerCard = workerCatalog.hydrateCard(combination, canonicalCard.id)
    assert(workerCard, `${canonicalCard.id}: Worker hydration`)
    assert.deepEqual(hydratedWorkerProjection(workerCard), canonicalWorkerProjection(canonicalCard), `${canonicalCard.id}: complete projected field parity`)
    projectedCards += 1
    projectedIds.add(workerCard.id)
  }
}
assert.equal(workerCatalog.getCombinations().length, 261)
assert.equal(projectedCards, 9_335)
assert.equal(projectedIds.size, 9_335)

function replayUntrusted(candidate: unknown) {
  validateTranscriptShape(candidate)
  return replayDraftWithCatalog(candidate, workerCatalog, CURRENT_REPLAY_VERSION_SUPPORT)
}

const base = () => mutableTranscript(fixed113Data.transcript)
const initialIndices = fixed113Data.transcript.events.flatMap((event, index) => event.type === 'initial-roll' ? [index] : [])
const pickIndices = fixed113Data.transcript.events.flatMap((event, index) => event.type === 'pick' ? [index] : [])
const rerollIndex = fixed113Data.transcript.events.findIndex((event) => event.type === 'reroll')
assert(rerollIndex >= 0)

function expectTamper(label: string, mutate: (candidate: MutableTranscript) => void, expected: RegExp) {
  const candidate = base()
  mutate(candidate)
  assert.throws(() => replayUntrusted(candidate), expected, label)
}

expectTamper('altered seed', (candidate) => { candidate.header.gameplaySeed = noRerollsData.transcript.header.gameplaySeed }, /landed combination was altered/)
expectTamper('altered roll', (candidate) => { candidate.events[initialIndices[0]].combinationId = 'ana-1960s' }, /landed combination was altered/)
expectTamper('altered reroll', (candidate) => { candidate.events[rerollIndex].resultingCombinationId = 'ana-1960s' }, /reroll result was altered/)
expectTamper('altered card', (candidate) => { candidate.events[pickIndices[0]].canonicalCardId = 'ana-1960s-adcocjo01' }, /is not in combination/)
expectTamper('altered source player', (candidate) => { candidate.events[pickIndices[0]].sourcePlayerId = 'altered-source' }, /Source player ID was altered/)
expectTamper('altered featured season', (candidate) => { candidate.events[pickIndices[0]].featuredSeason = 1900 }, /Featured season was altered/)
expectTamper('invalid position', (candidate) => { candidate.events[pickIndices[0]].assignedPosition = 'RP' satisfies Position }, /cannot be assigned to RP/)
expectTamper('duplicate card', (candidate) => { candidate.events[pickIndices[1]].canonicalCardId = candidate.events[pickIndices[0]].canonicalCardId }, /Duplicate canonical card ID/)
expectTamper('wrong version', (candidate) => { candidate.header.scoringVersion = '999' }, /Unsupported scoring version/)
expectTamper('wrong digest', (candidate) => { candidate.header.canonicalDataDigest = '0'.repeat(64) }, /Canonical data digest does not match/)

function duplicatePersonVariant(source: DraftTranscript) {
  const indexedPicks = source.events.flatMap((event, index) => event.type === 'pick' ? [{ event, index }] : [])
  const supportsPosition = (player: Player, position: Position) => (
    position === 'DH' ? player.type === 'hitter' || player.isTwoWay : player.eligiblePositions.includes(position)
  )
  for (let leftIndex = 0; leftIndex < indexedPicks.length; leftIndex += 1) {
    const left = indexedPicks[leftIndex]
    const leftPlayers = CURRENT_CANONICAL_DRAFT_DATA.playerPools[left.event.combinationId]
      .filter((player) => supportsPosition(player, left.event.assignedPosition))
    for (let rightIndex = leftIndex + 1; rightIndex < indexedPicks.length; rightIndex += 1) {
      const right = indexedPicks[rightIndex]
      const rightPlayers = CURRENT_CANONICAL_DRAFT_DATA.playerPools[right.event.combinationId]
        .filter((player) => supportsPosition(player, right.event.assignedPosition))
      for (const leftPlayer of leftPlayers) {
        const rightPlayer = rightPlayers.find((player) => player.playerId === leftPlayer.playerId && player.id !== leftPlayer.id)
        if (!rightPlayer) continue
        const candidate = mutableTranscript(source)
        Object.assign(candidate.events[left.index], {
          canonicalCardId: leftPlayer.id, sourcePlayerId: leftPlayer.playerId, featuredSeason: leftPlayer.featuredSeason,
        })
        Object.assign(candidate.events[right.index], {
          canonicalCardId: rightPlayer.id, sourcePlayerId: rightPlayer.playerId, featuredSeason: rightPlayer.featuredSeason,
        })
        try {
          const roster = replayUntrusted(candidate)
          return { roster, playerId: leftPlayer.playerId, cardIds: [leftPlayer.id, rightPlayer.id] }
        } catch {
          // Keep the search deterministic and try the next canonical pair.
        }
      }
    }
  }
  return null
}

const duplicatePerson = transcriptFixtures.map(({ transcript }) => {
  const candidate: unknown = transcript
  validateTranscriptShape(candidate)
  return duplicatePersonVariant(candidate)
}).find((candidate) => candidate !== null)
assert(duplicatePerson, 'different canonical cards for one source person must remain legal')
assert.equal(new Set(duplicatePerson.cardIds).size, 2)
assert.equal(Object.keys(duplicatePerson.roster).length, ROSTER_SLOTS.length)

assert.throws(
  () => createWorkerReplayCatalog({}),
  (error) => error instanceof WorkerCatalogError && error.code === 'worker_catalog_invalid',
  'malformed catalog errors must be controlled and sanitizable',
)

console.log(`Server validation parity passed: ${transcriptFixtures.length} transcripts, ${projectedCards.toLocaleString()} projected cards, tamper rejection, duplicate-person semantics, and constructive 162–0.`)
