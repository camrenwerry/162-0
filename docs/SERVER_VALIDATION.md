# Server draft validation

Backend Phase C1 provides a shared, Worker-compatible replay and scoring
foundation. Backend Phase C2 adds a preview-only, read-only HTTP adapter around
that foundation. Neither phase adds a submission protocol, identity,
leaderboard, database access, persistence, analytics, moderation, or runtime
writes.

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
  artifact. It eagerly materializes 261 combination descriptors, lazily caches
  lightweight eligibility views, and hydrates scoring-rich objects only for
  requested canonical card IDs.
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

## Phase C2 route and environment boundary

`POST /api/v1/validate-draft` accepts exactly `{ "transcript": { ... } }`. The
server replays the transcript with the compact canonical catalog and shared RNG,
then calls scoring 2.3. Client scores, statistics, grades, tiers, roster objects,
identity, display names, tickets, idempotency keys, leaderboard intent,
analytics, and request metadata are not part of the request grammar.

`DRAFT_VALIDATION_MODE` is a server-only Wrangler variable. Its top-level value
is `enabled`, which covers local development and Pages preview deployments. All
Pages previews that use the checked-in configuration may therefore expose this
route. The production override is exactly `disabled`. Only the exact lowercase
string `enabled` activates the route; a missing, malformed, or unexpected value
fails closed. In production, the route is indistinguishable from any unknown
API path: it returns the existing JSON 404 before inspecting the request body.
This preview capability is not production-ready.

When enabled, only `POST` is allowed and other methods return `Allow: POST`.
Requests must use exactly the `application/json` media type, without parameters
or a non-identity content encoding. If an `Origin` header is present, it must equal the request
URL origin; its absence is permitted for same-origin server tools. The bounded
stream reader stops at 16,384 UTF-8 bytes before full buffering and rejects an
empty body, malformed UTF-8, malformed JSON, arrays, primitives, and unknown
fields.

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
The production-disabled generic 404 intentionally retains the existing unknown
API response exactly.

| Status | Public codes |
| ---: | --- |
| 400 | `malformed_json`, `invalid_request_schema` |
| 403 | `origin_not_allowed` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
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
required because C2 has no schema, data, or migration changes.

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
