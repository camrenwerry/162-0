# Diamond Draft

Diamond Draft is a mobile-first historical baseball roster-building game. Classic Mode presents one franchise/decade pool in each of 14 rounds. A complete roster contains C, 1B, 2B, 3B, SS, LF, CF, RF, DH, three SP, and two RP slots, followed by a deterministic 162-game projection.

Version 0.9.0 is a static React + TypeScript + Vite application. It has no accounts, persistence, gameplay API, or database server.

## Historical data provenance

The checked-in generated pools are built from the complete CSV release of the **SABR Lahman Baseball Database 2025** in `data-import/lahman/`. The release covers recognized major leagues through 2025 and includes MLB and Negro-league records. The database is copyright 1996–2025 by SABR, donated by Sean Lahman, and distributed under the Creative Commons Attribution-ShareAlike 3.0 Unported license. See `data-import/lahman/readme2025.txt` and [SABR’s Lahman Database page](https://sabr.org/lahman-database/) for source notes and licensing.

Raw CSV files are build-time inputs only. They live outside `src/`, are never imported by React, and are not bundled for the browser. Generated Classic Mode data is isolated in the route-lazy Classic chunk, so the Home screen does not pay the historical-data startup cost.

## Official card definition

Every card is one **player + canonical franchise + decade + best eligible single season**.

- Franchise identity comes from Lahman `franchID`, so relocations remain one lineage. Brooklyn/Los Angeles Dodgers, New York/San Francisco Giants, Washington/Minnesota Twins, Montreal/Washington Nationals, and other moves are not split into duplicate franchises.
- Batting or pitching stints with the same player, franchise, and year are aggregated before eligibility and featured-season selection.
- The card retains the historical team name and abbreviation from its featured season.
- Featured seasons must belong to the selected franchise and decade. Career totals, decade totals, another club’s season, and out-of-decade seasons are never substituted.
- The selection formula is configurable in `data-import/lahman-build-config.json`. It uses Lahman-native production, workload, role, positional value, and league/year context. WAR, OPS+, and ERA+ are not required.

### Visible season statistics

Hitter cards support AVG, OBP, SLG, OPS, HR, RBI, SB, games, and plate appearances. Pitcher cards support ERA, WHIP, SO, W, SV, innings, games, starts, derived relief appearances (`G - GS`), K/9, and BB/9. Values come only from the featured franchise season. A genuinely unavailable source value remains `null`; the pipeline never manufactures a zero.

### Position and role eligibility

Eligibility is derived from the featured season only:

- Fielding position: at least 10 appearances
- SP: at least 10 starts
- RP: at least 15 derived relief appearances
- DH: supplied at draft time to hitters under the game rule; it is not stored as a fielding position

`FieldingOFsplit.csv` is preferred for LF/CF/RF. Generic OF records never grant all three outfield positions. Normal pitchers cannot fill DH; verified two-way seasons can expose both batting and pitching views.

## Pipeline architecture

```text
data-import/
  lahman/                       complete upstream CSV release
  lahman-build-config.json      thresholds, coverage, and selection weights
  lahman-overrides.json         reviewed exceptions only
scripts/
  lib/lahman-pipeline.mjs       parse, aggregate, derive, select, curate, validate
  build-lahman-data.mjs
  validate-lahman-data.mjs
  report-lahman-data.mjs
src/data/generated/
  combinations.json             only validated playable combinations
  franchises.json               canonical lineage and historical-name manifest
  pools/<franchise>-<decade>.json
  runtime-pools/<franchise>-<decade>.json compact UI payloads without audit-only metadata
  data-report.json              full build/coverage/exclusion audit
  index.ts                      TeamPool-facing registry
```

The UI reads data only through `TeamPool`. `Randomizer` sees only combinations in `combinations.json`, so excluded or missing pools cannot be rolled. Pool JSON is generated deterministically; volatile report timestamps are the only non-repeatable build metadata.

### Build, validate, and report

```bash
npm run data:lahman:build
npm run data:lahman:validate
npm run data:lahman:report
npm run data:lahman:all
```

The build scans every franchise/decade from the 1920s through the 2020s, creates all eligible season candidates, selects one featured season per player/franchise/decade, and curates 24–40 cards. Coverage targets are three players per fielding position, five SP, and three RP. Multi-position cards can satisfy multiple depth targets but the final roster-feasibility check uses distinct-player bipartite matching.

Pools with blocking identity, season, stat, duplicate, size, pitching-depth, or roster-feasibility errors are written to the report and omitted from the runtime index. Historically thin but still playable depth is a warning. Run the report command for exact counts by decade, franchise, exclusion reason, and position.

### Refreshing the source release

1. Replace the CSV files under `data-import/lahman/` with one internally consistent official SABR Lahman release.
2. Update the source label/date in `data-import/lahman-build-config.json`.
3. Run `npm run data:lahman:all`.
4. Review `src/data/generated/data-report.json`, especially excluded pools, warnings, franchise names, and decade counts.
5. Run the complete quality suite below and review the generated diff before committing.

### Overrides

`data-import/lahman-overrides.json` supports:

- `featuredSeasons`: card identity to `{ season, sourceLabel, reason, verified }`
- `positions`: card identity to `{ add, remove, sourceLabel, reason, verified }`
- `names`: Lahman player ID to `{ name, sourceLabel, reason, verified }`
- `notes`: card identity to an internal source note
- `fieldCorrections`: `{ cardId, field, value, sourceLabel, reason, verified: true }`

Field corrections fail the build if provenance fields are missing or the target path is invalid. Overrides must document source-backed exceptions and cannot bypass franchise/decade validation.

## Scoring engine v2.0

The v2.0 projection uses the generated featured-season statistics plus the pipeline’s league/year context metrics. Hitter scoring uses era-relative offense, OPS, OBP, SLG, rate production, speed, workload, and modest positional/defensive context. Pitcher scoring uses era-relative run prevention, ERA, WHIP, K/9, BB/9, workload, starts or relief appearances, and saves.

The engine does not require WAR, OPS+, ERA+, wRC+, or FIP. Missing optional inputs are omitted, available weights are redistributed, and low-coverage calculations blend toward neutral. The same roster always returns the same result. The scoring payload is versioned `2.0` because the data inputs materially changed in this release.

## Run and test

```bash
npm install
npm run dev

npm run data:lahman:all
npm run test:data
npm run test:game
npm run test:engine
npm run test:scoring
npm run test:responsive
npm run lint
npm run build
```

Tests cover CSV parsing, same-franchise stint aggregation, featured-season selection and overrides, relocation identity, position/role thresholds, distinct-player roster completion, generated-index integrity, sorting and null placement, randomizer completion without repeats, rerolls, scoring determinism, and production compilation.

## Historical limitations

- Some early franchise/decade combinations cannot support the game’s fixed modern roster, especially two RP slots or split LF/CF/RF. They remain documented in `data-report.json` and are not rolled.
- Lahman does not provide WAR, OPS+, ERA+, wRC+, or detailed modern fielding value for all history. Diamond Draft uses source-supported stats and its own transparent context metrics instead of fabricating enrichment.
- Relief appearances are derived as `G - GS`; Lahman does not provide a separate relief-appearance column.
- Exact source completeness varies by league and era. Unsupported optional RBI, SB, or SV values stay null and sort after real values.
- The projection is a deterministic game model, not a plate-appearance simulator or a claim of real-world predictive accuracy.
- The generated data is eager within the route-lazy Classic Mode bundle. A future D1 or per-pool transport can replace `TeamPool` without changing visual components or draft rules.
