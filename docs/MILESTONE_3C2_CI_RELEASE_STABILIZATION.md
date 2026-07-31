# Milestone 3C-2 CI and Preview release stabilization

Milestone 3C-2 adds validation-only GitHub Actions, explicit routine and manual
release test tiers, a focused dependency-risk decision record, aggregate-only
local Preview diagnostics, and the operator procedure for a future schema-4
Preview release. It does not authorize or perform deployment, migration,
Cloudflare access, secret or binding changes, feature activation, or Production
work.

The checked-in state remains fail-closed:

- public Preview leaderboard reads are disabled;
- Preview draft submissions are disabled;
- Preview identity mutations are disabled;
- Preview recovery is independently disabled;
- the corresponding Production capabilities are disabled;
- Preview Cron is empty;
- Production's private Worker has no D1 binding; and
- migration `0004_leaderboard_identity_ranking.sql` has not been applied
  remotely.

## Runtime and tooling boundaries

The shipped browser dependency set is React and React DOM. Vite,
`vite-plugin-pwa`, Workbox, the PWA asset generator, ESLint, Playwright,
Wrangler, and Miniflare are development dependencies.

Vite and Workbox create browser assets during a trusted repository build.
Their Node-only dependency graph is not copied into the browser bundle. Pages
Functions and the private Worker are bundled by local Wrangler dry-run
commands during manual validation. Miniflare and its `sharp` dependency support
local development; they are not part of the Pages Functions or Worker runtime.
The asset generator's `sharp` processes only explicitly selected local brand
images and is not part of `npm run build` or routine CI.

## Dependency and advisory decisions

The assessment uses the exact lockfile, `npm ls`, production-only and complete
`npm audit` reports, package metadata, reviewed GitHub advisories, and upstream
release notes. An audit severity is not treated as proof of shipped
reachability.

| Package and locked path | Reachability and prerequisite | Decision |
| --- | --- | --- |
| `fast-uri` through `vite-plugin-pwa > workbox-build > ajv` | Build-time AJV URI parsing only. Exploitation requires an attacker-controlled URL to be policy-checked by this parser and later consumed by Node using different backslash semantics. Repository PWA configuration is trusted. | Updated in-range from 3.1.3 to patched 3.1.4. |
| `brace-expansion` through `eslint > minimatch` | Local/CI lint only. Exploitation requires an attacker-controlled brace pattern large enough to exhaust the Node process. | Updated in-range from 5.0.7 to 5.0.9. |
| `brace-expansion` through `workbox-build > off-main-thread > ejs > jake > filelist > minimatch` | Build tooling only; glob patterns are fixed in `vite.config.ts`. No request, draft, identity, or remote value becomes a build glob. | The subtree moved from 2.1.2 to 2.1.4 during the targeted update, but the advisory still covers it. No compatible upstream Workbox release exists. Accepted as development-only residual risk. |
| `sharp` 0.33.5 through `@vite-pwa/assets-generator` | Manual image-generation tooling only. Exploitation requires decoding a malicious image selected by an operator. It is not invoked by build, routine CI, or release validation. | No compatible fixed `@vite-pwa/assets-generator` exists. Forcing sharp 0.35 across its declared `^0.33.5` range would cross documented sharp breaking changes. Accepted with a trusted-input-only rule. |
| `vite-plugin-pwa` 1.3.0 and Workbox 7.4.1 | PWA build tooling; generated service-worker assets are shipped, but the vulnerable Node packages are not. | Kept current. npm's suggested 0.18.2 is a major downgrade, does not resolve the separately direct asset-generator path, and creates disproportionate Vite 8/PWA regression risk. |
| Wrangler 4.111.0 > Miniflare 4.20260710.0 > sharp 0.34.5 | Wrangler types, dry-run bundles, local Pages/Worker development, and local simulation only. The sharp prerequisite is malicious local image input to Miniflare's Images path, which this repository does not use. | A compatible Wrangler 4.116.0 exists and selects Miniflare 4.20260730.0 with sharp 0.35.2. The update is deferred because protected `config/preview-release.json` pins 4.111.0 and this milestone may not change protected configuration. No override is used. |

`npm audit --omit=dev` reports zero vulnerabilities. The full audit retains 12
High entries because npm reports both vulnerable leaf packages and inherited
parent paths. They reduce to the two accepted leaf risks above: legacy
Workbox/Jake `brace-expansion`, and `sharp` in the asset-generator and pinned
Miniflare paths. Neither is reachable from shipped browser code, Pages
Functions, a deployed Worker, or untrusted end-user input in this repository.
Pull-request CI does execute the proposed repository code, as every test
workflow must, but it supplies no end-user pattern or image to these packages.
A PR author already controls package scripts and build configuration; the
read-only token, lack of secrets, 45-minute timeout, and concurrency
cancellation bound that inherent CI availability risk.

Do not use `npm audit fix --force`, a blanket resolution, or an unsupported
override. Revisit the residuals when Workbox or the PWA asset generator
publishes a compatible fixed dependency, or when a separately authorized
change updates the protected Wrangler pin.

Principal advisory and release references:

- [brace-expansion GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
- [fast-uri GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx)
- [sharp GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
- [sharp 0.35.0 changelog](https://sharp.pixelplumbing.com/changelog/v0.35.0/)
- [Wrangler 4.116.0 release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.116.0)
- [Miniflare 4.20260730.0 release](https://github.com/cloudflare/workers-sdk/releases/tag/miniflare%404.20260730.0)

## Routine GitHub Actions

`.github/workflows/ci.yml` runs only:

- on pushes to `develop`; and
- on pull requests whose base branch is `develop`.

It has `contents: read` and no other token permission. It does not use
`pull_request_target`, secrets, an environment, OIDC, a schedule,
`workflow_dispatch`, artifact uploads, deployment commands, remote Wrangler
commands, or Cloudflare credentials. Superseded runs in the same pull request
or branch are canceled. The job uses Ubuntu 24.04, Node 24.18.0, a 45-minute
timeout, immutable full-SHA pins for official checkout and Node setup actions,
and setup-node's npm download cache keyed by `package-lock.json`. It never
caches `node_modules` or Playwright browsers.

The job runs:

```bash
npm ci
npx --no-install playwright install --with-deps chromium
npm run ci:validate
```

The repository contract test verifies event coverage, permissions, immutable
action pins, exact commands, bounded timeout, cache configuration, and absence
of remote or deployment text. The protected-file test pins SHA-256 for both
Wrangler files, both Preview release models, all four migrations, and the Pages
routing files. A legitimate future change to one of those files must update the
guard in the same separately reviewed change.

GitHub recommends minimum explicit token permissions and full-length action
commit SHAs. Playwright recommends installing the browser with its system
dependencies and using one worker in CI; this repository already fixes the
browser suite at one worker.

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
- [GitHub dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Playwright CI guidance](https://playwright.dev/docs/ci)

## Test tiers

### Routine CI

After `npm ci` and the Chromium install above, run:

```bash
npm run ci:validate
```

This tier performs protected-file and workflow-contract checks, text integrity,
lint, every repository typecheck, all deterministic unit and integration
stages, a production build, three focused Chromium tests, and
`git diff --check`.

The focused browser tests cover:

- Production ignoring development activation and issuing no public API request;
- Preview ticket behavior with public submission disabled; and
- stale lazy-chunk recovery without a reload loop.

The two-version service-worker transition harness, the deeper release browser
journeys, and the full Chromium suite are excluded from routine CI because they
start extra servers, install and control service workers, or complete repeated
14-round drafts. Their release value is high, but their runtime and state
transitions are disproportionate for every push.

### Manual release validation

Before any proposed Preview deployment, run locally:

```bash
npm ci
npx --no-install playwright install chromium
npm run release:validate
```

This includes the routine non-browser contracts, all unit and integration
tests, the focused `@release` browser subset, the two-version PWA transition
suite, the complete Chromium suite, schema-4 and activation-state readiness,
both Worker dry-run bundles, the Pages Functions bundle, smoke executable
builds, bundle identity checks, lint, typechecks, text integrity, the production
build, and whitespace validation. A Node coordinator executes the tier without
shell evaluation, strips Cloudflare and Preview credentials from every child,
and disables Wrangler metrics, error reports, logs, remote `Request.cf`
metadata fetches, and banners. It uses local servers and fakes only.

After the changes are committed and the worktree is clean, the strict
pre-deployment gate remains:

```bash
npm exec --offline -- node scripts/preview-check.mjs --offline
```

That command additionally enforces the exact branch, upstream, divergence,
toolchain, clean state, protected topology, and safe package-script graph. Its
online form and every Preview planning command require separate authorization
because they contact Git and Cloudflare.

## Preview diagnostic evidence

`preview.operation` remains a four-field, low-cardinality log contract:
`event`, `operation`, `outcome`, and coarse `latency`. It never reads response
bodies and contains no display name, IP, user agent, request URL, ticket,
transcript, roster, capability, device credential, recovery code, raw error,
or fingerprint.

Milestone 3C-2 does not enable Workers Logs, Logpush, Analytics Engine, or any
other remote retention. Cloudflare Workers Logs requires a configuration change
and deployment; neither is authorized here. Live tail events therefore remain
ephemeral.

- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

The lightweight alternative is an aggregate-only local collector. During a
future separately authorized supervised Preview session, use two terminals:

```bash
npx wrangler tail pennant-pursuit-validation-preview \
  --format json \
  --search preview.operation \
  | node scripts/preview-diagnostics-summary.mjs \
      --source worker \
      --output .preview-diagnostics/worker-SESSION.json
```

```bash
npx wrangler pages deployment tail \
  --project-name diamond-draft \
  --environment preview \
  --format json \
  --search preview.operation \
  | node scripts/preview-diagnostics-summary.mjs \
      --source pages \
      --output .preview-diagnostics/pages-SESSION.json
```

Replace `SESSION` with a non-identifying operator label. Stopping a tail may
leave the pipeline with the expected interrupt status; verify that the summary
file was written. The collector keeps no raw line. It accepts only exact
four-field events, counts rejected lines without copying them, writes a new
mode-0600 JSON file, refuses overwrite, and confines output to the ignored
`.preview-diagnostics/` directory.

Input is streamed with a 65,536-character per-line ceiling and a 16 MiB
per-session byte ceiling. Oversized lines are discarded without retention; a
session exceeding the byte ceiling fails without writing a partial summary.

Access is limited to the release operator's local account. Retain a summary for
at most 14 days, or less if the release review closes earlier, then delete that
exact summary file. Deletion is manual and local. If parsing or file creation
fails, the session has no retained aggregate evidence; do not reconstruct it
from raw requests or tester-provided private data.

These summaries preserve per-session counts and coarse latency distribution,
but they are not remote durability, complete history, unique-user telemetry,
alerting, or evidence for percentages and hourly rates. Any activation rule
that depends on those capabilities still requires a separately authorized,
privacy-reviewed retained telemetry design.

## Schema-4 Preview operator procedure

This procedure is executable only after separate authorization and after the
current no-go conditions are resolved. Do not execute any remote command while
using this milestone as repository-only preparation.

### 1. Authorization and identity boundary

Record one approval that names:

- the exact commit SHA;
- the exact Preview Pages project, branch, private Worker, and D1 UUID;
- whether Cloudflare read access, migration, secret change, Worker deployment,
  Pages deployment, and each feature activation are authorized;
- the operator and independent reviewer; and
- an expiration time.

No approval for Preview authorizes Production. No CI result authorizes a remote
operation. Generic Cloudflare credentials are not accepted by the release
tooling.

Current no-go conditions are:

- the protected release manifest still has four unresolved remote identities;
- the protected activation model describes submission-only schema-3 states;
- it has no independent schema-4 identity or recovery states; and
- enabled-state generation intentionally refuses.

A separate reviewed configuration milestone must resolve those conditions
without editing migration history before any enabled plan can be approved.

### 2. Local pre-deployment evidence

From a clean `develop` checkout at the authorized commit:

```bash
git status --short
git status -sb
git rev-parse --short HEAD
git rev-list --left-right --count origin/develop...HEAD
node --version
npm --version
npm ci
npx --no-install playwright install chromium
npm run release:validate
npm exec --offline -- node scripts/preview-check.mjs --offline
```

Require a clean worktree, `0 0` divergence, Node 24, npm 11, exact protected
hashes, a clean production-only audit, and no Critical/High/Medium validation
failure. Capture command, UTC time, exit status, commit, and reviewed output;
do not capture credentials or raw browser data.

### 3. Read-only Preview grounding

Only when read access is separately authorized, run the documented identity
bootstrap and independently review its candidate output. Commit the grounded
manifest in a separate change before planning. Then run:

```bash
PENNANT_PREVIEW_API_TOKEN=<dedicated-read-token> \
npm exec --offline -- node scripts/preview-readiness.mjs \
  --target-state disabled
```

Require stable double-read evidence for exact Preview identities, no
Production collision, exact deployed commit, all public gates disabled, empty
Preview Cron, exact migration prefix, and either schema 3 with only migration
0004 pending or schema 4 with none pending.

### 4. Migration authorization and execution

Migration execution is a distinct approval checkpoint. Before applying:

1. Keep leaderboard reads, submission, identity, recovery, and Cron disabled.
2. Record a Preview D1 Time Travel bookmark under the authorized account.
3. Save the exact SHA-256 of migration 0004 and the read-only migration
   observation.
4. Stop unless the database is exact schema 3 with only 0004 pending.
5. Confirm the target UUID is the Preview UUID and differs from Production.

The authorized Time Travel evidence command is:

```bash
npx wrangler d1 time-travel info pennant-pursuit-preview --json
```

Under the migration-specific approval, execute only a freshly generated,
reviewed, unexpired canonical release package:

```bash
PENNANT_PREVIEW_API_TOKEN=<dedicated-read-token> \
PENNANT_PREVIEW_DEPLOY_API_TOKEN=<dedicated-preview-mutation-token> \
npm exec --offline -- node scripts/preview-release.mjs \
  --plan .preview-release/<readiness-package>.json
```

That executor must be the sole migration and deployment boundary; follow
the [Preview release workflow](PREVIEW_RELEASE_WORKFLOW.md) for its clean-tree,
dedicated-credential, TTY, challenge, and partial-failure contract. Do not run
a direct migration package script, paste SQL manually, edit 0004, reapply it as
a status check, or include a second migration.

Post-migration read-only verification must prove:

- `backend_schema` has one row, ID 1, version 4;
- no migration remains pending;
- the schema-4 identity, recovery-operation, event, and ranking structures
  exist;
- Production was not queried or changed; and
- every public gate is still disabled.

If apply outcome is ambiguous, do not retry. Re-read schema and migration state,
compare the bookmark and release evidence, and require a new reviewed plan.

### 5. Deployment preparation

Prepare a new canonical release package only after the separately reviewed
schema-4 activation model exists. The package must carry independent Pages and
Worker values for reads, submission, identity, and recovery, keep Production
disabled, keep Production Worker D1-free, and preserve Preview-only resource
identities.

The first deployment after migration must still have every public schema-4
capability disabled. Deploy the private Worker before Pages so Pages never
targets an older private contract. Verify the new Worker identity, no public
Worker URL or route, no Cron, correct Preview-only D1 binding, sanitized
diagnostics, and fail-closed health. Then deploy Pages and verify the exact
commit, routing, PWA assets, disabled API behavior, and Production isolation.

### 6. Feature activation order

Every step requires a new plan or the exact staged checkpoint recorded in the
approved plan. Verify health and browser behavior before proceeding:

1. Enable Preview leaderboard reads only.
2. Enable Preview identity claim/status/rename only.
3. Enable Preview draft submission only; run one owned, privacy-safe smoke and
   prove its exact D1 cleanup.
4. Enable Preview recovery independently; test one disposable identity and
   prove old device and recovery credentials no longer authenticate.
5. Enable cleanup Cron last; run the bounded retention smoke and verify no
   identity, player, or leaderboard-run deletion.

Ticket issuance and validation remain separate from these gates. Production
values remain disabled at every step. Do not combine recovery with identity
activation merely because the code shares an identity module.

### 7. Partial-failure handling

| Failure point | Required response |
| --- | --- |
| Migration apply ambiguous | Keep all gates disabled, do not retry, perform read-only schema reconciliation, and require a new plan. |
| Worker deployed, Pages not deployed | Keep Pages gates disabled; either complete the reviewed Pages disabled deployment or redeploy the prior reviewed Worker version. |
| Pages deployed, health degraded | Disable the affected Pages gate first, then its Worker gate; do not change schema. |
| Read activation fails | Disable reads; writes remain disabled. |
| Identity activation fails | Disable identity and recovery; submissions remain disabled until identity is healthy. |
| Submission smoke fails or cleanup is ambiguous | Disable submission immediately; do not delete by ticket ID alone and do not activate recovery or Cron. |
| Recovery verification fails | Disable recovery only, then assess whether identity mutations must also be disabled. Never reuse or log the recovery code. |
| Cron smoke fails or backlog persists | Disable Cron; keep submission state unchanged only if submission evidence remains healthy. |
| Diagnostic capture fails | Continue only with live, supervised stop conditions that do not depend on historical counts; otherwise pause the cohort. |

### 8. Emergency disablement and rollback

The safe rollback is configuration-first and forward-only:

1. disable recovery;
2. disable identity mutations;
3. disable submissions;
4. disable leaderboard reads;
5. disable Cron;
6. verify public routes return the established disabled behavior;
7. verify the Worker remains private and Production remains untouched; and
8. decide whether to redeploy the last known-good code.

When exposure is immediate, prepare all disabled values together but preserve
the public-before-private sequencing that removes public mutation reachability
first. A Pages rollback does not reverse D1. Do not down-migrate schema 4.
Prefer a reviewed forward fix; Time Travel restore requires its own destructive
recovery authorization.

### 9. Identity and credential reset

For one tester with a valid recovery code, use the normal recovery protocol so
device and recovery credentials rotate atomically. For a tester who still has a
device credential but wants to remove local access, use the UI's local
forget-device action; explain that it does not delete the server identity.

There is no administrator credential replacement and no safe way to attach a
new identity to an old run without the protocol. If both tester credentials are
lost, do not edit digests or reassign runs. The tester may create a new Preview
identity from a future qualifying run; any moderation or invalidation of the
old identity is a separate reviewed operation.

For a global identity-signing-key compromise:

1. disable identity and recovery, then submission;
2. notify the small Preview cohort that identities are disposable;
3. wait for claim and uncertain-recovery operation TTLs to expire;
4. stop: the current repository has no administrator reset executable, so
   ad-hoc SQL is prohibited;
5. in a separate reviewed change, implement and locally test a bounded reset
   tool that changes affected active players to `invalidated`, adds one
   `invalidated` identity event per player, preserves every player and run row,
   and verifies exact before/after counts in one transaction;
6. do not mutate eligible runs: leaderboard queries already exclude every
   player whose identity state is not `active`;
7. under separate reset and secret authorizations, execute that reviewed tool,
   then rotate the Worker-only key;
8. do not delete players while runs or identity records reference them; and
9. reactivate in the normal order with new disposable identities.

Until that bounded reset tool exists and passes independent review, a global
identity-key compromise is an emergency-disable and NO-GO condition, not a
recoverable operator procedure.

A later full Preview purge must use foreign-key-safe ordering:
recovery operations, identity claims, identity events, runs, then players.
Draft-submission receipt cleanup is separate. Capture counts before and after,
never broaden a failed predicate, and never perform the purge in Production.

### 10. Stale clients and PWA caches

Verify the built service worker and asset manifest before deployment. After a
Pages change, test one previously controlled client and one clean client. The
old shell must either update and reload once or show the truthful recovery UI;
it must not loop.

If a client remains stale:

1. stop mutation activation;
2. ask the tester to close all Pennant Pursuit tabs and reopen Preview;
3. if still stale, clear site data for the exact Preview origin only;
4. verify the new app version and disabled/active gates before resuming; and
5. never instruct a tester to clear all browser data or expose local
   credentials in a screenshot.

### 11. Go/no-go record

GO requires every item below:

- exact authorized commit and resource identities;
- successful manual release validation;
- protected hashes unchanged;
- exact schema state and migration evidence;
- current disabled baseline verified before each activation;
- feature-by-feature health, browser, and privacy-safe diagnostics evidence;
- successful owned-row cleanup for mutation smoke;
- stale-client and PWA transition success;
- Production isolation proof; and
- an independent reviewer signing the evidence index.

Any unknown identity, dirty state, stale package, ambiguous migration or
mutation, unexpected network request, privacy leak, failing Medium-or-higher
finding, incomplete rollback evidence, or Production collision is NO-GO.

Evidence may contain commit IDs, config hashes, migration hashes, deployment
IDs, feature states, aggregate diagnostic summaries, commands, times, and exit
statuses. It must not contain tokens, secrets, tickets, transcripts, rosters,
display names, device credentials, recovery codes, claim capabilities, raw
requests, IP addresses, or user agents.
