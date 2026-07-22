# Preview release workflow: Phase 1

Phase 1 establishes immutable Preview identity, offline release-readiness
checks, read-only remote inspection, and deterministic planning. It cannot
deploy, apply a migration, upload an artifact, change a flag, enable or disable
Cron, run a smoke request, roll back, or change a Cloudflare resource.

The canonical Pages and Worker configurations remain `disabled`. The reviewed,
non-secret identity source is `config/preview-release.json`. Preview/Production
collisions, incomplete inventories, and ambiguous observations fail closed.

## Preview check

Offline mode is the default:

```bash
npm exec --offline -- node scripts/preview-check.mjs
npm exec --offline -- node scripts/preview-check.mjs --offline
```

Offline checking verifies the exact repository, branch, upstream, clean state,
local divergence, package and lockfile metadata, supported tool versions,
manifest topology, all three activation states, documentation command
references, and the release-readiness quality suite. Before the first
npm-controlled quality stage, it validates the complete reachable package
script graph, including nested `npm run` references, `pre*` and `post*`
lifecycle hooks, recursion, cycles, shell syntax, executable and argument
allowlists, and known mutation commands. Child processes receive a minimal
credential-free environment, and npm child stages run with lifecycle execution
disabled after the graph has been validated.

The public command uses `npm exec` with a fixed Node entry point and does not
name a package script. npm therefore has no matching repository
`prepreview:*` or `postpreview:*` lifecycle hook to run around the validator.
This outer boundary is separate from the validator's recursive inspection of
all repository-controlled child scripts and their lifecycle hooks.

Online checking adds server-side `develop` verification and allowlisted
Cloudflare Preview inventory reads:

```bash
PENNANT_PREVIEW_API_TOKEN=<dedicated-read-token> npm exec --offline -- node scripts/preview-check.mjs --online
```

`PENNANT_PREVIEW_API_TOKEN` is required only for online mode. The commands do
not fall back to generic Cloudflare credentials, pass credentials to child
processes, or print or persist the token. The token should have only the read
permissions required for the reviewed Preview resources.

Machine-readable and uncolored output are available with `--json` and
`--no-color`. For JSON-only stdout through npm, suppress npm's banner:

```bash
npm exec --offline -- node scripts/preview-check.mjs --json
```

## Preview plan

Planning is always online and requires an explicit target:

```bash
npm exec --offline -- node scripts/preview-plan.mjs --target-state disabled
npm exec --offline -- node scripts/preview-plan.mjs --target-state submission-enabled
npm exec --offline -- node scripts/preview-plan.mjs --target-state cron-enabled
```

The plan records local and server Git hashes, target and observed states,
deployment-input and intended-artifact fingerprints, safe remote state,
migration classification, satisfied stages, future stages, approval
checkpoints, operational-verification status, rollback implications, and a
deterministic plan ID. It is recursively immutable and contains no remote
mutation capability.

`deploymentOutcome` and `operationalVerificationRequired` are separate. Phase
1 has neither trusted remote artifact fingerprints nor durable smoke receipts.
It therefore conservatively retains the applicable future deployments, and:

- `submission-enabled` always retains `submission.smoke`.
- `cron-enabled` always retains `submission.smoke` and `retention.smoke`.
- `disabled` retains future Worker and Pages deployments because remote
  artifact currentness is unproven.

No hypothetical, missing, stale, or malformed receipt field can turn an
enabled target into a fully verified no-op. Receipt creation and smoke
execution remain outside Phase 1.

## Exact topology and exposure inventory

Pages and Worker binding inventories must exactly equal their complete reviewed
state-specific sets. Unexpected or duplicate D1, service, rate-limit, KV, R2,
Durable Object, queue, analytics, Hyperdrive, Vectorize, secret-name, unknown,
or future binding categories are refused. Alternate binding names do not bypass
this rule.

Pages response parsing recognizes the documented binding collections,
including `hyperdrive_bindings` and `vectorize_bindings`, separately from
ordinary metadata such as `build_image_major_version`, `fail_open`, and
`usage_model`. Documented metadata is validated but is not treated as a
binding; a nonempty unreviewed binding collection still fails exact inventory.

Worker privacy requires all of the following:

- `workers.dev` is disabled.
- Worker Preview URLs are disabled.
- The account-wide custom-domain inventory contains no domain for the Preview
  Worker.
- The authoritative account-wide zone inventory exactly equals the reviewed
  expected zone identities, and every one contains no route for the Preview
  Worker.
- The custom-domain single-page response is complete; documented optional
  response metadata, when present, is internally consistent.
- Each zone route endpoint returns one complete array with no unsupported
  pagination query.

The paginated account-zone endpoint filtered to the reviewed account is the
source of completeness. Manifest route-zone values are expected identities
only and must exactly match that authoritative result before route inspection.
Because the repository does not currently ground those expected identities,
online checking and planning refuse before Cloudflare contact. Callers cannot
supply route zones at runtime. The dedicated token must be scoped for
account-wide Zone Read so a restricted subset cannot be mistaken for the
account inventory.

The normal inspection path uses JSON settings plus the Worker deployments
endpoint. The first active deployment must identify one version receiving 100%
of traffic; that deployment and version pair is included in both stable reads.
The path does not download the Worker source endpoint; that endpoint is raw
source, not JSON metadata.

## Read-only request boundary

The Cloudflare client accepts named operations rather than arbitrary URLs.
Every operation first descriptor-validates and copies its exact parameter set
into a frozen plain snapshot. The fixed method, path, pagination bounds where
applicable, identity checks, Production-identity scan, and URL construction use
only that snapshot. Accessors, symbols, inherited properties, unexpected keys,
non-enumerable properties, exotic prototypes, and arbitrary query strings are
refused before fetch.

One monotonic deadline remains active through fetch completion, headers,
bounded streaming, body completion, decoding, JSON parsing, generic envelope
validation, endpoint-specific semantic validation, and final normalized result
construction. A zero or already-expired
deadline refuses before fetch, and timer cleanup occurs once. Redirects,
oversized bodies, invalid content
lengths, stalled streams, invalid UTF-8, BOMs, malformed JSON, unexpected
shapes, missing or inconsistent pagination metadata, duplicate deployment IDs,
malformed timestamps, truncated pages, and ambiguous latest deployments are
rejected. Timed-out readers are canceled. Requests are never retried
automatically.

## Stable observation window and artifact evidence

Deployment-relevant repository fingerprints use immutable `HEAD` tree entries,
not mutable working-tree source reads. They cover the repository tree,
`package.json`, `package-lock.json`, Node/npm/Wrangler and tool-contract inputs,
Pages and Worker configuration, relevant source, generated declarations, build
configuration, static assets, Functions source, code-generation inputs, and
available reproducible bundle outputs.

A source commit match is only source evidence. An intended artifact hash is the
local canonical deployment-input fingerprint. Phase 1 has no version-bound,
trusted remote artifact fingerprint, so `provenCurrent` is always false for
Pages and Worker artifacts. A matching Pages commit or arbitrary Worker tag is
never artifact proof, and the relevant future deployment remains scheduled.

Planning builds an initial candidate and then repeats the critical Cloudflare
read, local repository inspection, server `develop` read, migration
classification, and deployment hashes. Any changed HEAD, worktree state,
branch, upstream, divergence, remote URL, server hash, active Worker deployment
or version, Worker settings, Pages deployment, migration state, or build input
makes the observation stale.

The command does not retry into a new plan.

## Migration inspection and maintenance ordering

Phase 1 does not use `wrangler d1 migrations list` because the pinned Wrangler
implementation may initialize `d1_migrations`. It uses only these fixed reads:

```sql
SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('backend_schema', 'd1_migrations') ORDER BY name ASC
SELECT id, name, applied_at FROM d1_migrations ORDER BY id ASC
SELECT version FROM backend_schema WHERE id = 1
```

The Cloudflare D1 query API requires POST for these reads, but the request
builder accepts only the exact SELECT statements. No other POST operation is
defined.

Repository discovery mirrors pinned Wrangler 4.111.0's default top-level
`migrations/*.sql` matching and numeric-leading filename ordering. Every
applicable top-level `.sql` file is included. Unsupported names, invalid UTF-8,
BOMs, normalized duplicate identities, malformed applied rows, duplicate IDs
or names, invalid `applied_at`, and repository/database ordering differences
fail closed. Applied source hashes remain unverifiable because Wrangler's
`d1_migrations` table does not store them.

If submissions are enabled and a migration is pending, a Cron-enabled state
first schedules `cron.disable`, followed by `pages.disable`.
`submission.disable.verify` must precede `migration.apply`. Only then can the
plan schedule target Worker and Pages deployments, submission verification,
Cron deployment, and retention verification. D1 migrations remain forward-only
and no automatic down-migration is implied.

## Exit codes and current limitations

| Code | Meaning |
| ---: | --- |
| `0` | Successful check or valid plan |
| `2` | Invalid command-line usage |
| `10` | Local precondition, command-safety, or quality failure |
| `11` | Remote read, stale snapshot, or ambiguous remote state |
| `12` | Production-protection or identity-guard refusal |

Repository evidence does not establish the Cloudflare account ID, Worker route
zone IDs, Pages production branch, or Production domains. Those values remain
unresolved, so live online commands currently refuse before network contact.
The online paths are tested with faithful local fakes.

`preview:release` and `preview:rollback` do not exist. Deployment, migration
application, activation, smoke execution, receipts, resume, and rollback
orchestration remain later-phase work.
