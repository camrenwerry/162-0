import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../src/config/versions'
import type { DraftTranscript, DraftTranscriptEvent } from '../src/game/DraftTranscript'
import { getAvailablePositions, isPlayerSelectable, resolveAssignmentSlot } from '../src/game/Eligibility'
import { Randomizer } from '../src/game/Randomizer'
import {
  CURRENT_CANONICAL_DRAFT_DATA,
  CURRENT_REPLAY_VERSION_SUPPORT,
  replayDraft,
} from '../src/game/ReplayDraft'
import { createSeededRandom } from '../src/game/SeededRandom'
import { calculateDraftResult } from '../src/game/scoring'
import { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from '../src/game/scoring/calculatePlayerValue'
import { TeamPool } from '../src/game/TeamPool'
import { ROSTER_SLOTS, type Player, type Position, type Roster, type TeamDecade } from '../src/types/draft'
import { historicalPeakRoster } from './lib/scoring-fixtures'

type RerollPlan = Readonly<Record<number, 'team' | 'era'>>
type DraftStrategy = 'browser-first' | 'best-available'

const pool = new TeamPool()
const combinations = pool.getCombinations()
const fixtureDirectory = path.join(process.cwd(), 'scripts/fixtures/transcripts')
const rosterFixtureDirectory = path.join(process.cwd(), 'scripts/fixtures/rosters')

function seedFor(value: number) {
  const word = (offset: number) => ((value + offset * 0x9e3779b9) >>> 0).toString(16).padStart(8, '0')
  return `seeded-v1:${word(0)}${word(1)}${word(2)}${word(3)}` as const
}

function publicResult(roster: Roster) {
  const calculation = calculateDraftResult(roster)
  const { result } = calculation
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
    roster: Object.fromEntries(ROSTER_SLOTS.map(({ id, position }) => [id, { canonicalCardId: roster[id]?.id, assignedPosition: position }])),
  }
}

function playerValue(player: Player, position: Position, roster: Roster) {
  const slotId = resolveAssignmentSlot(player, position, roster)
  if (!slotId) return Number.NEGATIVE_INFINITY
  if (position === 'SP') return player.playerType === 'hitter' ? Number.NEGATIVE_INFINITY : calculateStartingPitcherValue(player, slotId).value
  if (position === 'RP') return player.playerType === 'hitter' ? Number.NEGATIVE_INFINITY : calculateReliefPitcherValue(player, slotId).value
  return player.playerType === 'pitcher' ? Number.NEGATIVE_INFINITY : calculateHitterValue(player, position, slotId).value
}

function choosePlayer(
  combination: TeamDecade,
  roster: Roster,
  selectedCardIds: ReadonlySet<string>,
  round: number,
  strategy: DraftStrategy,
) {
  if (strategy === 'browser-first') {
    const position = ROSTER_SLOTS[round - 1].position
    const player = pool.query({ combination, excludedIds: selectedCardIds, filter: 'ALL', sort: 'name', search: '' })
      .find((candidate) => getAvailablePositions(candidate, roster).includes(position))
    return player ? { player, position } : null
  }

  const candidates = pool.getPlayers(combination).flatMap((player) => (
    selectedCardIds.has(player.id)
      ? []
      : getAvailablePositions(player, roster).map((position) => ({ player, position, value: playerValue(player, position, roster) }))
  )).sort((left, right) => right.value - left.value || left.player.id.localeCompare(right.player.id) || left.position.localeCompare(right.position))
  return candidates[0] ?? null
}

function buildTranscript(value: number, strategy: DraftStrategy, rerolls: RerollPlan, seedOverride?: ReturnType<typeof seedFor>) {
  const gameplaySeed = seedOverride ?? seedFor(value)
  const randomizer = new Randomizer(pool, createSeededRandom(gameplaySeed))
  const usedCombinationIds = new Set<string>()
  const selectedCardIds = new Set<string>()
  const events: DraftTranscriptEvent[] = []
  let roster: Roster = {}
  let currentCombination = combinations[0]
  let teamRerollAvailable = true
  let eraRerollAvailable = true

  const combinationIsPlayable = (combination: TeamDecade) => pool.getPlayers(combination).some((player) => (
    !selectedCardIds.has(player.id) && isPlayerSelectable(player, roster)
  ))
  const selectCombination = (mode: 'both' | 'team' | 'era') => randomizer.select({
    mode,
    current: currentCombination,
    usedCombinationIds,
    teamRerollAvailable,
    eraRerollAvailable,
    roundsRemaining: ROSTER_SLOTS.length - selectedCardIds.size,
    isPlayable: combinationIsPlayable,
  })

  for (let round = 1; round <= ROSTER_SLOTS.length; round += 1) {
    const initial = selectCombination('both')
    if (!initial) return null
    currentCombination = initial
    usedCombinationIds.add(initial.id)
    events.push({ type: 'initial-roll', round, combinationId: initial.id })

    const reroll = rerolls[round]
    if (reroll) {
      const discarded = currentCombination
      const result = selectCombination(reroll)
      if (!result) return null
      currentCombination = result
      usedCombinationIds.add(result.id)
      if (reroll === 'team') teamRerollAvailable = false
      else eraRerollAvailable = false
      events.push({
        type: 'reroll', reroll, round,
        discardedCombinationId: discarded.id,
        resultingCombinationId: result.id,
      })
    }

    const selection = choosePlayer(currentCombination, roster, selectedCardIds, round, strategy)
    if (!selection) return null
    const slotId = resolveAssignmentSlot(selection.player, selection.position, roster)
    if (!slotId) return null
    roster = { ...roster, [slotId]: selection.player }
    selectedCardIds.add(selection.player.id)
    events.push({
      type: 'pick', round, pickOrder: round, combinationId: currentCombination.id,
      canonicalCardId: selection.player.id,
      sourcePlayerId: selection.player.playerId,
      assignedPosition: selection.position,
      featuredSeason: selection.player.featuredSeason,
    })
  }

  const transcript: DraftTranscript = Object.freeze({
    header: Object.freeze({
      transcriptSchemaVersion: 'draft-transcript-v1',
      appVersion: APP_VERSION,
      gameRulesVersion: GAME_RULES_VERSION,
      rngVersion: RNG_VERSION,
      scoringVersion: SCORING_VERSION,
      dataVersion: DATA_VERSION,
      canonicalDataDigest: DATA_DIGEST,
      draftId: `c1000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`,
      gameplaySeed,
      createdAt: '2026-07-17T00:00:00.000Z',
    }),
    events: Object.freeze(events.map((event) => Object.freeze(event))),
  })
  const replayed = replayDraft(transcript, CURRENT_CANONICAL_DRAFT_DATA, CURRENT_REPLAY_VERSION_SUPPORT)
  assert.deepEqual(
    Object.fromEntries(ROSTER_SLOTS.map(({ id }) => [id, replayed[id].id])),
    Object.fromEntries(ROSTER_SLOTS.map(({ id }) => [id, roster[id]?.id])),
  )
  return { transcript, roster }
}

function writeTranscriptFixture(filename: string, label: string, built: NonNullable<ReturnType<typeof buildTranscript>>) {
  const result = publicResult(built.roster)
  const fixture = { fixtureVersion: 1, fixtureKind: 'transcript', label, expected: result, transcript: built.transcript }
  fs.writeFileSync(path.join(fixtureDirectory, filename), `${JSON.stringify(fixture, null, 2)}\n`)
  return result
}

fs.mkdirSync(fixtureDirectory, { recursive: true })
fs.mkdirSync(rosterFixtureDirectory, { recursive: true })

const fixed113 = buildTranscript(
  0x16201130,
  'browser-first',
  { 2: 'team', 8: 'era' },
  'seeded-v1:16201130162011301620113016201130',
)
assert(fixed113)
assert.equal(publicResult(fixed113.roster).wins, 113, 'the existing fixed transcript must remain 113–49')
const noRerolls = buildTranscript(0x16201131, 'browser-first', {})
assert(noRerolls)
const twoRerolls = buildTranscript(
  0x16201131,
  'browser-first',
  { 2: 'team', 8: 'era' },
  'seeded-v1:16201131162011311620113116201131',
)
assert(twoRerolls)

let allTime: NonNullable<ReturnType<typeof buildTranscript>> | null = null
let allTimeSeedIndex = 0
for (let value = 1; value <= 50_000; value += 1) {
  const candidate = buildTranscript(value, 'best-available', { 2: 'team', 8: 'era' })
  if (candidate && publicResult(candidate.roster).wins === 145) {
    allTime = candidate
    allTimeSeedIndex = value
    break
  }
}
assert(allTime, 'deterministic search did not find a legal 145–17 transcript in the bounded seed range')

const fixedResult = writeTranscriptFixture('fixed-113.json', 'Existing fixed 113–49 transcript', fixed113)
const noRerollResult = writeTranscriptFixture('ordinary-no-rerolls.json', 'Ordinary draft without rerolls', noRerolls)
const twoRerollResult = writeTranscriptFixture('ordinary-two-rerolls.json', 'Ordinary draft using both rerolls', twoRerolls)
const allTimeResult = writeTranscriptFixture('all-time-145.json', 'Legal all-time 145–17 transcript', allTime)

const peakRoster = historicalPeakRoster()
const peakCalculation = calculateDraftResult(peakRoster)
assert.equal(peakCalculation.result.wins, 162)
assert(peakCalculation.diagnostics.perfectRequirementsMet)
const rosterGolden = {
  fixtureVersion: 1,
  fixtureKind: 'roster-golden',
  label: 'Constructive 162–0 roster golden (not a replay transcript)',
  roster: Object.fromEntries(ROSTER_SLOTS.map(({ id }) => [id, peakRoster[id]?.id])),
  expected: publicResult(peakRoster),
  expectedDiagnostics: {
    projectedWinsBeforePerfectCheck: peakCalculation.diagnostics.projectedWinsBeforePerfectCheck,
    perfectRequirementsMet: peakCalculation.diagnostics.perfectRequirementsMet,
  },
}
fs.writeFileSync(path.join(rosterFixtureDirectory, 'constructive-162.json'), `${JSON.stringify(rosterGolden, null, 2)}\n`)

console.log(JSON.stringify({
  fixed: { seed: fixed113.transcript.header.gameplaySeed, record: `${fixedResult.wins}-${fixedResult.losses}` },
  ordinaryNoRerolls: { seed: noRerolls.transcript.header.gameplaySeed, record: `${noRerollResult.wins}-${noRerollResult.losses}` },
  ordinaryTwoRerolls: { seed: twoRerolls.transcript.header.gameplaySeed, record: `${twoRerollResult.wins}-${twoRerollResult.losses}` },
  allTime: { seedIndex: allTimeSeedIndex, seed: allTime.transcript.header.gameplaySeed, record: `${allTimeResult.wins}-${allTimeResult.losses}` },
  constructive: { record: `${peakCalculation.result.wins}-${peakCalculation.result.losses}` },
}, null, 2))
