import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
  SUBMISSION_SCHEMA_VERSION,
} from '../../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION } from '../../../src/game/DraftTranscript'
import {
  databaseSchemaIsCompatible,
  readDatabaseHealth,
} from '../../lib/database'
import { SAFE_JSON_RESPONSE_HEADERS } from '../../lib/api-response'
import { draftSubmissionFeatureState } from '../../lib/draft-submission-mode'
import { draftValidationFeatureState } from '../../lib/draft-validation-mode'
import type { BackendEnv } from '../../lib/env'

const ALLOWED_METHODS = 'GET, HEAD'

const dataVersionLabel = DATA_VERSION
  .replace(/^lahman-/i, 'Lahman ')
  .replace(/-v(\d+)$/i, ' (v$1)')

const healthMetadata = Object.freeze({
  ok: true,
  service: 'pennant-pursuit',
  runtime: 'cloudflare-pages-functions',
  versions: Object.freeze({
    app: APP_VERSION,
    gameRules: GAME_RULES_VERSION,
    rng: RNG_VERSION,
    scoring: SCORING_VERSION,
    data: Object.freeze({
      id: DATA_VERSION,
      label: dataVersionLabel,
    }),
    canonicalDataDigest: DATA_DIGEST,
    transcriptSchema: TRANSCRIPT_SCHEMA_VERSION,
    submissionSchema: SUBMISSION_SCHEMA_VERSION,
  }),
})

function responseHeaders() {
  return {
    ...SAFE_JSON_RESPONSE_HEADERS,
    Allow: ALLOWED_METHODS,
  }
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders() })
}

export async function handleHealthRequest(request: Request, env: BackendEnv = {}) {
  if (request.method === 'GET') {
    const d1 = await readDatabaseHealth(env)
    const submissionState = draftSubmissionFeatureState(env)
    const submissionConfigured = submissionState === 'enabled'
    const submissionProtocolPublished = typeof SUBMISSION_SCHEMA_VERSION === 'string'
    const submissionWritesReady = submissionConfigured && submissionProtocolPublished
    const databaseHealthy = d1.reachable
      && databaseSchemaIsCompatible(d1.schemaVersion, submissionWritesReady)
    const healthy = submissionConfigured
      ? submissionProtocolPublished && d1.configured && databaseHealthy
      : !d1.configured || databaseHealthy
    return jsonResponse({
      ...healthMetadata,
      status: healthy ? 'healthy' : 'degraded',
      backend: Object.freeze({ d1: Object.freeze(d1) }),
      features: Object.freeze({
        draftValidation: draftValidationFeatureState(env),
        leaderboard: 'disabled',
        submissions: submissionState,
        writes: submissionWritesReady ? 'submission-only' : 'disabled',
        d1: d1.configured
          ? submissionWritesReady ? 'submission-read-write' : 'read-only'
          : 'not-configured',
      }),
    }, 200)
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: responseHeaders() })
  return jsonResponse({
    ok: false,
    error: Object.freeze({ code: 'method_not_allowed', message: 'Method Not Allowed' }),
  }, 405)
}

export const onRequest: PagesFunction<BackendEnv> = ({ request, env }) => handleHealthRequest(request, env)
