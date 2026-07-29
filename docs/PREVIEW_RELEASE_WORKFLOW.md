# Preview release workflow: Phase 1 and Phase 1.5

Phase 1 establishes immutable Preview identity, offline release-readiness
checks, read-only remote inspection, and deterministic planning. It cannot
deploy, apply a migration, upload an artifact, change a flag, enable or disable
Cron, run a smoke request, roll back, or change a Cloudflare resource.

The canonical Pages and Worker configurations remain `disabled`. The reviewed,
non-secret identity source is `config/preview-release.json`. Preview/Production
collisions, incomplete inventories, and ambiguous observations fail closed.

## Phase 1.5 identity bootstrap

Phase 1 deliberately leaves exactly four identities unresolved:

- `cloudflare.account.id`
- `cloudflare.preview.worker.routeZoneIds`
- `cloudflare.production.pages.branch`
- `cloudflare.production.pages.domains`

Phase 1.5 can collect candidate evidence for only those fields:

```bash
PENNANT_PREVIEW_API_TOKEN=<dedicated-read-token> npm exec --offline -- node scripts/preview-identity-bootstrap.mjs
```

The fixed Node entry point is the public interface. There is no package-script
alias around which matching npm pre- or post-lifecycle hooks could run. It
accepts only `--json` and `--no-color`; positional values, duplicate or unknown
flags, runtime identities, arbitrary URLs, operations, query parameters, and
generic Cloudflare credentials are refused.

The generic credential rejection set includes
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`,
`CF_API_TOKEN`, `CF_API_KEY`, `CF_EMAIL`, and `WRANGLER_OAUTH_TOKEN`.
Credential-material scanning uses case-insensitive textual alias matching at
identifier boundaries. It rejects the dedicated alias and every generic alias
when optional horizontal whitespace is followed by either `=` or `:`, optional
horizontal whitespace, and a same-line value. Runtime environment-variable
names remain exact and case-sensitive. Credential material is removed from
child environments and redacted from diagnostic text with the same assignment
grammar.

The token must be a dedicated, least-privilege read token with the account,
Zone, Pages, Workers, and D1 metadata-read permissions needed by the fixed
operations. The bootstrap does not use Wrangler login state or browser
authentication. It does not spawn a child process, print or persist the token,
or pass it to another program.

Account discovery begins with a complete, bounded, paginated account inventory
and requires exactly one accessible account. Zero, multiple, duplicate,
malformed, incomplete, inconsistent, excessive, or changing results fail
closed. The command never probes several candidate accounts or selects one by
partial matching. The specific account endpoint must then confirm that one
identity. Both observations must contain a nonempty account name of at most 100
Unicode code points. Names are rejected if they have leading or trailing
whitespace, control, format, surrogate, line-separator, or paragraph-separator
characters. They are normalized to NFC in memory, and the inventory and detail
names must agree after normalization. The name is retained only as internal
cross-check evidence; it is not added to the candidate manifest or report.

Every paginated request fixes 25 records per page, at most 10 pages, and no
more than 250 total records. List Accounts uses its documented `count`, `page`,
`per_page`, and `total_count` response fields; it does not require the
undocumented `total_pages` field. The implementation derives a bounded page
count from validated `total_count` and `per_page`, and cross-checks
`total_pages` only if Cloudflare supplies it. Other paginated endpoints require
their documented total-page field. Each page count, aggregate count, and
final-page cardinality must agree.

For the grounded account, the command reads the complete account-zone
inventory, validates one owner and a unique ID for every zone, sorts the IDs,
and requires at least one zone under the current manifest contract. Its fixed
query includes exactly `type=full,partial,secondary,internal`; callers cannot
omit or replace a type, so internal zones are not silently excluded by
Cloudflare's default behavior.

The command inspects every grounded zone's complete Worker route inventory.
Every route record must be an exact plain data object containing a lowercase
32-hex route ID and a reviewed ASCII route pattern. Documented optional HTTP or
HTTPS schemes, leading host wildcards, and an omitted path with its implied
slash are accepted; query strings, infix wildcards, and malformed hosts or
paths are refused. `script` is the only optional field. An absent script is a
valid disabled, non-exposure state;
if present, it must be a nonempty reviewed Worker name. Explicit `null`, empty,
or malformed script values are not treated as absence. Scalar coercion,
accessors, inherited or non-enumerable fields, symbol keys, exotic prototypes,
duplicate IDs or patterns, and conflicting evidence are refused before route
non-exposure can be established. Each unpaginated per-zone response is capped
at 250 records, the aggregate route inventory is capped at 250 records, and
the 250-zone cap bounds route-request fan-out.

Worker custom-domain discovery uses the endpoint's fixed exact
`service=pennant-pursuit-validation-preview` filter. Callers cannot customize
that filter. Because the current official endpoint documents pagination
metadata but no page or per-page query controls, missing metadata, a result
requiring more than one page, or any inconsistent count is unverifiable and
fails closed. A successful empty result must prove one complete filtered page
and is capped at 250 records. Any returned record for another service means the
fixed filter was not honored and fails closed.

Every returned custom-domain record must contain the documented `id`,
UUID-form `cert_id`, strict `hostname`, exact Worker `service`, grounded
`zone_id`, and strict `zone_name`. The deprecated `environment` string is
optional and is never required for completeness or exposure decisions; when
present it must still be a safe nonempty identifier. Missing, malformed,
ungrounded, duplicate, conflicting, or undocumented fields make the filtered
inventory ambiguous. Any valid record is proof that the Preview Worker has a
custom domain and is refused. The exact Preview Worker settings must also be
reachable, and both `workers.dev` and Worker Preview URLs must be disabled.

Only the exact `diamond-draft` Pages project can provide the production branch
and complete production-domain inventory. The branch must be valid and differ
from `develop`; a leading ASCII hyphen is invalid, while a hyphen beginning a
later slash component follows Git's branch grammar and is permitted. Branch
evidence is neither trimmed nor Unicode-normalized. The same authoritative Git
branch validator is applied to live Pages observations, in-memory candidates,
and loaded checked-in manifests. Domains are normalized to
lowercase and sorted. Every hostname uses 1-through-63-character ASCII labels
and a maximum 253-character textual hostname; empty, overlength, duplicate,
malformed, wildcard, trailing-dot, changing, or Preview-colliding values are
refused. Discovered hostnames are never contacted. The exact Preview D1 UUID and
`pennant-pursuit-preview` name are confirmed through metadata only; the
bootstrap never runs a D1 SQL query.

Every operation is a fixed, allowlisted GET under the canonical
`https://api.cloudflare.com/client/v4/` boundary. There is no arbitrary URL or
query interface, redirect following, retry, write method, deployment, upload,
secret operation, route write, schedule write, database write, or
configuration write. The command does not contact Production-specific Worker,
D1, route, or discovered-hostname endpoints. Account-wide inventories may
contain entries for other resources, but the report retains only the normalized
identity and cross-check evidence required by this bootstrap.
Successful responses must use only the complete `application/json` media type,
optionally with one valid UTF-8 charset parameter; malformed, duplicate,
unsupported, comma-separated, or control-character-bearing media types are
refused.

The entire critical observation is repeated. Account inventory, specific
account identity, zone inventory and ownership, Pages identities, Worker
reachability and public exposure, custom domains, every grounded route
inventory, and Preview D1 identity must match across both reads. A mismatch is
ambiguous state, and the command does not retry into a new successful result.

After stable reads, an in-memory candidate resolves only the four fields above,
clears their unresolved reasons, and passes the existing strict release
manifest validator. The implementation proves every other manifest field is
unchanged. It never writes that candidate to
`config/preview-release.json` or any other repository file.

The regression suite also invokes the exact public
`node scripts/preview-identity-bootstrap.mjs` entry point in a complete
temporary repository with an isolated, test-only fake transport. It compares
the entire repository tree, including contents, paths, types, permissions, and
symlink targets, before and after the successful process.

Human and JSON reports identify the evidence as
`untrusted-pending-independent-review`. They include the four normalized
candidate identities, reviewed Preview anchors, immutable checked-in manifest
hash, deterministic timestamp-free evidence hash, stable-observation result,
and explicit no-mutation and no-configuration-change statements. Command
success is not authority. A later, separate manifest-grounding change must
receive independent review before these identities become trusted.

Ordinary `preview-check --online` and `preview-plan` continue to read only the
checked-in manifest and refuse before Cloudflare contact while it remains
unresolved. They cannot accept or discover bootstrap results at runtime. Phase
1.5 does not deploy, migrate, activate, smoke-test, create a receipt, resume,
roll back, or mutate Cloudflare or GitHub. The checked-in Pages and Worker
submission modes, Cron schedule, URL exposure, Production isolation, and
canonical `disabled` activation state remain unchanged.

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
- The exact immutable Preview Worker service filter returns no custom domain.
- The authoritative account-wide zone inventory exactly equals the reviewed
  expected zone identities, and every one contains no route for the Preview
  Worker.
- The custom-domain response contains required, internally consistent metadata
  proving the fixed filtered result is one complete page.
- Each zone route endpoint returns one complete array with no unsupported
  pagination query; a route with no `script` is a valid disabled route.

The paginated account-zone endpoint filtered to the reviewed account is the
source of completeness. Its immutable all-type filter requests `full`,
`partial`, `secondary`, and `internal` zones explicitly. Manifest route-zone
values are expected identities only and must exactly match that authoritative
result before route inspection. Because the repository does not currently
ground those expected identities, online checking and planning refuse before
Cloudflare contact. Callers cannot supply route zones, zone types, or the
Worker-domain service filter at runtime. The dedicated token must be scoped for
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
construction. A zero or already-expired deadline refuses before fetch, and
timer cleanup occurs once. Redirects, oversized bodies, invalid content
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
| `0` | Successful check, valid plan, or successful untrusted bootstrap evidence |
| `2` | Invalid command-line usage |
| `10` | Local precondition, command-safety, or quality failure |
| `11` | Remote read, stale snapshot, or ambiguous remote state |
| `12` | Production-protection or identity-guard refusal |

Repository evidence does not establish the Cloudflare account ID, Worker route
zone IDs, Pages production branch, or Production domains. Bootstrap output is
not repository evidence. Those values remain unresolved, so ordinary live
online checking and planning currently refuse before network contact. All
bootstrap network paths and ordinary online paths are tested with faithful
local fakes; the implementation suite does not run a live bootstrap.

`preview:release` and `preview:rollback` do not exist. Deployment, migration
application, activation, smoke execution, receipts, resume, and rollback
orchestration remain later-phase work.
