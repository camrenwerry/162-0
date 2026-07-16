import {
  APP_VERSION,
  DATA_DIGEST,
  DATA_VERSION,
  GAME_RULES_VERSION,
  RNG_VERSION,
  SCORING_VERSION,
} from '../../../src/config/versions'
import { TRANSCRIPT_SCHEMA_VERSION } from '../../../src/game/DraftTranscript'

const ALLOWED_METHODS = 'GET, HEAD'

const dataVersionLabel = DATA_VERSION
  .replace(/^lahman-/i, 'Lahman ')
  .replace(/-v(\d+)$/i, ' (v$1)')

const healthPayload = Object.freeze({
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
  }),
  features: Object.freeze({
    leaderboard: 'disabled',
    submissions: 'disabled',
    writes: 'disabled',
    d1: 'not-configured',
  }),
})

function responseHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Allow: ALLOWED_METHODS,
  }
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders() })
}

export function handleHealthRequest(request: Request) {
  if (request.method === 'GET') return jsonResponse(healthPayload, 200)
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: responseHeaders() })
  return jsonResponse({
    ok: false,
    error: Object.freeze({ code: 'method_not_allowed', message: 'Method Not Allowed' }),
  }, 405)
}

export const onRequest: PagesFunction<Env> = ({ request }) => handleHealthRequest(request)
