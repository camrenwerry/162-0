# Backend operations

Pennant Pursuit Backend Phase A uses exactly one D1 database: `pennant-pursuit-preview`. The top-level/default Wrangler environment binds it as `DB`. The production environment explicitly overrides the inherited list with `d1_databases = []`, so production has no D1 binding.

The only application table is `backend_schema`, which contains the singleton schema version. No user identity, display name, draft, roster, gameplay, transcript, analytics, request, IP-address, user-agent, or location data is stored. Leaderboard, submissions, and all runtime writes remain disabled.

## Environment boundaries

All Cloudflare Pages preview deployments share `pennant-pursuit-preview`; a branch preview is not an isolated database. Tests and manual preview activity must therefore treat the remote preview database as shared state.

In `wrangler.toml`, `database_id` is the real remote D1 database UUID. The value `preview_database_id = "DB"` is the local Pages preview identifier used by Wrangler, not the UUID or name of a second remote database. Local development must use Wrangler's local persistence and must not add `remote = true` to the binding. This prevents ordinary local requests from reaching the shared remote preview database.

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

Inspect the pending list before applying. A Pages deployment rollback does not roll back D1 schema or data, and an applied D1 migration has no automatic down-migration. Correct a released schema with a reviewed forward migration or an explicitly planned database recovery operation.

## Production commands are blocked in Phase A

The production command names are reserved for a later, separately authorized phase:

```bash
npm run db:migrations:list:production
npm run db:migrations:apply:production
```

Do not run either command during Phase A. No `pennant-pursuit-production` database or production binding exists, so listing cannot target an authorized resource and the apply wrapper refuses to proceed. Even after a production binding is introduced, the apply wrapper requires a clean worktree, an interactive non-CI terminal, the exact production database name and UUID, a matching `CONFIRM_PRODUCTION_D1` value, and a final typed warning confirmation.

## Phase B checklist

Production D1 work requires new authorization and a fresh safety review:

1. Confirm the expected repository, branch, clean worktree, HEAD, Cloudflare account, Pages project, health responses, and complete D1 resource inventory.
2. Create exactly `pennant-pursuit-production` with automatic configuration updates disabled, then independently verify its name and UUID.
3. Add one explicit `env.production` D1 binding with that real UUID while preserving the preview binding and all no-secret/no-variable constraints.
4. Regenerate Functions types and extend the configuration, health, migration, and production-isolation tests.
5. Review pending migrations, backups, rollback limitations, and the production safety-wrapper output before any remote apply.
6. Apply migrations through the guarded production wrapper only after a clean full test pass and explicit production-migration authorization.
7. Treat any Pages deployment as a separate operation requiring its own review and authorization.
