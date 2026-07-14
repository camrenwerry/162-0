# Diamond Draft

Diamond Draft is a mobile-first baseball roster-building game. Classic Mode presents one MLB franchise/decade pool in each of 14 rounds. The player fills C, 1B, 2B, 3B, SS, LF, CF, RF, DH, three SP slots, and two RP slots, then receives the current placeholder 162-game projection.

Version 0.6.0 is a static React + TypeScript + Vite application. It has no accounts, persistence, gameplay API calls, or database server.

## Official card definition

Every card is one **player + franchise + decade + best eligible single season**. The featured season must belong to that franchise and fall inside that decade. Cards never use career totals, combined decade totals, a different club's season, or an out-of-decade season.

The checked-in pools combine season-level counting and fielding records from the [SABR Lahman Baseball Database 2025](https://sabr.org/lahman-database/) with Baseball-Reference's public season/team WAR exports. Unavailable values are `null`; the pipeline does not manufacture wRC+, FIP, defensive, or baserunning values.

### Featured-season selection

The formula is isolated in `scripts/lib/player-pipeline.mjs` and is used only to select a featured season—no overall rating is shown in the game.

- A hitter season needs at least 100 PA. Its primary score is `WAR × 12 + (OPS+ − 100) × 0.5 + min(PA, 750) / 100`.
- A pitcher season needs at least 30 IP and must satisfy the SP or RP usage threshold. Its primary score is `WAR × 12 + (ERA+ − 100) × 0.35 + role workload`.
- A two-way season must satisfy the pitching rules and have at least 200 PA. Its selection score blends both sides.
- Records are filtered to the requested franchise and decade before they are scored. A manual featured-season override is allowed, but only when that season exists in the already eligible group.

The legacy OPS/ERA/WHIP fallback remains available only for explicitly unverified imports missing enrichment. Verified current cards must contain the supported advanced fields or validation fails.

### Position eligibility

Eligibility is derived only from appearances in the featured season:

- Fielding position: at least 10 games
- SP: at least 10 starts
- RP: at least 15 relief appearances
- DH: supplied by the existing game rule to any hitter; never stored as season fielding eligibility

Manual overrides can add or remove historically supported positions and are surfaced as validation warnings. Normal pitchers cannot fill DH. A historically supported two-way card can expose both batting and pitching views.

## Data layout

```text
data-import/
  pool-config.json            franchise/source-team and decade definitions
  season-stats.csv            one player/franchise/season batting-pitching row
  fielding-appearances.csv    one player/franchise/season/position row
  advanced-season-stats.csv   Baseball-Reference WAR/OPS+/ERA+ enrichment
  manual-overrides.json       reviewed name, season, position, and note overrides
  validation-report.json      generated machine-readable report
  stat-completeness-report.json generated per-card visible-stat audit
src/data/mlb/
  franchises.ts
  decades.ts
  pool-index.json             validated combinations available to Randomizer
  pools/<franchise>-<decade>.json
  index.ts                    generated TeamPool-facing registry
```

The season import includes Lahman and Baseball-Reference identities, franchise/team identity, season, batting and pitching values, handedness, and source team IDs. The fielding import includes player/team identity, season, position, games, and starts. The advanced import joins only exact Baseball-Reference player/team/season rows and carries source URLs and a verification date.

React never imports pool JSON. `TeamPool` is the only runtime adapter; unsupported combinations return no cards, and the randomizer sees only combinations in the generated index. This boundary can later become lazy or remote without changing components.

## Build and validate data

The generated JSON is committed, so Python is not required to run the app.

```bash
npm run data:build      # transform raw CSVs into pools and generate a report
npm run data:validate   # strictly validate the checked-in generated pools
npm run data:audit      # write and check every card's visible-stat completeness
npm run data:report     # print the last generated report grouped by pool
npm run test:data       # season selection and validation unit checks
```

Blocking validation covers duplicate IDs, identities, franchise/decade association, featured-year range, position/stat shapes, full 14-slot roster feasibility, and missing verified modern WAR/OPS+/ERA+/WHIP fields. The audit additionally checks every displayed hitter and pitcher statistic and records every card's verification state. It requires at least three SP and two RP options. Coverage, unverified data, overrides, and low playing time are warnings.

To reproduce the raw import from an official Lahman checkout:

```bash
PYTHONPATH=/path/to/python/packages python3 scripts/export-lahman-seasons.py \
  --lahman-dir /path/to/Lahman/data
node scripts/import-baseball-reference.mjs \
  --batting /path/to/war_daily_bat.txt \
  --pitching /path/to/war_daily_pitch.txt
npm run data:build
```

The export helper requires Python, pandas, and `rdata`; none ship in the browser bundle.

## Add a franchise or decade

1. Add its canonical ID, display identity, and all applicable Lahman team IDs to `data-import/pool-config.json`.
2. Add the matching typed display definition to `src/data/mlb/franchises.ts` or `decades.ts`.
3. Re-export the raw season files (or add verified rows using the documented CSV schema).
4. Run `npm run data:build`, inspect the organized warnings, then run all quality checks below.
5. Review the generated pool for identity changes and historically unusual secondary positions before merging.

`manual-overrides.json` supports `names` by source player ID and `featuredSeasons`, `positionOverrides`, and `notes` by `<franchise>-<decade>-<playerId>`. Position overrides use `{ "add": [], "remove": [] }`. They must document a historically defensible exception; validation never allows an override to bypass the franchise/decade season filter.

Every generated card includes internal `sourceMetadata` with verification state, source label/URL/date, source player ID, and source team IDs. This metadata is deliberately invisible during gameplay. A record marked `verified: false` remains a warning until reviewed.

## Supported combinations

The current data index contains 48 verified pools: Yankees, Red Sox, Dodgers, Giants, Cardinals, Cubs, Braves, Mariners, Orioles, Athletics, Angels, and Phillies for each of the 1980s, 1990s, 2000s, and 2010s. This includes the milestone pools SEA 1990s, NYY 2000s, ATL 1990s, STL 2000s, LAA 2010s, BOS 2000s, LAD 2010s, and CHC 1990s.

Pools contain roughly 28–35 selected cards and are validated for complete-roster play. Coverage targets are warnings rather than a reason to invent players or eligibility.

## Run and test

```bash
npm install
npm run dev

npm run data:build
npm run data:validate
npm run data:audit
npm run data:report
npm run test:data
npm run test:game
npm run test:engine
npm run lint
npm run build
```

`npm run build` runs strict data validation before TypeScript and Vite.

## Engine boundary and limitations

`DraftEngine` owns transitions, `Randomizer` owns combination selection, `Eligibility` owns roster rules, `TeamPool` owns data access and queries, and `Scoring` remains a replaceable placeholder. Components render immutable snapshots.

Known limitations:

- The pool covers 12 franchises and four decades, not all MLB history.
- Baseball-Reference WAR, OPS+, and ERA+ are imported for the supported modern seasons. Other unavailable advanced scoring inputs remain `null`; the UI keeps its `—` fallback and nulls sort last.
- Some pools use lower-playing-time but still threshold-qualified real seasons to preserve historical position coverage; these are called out in the report.
- The projection remains a game placeholder, not a final simulation or a claim of predictive accuracy.
- Drafts are not persisted.
