# Diamond Draft

Diamond Draft is a mobile-first baseball roster-building game. Classic Mode gives the player a random MLB franchise and decade for each of 14 rounds. The player drafts one eligible card per round, fills a complete roster, and receives a deterministic 162-game projection.

The beta is a static React + TypeScript + Vite application. It has no accounts, persistence, gameplay API calls, or server dependency.

## Current beta scope

The checked-in beta contains 1,536 player/franchise/decade cards across 48 pools:

- Franchises: Yankees, Red Sox, Dodgers, Giants, Cardinals, Cubs, Braves, Mariners, Orioles, Athletics, Angels, and Phillies
- Decades: 1980s, 1990s, 2000s, and 2010s
- Thirty-two curated cards per franchise/decade pool
- At least three eligible cards at every required hitter fielding position in every pool
- At least five meaningful starting-pitcher choices and three meaningful relief-pitcher choices in every pool

The Classic roster is C, 1B, 2B, 3B, SS, LF, CF, RF, DH, three SP slots, and two RP slots. Pitching slots have stable internal IDs while the player-facing picker continues to show a single SP or RP choice and fills the first open slot.

The source is the [SABR Lahman Baseball Database 2025](https://sabr.org/lahman-database/). Player totals are aggregated only from seasons with the card's franchise identity and decade. A Yankees 1990s card, for example, contains no statistics earned for another club or decade.

## Player cards

Runtime data lives in `src/data/mlb/betaPlayers.json` and is exposed through `src/data/mlb/index.ts`. Every card includes:

- A stable card ID and Lahman player ID
- Franchise, team abbreviation, and decade
- Historically recorded position eligibility derived from fielding appearances
- Hitter or pitcher role and explicit two-way status
- Visible and sortable franchise/decade statistics, with unavailable values represented as `null`
- Additional normalized scoring inputs
- Provenance notes

HR, AVG, ERA, SO, and SV are direct aggregates. Lahman does not publish WAR, OPS+, ERA+, wRC+, FIP, or modern defensive runs. The beta generator therefore calculates transparent, deterministic estimates from the underlying franchise/decade totals and the appropriate decade league environment. These estimates are suitable for beta gameplay tuning, but must not be represented as official Baseball-Reference or FanGraphs values.

## Projected record

`src/game/scoring.ts` owns the complete scoring model. React components contain no scoring formulas. It evaluates:

- Offense
- Defense
- Speed
- Starting pitching
- Relief pitching
- Roster balance
- Overall team strength

Rate and durability inputs are normalized before they are combined. DH receives no defensive value, while SP/RP role fit affects pitching value. The final deterministic strength score maps to a tunable 162-game win curve and a tier from Rebuild through Perfect Season.

## Run locally

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run validate:data
npm run test:game
npm run lint
npm run build
```

`npm run build` runs data validation automatically and fails on serious dataset errors.

## Add or regenerate a pool

The checked-in JSON is the runtime artifact, so contributors do not need Python to play or build the game. To regenerate it from an official Lahman release:

1. Obtain the Lahman `Batting`, `Pitching`, `Fielding`, `FieldingOFsplit`, and `People` RData files.
2. Install Python, pandas, and the `rdata` package outside the application bundle.
3. Add the franchise mapping or decade in `scripts/generate_beta_data.py`.
4. Run:

```bash
PYTHONPATH=/path/to/python/packages python3 scripts/generate_beta_data.py \
  --lahman-dir /path/to/Lahman/data
npm run validate:data
```

The generator aggregates team/decade totals, derives eligibility from appearances, selects the strongest coverage set, and writes the static JSON. Review every newly generated pool for identity changes and historically unusual secondary positions before merging it.

## Current limitations

- This is a 12-franchise, four-decade beta rather than the complete MLB historical database.
- Advanced metrics are documented beta estimates, not licensed values from a commercial statistics provider.
- Defensive and baserunning inputs are deliberately conservative proxies because Lahman lacks modern play-by-play metrics for the full period.
- The season projection is a game model, not a claim of predictive accuracy.
- Drafts are not saved between reloads and cannot be shared through accounts yet.
