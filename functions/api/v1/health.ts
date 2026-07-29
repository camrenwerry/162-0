import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION } from '../../../src/game/DraftTranscript'
import {
  databaseSchemaIsCompatible,
  readDatabaseHealth,
} from '../../lib/database'
import { SAFE_JSON_RESPONSE_HEADERS } from '../../lib/api-response'
import { DRAFT_SUBMISSION_SCHEMA_VERSION } from '../../lib/draft-submission-constants'
import { draftSubmissionFeatureState } from '../../lib/draft-submission-mode'
import { draftValidationFeatureState } from '../../lib/draft-validation-mode'
import type { BackendEnv } from '../../lib/env'
import {
  leaderboardIdentityFeatureState,
  type LeaderboardIdentityModeEnv,
} from '../../lib/leaderboard-identity-mode'
import {
  leaderboardReadFeatureState,
  leaderboardReadRuntimeIsConfigured,
  type LeaderboardReadModeEnv,
} from '../../lib/leaderboard-mode'

const ALLOWED_METHODS = 'GET, HEAD'
const PRIVATE_IDENTITY_HEALTH_URL = 'https://pennant-pursuit.internal/internal/leaderboard-identity-health'

const dataVersionLabel = DATA_VERSION
  .replace(/^lahman-/i, 'Lahman ')
  .replace(/-v(\d+)$/i, ' (v$1)')

const baseHealthMetadata = Object.freeze({
  ok: true,
  service: 'pennant-pursuit',
  runtime: 'cloudflare-pages-functions',
})

const baseVersionMetadata = Object.freeze({
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

async function privateIdentityIsReady(service: Pick<Fetcher, 'fetch'> | undefined) {
  if (!service || typeof service.fetch !== 'function') return false
  try {
    const response = await service.fetch(new Request(PRIVATE_IDENTITY_HEALTH_URL))
    return response.status === 204
  } catch {
    return false
  }
}

type HealthEnv = BackendEnv & LeaderboardReadModeEnv & LeaderboardIdentityModeEnv & {
  readonly VALIDATION_SERVICE?: Pick<Fetcher, 'fetch'>
}

export async function handleHealthRequest(request: Request, env: HealthEnv = {}) {
  if (request.method === 'GET') {
    const d1 = await readDatabaseHealth(env)
    const submissionState = draftSubmissionFeatureState(env)
    const submissionConfigured = submissionState === 'enabled'
    const leaderboardRequested = leaderboardReadFeatureState(env) === 'enabled'
    const leaderboardConfigured = leaderboardRequested
      && leaderboardReadRuntimeIsConfigured(env)
    const identityRequested = leaderboardIdentityFeatureState(env) === 'enabled'
    const identityRuntimeConfigured = identityRequested
      && await privateIdentityIsReady(env.VALIDATION_SERVICE)
    const submissionSchemaReady = submissionConfigured
      && d1.configured
      && d1.reachable
      && databaseSchemaIsCompatible(d1.schemaVersion, true)
    const leaderboardSchemaReady = leaderboardConfigured
      && d1.configured
      && d1.reachable
      && databaseSchemaIsCompatible(d1.schemaVersion, true)
    const identitySchemaReady = identityRuntimeConfigured
      && d1.configured
      && d1.reachable
      && databaseSchemaIsCompatible(d1.schemaVersion, true)
    const submissionSchema = submissionSchemaReady ? DRAFT_SUBMISSION_SCHEMA_VERSION : null
    const databaseHealthy = d1.reachable
      && databaseSchemaIsCompatible(
        d1.schemaVersion,
        submissionConfigured || leaderboardRequested || identityRequested,
      )
    const dataFeatureConfigured = submissionConfigured || leaderboardRequested || identityRequested
    const healthy = dataFeatureConfigured
      ? d1.configured
        && databaseHealthy
        && (!leaderboardRequested || leaderboardConfigured)
        && (!identityRequested || identitySchemaReady)
      : !d1.configured || databaseHealthy
    const operationalWriteReadiness = !submissionConfigured
      ? 'disabled'
      : submissionSchemaReady ? 'externally-unverified' : 'unavailable'
    const d1State = !d1.configured
      ? 'not-configured'
      : !d1.reachable
        ? 'unavailable'
        : databaseHealthy ? 'schema-ready' : 'schema-incompatible'
    return jsonResponse({
      ...baseHealthMetadata,
      versions: Object.freeze({
        ...baseVersionMetadata,
        submissionSchema,
      }),
      status: healthy ? 'healthy' : 'degraded',
      backend: Object.freeze({ d1: Object.freeze(d1) }),
      submission: Object.freeze({
        configured: submissionConfigured,
        schemaReady: submissionSchemaReady,
        operationalWriteReadiness,
      }),
      features: Object.freeze({
        draftValidation: draftValidationFeatureState(env),
        leaderboard: !leaderboardRequested
          ? 'disabled'
          : leaderboardSchemaReady ? 'schema-ready' : 'configured',
        submissions: !submissionConfigured
          ? 'disabled'
          : submissionSchemaReady ? 'schema-ready' : 'configured',
        ...(identityRequested
          ? { leaderboardIdentity: identitySchemaReady ? 'schema-ready' : 'configured' }
          : {}),
        writes: operationalWriteReadiness,
        d1: d1State,
      }),
    }, 200)
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: responseHeaders() })
  return jsonResponse({
    ok: false,
    error: Object.freeze({ code: 'method_not_allowed', message: 'Method Not Allowed' }),
  }, 405)
}

export const onRequest: PagesFunction<HealthEnv> = ({ request, env }) => handleHealthRequest(request, env)
