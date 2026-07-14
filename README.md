# Diamond Draft

Diamond Draft is a mobile-first baseball roster-building game. Classic Mode presents one MLB franchise/decade pool in each of 14 rounds. The player fills C, 1B, 2B, 3B, SS, LF, CF, RF, DH, three SP slots, and two RP slots, then receives a deterministic 162-game projection.

Version 0.8.0 is a static React + TypeScript + Vite application. It has no accounts, persistence, gameplay API calls, or database server.

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

Compact cards render at most four real numeric values in documented hitter/pitcher priority order. Missing values remain in the data model and reports but are omitted from the compact grid. TeamPool exposes only sort choices backed by at least one usable value in the active pool/filter; same-type cards with null values remain visible and sort last.

## Build and validate data

The generated JSON is committed, so Python is not required to run the app.

```bash
npm run data:build      # transform raw CSVs into pools and generate a report
npm run data:validate   # strictly validate the checked-in generated pools
npm run data:audit      # write and check every card's visible-stat completeness
npm run data:report     # print the last generated report grouped by pool
npm run test:data       # season selection and validation unit checks
```

Blocking validation covers duplicate IDs, identities, franchise/decade association, featured-year range, position/stat shapes, full 14-slot roster feasibility, at least three SP and two RP options, and missing verified modern WAR/OPS+/ERA+/WHIP fields. The data build also requires at least 20 supported pools and writes generated runtime pools only after validation succeeds. The audit additionally checks every displayed hitter and pitcher statistic and records every card's verification state. Missing-data reports summarize WAR, OPS+, and ERA+ counts and classify gaps as source-column, import-mapping, unverified-card, historical-source, or manual-review issues.

Coverage targets are at least three choices at C, 1B, 2B, 3B, SS, LF, CF, and RF, five SP choices, and three RP choices. Falling short of a target is a warning when the pool can still complete the roster; inability to assign 14 distinct players across all slots is blocking. Validation uses a matching algorithm, so one multi-position player cannot be counted as several simultaneous selections. DH is derived from any hitter under the game rule. Heavy dependence on one multi-position card is reported as a warning.

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

The current index contains **48 playable pools and 1,371 verified cards**. Each listed franchise supports all four listed decades:

| Franchise | Abbreviation | Supported decades |
| --- | --- | --- |
| New York Yankees | NYY | 1980s, 1990s, 2000s, 2010s |
| Boston Red Sox | BOS | 1980s, 1990s, 2000s, 2010s |
| Los Angeles Dodgers | LAD | 1980s, 1990s, 2000s, 2010s |
| San Francisco Giants | SFG | 1980s, 1990s, 2000s, 2010s |
| St. Louis Cardinals | STL | 1980s, 1990s, 2000s, 2010s |
| Chicago Cubs | CHC | 1980s, 1990s, 2000s, 2010s |
| Atlanta Braves | ATL | 1980s, 1990s, 2000s, 2010s |
| Seattle Mariners | SEA | 1980s, 1990s, 2000s, 2010s |
| Baltimore Orioles | BAL | 1980s, 1990s, 2000s, 2010s |
| Oakland Athletics | OAK | 1980s, 1990s, 2000s, 2010s |
| Los Angeles Angels | LAA | 1980s, 1990s, 2000s, 2010s |
| Philadelphia Phillies | PHI | 1980s, 1990s, 2000s, 2010s |

Pools contain 24–36 selected cards and are validated for complete-roster play. Every current pool has at least five SP and three RP choices. Coverage targets remain warnings rather than a reason to invent players, positions, seasons, or statistics. Run `npm run data:report` for exact per-pool counts, position coverage, pitching depth, verification totals, missing advanced fields, blocking errors, and warnings.

## Scoring engine v1.0

The v0.8.0 scoring engine runs only after a roster is complete. It uses each card's featured-season statistics, rolled franchise and decade, and assigned roster position. It never uses career totals, reputation, name recognition, another franchise's season, or randomness. The same roster therefore always produces the same category scores, grades, and projected record.

The engine evaluates offense, power, contact/on-base ability, speed, defense, starting pitching, relief pitching, and roster balance. SP and RP use separate role-specific normalization. Defense excludes DH and applies only a modest assignment-position adjustment. Overall strength combines offense, defense, rotation, bullpen, speed, and balance while applying capped depth penalties and balance bonuses. A perfect season requires an exceptional overall score, exceptional major categories, exceptional balance, and no weak roster slot; otherwise the deterministic win curve is capped below 162.

All inputs come from the featured season. Era-adjusted OPS+ and ERA+ carry the most context, while rate and workload statistics provide supporting signals. When a metric is genuinely `null`, it is omitted rather than treated as zero. Available metric weights are redistributed proportionally, and low-coverage calculations blend toward a neutral baseline instead of fabricating a value. Internal player confidence is `high`, `medium`, or `low`, but confidence and hidden player values are not exposed during drafting or on the production Results screen.

Scoring code is isolated under `src/game/scoring/`. Tune normalization ranges, player weights, positional adjustments, category weights, grade thresholds, record-curve points, and perfect-season safeguards in `src/game/scoring/scoringConfig.ts`. The structured result payload is versioned as `1.0` for future balancing migrations.

Development diagnostics are disabled by default. Start the development server with `VITE_SCORING_DIAGNOSTICS=true npm run dev` to log per-player normalized components, redistributed weights, confidence, category calculations, overall adjustments, and projected-win mapping after a completed draft. Diagnostics are not rendered in the UI or enabled in production builds.

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
npm run test:scoring
npm run lint
npm run build
```

`npm run build` runs strict data validation before TypeScript and Vite.

## Engine boundary and limitations

`DraftEngine` owns transitions, `Randomizer` owns combination selection, `Eligibility` owns roster rules, `TeamPool` owns data access and queries, and `DiamondDraftScoring` owns the deterministic v1.0 projection behind the replaceable `Scoring` interface. Components render immutable snapshots and never calculate scores.

Known limitations:

- The pool covers 12 franchises and four decades, not all MLB history.
- Baseball-Reference WAR, OPS+, and ERA+ are imported for the supported modern seasons. Other unavailable advanced scoring inputs remain `null`; the UI keeps its `—` fallback and nulls sort last.
- Some pools use lower-playing-time but still threshold-qualified real seasons to preserve historical position coverage; these are called out in the report.
- Exact position depth varies by franchise history. For example, a playable pool may warn below the three-player target rather than assign an unsupported secondary position.
- The v1.0 projection is a tunable game model, not a plate-appearance simulation or a claim of real-world predictive accuracy.
- Drafts are not persisted.

At runtime, `TeamPool` exposes only generated indexed pools that contain cards. `DraftEngine` refuses to start without capacity for all 14 rounds and both one-time rerolls, and `Randomizer` reserves enough unused combinations to finish the draft without repetition. These checks produce developer-facing errors before a game starts rather than allowing a mid-draft dead end.
