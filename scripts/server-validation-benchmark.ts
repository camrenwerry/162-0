import assert from 'node:assert/strict'
import fs from 'node:fs'
import { gzipSync } from 'node:zlib'
import ordinaryData from './fixtures/transcripts/ordinary-no-rerolls.json'
import twoRerollsData from './fixtures/transcripts/ordinary-two-rerolls.json'
import allTime145Data from './fixtures/transcripts/all-time-145.json'
import constructive162Data from './fixtures/rosters/constructive-162.json'
import type { DraftTranscript } from '../src/game/DraftTranscript'
import { CURRENT_REPLAY_VERSION_SUPPORT } from '../src/game/ReplayDraft'
import { createWorkerReplayCatalog } from '../src/game/replay/WorkerCatalog'
import { replayDraftWithCatalog } from '../src/game/replay/replayDraft'
import type { HydratedReplayCard } from '../src/game/replay/types'
import { validateTranscriptShape } from '../src/game/replay/validateTranscript'
import { calculateDraftResult } from '../src/game/scoring'
import { ROSTER_SLOTS, type RosterSlotId } from '../src/types/draft'

const ITERATIONS = 10_000
const workerCatalog = createWorkerReplayCatalog()

function transcriptFrom(value: unknown): DraftTranscript {
  validateTranscriptShape(value)
  return value
}

const ordinary = transcriptFrom(ordinaryData.transcript)
const twoRerolls = transcriptFrom(twoRerollsData.transcript)
const allTime145 = transcriptFrom(allTime145Data.transcript)

let checksum = 0
function replayAndScore(transcript: DraftTranscript) {
  const roster = replayDraftWithCatalog(transcript, workerCatalog, CURRENT_REPLAY_VERSION_SUPPORT)
  const result = calculateDraftResult(roster).result
  checksum += result.wins
}

const combinationByCardId = new Map<string, ReturnType<typeof workerCatalog.getCombinations>[number]>()
for (const combination of workerCatalog.getCombinations()) {
  for (const card of workerCatalog.getCardViews(combination)) combinationByCardId.set(card.id, combination)
}
const constructiveRoster: Partial<Record<RosterSlotId, HydratedReplayCard>> = {}
for (const { id } of ROSTER_SLOTS) {
  const cardId = constructive162Data.roster[id]
  const combination = combinationByCardId.get(cardId)
  assert(combination, `Missing constructive combination for ${cardId}`)
  const card = workerCatalog.hydrateCard(combination, cardId)
  assert(card, `Missing constructive card ${cardId}`)
  constructiveRoster[id] = card
}

function summarize(samples: Float64Array) {
  samples.sort()
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length
  const percentile = (value: number) => samples[Math.ceil(samples.length * value) - 1]
  return {
    iterations: samples.length,
    meanMs: Number(mean.toFixed(4)),
    p95Ms: Number(percentile(.95).toFixed(4)),
    p99Ms: Number(percentile(.99).toFixed(4)),
  }
}

function measure(work: () => void) {
  for (let index = 0; index < 100; index += 1) work()
  const samples = new Float64Array(ITERATIONS)
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now()
    work()
    samples[index] = performance.now() - started
  }
  return summarize(samples)
}

const timings = {
  ordinaryReplayAndScore: measure(() => replayAndScore(ordinary)),
  twoRerollReplayAndScore: measure(() => replayAndScore(twoRerolls)),
  allTime145ReplayAndScore: measure(() => replayAndScore(allTime145)),
  constructive162ScoringOnly: measure(() => { checksum += calculateDraftResult(constructiveRoster).result.wins }),
}

const catalogBytes = fs.readFileSync('src/data/generated/worker-catalog.json')
const bundleBytes = fs.readFileSync('/tmp/pennant-pursuit-server-validation-worker/server-validation-worker-entry.js')
const sizes = {
  workerCatalog: { rawBytes: catalogBytes.byteLength, gzipBytes: gzipSync(catalogBytes).byteLength },
  workerReplayScoringBundle: { rawBytes: bundleBytes.byteLength, gzipBytes: gzipSync(bundleBytes).byteLength },
}

assert(checksum > 0)
console.log(JSON.stringify({ iterations: ITERATIONS, sizes, timings, checksum }, null, 2))
