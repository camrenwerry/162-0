import assert from 'node:assert/strict'
import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../src/config/versions'
import { DraftEngine, type DraftSessionIdentity } from '../src/game/DraftEngine'
import {
  appendDraftTranscriptEvent,
  createDraftTranscript,
  TRANSCRIPT_SCHEMA_VERSION,
  type DraftTranscript,
  type DraftTranscriptEvent,
} from '../src/game/DraftTranscript'
import {
  CURRENT_CANONICAL_DRAFT_DATA,
  CURRENT_REPLAY_VERSION_SUPPORT,
  replayDraft,
} from '../src/game/ReplayDraft'
import { TeamPool } from '../src/game/TeamPool'
import { ROSTER_SLOTS, type Position, type Roster } from '../src/types/draft'

type MutableTranscript = {
  header: Record<string, unknown>
  events: Array<Record<string, unknown>>
}

class FakeTimers {
  private now = 0
  private nextId = 1
  private tasks = new Map<number, { due: number; callback: () => void }>()
  private readonly originalSetTimeout = globalThis.setTimeout
  private readonly originalClearTimeout = globalThis.clearTimeout

  install() {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
      const id = this.nextId
      this.nextId += 1
      this.tasks.set(id, {
        due: this.now + Number(delay ?? 0),
        callback: () => callback(...args),
      })
      return id
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
      this.tasks.delete(handle as unknown as number)
    }) as typeof clearTimeout
  }

  flush() {
    let steps = 0
    while (this.tasks.size > 0) {
      steps += 1
      if (steps > 10_000) throw new Error('Fake timer queue did not settle.')
      const [id, task] = [...this.tasks.entries()].sort((left, right) => (
        left[1].due - right[1].due || left[0] - right[0]
      ))[0]
      this.tasks.delete(id)
      this.now = task.due
      task.callback()
    }
  }

  reset() {
    this.tasks.clear()
    this.now = 0
  }

  restore() {
    this.tasks.clear()
    globalThis.setTimeout = this.originalSetTimeout
    globalThis.clearTimeout = this.originalClearTimeout
  }
}

const transcriptHeader = {
  appVersion: APP_VERSION,
  gameRulesVersion: GAME_RULES_VERSION,
  rngVersion: RNG_VERSION,
  scoringVersion: SCORING_VERSION,
  dataVersion: DATA_VERSION,
  canonicalDataDigest: DATA_DIGEST,
  draftId: '00000000-0000-4000-8000-000000000001',
  gameplaySeed: 'seeded-v1:00000001000000020000000300000004',
  createdAt: '2026-01-01T00:00:00.000Z',
} as const

const emptyTranscript = createDraftTranscript(transcriptHeader)
assert(Object.isFrozen(emptyTranscript))
assert(Object.isFrozen(emptyTranscript.header))
assert(Object.isFrozen(emptyTranscript.events))
assert.equal(emptyTranscript.header.transcriptSchemaVersion, TRANSCRIPT_SCHEMA_VERSION)
assert.deepEqual(emptyTranscript.events, [])

const firstEvent = {
  type: 'initial-roll',
  round: 1,
  combinationId: CURRENT_CANONICAL_DRAFT_DATA.combinations[0].id,
} as const
const oneEventTranscript = appendDraftTranscriptEvent(emptyTranscript, firstEvent)
assert.notEqual(oneEventTranscript, emptyTranscript)
assert.equal(oneEventTranscript.header, emptyTranscript.header)
assert.deepEqual(emptyTranscript.events, [], 'functional append must leave the prior transcript unchanged')
assert.deepEqual(oneEventTranscript.events, [firstEvent])
assert(Object.isFrozen(oneEventTranscript))
assert(Object.isFrozen(oneEventTranscript.header))
assert(Object.isFrozen(oneEventTranscript.events))
assert(Object.isFrozen(oneEventTranscript.events[0]))
assert.throws(() => (oneEventTranscript.events as DraftTranscriptEvent[]).push(firstEvent), TypeError)
assert.throws(() => Object.assign(oneEventTranscript.header, { draftId: 'altered' }), TypeError)

const twoEventTranscript = appendDraftTranscriptEvent(oneEventTranscript, {
  type: 'pick',
  round: 1,
  pickOrder: 1,
  combinationId: firstEvent.combinationId,
  canonicalCardId: 'fixture-card',
  sourcePlayerId: 'fixture-source',
  assignedPosition: 'C',
  featuredSeason: 2000,
})
assert.equal(oneEventTranscript.events.length, 1, 'later appends must not mutate prior event snapshots')
assert.equal(twoEventTranscript.events.length, 2)

const FIXED_SEED = 'seeded-v1:16201130162011301620113016201130' as const
const ALTERNATE_SEED = 'seeded-v1:16201131162011311620113116201131' as const
const session = (draftId: string, gameplaySeed: DraftSessionIdentity['gameplaySeed']): DraftSessionIdentity => ({
  gameplaySeed,
  draftId,
  createdAt: '2026-02-03T04:05:06.000Z',
})

function rosterIds(roster: Roster) {
  return Object.fromEntries(ROSTER_SLOTS.map(({ id }) => [id, roster[id]?.id ?? null]))
}

function landedCombinationIds(transcript: DraftTranscript) {
  return transcript.events.flatMap((event) => {
    if (event.type === 'initial-roll') return [event.combinationId]
    if (event.type === 'reroll') return [event.resultingCombinationId]
    return []
  })
}

function driveCompleteDraft(
  timers: FakeTimers,
  reducedMotion: boolean,
  draftId: string,
  cosmeticRandom: () => number,
  gameplaySeed = FIXED_SEED,
) {
  const pool = new TeamPool()
  const engine = new DraftEngine({
    pool,
    reducedMotion: () => reducedMotion,
    cosmeticRandom,
    sessionFactory: () => session(draftId, gameplaySeed),
  })

  engine.start()
  timers.flush()
  for (const [index, slot] of ROSTER_SLOTS.entries()) {
    if (index === 1) {
      engine.rerollTeam()
      timers.flush()
    }
    if (index === 7) {
      engine.rerollEra()
      timers.flush()
    }

    const draft = engine.getSnapshot()
    const candidate = draft.players.find(({ player, isAvailable }) => (
      isAvailable
      && (slot.position === 'DH'
        ? player.type === 'hitter' || player.isTwoWay
        : player.eligiblePositions.includes(slot.position))
    ))
    assert(candidate, `No canonical candidate for ${slot.id}`)
    engine.selectPlayer(candidate.player.id)
    assert(engine.getSnapshot().availablePositions.includes(slot.position))
    engine.assignSelectedPlayer(slot.position)
    timers.flush()
  }

  const snapshot = engine.getSnapshot()
  assert.equal(snapshot.complete, true)
  const transcript = engine.getFinalizedTranscript()
  assert(transcript)
  const result = {
    transcript,
    roster: snapshot.roster,
    landed: landedCombinationIds(transcript),
  }
  engine.dispose()
  timers.flush()
  return result
}

const timers = new FakeTimers()
timers.install()
let reducedDraft: ReturnType<typeof driveCompleteDraft>
let animatedDraft: ReturnType<typeof driveCompleteDraft>
let alternateSeedDraft: ReturnType<typeof driveCompleteDraft>
try {
  reducedDraft = driveCompleteDraft(
    timers,
    true,
    '11111111-1111-4111-8111-111111111111',
    () => { throw new Error('reduced-motion rolls must not request cosmetic randomness') },
  )
  timers.reset()
  let cosmeticState = 0
  animatedDraft = driveCompleteDraft(
    timers,
    false,
    '22222222-2222-4222-8222-222222222222',
    () => ((cosmeticState++ * 17) % 97) / 97,
  )
  timers.reset()
  alternateSeedDraft = driveCompleteDraft(
    timers,
    true,
    '33333333-3333-4333-8333-333333333333',
    () => { throw new Error('reduced-motion rolls must not request cosmetic randomness') },
    ALTERNATE_SEED,
  )
} finally {
  timers.restore()
}

assert.deepEqual(animatedDraft.landed, reducedDraft.landed, 'animation frames must not change landed gameplay combinations')
assert.deepEqual(rosterIds(animatedDraft.roster), rosterIds(reducedDraft.roster), 'animation mode must not change the final roster')
assert.notDeepEqual(alternateSeedDraft.landed, reducedDraft.landed, 'different fixed gameplay seeds must produce different landed combination sequences')

const transcript = reducedDraft.transcript
assert.equal(transcript.events.length, 30)
assert.equal(transcript.events.filter(({ type }) => type === 'initial-roll').length, 14)
assert.equal(transcript.events.filter(({ type }) => type === 'reroll').length, 2)
assert.equal(transcript.events.filter(({ type }) => type === 'pick').length, 14)
assert.equal(new Set(landedCombinationIds(transcript)).size, 16)

let eventIndex = 0
for (let round = 1; round <= ROSTER_SLOTS.length; round += 1) {
  const initialRoll = transcript.events[eventIndex]
  eventIndex += 1
  assert.equal(initialRoll.type, 'initial-roll')
  assert.equal(initialRoll.round, round)
  assert.deepEqual(Object.keys(initialRoll).sort(), ['combinationId', 'round', 'type'])
  let activeCombinationId = initialRoll.type === 'initial-roll' ? initialRoll.combinationId : ''

  if (round === 2 || round === 8) {
    const reroll = transcript.events[eventIndex]
    eventIndex += 1
    assert.equal(reroll.type, 'reroll')
    if (reroll.type === 'reroll') {
      assert.equal(reroll.round, round)
      assert.equal(reroll.reroll, round === 2 ? 'team' : 'era')
      assert.equal(reroll.discardedCombinationId, activeCombinationId)
      assert.deepEqual(Object.keys(reroll).sort(), ['discardedCombinationId', 'reroll', 'resultingCombinationId', 'round', 'type'])
      activeCombinationId = reroll.resultingCombinationId
    }
  }

  const pick = transcript.events[eventIndex]
  eventIndex += 1
  assert.equal(pick.type, 'pick')
  if (pick.type === 'pick') {
    assert.equal(pick.round, round)
    assert.equal(pick.pickOrder, round)
    assert.equal(pick.combinationId, activeCombinationId)
    assert.deepEqual(Object.keys(pick).sort(), [
      'assignedPosition', 'canonicalCardId', 'combinationId', 'featuredSeason',
      'pickOrder', 'round', 'sourcePlayerId', 'type',
    ])
  }
}
assert.equal(eventIndex, transcript.events.length)
assert.equal(JSON.stringify(transcript).includes('categoryScores'), false)
assert.equal(JSON.stringify(transcript).includes('visibleStats'), false)

const replayedRoster = replayDraft(
  transcript,
  CURRENT_CANONICAL_DRAFT_DATA,
  CURRENT_REPLAY_VERSION_SUPPORT,
)
assert(Object.isFrozen(replayedRoster))
assert.deepEqual(rosterIds(replayedRoster), rosterIds(reducedDraft.roster))

function duplicateRealPersonVariant(source: DraftTranscript) {
  const indexedPicks = source.events.flatMap((event, index) => event.type === 'pick' ? [{ event, index }] : [])
  const supportsPosition = (player: (typeof CURRENT_CANONICAL_DRAFT_DATA.playerPools)[string][number], position: Position) => (
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
        const rightPlayer = rightPlayers.find((player) => (
          player.playerId === leftPlayer.playerId && player.id !== leftPlayer.id
        ))
        if (!rightPlayer) continue
        const candidate = structuredClone(source) as unknown as MutableTranscript
        Object.assign(candidate.events[left.index], {
          canonicalCardId: leftPlayer.id,
          sourcePlayerId: leftPlayer.playerId,
          featuredSeason: leftPlayer.featuredSeason,
        })
        Object.assign(candidate.events[right.index], {
          canonicalCardId: rightPlayer.id,
          sourcePlayerId: rightPlayer.playerId,
          featuredSeason: rightPlayer.featuredSeason,
        })
        try {
          replayDraft(candidate as unknown as DraftTranscript, CURRENT_CANONICAL_DRAFT_DATA, CURRENT_REPLAY_VERSION_SUPPORT)
          return candidate as unknown as DraftTranscript
        } catch {
          // Try another canonical same-person pair that preserves both assignments.
        }
      }
    }
  }
  return null
}

const duplicatePersonTranscript = duplicateRealPersonVariant(transcript)
  ?? duplicateRealPersonVariant(alternateSeedDraft.transcript)
assert(duplicatePersonTranscript, 'fixed canonical drafts should expose a legal duplicate-person/different-card fixture')
const duplicatePersonPicks = duplicatePersonTranscript.events.filter((event) => event.type === 'pick')
const picksBySourcePlayer = new Map<string, typeof duplicatePersonPicks>()
for (const pick of duplicatePersonPicks) {
  picksBySourcePlayer.set(pick.sourcePlayerId, [...(picksBySourcePlayer.get(pick.sourcePlayerId) ?? []), pick])
}
const duplicatePersonPicksForOneSource = [...picksBySourcePlayer.values()].find((picks) => (
  picks.length > 1 && new Set(picks.map(({ canonicalCardId }) => canonicalCardId)).size === picks.length
))
assert(duplicatePersonPicksForOneSource, 'duplicate real people must remain valid when canonical card IDs differ')
assert.equal(Object.keys(replayDraft(
  duplicatePersonTranscript,
  CURRENT_CANONICAL_DRAFT_DATA,
  CURRENT_REPLAY_VERSION_SUPPORT,
)).length, ROSTER_SLOTS.length)

const mutableClone = () => structuredClone(transcript) as unknown as MutableTranscript
const expectReplayRejection = (
  label: string,
  mutate: (candidate: MutableTranscript) => void,
  expected: RegExp,
) => {
  const candidate = mutableClone()
  mutate(candidate)
  assert.throws(
    () => replayDraft(candidate as unknown as DraftTranscript, CURRENT_CANONICAL_DRAFT_DATA, CURRENT_REPLAY_VERSION_SUPPORT),
    expected,
    label,
  )
}

const initialRollIndices = transcript.events.flatMap((event, index) => event.type === 'initial-roll' ? [index] : [])
const pickIndices = transcript.events.flatMap((event, index) => event.type === 'pick' ? [index] : [])
const teamRerollIndex = transcript.events.findIndex((event) => event.type === 'reroll' && event.reroll === 'team')
const eraRerollIndex = transcript.events.findIndex((event) => event.type === 'reroll' && event.reroll === 'era')
assert(teamRerollIndex >= 0 && eraRerollIndex >= 0)

const differentCombinationId = (current: unknown) => (
  CURRENT_CANONICAL_DRAFT_DATA.combinations.find(({ id }) => id !== current)?.id ?? 'missing-combination'
)

expectReplayRejection('altered landed combination', (candidate) => {
  const event = candidate.events[initialRollIndices[0]]
  event.combinationId = differentCombinationId(event.combinationId)
}, /landed combination was altered/)

expectReplayRejection('altered card ID', (candidate) => {
  const pick = candidate.events[pickIndices[0]]
  const otherCombination = CURRENT_CANONICAL_DRAFT_DATA.combinations.find(({ id }) => id !== pick.combinationId)
  assert(otherCombination)
  pick.canonicalCardId = CURRENT_CANONICAL_DRAFT_DATA.playerPools[otherCombination.id][0].id
}, /is not in combination/)

expectReplayRejection('altered source player ID', (candidate) => {
  candidate.events[pickIndices[0]].sourcePlayerId = 'altered-source-player'
}, /Source player ID was altered/)

expectReplayRejection('altered featured season', (candidate) => {
  candidate.events[pickIndices[0]].featuredSeason = 1900
}, /Featured season was altered/)

expectReplayRejection('altered assigned position', (candidate) => {
  candidate.events[pickIndices[0]].assignedPosition = 'RP' satisfies Position
}, /cannot be assigned to RP/)

expectReplayRejection('altered reroll discard', (candidate) => {
  candidate.events[teamRerollIndex].discardedCombinationId = 'altered-discard'
}, /Reroll discarded combination is invalid/)

expectReplayRejection('altered reroll result', (candidate) => {
  const reroll = candidate.events[teamRerollIndex]
  reroll.resultingCombinationId = differentCombinationId(reroll.resultingCombinationId)
}, /reroll result was altered/)

expectReplayRejection('altered reroll kind', (candidate) => {
  candidate.events[teamRerollIndex].reroll = 'era'
}, /reroll result was altered|reroll has no possible result/)

expectReplayRejection('duplicate canonical card ID', (candidate) => {
  candidate.events[pickIndices[1]].canonicalCardId = candidate.events[pickIndices[0]].canonicalCardId
}, /Duplicate canonical card ID/)

expectReplayRejection('second team reroll', (candidate) => {
  const reroll = candidate.events[teamRerollIndex]
  candidate.events.splice(teamRerollIndex + 1, 0, {
    ...reroll,
    discardedCombinationId: reroll.resultingCombinationId,
  })
}, /More than one team reroll/)

expectReplayRejection('second era reroll', (candidate) => {
  const reroll = candidate.events[eraRerollIndex]
  candidate.events.splice(eraRerollIndex + 1, 0, {
    ...reroll,
    discardedCombinationId: reroll.resultingCombinationId,
  })
}, /More than one era reroll/)

expectReplayRejection('swapped event order', (candidate) => {
  ;[candidate.events[0], candidate.events[1]] = [candidate.events[1], candidate.events[0]]
}, /Altered event order/)

expectReplayRejection('incomplete final round', (candidate) => {
  candidate.events.splice(pickIndices.at(-1)!, 1)
}, /Transcript ended before round 14 pick event/)

expectReplayRejection('extra round', (candidate) => {
  candidate.events.push({ type: 'initial-roll', round: 15, combinationId: firstEvent.combinationId })
}, /extra event/)

expectReplayRejection('wrong data digest', (candidate) => {
  candidate.header.canonicalDataDigest = '0'.repeat(64)
}, /Canonical data digest does not match/)

expectReplayRejection('unsupported transcript schema', (candidate) => {
  candidate.header.transcriptSchemaVersion = 'draft-transcript-v2'
}, /Unsupported transcript schema version/)

expectReplayRejection('unsupported RNG version', (candidate) => {
  candidate.header.rngVersion = 'seeded-v2'
}, /Unsupported RNG version/)

expectReplayRejection('transcript-supplied score', (candidate) => {
  candidate.events[pickIndices[0]].score = 999
}, /does not match the draft-transcript-v1 schema/)

console.log('Transcript replay tests passed: immutability, canonical replay, event grammar, motion independence, and tamper rejection.')
