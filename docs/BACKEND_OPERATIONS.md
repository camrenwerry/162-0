# Backend operations

Pennant Pursuit Backend Phase B uses two separate D1 databases:

- Preview: `pennant-pursuit-preview` (`ba6255b4-9425-4863-b10f-79149180f75a`)
- Production: `pennant-pursuit-production` (`4b821c17-b88b-462d-a2ed-c6a2113cc362`)

The top-level/default Wrangler environment binds only preview as `DB`. The explicit `[env.production]` override binds only production as `DB`. The names and UUIDs differ, and neither environment can inherit or select the other database under the checked-in configuration.

The only application table is `backend_schema`, which contains the singleton schema version. No user identity, display name, draft, roster, gameplay, transcript, analytics, request, IP-address, user-agent, or location data is stored. Leaderboard, submissions, and all runtime writes remain disabled.

## Environment boundaries

All Cloudflare Pages preview deployments share `pennant-pursuit-preview`; a branch preview is not an isolated database. Tests and manual preview activity must therefore treat the remote preview database as shared state. Production deployments use only `pennant-pursuit-production` after a future authorized deployment activates the checked-in configuration.

In `wrangler.toml`, each `database_id` is a real remote D1 database UUID. The top-level value `preview_database_id = "DB"` is the local Pages preview identifier used by Wrangler, not the UUID or name of another remote database. Local development must use Wrangler's local persistence and must not add `remote = true` to either binding. This prevents ordinary local requests from reaching a remote database.

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

A Pages deployment rollback does not roll back D1 schema or data. Applied D1 migrations have no automatic down-migration. Prefer a reviewed forward migration for a released schema problem, or use Time Travel only through a deliberate recovery procedure. Because Phase B stores only the singleton schema-version row, there is no user or gameplay data to recover.

## Phase C checklist

Future server-side validation and submission work requires separate authorization and a new privacy, abuse, schema, and deployment review:

1. Define the minimum submission data contract and retention policy before collecting anything.
2. Validate game version, rules, deterministic RNG inputs, transcript, roster legality, and score entirely on the server.
3. Design idempotency, replay protection, rate limits, request-size limits, and safe error responses.
4. Decide whether player identity or display names are necessary; if so, document consent, normalization, moderation, deletion, and abuse handling first.
5. Add narrowly scoped migrations, read/write APIs, feature flags, observability, and rollback procedures with focused tests.
6. Keep submissions and leaderboard disabled until schema, security, privacy, load, and moderation checks pass in an isolated preview rollout.
7. Treat production migration, Pages deployment, and feature enablement as separately authorized operations.
