# Diamond Draft Beta Feedback

Running checklist for v0.11.3 and later beta work. Historical audits are report-only: they never add cards, replace featured seasons, or overwrite manual position overrides.

## Current beta issues

- [x] Expand the compressed projected-win curve without a flat bonus.
- [x] Keep average fixtures in the 86–95-win band and make 162–0 attainable only through explicit perfect-roster gates.
- [x] Remove Speed from the Results presentation while retaining its internal scoring effect.
- [x] Keep the draft flow, randomizer, roster slots, category weights, balance penalties, and weak-category penalties unchanged.
- [ ] Review new beta reports for real-roster outliers after v0.11.3 ships.

## Historical data tasks

- [x] Validate all generated card identities, supported pools, featured-season decades, source stats, and roster completeness.
- [x] Add reusable award/Hall of Fame/franchise-tenure discovery instead of a fixed list of modern stars.
- [x] Detect canonical duplicate card IDs and suspicious duplicate generated files.
- [ ] Triage expected-player findings in [STAR_AUDIT.md](audits/STAR_AUDIT.md); add players only through a separately reviewed data change.

## Scoring tuning notes

- Scoring payload version: `2.1`.
- The win conversion is deterministic piecewise interpolation. It starts at a 70-win floor, remains restrained through average scores, then expands sharply through great, historic, all-time, and near-perfect scores.
- Category weights remain Offense 32%, Defense 18%, Starting Pitching 25%, Relief Pitching 12%, hidden Speed 5%, and Roster Balance 8%.
- Speed now contributes to the Offense facet and modifies the existing power/contact production-mix input to Roster Balance. It continues its direct Overall contribution.
- When a card lacks a cross-era defensive value, its featured-season workload and positional difficulty supply a deterministic defensive proxy. This prevents real historical rosters from being permanently capped near neutral Defense.
- Existing weak-major-category, rotation-depth, bullpen-depth, weak-defense, and roster-balance adjustments remain active.
- Benchmark output: [SCORING_BENCHMARKS.md](audits/SCORING_BENCHMARKS.md).

## Missing player audit

- Command: `npm run audit:stars`
- Inputs: supported generated pools, exact MVP/Cy Young/Rookie of the Year records, Hall of Fame inductions with meaningful franchise relevance, and data-derived long-tenure/high-selection franchise candidates.
- Output includes missing expected players, duplicate cards/files, and suspicious featured-season count.
- Checklist/report: [STAR_AUDIT.md](audits/STAR_AUDIT.md).

## Position audit

- Command: `npm run audit:positions`
- Reviews every generated hitter card against featured-season eligibility, raw position appearances, fuller nearby eligible seasons, and documented overrides.
- Manual overrides are reported and retained, never overwritten.
- Checklist/report: [POSITION_AUDIT.md](audits/POSITION_AUDIT.md).

## Featured-season audit

- Command: `npm run audit:seasons`
- Compares every chosen card with all eligible same-player, same-franchise, same-decade seasons.
- Flags formula conflicts, clearly stronger eligible alternatives, and short featured seasons that narrowly outrank much fuller seasons.
- Checklist/report: [FEATURED_SEASON_AUDIT.md](audits/FEATURED_SEASON_AUDIT.md).

## Release quality gate

- [x] Tests
- [x] Data validation
- [x] Star audit
- [x] Position audit
- [x] Featured-season audit
- [x] Scoring benchmark report
- [x] Lint
- [x] Production build
