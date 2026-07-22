# Backend operations

Pennant Pursuit Backend Phase B uses two separate D1 databases:

- Preview: `pennant-pursuit-preview`
- Production: `pennant-pursuit-production`

The top-level/default Wrangler environment binds only preview as `DB`. The explicit `[env.production]` override binds only production as `DB`. The names and UUIDs differ, and neither environment can inherit or select the other database under the checked-in configuration.

Schema version 1 contains only `backend_schema`. The additive D1C.1 schema
version 2 also defines `draft_submissions` for retained submission receipts.
D1C.2 implements the atomic submission path behind disabled flags, and D1C.3
implements bounded retention cleanup in the preview private Worker. No user
identity, display name, raw ticket, signature, draft, roster, gameplay,
transcript, analytics, request, IP-address, user-agent, or location data has a
storage column. Leaderboard, submissions, and all runtime writes remain
disabled in the checked-in default configuration.

## Environment boundaries

All Cloudflare Pages preview deployments share `pennant-pursuit-preview`; a branch preview is not an isolated database. Tests and manual preview activity must therefore treat the remote preview database as shared state. Production deployments use only `pennant-pursuit-production` after a future authorized deployment activates the checked-in configuration.

In `wrangler.toml`, each `database_id` is a real remote D1 database UUID. The top-level value `preview_database_id = "DB"` is the local Pages preview identifier used by Wrangler, not the UUID or name of another remote database. Local development must use Wrangler's local persistence and must not add `remote = true` to either binding. This prevents ordinary local requests from reaching a remote database.

## Private validation isolation and production enablement

`VALIDATION_SERVICE` is explicit in both Pages environments and targets two
different private Workers:

- Preview: `pennant-pursuit-validation-preview`, with preview-only rate-limit
  namespaces.
- Production: `pennant-pursuit-validation-production`, with distinct
  production rate-limit namespaces.

Both targets share the source in `workers/draft-validation/`, but each has a
separate Worker name and separate 5/10-second and 20/60-second Rate Limiting
counter namespaces. Both disable `workers.dev` and Worker preview URLs and have
no route, custom domain, KV, R2, Durable Object, queue, analytics, or external
fetch binding. Only the preview Worker has the `pennant-pursuit-preview` D1
binding; the production Worker has no D1 binding. Validation and ticket handlers
remain storage-free. The disabled submission handler and scheduled cleanup are
the only repository paths that can write the preview binding. No signing secret
is stored in this repository or Wrangler variables. The signing secret exists
only on the preview Worker as an out-of-repository secret; the production Worker
has none. The reviewed production Pages configuration sets
`DRAFT_VALIDATION_MODE` to exactly `enabled`; a future Pages deployment is
required before that checked-in setting becomes live. Once live, only a valid,
same-origin `POST` with trusted Cloudflare connection metadata is privately
proxied to the production Worker. The Pages proxy and validation path remain
read-only and do not access D1.

Rate Limiting is deliberately best-effort, per-location, and eventually
consistent; it does not promise an exact sixth-request denial. No transcript,
roster, player, key, request metadata, validation attempt, identity, ticket,
leaderboard, or analytics history is stored. D1C.2's disabled persistent ticket
consumption is not activated and does not establish leaderboard eligibility.

## Preview-only draft tickets

Phase D1A prepares a stateless, signed draft-ticket protocol. It remains
preview-only: the default Pages and private Worker configurations set
`DRAFT_TICKET_MODE = "enabled"`, while both production configurations set it to
`"disabled"`. The production Pages route therefore returns the established
generic 404 before reading a body or invoking its private Service Binding.
Production draft validation remains independently enabled and read-only.

Preview `POST /api/v1/draft-ticket` goes through the existing Pages trusted-IP
and same-origin boundary and then the existing preview `VALIDATION_SERVICE`
binding. The private Worker applies the existing two Rate Limiting bindings
before parsing the small versioned request. It has no public route or URL, and
the ticket path neither reads nor writes D1 or any other storage. It returns an
opaque signed ticket with a server-generated ID and `seeded-v1` draft seed.

The Worker expects a secret named `DRAFT_TICKET_SIGNING_KEY` only at an
explicitly authorized preview deployment. It is not a Wrangler variable and
is not present in checked-in configuration or generated types. The deployed
preview Worker has this secret; production does not. A missing secret fails
safely with the existing generic 503 response. A deterministic non-production
key exists only in automated test code and is never part of a deployed bundle.

Each ticket is HMAC-SHA-256 signed, expires 15 minutes after issuance, and
allows at most 60 seconds of future clock skew during later server-side
verification. Phase D1B verifies these claims during preview validation and
binds them to the transcript before replay. At the D1B stop point, its signed
ticket ID was reserved as the future submission idempotency key, and D1B did
not consume it. D1C.2 later implements that transaction behind the
still-disabled submission gate.

Preview `POST /api/v1/validate-draft` now requires exactly an opaque `ticket`
and a `transcript`. Ticket verification occurs only in the private Worker after
both rate limits. The signed ID, seed, issuance time, app/rules/RNG/scoring/data
versions, canonical digest, transcript schema, and classic game mode must match
the transcript header and authoritative ruleset before the unchanged replay and
scoring path begins. Failures use fixed sanitized responses. Validation remains
read-only: it does not access D1, consume tickets, store replay state, or create
a submission. One-time consumption belongs only to the separately disabled
D1C.2 submission route; validation alone remains replayable.

D1B does not deploy production code, add a production signing secret, or enable
production ticket issuance. Production retains `DRAFT_TICKET_MODE = "disabled"`.
The shared D1B Worker source requires a signing secret for successful
validation, so it must not be deployed to the secret-free production Worker
without a separately reviewed production ticket strategy; it will otherwise
fail closed with the generic 503.

To rotate the signing key in a future authorized deployment, first disable
ticket issuance, wait at least the 15-minute ticket lifetime plus 60-second
skew, rotate the Worker secret, and then re-enable issuance only after the
private preview checks pass. This intentionally invalidates old tickets without
needing multi-key acceptance. To roll back D1A, set the relevant preview
`DRAFT_TICKET_MODE` to `"disabled"` and deploy that reviewed Pages/Worker
configuration; no D1 cleanup, migration, or data recovery is required.

## D1C.1 disabled submission foundation

D1C.1 is governed by the recovered
[Corrected D1C.0 authoritative submission contract](D1C0_CORRECTED_SUBMISSION_DESIGN.md).

D1C.1 adds migration `0002_draft_submissions.sql`, the preview-only private
Worker D1 binding, and `DRAFT_SUBMISSION_MODE = "disabled"` in both Pages and
private-Worker environments. Production's private Worker intentionally has no
D1 binding. The migration advances `backend_schema` from 1 to 2 and adds only
the minimal future-consumption columns, database-enforced ticket-ID primary key,
and retention index approved in D1C.0.

At the D1C.1 stop point there was no `/api/v1/submit-draft` route, scheduled
cleanup handler, submission-path D1 read or write, ticket consumption, or
persistent idempotency behavior. Ticket and validation paths did not access the
new binding. While submission is disabled, health accepts schema 1 or 2 so code
and migration can be rolled out independently; an unknown schema remains
degraded. D1C.4 later separates flag intent from Pages-proven schema readiness:
the protocol is published only for exact reachable schema 2, while private
Worker write execution remains externally unverified.

D1C.1 performs no remote preview migration, Worker deployment, Pages deployment,
secret operation, production migration, or remote production configuration
change. All migration verification is local until a later explicit authorization.

## D1C.2 disabled atomic submission path

D1C.2 adds the public Pages proxy and private authoritative
`POST /api/v1/submit-draft` handler, but `DRAFT_SUBMISSION_MODE` remains exactly
`disabled` in every Pages and Worker environment. The disabled gate returns the
generic 404 before origin, IP, body, Service Binding, or D1 processing.

If a future preview activation is separately authorized, the private Worker
checks a retained row before current ticket verification. Exact retries return
the immutable stored receipt; conflicting token or transcript digests fail with
fixed responses. A new submission verifies the ticket, bindings, replay, and
score before one D1 batch performs `INSERT ... ON CONFLICT DO NOTHING` followed
by the authoritative row `SELECT`. D1 primary-key uniqueness resolves races.
The row stores only the approved digests, server timestamps, fixed schema name,
and bounded receipt. Production has no Worker D1 binding or signing secret.

D1C.2 is repository-only. It does not apply migration 0002 remotely, deploy,
enable submission, publish submission version metadata, or write remote data.

## D1C.3 preview retention cleanup path

D1C.3 added an awaited scheduled handler to the same private Worker and
originally placed `17 * * * *` UTC in the top-level preview configuration.
That meant deploying the default Worker would also apply the Cron Trigger;
deployment and Cron activation were not independent. D1C.4 corrects the
checked-in default to explicit `crons = []` and reserves the schedule for the
reviewed `cron-enabled` activation state. Production keeps an explicit empty
Cron list, both checked-in submission flags remain disabled, production remains
D1-free, and no cleanup HTTP route exists.

Each invocation samples current server time once and requires schema version 2.
It executes at most ten sequential prepared DELETE statements. Each statement
deletes at most 500 rows satisfying only `retain_until_ms <= cutoff_ms`, ordered
by `retain_until_ms, ticket_id`, and every statement binds the same cutoff. A
batch deleting fewer than 500 rows completes the run. Ten full batches stop at
5,000 rows and conservatively emit `cleanup.backlog` without another query.

Any missing binding, incompatible schema, query exception, or malformed D1
result stops immediately, emits only bounded `cleanup.failed` observability,
and rejects the scheduled event without calling `noRetry()`. Earlier DELETE
statements remain committed and a later invocation can resume. Logs contain
only the outcome plus bounded completed-batch and deleted-row counts; they never
contain rows, identifiers, digests, SQL, exception details, secrets, bindings,
or request data.

D1C.3 changed repository code and configuration only. Its checked-in schedule
coupled a future Worker deployment to Cron activation; no remote activation was
performed. D1C.4 provides separate reviewed configuration states instead.

## D1C.4 preview activation preparation

The checked-in Pages and private-Worker defaults now represent the exact
disabled state: both submission flags are disabled and preview Cron is
explicitly empty. The repository defines and validates `disabled`,
`submission-enabled`, and `cron-enabled` preview states without changing any
production section. Enabled health publishes
`pennant-draft-submission-v1` from the existing protocol constant only when the
Pages flag is configured and reachable D1 schema 2 is exact. It reports schema
readiness, not private Worker readiness; operational writes remain
`externally-unverified` until the smoke independently observes endpoint success
and exact D1 persistence.

See [D1C.4 preview activation preparation](D1C4_ACTIVATION.md) for the exact
manifest, validation and review commands, generated local config inputs,
guarded smoke harnesses, stop conditions, and two-step rollback. D1C.4 performs
no remote migration, deployment, endpoint request, feature activation, Cron
activation, secret operation, binding change, route change, or production
change.

## Local migration workflow

Local state is persisted beneath the ignored `.wrangler/` directory:

```bash
npm run db:migrations:list:local
npm run db:migrations:apply:local
npm run dev:pages
```

Regenerate and check the Worker environment types after any binding change:

```bash
npm run functions:types
npm run functions:types:check
npm run functions:typecheck
npm run validation-worker:types
npm run validation-worker:types:check
npm run validation-worker:typecheck
npm run test:validation-worker
npm run test:d1c3-retention-cleanup
```

For an isolated local scheduled-handler check, apply migrations only to a
temporary local Wrangler persistence directory, start the private Worker with
scheduled-event testing enabled, and invoke the local scheduled test endpoint.
Never add `--remote` to that workflow.

## Remote preview migration workflow

These legacy commands explicitly target `pennant-pursuit-preview` in the
default/top-level environment:

```bash
npm run db:migrations:list:preview
npm run db:migrations:apply:preview
```

Do not treat `db:migrations:list:preview` as read-only release inspection. The
pinned Wrangler implementation may create the `d1_migrations` metadata table
while listing. Phase 1 Preview checking and planning therefore never invoke
that command; they use the fixed SELECT-only design documented in
[Preview release workflow: Phase 1](PREVIEW_RELEASE_WORKFLOW.md). The apply
command remains mutation-capable and outside Phase 1.

Phase 1 mirrors pinned Wrangler 4.111.0's default discovery of every top-level
`migrations/*.sql` file and its numeric-leading filename ordering. It rejects
unsupported names, invalid UTF-8, BOMs, duplicate metadata, malformed
`applied_at` values, and repository/database ordering differences. When a
pending migration is observed while public submissions are enabled, the plan
first schedules Cron disablement when active, then Pages write-gate
disablement, and then verification of the disabled gate before
`migration.apply`. This ordering is a future plan only; Phase 1 cannot apply
the migration.

Inspect the pending list before applying. Do not reapply a migration merely as a status check.

## Guarded production migration workflow

Production migration work must start from the expected `develop` branch and a clean worktree. Verify authentication, account, Pages project, database inventory, database identities, deployed health, migration contents, feature flags, and absence of runtime write routes first.

Before an apply, record the current Time Travel bookmark without restoring anything:

```bash
npx wrangler d1 time-travel info pennant-pursuit-production --json
```

Then inspect pending migrations and use only the guarded wrapper:

```bash
npm run db:migrations:list:production
CONFIRM_PRODUCTION_D1="<production-database-id-from-reviewed-config>" npm run db:migrations:apply:production
```

`CONFIRM_PRODUCTION_D1` is a deliberate confirmation token and must exactly equal the production UUID. The wrapper prints the branch and HEAD, refuses dirty worktrees, CI, non-interactive terminals, ambiguous bindings, the wrong database name, an invalid or preview-matching UUID, and a missing or incorrect token. It issues a final warning and requires `APPLY pennant-pursuit-production` to be typed before invoking exactly:

```bash
wrangler d1 migrations apply pennant-pursuit-production --remote --env production
```

## Production deployment sequence

A Pages deployment is a separate operation and is not part of Backend Phase B. For a future authorized production release:

1. Re-run the repository, Cloudflare inventory, binding-isolation, migration-status, schema, and health checks.
2. Run all type generation, typechecks, tests, lint, and the production build from a clean reviewed revision.
3. Confirm preview still uses only the preview UUID and production still uses only the production UUID.
4. Deploy a preview revision and verify static routes, PWA assets, API methods, and non-mutating preview health.
5. Deploy production only under separate authorization, then verify the same behavior and production schema version 1.

## Recovery and rollback limitations

D1 Time Travel is continuously available for supported production-backend databases, but a bookmark is only a recovery point; it is not a tested down-migration. A restore overwrites database state and requires a separate reviewed recovery plan and explicit authorization.

A Pages deployment rollback does not roll back D1 schema or data. Applied D1 migrations have no automatic down-migration. Prefer a reviewed forward migration for a released schema problem, or use Time Travel only through a deliberate recovery procedure. Production still stores only the singleton schema-version row. D1C.1 has no remote data and no user or gameplay data to recover.

## Phase C checklist

Future server-side validation and submission work requires separate authorization and a new privacy, abuse, schema, and deployment review:

1. Define the minimum submission data contract and retention policy before collecting anything.
2. Validate game version, rules, deterministic RNG inputs, transcript, roster legality, and score entirely on the server.
3. Design idempotency, replay protection, rate limits, request-size limits, and safe error responses.
4. Decide whether player identity or display names are necessary; if so, document consent, normalization, moderation, deletion, and abuse handling first.
5. Add narrowly scoped migrations, read/write APIs, feature flags, observability, and rollback procedures with focused tests.
6. Keep submissions and leaderboard disabled until schema, security, privacy, load, and moderation checks pass in an isolated preview rollout.
7. Treat production migration, Pages deployment, and feature enablement as separately authorized operations.
