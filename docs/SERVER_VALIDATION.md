# Server draft validation

Backend Phase C1 provides a shared, Worker-compatible replay and scoring
foundation. Backend Phase C2 adds a preview-only, read-only HTTP adapter around
that foundation. Backend Phase C3 hardens its bounded parsing, HTTP boundary,
and catalog execution path without changing game behavior. Phase C4.1 moves the
authoritative path behind private preview and production Workers and adds coarse
abuse mitigation without changing the browser endpoint or game behavior. No phase
adds a submission protocol, identity, leaderboard, database access,
persistence, analytics, moderation, or runtime writes.

## Module boundaries

The authoritative calculation path is intentionally split from the browser:

- `src/game/replay/validateTranscript.ts` validates the exact transcript
  object grammar.
- `src/game/replay/replayDraft.ts` replays a transcript against an injected
  `ReplayCatalog`; it has no generated-data, browser, UI, Node, Worker, D1, or
  network imports.
- `src/game/replay/types.ts` defines the minimal catalog, card identity, and
  replay result contracts.
- `src/game/replay/WorkerCatalog.ts` validates and adapts the compact generated
  artifact. It eagerly materializes 261 combination descriptors once per
  catalog initialization, indexes canonical card IDs for bounded error mapping,
  and hydrates scoring-rich objects only for requested canonical card IDs.
  C3's tuple-level playability path avoids materializing 9,335 eligibility
  views during normal replay.
- `src/game/ReplayDraft.ts` remains the browser compatibility adapter, so
  existing browser imports and canonical full-player results continue to work.
- `src/game/scoring/` remains the single scoring implementation. Structural
  scoring interfaces allow either a full browser `Player` or a minimal Worker
  card to call `calculateDraftResult` directly. The stateful client
  `ScoringEngine` wrapper is not part of a future server calculation path.

The replay and scoring core uses no React, DOM, browser storage, timers,
`DraftEngine`, frontend search/sorting, Node APIs, Cloudflare APIs, or D1.

## Version and transcript contract

The shared path preserves these production identifiers:

- transcript: `draft-transcript-v1`
- RNG: `seeded-v1`
- rules: `classic-rules-v1`
- scoring: `2.3`
- data: `lahman-2025-v1`
- canonical digest:
  `e033f463caf37aa38037ba58c8fafe3be8358c93afe17f13a49ef117b6d4ed05`

The header and event grammar remains the contract documented in
`docs/DETERMINISTIC_REPLAY.md`. Replay accepts identifiers and actions only;
it never accepts transcript-supplied statistics, category scores, or projected
wins.

This proves deterministic consistency, not fair-play provenance. The seed and
transcript are still client-created, with no server-issued ticket, signature,
identity, attestation, one-time challenge, or replay protection. An untrusted
client can search seeds or construct a self-consistent transcript until a later
authorized protocol establishes provenance.

Replay reconstructs every seeded roll and reroll in order. It rejects malformed
objects, unsupported versions, the wrong digest, an invalid seed, altered event
order or round numbers, altered rolls or rerolls, reused combinations, cards
outside the landed pool, altered source-player IDs or featured seasons,
ineligible assignments, duplicate canonical card IDs, incomplete rosters, and
extra events. Different canonical cards for the same source person remain
legal.

## Compact Worker catalog

`src/data/generated/worker-catalog.json` is a deterministic tuple projection of
the exact runtime pool files allowlisted by `combinations.json`. The top-level
object contains `schemaVersion`, `scoringVersion`, `dataVersion`, `dataDigest`,
and ordered `combinations`.

Each combination tuple is:

```text
[id, franchiseId, team, teamName, decade, cards]
```

Each card tuple is:

```text
[
  canonicalCardId,
  sourcePlayerId,
  name,
  featuredSeason,
  positionBitMask,
  playerKind,
  hitterVisibleStats,
  pitcherVisibleStats,
  hitterScoringStats,
  pitcherScoringStats
]
```

`playerKind` is `0` for hitter, `1` for pitcher, and `2` for two-way. Position
bits follow the shared `POSITIONS` order. The stat tuples contain only fields
read by scoring 2.3:

- hitter visible: `ops`, `obp`, `slg`, `hr`, `rbi`, `sb`, `avg`
- pitcher visible: `era`, `whip`, `so`, `sv`
- hitter scoring: `plateAppearances`, `games`, `baserunningValue`,
  `defensiveValue`, `eraAdjustedOffense`
- pitcher scoring: `fip`, `inningsPitched`, `strikeoutRate`, `walkRate`,
  `starts`, `gamesStarted`, `reliefAppearances`, `eraAdjustedPitching`

`npm run data:worker:build` first runs the canonical generated-data validator
while ignoring only the output it is about to replace. It then reads the exact
allowlisted runtime files, recomputes the canonical digest with the existing
canonical serializer, checks readiness and shared version metadata, rejects
conflict copies or unexpected generated JSON, and requires exactly 261
combinations, 9,335 globally unique canonical card IDs, and the stored digest.
The ordinary canonical build also emits the artifact, and the canonical
validator rejects a stale or edited projection. Two consecutive generations
must produce byte-identical output.

The adapter validates tuple lengths, primitive types, nullable numeric fields,
position masks, player-kind/stat consistency, versions, digest, and duplicate
combination IDs. Catalog construction creates no rich player objects. A rich
minimal scoring object is created only by `hydrateCard`, which replay calls for
the 14 selected IDs. Malformed catalog failures use `WorkerCatalogError` with
the stable internal code `worker_catalog_invalid`.

## Structural scoring contract

Minimal scoring cards are discriminated by `playerType` and supply `id`,
`name`, the relevant visible-stat object, and the relevant scoring-stat object.
Two-way cards supply both hitter and pitcher objects. Full browser players are
structural supersets of this contract.

`calculateDraftResult` is generic over that structural player and retains one
formula, one diagnostics path, and one public result shape. No weights,
normalization, rounding, grades, tiers, curves, fixed-point diagnostics, or
perfect-season gates are duplicated or changed. The caller owns all roster and
request state; scoring does not mutate request-global state.

## Golden fixtures

Transcript fixtures are immutable test inputs under
`scripts/fixtures/transcripts/`:

| Fixture | Seed | Rerolls | Result |
| --- | --- | ---: | ---: |
| Existing fixed | `seeded-v1:16201130162011301620113016201130` | team round 2; era round 8 | 113–49 |
| Ordinary no rerolls | `seeded-v1:16201131b4578aea528f04a3f0c67e5c` | none | 103–59 |
| Ordinary both rerolls | `seeded-v1:16201131162011311620113116201131` | team round 2; era round 8 | 101–61 |
| All-time legal replay | `seeded-v1:0000002e9e3779e73c6ef3a0daa66d59` | team round 2; era round 8 | 145–17 |

The legal 145–17 draft is the first exact match at index 46 in the bounded,
deterministic fixture search. `scripts/fixtures/rosters/constructive-162.json`
is explicitly a roster/scoring golden, not a replay transcript. It produces
162–0, reaches 152 wins before the override, and passes every perfect-season
gate. Every fixture contains 14 unique canonical card IDs.

`npm run test:server-validation` proves browser/Worker roster and scoring
parity for all transcript fixtures, exact public result equality, all tamper
cases, duplicate-person semantics, constructive perfection, controlled catalog
errors, deterministic pool/card order, and complete identity, eligibility, and
scoring projection parity for all 9,335 cards.

## Size and performance baseline

Measured on 2026-07-17 with Node.js 24.18.0 on arm64. Gzip sizes use Node's
`gzipSync`; timings are 10,000 warm iterations per workload after 100 warmups.

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Worker catalog | 1,210,665 | 373,023 |
| Worker replay/scoring bundle | 2,800,979 | 454,611 |
| Browser/Worker parity test bundle | 11,615,530 | 1,253,633 |

| Workload | Mean ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| Ordinary replay + score | 0.9655 | 1.0398 | 1.0940 |
| Two-reroll replay + score | 1.0397 | 1.1273 | 1.1878 |
| Legal 145–17 replay + score | 1.3462 | 1.4221 | 1.4594 |
| Constructive 162–0 scoring only | 0.0167 | 0.0180 | 0.0257 |

These local measurements are a regression baseline, not a production latency
guarantee. The representative Worker bundle remains below the current
[Workers Free compressed-size and raw-size limits](https://developers.cloudflare.com/workers/platform/limits/),
and warm p99 CPU is below the current Free-plan CPU limit. A future route must
still be tested in an actual isolated preview Worker because isolate startup,
platform CPU accounting, request parsing, and response serialization are not
represented here.

## Phase C2/C3/C4 route and environment boundary

`POST /api/v1/validate-draft` accepts exactly `{ "transcript": { ... } }`. The
server replays the transcript with the compact canonical catalog and shared RNG,
then calls scoring 2.3. Client scores, statistics, grades, tiers, roster objects,
identity, display names, tickets, idempotency keys, leaderboard intent,
analytics, and request metadata are not part of the request grammar.

`DRAFT_VALIDATION_MODE` is a server-only Wrangler variable. Its top-level value
is `enabled`, which covers local development and Pages preview deployments. The
checked-in production override is also exactly `enabled`, but it takes effect
only after a reviewed production Pages deployment. Each environment is bound to
its own private Worker. Only the exact lowercase string `enabled` activates the
route; a missing, malformed, or unexpected value fails closed with the existing
generic JSON 404 before inspecting the request body. Enabled production
validation remains read-only and is not a submission or leaderboard capability.

When enabled, only `POST` is allowed and other methods return `Allow: POST`.
Requests must use exactly the `application/json` media type, without parameters
or a non-identity content encoding. If an `Origin` header is present, it must
equal the request URL origin; if a `Host` header is present, it must equal the
request URL authority. Their absence is permitted for same-origin server tools.
The bounded stream reader stops at 16,384 UTF-8 bytes before full buffering and
rejects an empty body, malformed UTF-8, malformed JSON, duplicate JSON member
names, arrays, primitives, and unknown fields.

The strict transcript boundary requires the exact header and per-event keys,
28–30 total events, exactly 14 initial rolls, exactly 14 picks, at most one team
and one era reroll, safe rounds and pick orders from 1–14, and safe featured
seasons from 1920–2025. It also requires a canonical lowercase UUIDv4, the exact
`seeded-v1:` plus 32-lowercase-hex seed form, a 64-lowercase-hex digest,
length-limited exact version strings, bounded ASCII identifiers, supported
positions, and no non-finite or unsafe numeric values. These checks are in
addition to, and do not replace, the Phase C1 deterministic replay checks.

## Public response

A successful request returns HTTP 200, `Cache-Control: no-store`, and JSON in
this shape (values shown are representative):

```json
{
  "ok": true,
  "verified": true,
  "versions": {
    "transcriptSchema": "draft-transcript-v1",
    "app": "1.0.0",
    "gameRules": "classic-rules-v1",
    "rng": "seeded-v1",
    "scoring": "2.3",
    "data": "lahman-2025-v1",
    "canonicalDataDigest": "e033f463caf37aa38037ba58c8fafe3be8358c93afe17f13a49ef117b6d4ed05"
  },
  "result": {
    "projectedWins": 113,
    "projectedLosses": 49,
    "overallScore": 82.4,
    "overallGrade": "B+",
    "tier": "Championship Contender",
    "categories": {
      "offense": { "score": 82.3, "grade": "B+" },
      "defense": { "score": 80.9, "grade": "B" },
      "startingPitching": { "score": 79.4, "grade": "B" },
      "reliefPitching": { "score": 84.7, "grade": "B+" },
      "rosterBalance": { "score": 82.1, "grade": "B+" }
    },
    "strongestCategory": "reliefPitching",
    "weakestCategory": "startingPitching",
    "roster": [
      {
        "slot": "C",
        "assignedPosition": "C",
        "canonicalCardId": "sfg-2010s-poseybu01",
        "playerName": "Buster Posey",
        "featuredSeason": 2012,
        "franchiseId": "sfg",
        "team": "SFG",
        "decade": "2010s"
      }
    ]
  }
}
```

The real roster array always contains all 14 slots in canonical slot order.
Only the five public summary categories are returned. Power, Contact, Speed,
raw values, fixed-point values, diagnostics, contribution formulas, internal
catalog fields, the transcript, and the gameplay seed are omitted.

Errors use fixed messages and the shape
`{ "ok": false, "verified": false, "error": { "code": "...", "message": "..." } }`.
When the feature flag is disabled, the generic 404 intentionally retains the
existing unknown API response exactly.

| Status | Public codes |
| ---: | --- |
| 400 | `malformed_json`, `invalid_request_schema` |
| 403 | `origin_not_allowed` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 429 | `rate_limited` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 422 | `unsupported_transcript_version`, `unsupported_app_version`, `unsupported_rng_version`, `unsupported_rules_version`, `unsupported_scoring_version`, `unsupported_data_version`, `canonical_data_mismatch`, `invalid_seed`, `invalid_roll_sequence`, `invalid_reroll`, `invalid_card`, `wrong_pool`, `invalid_position`, `duplicate_card`, `incomplete_roster`, `unexpected_event_order` |
| 500 | `scoring_failed` |
| 503 | `temporarily_unavailable` |

Public errors never include parser offsets, event indexes, submitted or expected
identifiers, alternatives, SQL, D1 details, stack traces, or exception messages.

## Isolation, fair play, and rollback

Draft validation never reads or writes D1 and works with no `DB` binding or a
binding that throws if touched. It does not use `waitUntil`, cookies, CORS,
storage, transcript logging, request logging, or any other persistence path.
Health continues to describe D1 as read-only and continues to report
leaderboard, submissions, and writes as disabled; it adds only the effective
`draftValidation` state without identifying the environment or database.

Successful deterministic replay proves internal consistency, not fair-play
provenance. A client can still search or synthesize a seed and matching
transcript. Phase D must introduce separately reviewed server-issued tickets and
replay protection before any result can become leaderboard-eligible. C2 itself
does not make a draft eligible and has no submission path.

Preview rollback is to disable the server variable through the approved
configuration workflow or revert the preview deployment. No D1 rollback is
required because C3 has no schema, data, or migration changes.

## Phase C2 size and performance check

Measured locally on 2026-07-17 with Wrangler 4.111.0. The minified Pages
Functions bundle is 7,974,912 raw bytes and 1,102,438 gzip bytes. Wrangler's
startup profiler completed successfully in 68.597 ms. Timings include bounded
request parsing, authoritative replay, scoring, response serialization, and
request/response construction after 200 warmups.

| Workload | Iterations | Mean ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Ordinary transcript | 10,000 | 1.0687 | 1.1505 | 1.2146 |
| Two-reroll transcript | 10,000 | 1.1420 | 1.2525 | 1.3345 |
| Legal 145–17 transcript | 10,000 | 1.4479 | 1.5505 | 1.6187 |
| Invalid first event | 10,000 | 0.0848 | 0.0921 | 0.1091 |

These local results are regression evidence, not production latency guarantees.
No deployment was performed while measuring them.

## Phase C3 threat model and fixed bounds

C3 treats every request byte, chunk boundary, JSON nesting shape, key name,
event, identifier, and transcript action as hostile. It protects the
preview-only route from parser/CPU/memory amplification; it does not establish
fair-play provenance or user identity.

| Surface | C3 bound and behavior |
| --- | --- |
| Request body | Exactly one identity-encoded `application/json` body, at most 16,384 UTF-8 bytes and 16,384 chunks. A fixed 16 KiB buffer is used; reading is cancelled on the first byte or chunk that crosses either limit. |
| JSON | Fatal UTF-8 decoding; native JSON syntax validation; a separate explicit-stack scan rejects duplicate member names without recursive traversal. |
| JSON shape | Input-derived JSON allocation is capped by the 16 KiB body. Deep and wide payloads terminate in a sanitized public error. |
| Events | 28–30 total; exactly 14 initial rolls and picks; at most one team and one era reroll. Schema work is at most 30 event checks. |
| Replay | At most 16 seeded selections (14 rounds plus two rerolls). Each selection scans no more than 261 combinations and 9,335 compact card tuples; selected-card hydration is at most 14 cards, with at most 36 tuples per pool. |
| Scoring | Fixed 14-card roster: nine hitter, three starter, and two relief calculations plus fixed-size category, threshold, and sort work. |
| Catalog | A single isolate-local immutable catalog is initialized only after feature, method, origin/host, media, JSON, and schema checks pass. Failure is cached as unavailable. |

The only mutable isolate-local values are the lazy catalog result and its
immutable-view cache. They never hold request data. Normal route replay uses the
tuple fast path and does not populate that view cache. There is no D1, fetch,
cache, cookie, `waitUntil`, request/transcript log, raw-error log, or runtime
write in the validation path. Public errors are fixed code/message pairs only.

Every C3 response has `Cache-Control: no-store`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, and
`Cross-Origin-Resource-Policy: same-origin`. It intentionally emits no CORS or
cookie headers. A CSP is not set because this is a JSON API response, not an
HTML document. `HEAD` is rejected with the existing 405 whenever validation is
enabled, including production after the reviewed Pages deployment; a disabled
or malformed feature flag retains the generic 404 before body parsing.

## C3 local measurements

Measured on 2026-07-17 using Node.js 24.18.0, macOS arm64, Apple M4. Each
focused workload uses 10,000 warmups and 10,000 measured requests; the
concurrent workload uses five concurrent requests and 10,000 measured requests
total. Response bodies are consumed by the benchmark. Heap deltas are
process-level approximations without forced GC, so they are observations rather
than per-request memory limits.

| Workload | Mean ms | Median | p90 | p95 | p99 | Max | req/s | Heap Δ KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Disabled-mode control request (historical) | 0.0117 | 0.0113 | 0.0121 | 0.0125 | 0.0188 | 0.1591 | 85,576.7 | -5,471.0 |
| Unsupported method | 0.0073 | 0.0071 | 0.0074 | 0.0075 | 0.0093 | 0.1287 | 137,594.4 | 96.6 |
| Wrong content type | 0.0105 | 0.0102 | 0.0106 | 0.0112 | 0.0157 | 0.1237 | 95,435.2 | 6,589.5 |
| Oversized body | 0.0115 | 0.0112 | 0.0117 | 0.0123 | 0.0170 | 0.1370 | 86,872.7 | -5,124.5 |
| Malformed JSON | 0.0121 | 0.0117 | 0.0122 | 0.0128 | 0.0178 | 0.2207 | 82,777.7 | -4,682.0 |
| Invalid schema | 0.0107 | 0.0105 | 0.0110 | 0.0113 | 0.0150 | 0.1266 | 93,024.3 | 9,693.8 |
| Invalid first event | 0.1038 | 0.0999 | 0.1049 | 0.1094 | 0.1517 | 8.2218 | 9,629.5 | -7,451.3 |
| Invalid final event | 0.5321 | 0.5242 | 0.5410 | 0.5835 | 0.6306 | 11.4618 | 1,879.3 | -6,112.1 |
| Ordinary valid | 0.5635 | 0.5584 | 0.5775 | 0.6200 | 0.6802 | 1.9305 | 1,774.7 | -14,719.8 |
| Two-reroll valid | 0.5958 | 0.5885 | 0.6061 | 0.6409 | 0.7365 | 8.8077 | 1,678.5 | -29,034.5 |
| 145–17 valid | 0.6323 | 0.6283 | 0.6462 | 0.6814 | 0.7783 | 1.1347 | 1,581.5 | 25,254.5 |
| Fixed 113–49 | 0.6012 | 0.5973 | 0.6136 | 0.6414 | 0.7424 | 1.0337 | 1,663.2 | 30,535.6 |
| Maximum-size valid | 0.5855 | 0.5717 | 0.5954 | 0.6413 | 0.7559 | 22.2358 | 1,707.8 | -47,629.3 |
| Ordinary valid, concurrency 5 | 0.5627 | 0.5592 | 0.5818 | 0.5928 | 0.6124 | 0.9001 | 1,777.0 | -29,465.1 |

The pre-C4.1 baseline measured a 61.983 ms local authoritative-route module
import, 0.532 ms local health import, and 3.159 ms catalog construction. C4.1
supersedes that route measurement with separate private-Worker and Pages-proxy
startup figures below. Catalog construction remains delayed until a structurally
valid enabled validation request needs it. These are local Vite/Node observations,
not Cloudflare isolate timing.

Before C4.1, the final minified Pages Functions Worker bundle was 7,977,561 raw bytes and
1,099,278 gzip bytes. Its largest input is the 1,210,665-byte Worker catalog;
the next individual inputs are compact runtime pools (43,121 bytes or less).
The bundle is below Cloudflare's current 64 MB raw and 3 MB Free gzip Worker
size limits, and it is not near the limit. Pages compiles Functions into one
Worker, so the catalog remains in the bundle for health as well as validation;
lazy construction removes catalog validation/index construction from unrelated
health startup but cannot remove the statically imported artifact. Wrangler
4.111.0's alpha Pages-build startup check succeeded with
`npx wrangler check startup --pages --args=--minify`; its local CPU profile
covered 57.691 ms across nine samples. The profile is dominated by anonymous
bundle evaluation (seven samples) and garbage collection (one sample), with no
catalog-construction call on startup. No deployment was attempted.
Cloudflare documents a one-second startup limit and notes that local startup
profiles are diagnostic, not deployment-equivalent.

## C4 private Workers, traffic control, and local operation

The browser still calls the same same-origin endpoint. C4.1 changes only its
internal execution path:

```text
browser POST /api/v1/validate-draft
  -> Pages proxy: feature flag + method/origin check + trusted key derivation
  -> VALIDATION_SERVICE Service Binding
  -> environment-specific private validation Worker: rate limit + bounded validation
```

`workers/draft-validation/` is one shared Worker source with two explicit,
private deployment targets: preview `pennant-pursuit-validation-preview` and
production `pennant-pursuit-validation-production`. Both disable `workers.dev`
and Worker preview URLs and have no route, custom domain, D1, KV, R2, Durable
Object, queue, secret, analytics binding, storage, external fetch, cookie
handling, or runtime write. Their only entry point is the Service-Binding-
compatible `fetch` handler. The original C1/C2/C3 authoritative parser, replay,
canonical catalog, and scoring code live behind that handler; the Pages route
does not import the catalog, parse a transcript, replay, or score.

The Pages boundary runs the existing feature, method, and same-origin checks
before it reads or forwards a request. It accepts the client IP only from
Cloudflare's `CF-Connecting-IP`, validates its IPv4/IPv6 form, computes
`v1:` plus SHA-256 of a domain-separated value with Web Crypto, and passes the
digest in `X-Pennant-Pursuit-Rate-Key`. It never persists, logs, returns, or
accepts that value from the browser. The proxy strips every browser-supplied
copy of that internal key, all raw IP/forwarding headers, cookies, credentials,
and other request metadata. It forwards only content type/length/encoding plus
the generated key. A missing trusted IP or unavailable Service Binding is the
sanitized existing 503 response. The private Worker rejects a missing or
malformed key before calling a limiter.

Both private Worker bindings run before any body parsing or validation:

| Binding | Policy | Key |
| --- | --- | --- |
| `RATE_LIMIT_BURST` | 5 requests / 10 seconds | trusted `v1:` hash |
| `RATE_LIMIT_SUSTAINED` | 20 requests / 60 seconds | trusted `v1:` hash |

Every enabled request, including malformed and oversized bodies, consumes quota;
health stays in Pages and never reaches this Worker. A failed burst check skips
the sustained check. Either rejection returns the fixed 429 `rate_limited`
payload with `Retry-After: 60` and the same no-store, nosniff, no-referrer, and
same-origin response headers as every validation result. Cloudflare Rate
Limiting counters are per location and eventually consistent: this is coarse
burst mitigation, not global accounting or fair-play replay protection.

The default/preview Pages configuration binds `VALIDATION_SERVICE` only to
`pennant-pursuit-validation-preview`, with namespaces `16204011` and
`16204012`. `[env.production]` binds that same name only to
`pennant-pursuit-validation-production`, with namespaces `16204021` and
`16204022`; the two counters are never shared. The reviewed Pages production
feature flag sets `DRAFT_VALIDATION_MODE = "enabled"`. After a reviewed Pages
deployment, valid production `POST`s pass the existing method, origin, host,
and trusted-metadata checks before invoking only the production Service Binding.
Invalid methods and malformed requests retain their existing safe responses.

Local commands are deliberately separate from remote operations:

```bash
npm run validation-worker:types:check
npm run validation-worker:typecheck
npm run test:validation-worker
npm run validation-worker:build       # local Wrangler --dry-run only
npx wrangler --cwd workers/draft-validation deploy --env production --dry-run --minify --outdir /tmp/pennant-pursuit-validation-production-worker-build
npm run pages:functions:build
npm run validation-bundles:check
npm run dev:validation-worker
npm run dev:pages-with-validation
```

Use the two development commands in separate terminals when exercising a local
Service Binding. Unit/integration tests instead use deterministic rate-limit
doubles; they do not rely on a remote counter.

### Production Pages activation and rollback

The private production Worker is already deployed. This reviewed repository
change does not deploy Pages; a future authorized rollout must deploy the
reviewed `main` Pages configuration and then verify that production health
reports `draftValidation: "enabled"` while leaderboard, submissions, and writes
remain disabled. A valid fixed transcript must verify as 113–49 through the
private production Service Binding; invalid methods and malformed requests must
retain their existing safe errors. Do not call the private Worker through a
public URL.

Rollback is to change only the production Pages
`DRAFT_VALIDATION_MODE` back to `disabled` and deploy or revert Pages until the
generic 404 returns. The private production Worker may remain deployed but
unreachable; do not delete it without separate authorization. No validation data
is stored and no D1 schema or data changes occur, so rollback requires neither
data cleanup nor D1 recovery. Phase D still requires independently reviewed
server-issued, short-lived, single-use tickets and replay protection before any
result may be leaderboard-eligible.

### C4.1 local measurements

Measured on 2026-07-17 with Node.js 24.18.0, macOS arm64, Apple M4. Each
focused workload used 10,000 warmups and 10,000 measured requests; the private
Worker and Pages proxy figures consume every response body.

| Workload | Mean ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| Pages health handler | 0.0052 | 0.0062 | 0.0094 |
| Authoritative ordinary, no limiter | 0.5585 | 0.6176 | 0.6599 |
| Private Worker ordinary | 0.5589 | 0.6197 | 0.6645 |
| Pages proxy ordinary | 0.5874 | 0.6377 | 0.7513 |
| Private Worker two-reroll | 0.5934 | 0.6370 | 0.7337 |
| Private Worker legal 145–17 | 0.6335 | 0.6838 | 0.7765 |
| Private Worker malformed JSON | 0.0128 | 0.0132 | 0.0181 |
| Private Worker burst-limited | 0.0104 | 0.0108 | 0.0132 |

The local proxy delta was 0.0285 ms. The two limiter calls measured within local
noise against the no-limiter baseline (0.0004 ms); they are asynchronous
platform bindings in production and must be measured again after an authorized
preview deployment. `wrangler check startup` completed for the private Worker
and Pages bundles (local profiles: 63.359 ms across nine samples and 28.992 ms
across two samples, respectively). These are diagnostic local profiles, not
Cloudflare isolate timing.

The minified private Worker dry-run bundle is 7,969,459 raw bytes and 1,096,245
gzip bytes; the minified Pages proxy bundle is 14,943 raw bytes and 5,551 gzip
bytes. Both pass the checked conservative 64 MiB raw and 3 MiB gzip guards; the
Pages bundle is materially smaller than the previous all-in-Pages validation
bundle. No deployment was performed while measuring them.

### Historical preview probe

The opt-in preview probe is intentionally capped at 100 requests per workload
and concurrency five. With its defaults it makes 63 requests:

```bash
PREVIEW_URL=https://<authorized-preview>.pages.dev npm run benchmark:preview-draft-validation
```

It reports a first/cold-like latency, warm mean/p95/max, status distribution,
response-size consistency, `Cache-Control`, `CF-Ray`, `Server-Timing`, and
`CF-Cache-Status`. On 2026-07-17 it ran against the already deployed pre-C3
`develop` preview at concurrency five: health was 20/20 HTTP 200 with a 577-byte
body (202.84 ms mean; 1,701.11 ms initial), valid validation was 20/20 HTTP 200
with a 3,184-byte body (132.79 ms mean), and invalid validation was 20/20 HTTP
422 with a 114-byte body (217.27 ms mean). All returned `Cache-Control:
no-store`; Cloudflare did not return `Server-Timing` or `CF-Cache-Status`.
These are network measurements of the old deployment, not C3 release results.

Relevant Cloudflare references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[startup profiling](https://developers.cloudflare.com/workers/wrangler/commands/workers/),
[Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/),
[Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/),
[Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/),
and [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
