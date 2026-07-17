import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION, type DraftTranscript } from '../../../src/game/DraftTranscript'
import { CURRENT_REPLAY_VERSION_SUPPORT } from '../../../src/game/ReplayDraft'
import { createWorkerReplayCatalog } from '../../../src/game/replay/WorkerCatalog'
import { replayDraftWithCatalog } from '../../../src/game/replay/replayDraft'
import { DraftReplayError, type ReplayCatalog, type ValidatedDraftRoster } from '../../../src/game/replay/types'
import { calculateDraftResult } from '../../../src/game/scoring'
import { ROSTER_SLOTS } from '../../../src/types/draft'
import {
  DraftValidationPublicError,
  draftValidationErrorResponse,
  handleApiNotFoundRequest,
  jsonResponse,
  type DraftValidationErrorCode,
} from '../../lib/api-response'
import { readBoundedJson } from '../../lib/bounded-json'
import { isDraftValidationEnabled } from '../../lib/draft-validation-mode'
import { validateDraftRequestEnvelope } from '../../lib/draft-validation-schema'
import type { BackendEnv } from '../../lib/env'

const ALLOWED_METHODS = 'POST'
const catalogInitialization: { readonly catalog: ReplayCatalog | null } = (() => {
  try {
    return Object.freeze({ catalog: createWorkerReplayCatalog() })
  } catch {
    return Object.freeze({ catalog: null })
  }
})()

function errorResponse(code: DraftValidationErrorCode, headers: Readonly<Record<string, string>> = {}) {
  return draftValidationErrorResponse(new DraftValidationPublicError(code), headers)
}

function requestOriginIsAllowed(request: Request) {
  const origin = request.headers.get('Origin')
  return origin === null || origin === new URL(request.url).origin
}

function cardFailureCode(transcript: DraftTranscript, catalog: ReplayCatalog): 'invalid_card' | 'wrong_pool' {
  const combinations = catalog.getCombinations()
  for (const event of transcript.events) {
    if (event.type !== 'pick') continue
    const referencedCombination = combinations.find(({ id }) => id === event.combinationId)
    if (referencedCombination && catalog.getCardViews(referencedCombination).some(({ id }) => id === event.canonicalCardId)) continue
    const existsElsewhere = combinations.some((combination) => (
      catalog.getCardViews(combination).some(({ id }) => id === event.canonicalCardId)
    ))
    return existsElsewhere ? 'wrong_pool' : 'invalid_card'
  }
  return 'invalid_card'
}

function replayFailureCode(error: DraftReplayError, transcript: DraftTranscript, catalog: ReplayCatalog): DraftValidationErrorCode {
  const message = error.message
  if (message.includes('Unsupported transcript schema')) return 'unsupported_transcript_version'
  if (message.includes('Unsupported app version')) return 'unsupported_app_version'
  if (message.includes('Unsupported RNG version')) return 'unsupported_rng_version'
  if (message.includes('Unsupported game rules version')) return 'unsupported_rules_version'
  if (message.includes('Unsupported scoring version')) return 'unsupported_scoring_version'
  if (message.includes('Unsupported data version')) return 'unsupported_data_version'
  if (message.includes('Canonical data digest')) return 'canonical_data_mismatch'
  if (message.includes('Invalid gameplay seed')) return 'invalid_seed'
  if (message.includes('Duplicate canonical card ID')) return 'duplicate_card'
  if (message.includes('reroll') || message.includes('Reroll')) return 'invalid_reroll'
  if (message.includes('landed combination') || message.includes('initial combination') || message.includes('landed more than once')) return 'invalid_roll_sequence'
  if (message.includes('invalid round') || message.includes('Pick order') || message.includes('Altered event order')) return 'unexpected_event_order'
  if (message.includes('references the wrong franchise-decade pool') || message.includes('inconsistent with its franchise-decade pool')) return 'wrong_pool'
  if (message.includes('is not in combination')) return cardFailureCode(transcript, catalog)
  if (message.includes('Source player ID') || message.includes('Featured season')) return 'invalid_card'
  if (message.includes('Assigned position') || message.includes('cannot be assigned')) return 'invalid_position'
  if (message.includes('ended before') || message.includes('does not contain exactly 14') || message.includes('missing slot')) return 'incomplete_roster'
  if (message.includes('extra event')) return 'unexpected_event_order'
  if (message.includes('schema')) return 'invalid_request_schema'
  return 'temporarily_unavailable'
}

function teamByFranchiseDecade(catalog: ReplayCatalog) {
  return new Map(catalog.getCombinations().map((combination) => [
    `${combination.franchiseId}:${combination.decade}`,
    combination.team,
  ]))
}

function sanitizedRoster(roster: ValidatedDraftRoster, catalog: ReplayCatalog) {
  const teams = teamByFranchiseDecade(catalog)
  return ROSTER_SLOTS.map(({ id, position }) => {
    const player = roster[id]
    const team = teams.get(`${player.franchiseId}:${player.decade}`)
    if (!team) throw new Error('Canonical team is unavailable.')
    return Object.freeze({
      slot: id,
      assignedPosition: position,
      canonicalCardId: player.id,
      playerName: player.name,
      featuredSeason: player.featuredSeason,
      franchiseId: player.franchiseId,
      team,
      decade: player.decade,
    })
  })
}

function publicCategory(result: ReturnType<typeof calculateDraftResult>['result'], key: 'offense' | 'defense' | 'startingPitching' | 'reliefPitching' | 'rosterBalance') {
  return Object.freeze({ score: result.categoryScores[key], grade: result.categoryGrades[key] })
}

function successResponse(roster: ValidatedDraftRoster, catalog: ReplayCatalog) {
  let result: ReturnType<typeof calculateDraftResult>['result']
  try {
    result = calculateDraftResult(roster).result
  } catch {
    return errorResponse('scoring_failed')
  }

  let publicRoster: ReturnType<typeof sanitizedRoster>
  try {
    publicRoster = sanitizedRoster(roster, catalog)
  } catch {
    return errorResponse('temporarily_unavailable')
  }

  return jsonResponse({
    ok: true,
    verified: true,
    versions: Object.freeze({
      transcriptSchema: TRANSCRIPT_SCHEMA_VERSION,
      app: APP_VERSION,
      gameRules: GAME_RULES_VERSION,
      rng: RNG_VERSION,
      scoring: SCORING_VERSION,
      data: DATA_VERSION,
      canonicalDataDigest: DATA_DIGEST,
    }),
    result: Object.freeze({
      projectedWins: result.wins,
      projectedLosses: result.losses,
      overallScore: result.overallScore,
      overallGrade: result.overallGrade,
      tier: result.tierLabel,
      categories: Object.freeze({
        offense: publicCategory(result, 'offense'),
        defense: publicCategory(result, 'defense'),
        startingPitching: publicCategory(result, 'startingPitching'),
        reliefPitching: publicCategory(result, 'reliefPitching'),
        rosterBalance: publicCategory(result, 'rosterBalance'),
      }),
      strongestCategory: result.strongestCategory,
      weakestCategory: result.weakestCategory,
      roster: publicRoster,
    }),
  }, 200)
}

export async function handleValidateDraftRequest(request: Request, env: BackendEnv = {}) {
  if (!isDraftValidationEnabled(env)) return handleApiNotFoundRequest(request)
  if (request.method !== 'POST') return errorResponse('method_not_allowed', { Allow: ALLOWED_METHODS })
  if (!requestOriginIsAllowed(request)) return errorResponse('origin_not_allowed')

  let transcript: DraftTranscript
  try {
    const body = await readBoundedJson(request)
    transcript = validateDraftRequestEnvelope(body)
  } catch (error) {
    return error instanceof DraftValidationPublicError
      ? draftValidationErrorResponse(error)
      : errorResponse('temporarily_unavailable')
  }

  const catalog = catalogInitialization.catalog
  if (!catalog) return errorResponse('temporarily_unavailable')
  let roster: ValidatedDraftRoster
  try {
    roster = replayDraftWithCatalog(transcript, catalog, CURRENT_REPLAY_VERSION_SUPPORT)
  } catch (error) {
    return error instanceof DraftReplayError
      ? errorResponse(replayFailureCode(error, transcript, catalog))
      : errorResponse('temporarily_unavailable')
  }
  return successResponse(roster, catalog)
}

export const onRequest: PagesFunction<BackendEnv> = ({ request, env }) => handleValidateDraftRequest(request, env)
