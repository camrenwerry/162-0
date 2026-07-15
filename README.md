# Diamond Draft

Diamond Draft is a mobile-first historical baseball roster-building game. Classic Mode presents one franchise/decade pool in each of 14 rounds. A complete roster contains C, 1B, 2B, 3B, SS, LF, CF, RF, DH, three SP, and two RP slots, followed by a deterministic 162-game projection.

Version 0.11.5 is a public beta of the static React + TypeScript + Vite application. It has no accounts, gameplay API, or database server. Local storage is used only to remember whether first-game tips were dismissed.

## Public beta configuration

Copy `.env.example` to `.env.local` to configure optional beta feedback:

```bash
VITE_FEEDBACK_URL=https://example.com/diamond-draft-feedback
```

When configured, feedback links appear in the gameplay menu and Results screen. Diamond Draft appends safe context parameters (`appVersion`, `currentScreen`, and, when available, `round`, `team`, `decade`, and `projectedRecord`). This works with a Google Form or any external form that accepts query parameters. When the variable is absent or invalid, the links are hidden.

First-game tips are dismissible and can be re-enabled from **How to Play** on the Home screen. Home, Restart, Play Again, and a new game from Home all construct a fresh draft engine, clearing the roster, used combinations, and reroll usage.

Results can be shared with the device’s native share sheet. The summary includes the projected record, overall grade, tier, strongest category, and `window.location.origin`. Browsers without Web Share copy the complete summary to the clipboard. If clipboard permission is blocked, a selectable fallback dialog keeps the result available for manual copying. No result image or personal data is created.

## Installable PWA

Diamond Draft is installable from supporting desktop and mobile browsers. It launches at the Home screen in portrait-oriented standalone mode and uses an auto-updating Workbox service worker. The lightweight Home application shell is available during a temporary network outage. The large historical draft-data chunk is intentionally excluded from precaching, and drafts and game history are not persisted offline.

On iOS, open the deployed site in Safari and choose **Share → Add to Home Screen**. On supported Chromium browsers, use the browser’s install action. Safe-area metadata and the dark `#0D1117` theme are shared by the browser and standalone experience.

The icon source is [`public/app-icon.svg`](public/app-icon.svg), a square recomposition of the existing Diamond Draft crest. Generated assets include 192×192 and 512×512 standard icons, a padded dark-background 512×512 maskable icon, a 180×180 Apple touch icon, and a browser favicon. To revise them:

1. Edit `public/app-icon.svg`, keeping the core mark in the central safe area.
2. Adjust padding or background in `pwa-assets.config.ts` if necessary.
3. Run `npm run pwa:icons`.
4. Inspect the standard, maskable, and Apple outputs before committing them.

### Beta testing

The most useful feedback covers incorrect players or featured seasons, incorrect positions, missing statistics, scoring balance, mobile layout issues, confusing instructions, and bugs or crashes. Include the round and displayed franchise/decade when reporting a draft issue.

### Cloudflare Pages deployment

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: optional `VITE_FEEDBACK_URL`
- SPA routing: `public/_redirects` sends direct `/draft` requests to `index.html`

Preview and test the exact production output locally:

```bash
npm run build
npm run test:pwa
npm run preview
```

Open the HTTPS deployment—or the local preview on `localhost`, which browsers treat as secure—to inspect the manifest, service-worker registration, offline shell, and installability in browser developer tools. Raw Lahman CSV files remain outside `src` and are not emitted to `dist`.

## Draft completion experience

Late-round player lists keep every matching card visible while grouping currently selectable players above greyed-out cards. The grouping is performed by the eligibility engine after search, position, player-type, and stat sorting, so each group preserves the chosen sort order and DH/SP/RP rules remain centralized.

After the 14th roster assignment, the completed roster briefly lands before a deterministic Season Simulation presentation. One continuous progress animation moves through Simulating Season, Postseason, and Finalizing Results in about three seconds before revealing the record in the same stable card. The existing scoring engine runs once and its immutable result payload drives both the reveal and full Results screen. The presentation can be skipped without recalculating, supports one-session restart/Home confirmation, and uses a shortened sequence for `prefers-reduced-motion`.

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
- DH: at least 10 appearances recorded in Lahman `G_dh`
- SP: at least 10 starts
- RP: at least 15 derived relief appearances
- Source-qualified DH is retained in `eligiblePositions`; other hitters may still use the DH slot under the game rule

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
  readiness.json                compact browser startup-validation manifest
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

The build scans every franchise/decade from the 1920s through the 2020s, creates all eligible season candidates, selects one featured season per player/franchise/decade, and curates 24–40 cards toward a target of 36. Coverage targets are three players per fielding position, five SP, and three RP. Curation preserves the legacy coverage-sized core, then adds the highest-ranked remaining cards without dropping below either that core's weakest selection score or the configured expansion-quality floor; it can continue beyond 36 only when roster completion requires it, and never beyond 40. Multi-position cards can satisfy multiple depth targets but the final roster-feasibility check uses distinct-player bipartite matching.

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

## Scoring engine v2.3

The v2.3 projection uses the generated featured-season statistics plus the pipeline’s league/year context metrics. Hitter scoring uses era-relative offense, OPS, OBP, SLG, rate production, hidden speed, workload, and modest positional/defensive context. Pitcher scoring uses role-specific era-relative run prevention, ERA, WHIP, K/9, BB/9, workload, starts or relief appearances, and modest save value. Broader metric anchors and a continuous piecewise win curve separate weak, average, elite, and historic rosters without a flat win bonus; perfect seasons also require at least 152 wins from that curve before qualification.

The engine does not require WAR, OPS+, ERA+, wRC+, or FIP. Missing optional inputs are omitted, available weights are redistributed, and low-coverage calculations blend toward the league-average anchor. When cross-era defensive enrichment is unavailable, a neutral-confidence fallback combines featured-season workload and positional difficulty. The same roster always returns the same result. Speed remains a small internal input to offense, overall strength, and roster balance, but is not displayed as a Results category.

## Run and test

```bash
npm install
npm run dev

npm run data:lahman:all
npm run audit:stars
npm run audit:positions
npm run audit:seasons
npm run scoring:benchmarks
npm run scoring:distribution
npm run test:data
npm run test:game
npm run test:engine
npm run test:scoring
npm run test:responsive
npm run test:presentation
npm run test:beta
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
