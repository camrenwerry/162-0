# Server validation foundation

Backend Phase C1 provides a shared, Worker-compatible replay and scoring
foundation. It does not add a Function route, submission protocol, identity,
leaderboard, database access, persistence, analytics, or runtime writes.

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

## Guidance for a future Function

A separately authorized future server phase should:

1. Import only the Worker catalog adapter, shared replay core, shared version
   support, and pure scoring function. Do not import `ReplayDraft.ts`,
   `TeamPool`, `DraftEngine`, React, or browser generated pools.
2. Parse an explicitly bounded JSON request and pass the unknown transcript to
   `validateTranscriptShape`. Never accept client statistics, roster objects,
   scores, or catalog fields.
3. Reuse one immutable catalog per isolate if desired. Never store request or
   user state in module globals; the catalog's lazy cache contains immutable
   canonical eligibility views only.
4. Call `replayDraftWithCatalog`, then call `calculateDraftResult` on the
   returned canonical roster. Sanitize `DraftReplayError` into stable client
   validation codes. Treat `WorkerCatalogError` as an internal configuration
   failure and do not return its detail.
5. Add method, content-type, request-size, rate-limit, abuse, privacy,
   observability, replay-protection, and response-contract review before any
   endpoint is enabled. Submission persistence, identity, and leaderboard
   behavior remain separate designs requiring separate authorization.

Phase C1 deliberately stops before all routing, Cloudflare configuration,
deployment, D1 access, schema changes, resource creation, secrets, variables,
identity, submissions, leaderboard behavior, analytics, moderation, and writes.
