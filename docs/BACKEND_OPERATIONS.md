# Backend operations

Pennant Pursuit Backend Phase B uses two separate D1 databases:

- Preview: `pennant-pursuit-preview` (`ba6255b4-9425-4863-b10f-79149180f75a`)
- Production: `pennant-pursuit-production` (`4b821c17-b88b-462d-a2ed-c6a2113cc362`)

The top-level/default Wrangler environment binds only preview as `DB`. The explicit `[env.production]` override binds only production as `DB`. The names and UUIDs differ, and neither environment can inherit or select the other database under the checked-in configuration.

Schema version 1 contains only `backend_schema`. The additive D1C.1 schema
version 2 also defines an initially empty `draft_submissions` table for future
ticket consumption, but D1C.1 adds no submission route or runtime write path.
No user identity, display name, raw ticket, signature, draft, roster, gameplay,
transcript, analytics, request, IP-address, user-agent, or location data is
stored. Leaderboard, submissions, and all runtime writes remain disabled.

## Environment boundaries

All Cloudflare Pages preview deployments share `pennant-pursuit-preview`; a branch preview is not an isolated database. Tests and manual preview activity must therefore treat the remote preview database as shared state. Production deployments use only `pennant-pursuit-production` after a future authorized deployment activates the checked-in configuration.

In `wrangler.toml`, each `database_id` is a real remote D1 database UUID. The top-level value `preview_database_id = "DB"` is the local Pages preview identifier used by Wrangler, not the UUID or name of another remote database. Local development must use Wrangler's local persistence and must not add `remote = true` to either binding. This prevents ordinary local requests from reaching a remote database.

## Private validation isolation and production enablement

`VALIDATION_SERVICE` is explicit in both Pages environments and targets two
different private Workers:

- Preview: `pennant-pursuit-validation-preview`, namespaces `16204011` and
  `16204012`.
- Production: `pennant-pursuit-validation-production`, namespaces `16204021`
  and `16204022`.

Both targets share the source in `workers/draft-validation/`, but each has a
separate Worker name and separate 5/10-second and 20/60-second Rate Limiting
counter namespaces. Both disable `workers.dev` and Worker preview URLs and have
no route, custom domain, KV, R2, Durable Object, queue, analytics, external
fetch, or runtime-write binding. D1C.1 gives only the preview Worker an unused
binding to `pennant-pursuit-preview`; the production Worker has no D1 binding,
and the validation and ticket handlers remain storage-free. No signing secret
has been created or configured in this repository. The signing secret exists only on the preview
Worker as an out-of-repository secret; the production Worker has none. The reviewed production Pages
configuration sets `DRAFT_VALIDATION_MODE` to exactly `enabled`; a future Pages
deployment is required before that checked-in setting becomes live. Once live,
only a valid, same-origin `POST` with trusted Cloudflare connection metadata is
privately proxied to the production Worker. The Pages proxy, Worker, and
validation path remain read-only and do not access D1.

Rate Limiting is deliberately best-effort, per-location, and eventually
consistent; it does not promise an exact sixth-request denial. No transcript,
roster, player, key, request metadata, validation attempt, identity, ticket,
submission, leaderboard, or analytics data is stored. Persistent ticket
consumption and replay protection still require separate review before any
result can be eligible for a leaderboard.

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
explicitly authorized preview deployment. It is not a Wrangler variable, is not
present in checked-in configuration or generated types. The deployed preview
Worker has this secret; production does not. A missing secret fails safely with
the existing generic 503 response. A deterministic non-production key exists
only in automated test code and is never part of a deployed bundle.

Each ticket is HMAC-SHA-256 signed, expires 15 minutes after issuance, and
allows at most 60 seconds of future clock skew during later server-side
verification. Phase D1B verifies these claims during preview validation and
binds them to the transcript before replay. Its signed ticket ID is the future submission idempotency key:
the future submission table must enforce a unique ticket-ID constraint and atomically
consume it. D1B deliberately does neither, so a valid ticket can still be
replayed until that persistence layer is separately designed and authorized.

Preview `POST /api/v1/validate-draft` now requires exactly an opaque `ticket`
and a `transcript`. Ticket verification occurs only in the private Worker after
both rate limits. The signed ID, seed, issuance time, app/rules/RNG/scoring/data
versions, canonical digest, transcript schema, and classic game mode must match
the transcript header and authoritative ruleset before the unchanged replay and
scoring path begins. Failures use fixed sanitized responses. Validation remains
read-only: it does not access D1, consume tickets, store replay state, or create
a submission. One-time consumption and persistent replay protection remain
deferred.

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

D1C.1 adds migration `0002_draft_submissions.sql`, the preview-only private
Worker D1 binding, and `DRAFT_SUBMISSION_MODE = "disabled"` in both Pages and
private-Worker environments. Production's private Worker intentionally has no
D1 binding. The migration advances `backend_schema` from 1 to 2 and adds only
the minimal future-consumption columns, database-enforced ticket-ID primary key,
and retention index approved in D1C.0.

There is still no `/api/v1/submit-draft` route, scheduled cleanup handler,
submission-path D1 read or write, ticket consumption, or persistent idempotency
behavior. The existing ticket and validation paths do not access the new binding. While
submission is disabled, health accepts schema 1 or 2 so code and migration can
be rolled out independently; an unknown schema remains degraded. A prematurely
enabled submission flag remains degraded while submission version metadata is
`null` and does not advertise writes.

D1C.1 performs no remote preview migration, Worker deployment, Pages deployment,
secret operation, production migration, or remote production configuration
change. All migration verification is local until a later explicit authorization.

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
npm run validation-worker:types:check
npm run validation-worker:typecheck
npm run test:validation-worker
```

## Remote preview migration workflow

These commands explicitly target `pennant-pursuit-preview` in the default/top-level environment:

```bash
npm run db:migrations:list:preview
npm run db:migrations:apply:preview
```

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
CONFIRM_PRODUCTION_D1="4b821c17-b88b-462d-a2ed-c6a2113cc362" npm run db:migrations:apply:production
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
4. Deploy a preview revision and verify static routes, PWA assets, API methods, and read-only preview health.
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
