# D1C.4 preview activation preparation

D1C.4 is repository preparation only. It does not deploy Pages or a Worker,
apply a migration, contact an endpoint, change a secret, alter a binding or
route, or activate a Cron Trigger. Production is explicitly out of scope, and
remote smoke execution remains a separate operation requiring explicit
authorization.

## Why the activation structure changed

D1C.3 added the scheduled cleanup handler and placed `17 * * * *` directly in
the default private-Worker configuration. With Wrangler-managed triggers, a
Worker deployment applies the checked-in trigger configuration. Worker
deployment and preview Cron activation were therefore coupled even though the
earlier operations text described them as separate boundaries.

D1C.4 makes the checked-in defaults safe and defines activation once in
`workers/draft-validation/d1c4-activation-states.json`. The default
`workers/draft-validation/wrangler.toml` now declares `crons = []` explicitly;
omitting or commenting out the key is not the disable mechanism. The local-only
`scripts/prepare-d1c4-activation.mjs` validates the defaults and materializes a
paired Pages/private-Worker configuration for one reviewed state. It never
invokes Wrangler.

The Pages and Worker submission flags necessarily live in different
configuration files. The state manifest stores one `submissionMode`, and the
generator applies it to both files together. The validator refuses unknown
states, unsafe checked-in defaults, production drift, flag drift, an
unapproved schedule, or more than the expected minimal transition.

## Exact preview states

| State | Pages preview submission | Private Worker preview submission | Preview Worker Cron | Pages health |
| --- | --- | --- | --- | --- |
| `disabled` | `disabled` | `disabled` | `[]` | submission schema `null`; writes `disabled` |
| `submission-enabled` | `enabled` | `enabled` | `[]` | intent `configured`; schema is published only when reachable D1 schema 2 is exact; operational writes remain `externally-unverified` |
| `cron-enabled` | `enabled` | `enabled` | `17 * * * *` | identical to `submission-enabled` |

Every state preserves the production sections byte-for-byte. Production
submission stays disabled, production Cron stays `[]`, and the production
private Worker remains without a D1 binding or signing secret.

Pages health separates three facts. `submission.configured` records only Pages
configuration intent. `submission.schemaReady` is true only when the Pages
handler reaches the bound D1 database and reads exact supported schema version
2. `submission.operationalWriteReadiness` is never a claim about the private
Worker: it is `disabled`, `unavailable`, or `externally-unverified`.

When submission is configured but D1 is missing, unreachable, malformed,
older, or newer than the exact supported schema, health is `degraded`, the
submission schema remains `null`, `features.submissions` is `configured`, and
`features.writes` is `unavailable`. Exact reachable schema 2 publishes
`pennant-draft-submission-v1`, reports submissions as `schema-ready`, and keeps
writes `externally-unverified`. The Pages handler cannot independently prove
the private Worker flag or D1 binding, signing-secret presence, Service Binding
health, or a private write execution. Endpoint success and direct D1
persistence checks remain separate smoke evidence.

## Validate, review, and prepare

Run the deterministic validator first:

```bash
npm run d1c4:activation:check
```

Review each transition without writing a file:

```bash
npm run d1c4:activation -- --state disabled --review
npm run d1c4:activation -- --state submission-enabled --review
npm run d1c4:activation -- --state cron-enabled --review
```

Expected review output:

- `disabled`: no differences from either checked-in config.
- `submission-enabled`: one preview submission line in `wrangler.toml` and one
  in `workers/draft-validation/wrangler.toml`.
- `cron-enabled`: the same two submission lines plus the preview Worker Cron
  line.
- Comparing `submission-enabled` with `cron-enabled`: no Pages difference and
  exactly `crons = []` to `crons = ["17 * * * *"]` in the Worker.

Prepare ignored local configuration inputs only after review:

```bash
npm run d1c4:activation -- --state <disabled|submission-enabled|cron-enabled> --write
```

That creates these local files, with the chosen state in each filename:

```text
wrangler.d1c4-<state>.generated.toml
workers/draft-validation/wrangler.d1c4-<state>.generated.toml
```

They remain next to their canonical configs so relative source and migration
paths do not change. They are ignored by Git. A future separately authorized
deployment must use the matching pair as its reviewed Pages and private-Worker
configuration inputs. Never mix files from different states. Repository
preparation ends before any deployment command.

Stop if validation fails, either of the generated production sections differs,
the submission flags differ, Cron is present in either of the first two states,
the Cron transition contains any other difference, Pages health cannot prove
exact schema readiness for an enabled smoke, the target cannot be proven
preview-only, or the worktree contains unexplained changes.

## Guarded submission smoke

The submission harness permits only an unambiguous branch deployment on the
configured Pages project and the exact checked-in preview D1 database. It
rejects localhost, IP addresses, custom or production Pages domains,
production-like branch labels, the production Worker, the production D1 ID,
any environment other than `preview`, missing inputs, and an incorrect
acknowledgement. Each request has a finite timeout and incrementally enforced
body limit. Redirect handling is manual and every HTTP 3xx is rejected without
reading or trusting `Location`, so tickets, transcripts, authorization, and
request bodies are never forwarded by the harness. The API token is read only
from the environment and is never printed.

Use placeholders in saved commands. First omit `--execute` to inspect the
dry-run plan; no token is required or read:

```bash
npm run smoke:d1c4:submission -- \
  --preview-base-url "https://<branch>.<pages-project>.pages.dev" \
  --preview-worker "<preview-worker-name>" \
  --preview-environment preview \
  --account-id "<cloudflare-account-id>" \
  --database-id "<preview-d1-database-id>" \
  --ack D1C4_PREVIEW_ONLY
```

After target review, load the preview-scoped token without placing its value in
the command line or shell history, export it only in the environment, and
repeat the dry-run command with `--execute`:

```bash
read -r -s CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
npm run smoke:d1c4:submission -- \
  --preview-base-url "https://<branch>.<pages-project>.pages.dev" \
  --preview-worker "<preview-worker-name>" \
  --preview-environment preview \
  --account-id "<cloudflare-account-id>" \
  --database-id "<preview-d1-database-id>" \
  --ack D1C4_PREVIEW_ONLY \
  --execute
```

The harness:

1. Requires Pages health to report configured intent and exact D1 schema
   readiness while private write execution remains externally unverified.
2. Issues a signed ticket and builds a canonical transcript from its seed.
3. Checks initial absence only as an availability preflight. Absence reserves
   nothing and does not establish ownership. Before submission, the harness
   computes the exact ticket-token digest, transcript digest, ticket ID, and
   submission schema identity expected for this run.
4. Requires HTTP 201 and validates the complete production receipt contract:
   exact top-level, version, result, category, timestamp, score, grade, tier,
   and ranking fields with no unexpected fields. It preserves the exact raw
   receipt bytes, derives the canonical UTF-8 receipt text and authoritative
   retention deadline, and constructs all seven immutable fingerprint values
   before reading D1. Ownership is established only when the later D1 row
   exactly matches those independently known values.
5. Requires an identical retry to return HTTP 200 with exactly the same raw
   response bytes. Bodies are bounded while streaming and decoded with fatal
   UTF-8; a BOM or invalid encoding is rejected.
6. Verifies the D1 `TEXT` receipt under an explicit storage contract: the
   stored string, encoded as canonical UTF-8 without a BOM, must equal the raw
   bytes of the initial valid UTF-8 HTTP receipt. This does not claim that D1
   preserves arbitrary HTTP encodings.
7. Requires a substituted transcript on the consumed ticket to fail and proves
   that the complete owned fingerprint and receipt did not change.
8. Issues a second ticket, requires a deterministic replay failure, proves D1
   still has zero rows and no receipt for it, then submits the valid transcript
   and proves one row exists.
9. Never establishes ownership from a lost, timed-out, redirected, malformed,
   invalidly encoded, missing, non-successful, or otherwise ambiguous endpoint
   response. An exact D1 read after such an outcome is diagnostic only. Even a
   same-ID, same-digest, same-schema row with a plausible complete receipt is
   not added to owned cleanup, remains untouched, and causes a nonzero result,
   because its receipt and timestamps were not independently established by a
   validated HTTP success response.
10. Immediately before cleanup, re-reads every proven-owned fingerprint and
    deletes only current complete matches with parameterized conditional
    `DELETE` statements. Each predicate contains all seven immutable fields.
    D1 allows at most 100 bound parameters, so the shared chunk limit is derived
    as `floor(100 / 7) = 14` fingerprints per request. Each chunk gets one
    destructive delete attempt. A confirmed expected change count is classified
    deleted without a reconciliation read. A zero-change, unexpected-change,
    or thrown/ambiguous mutation outcome receives exactly one exact read-only
    reconciliation that distinguishes absent, still-owned, and
    mismatching/non-owned rows. If that read fails, the affected ownership
    records become unresolved immediately: there is no second reconciliation
    read, destructive retry, ID-only fallback, or broadened deletion scope, and
    the harness fails nonzero.

Success ends with `Submission smoke passed`. Any HTTP/D1 mismatch, unexpected
row count, receipt byte mismatch, malformed response, redirect, timeout,
oversized body, degraded schema readiness, failed cleanup, or ambiguous target
is a stop condition and causes the harness to exit nonzero.

## Guarded retention smoke

The retention harness uses the same target guard and D1 API token rules. It
does not expose or call a cleanup HTTP route and does not run a Wrangler or
Cloudflare configuration command. It relies only on the already activated
scheduled handler.

Dry-run example; no token is required or read:

```bash
npm run smoke:d1c4:retention -- \
  --preview-base-url "https://<branch>.<pages-project>.pages.dev" \
  --preview-worker "<preview-worker-name>" \
  --preview-environment preview \
  --account-id "<cloudflare-account-id>" \
  --database-id "<preview-d1-database-id>" \
  --ack D1C4_PREVIEW_ONLY
```

After review, load the preview-scoped token without pasting it into shell
history, then execute explicitly:

```bash
read -r -s CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
npm run smoke:d1c4:retention -- \
  --preview-base-url "https://<branch>.<pages-project>.pages.dev" \
  --preview-worker "<preview-worker-name>" \
  --preview-environment preview \
  --account-id "<cloudflare-account-id>" \
  --database-id "<preview-d1-database-id>" \
  --ack D1C4_PREVIEW_ONLY \
  --execute
```

Polling defaults to 15 seconds and accepts 5 through 300 seconds. The overall
polling timeout defaults to 8,000 seconds and accepts 3,600 through 10,800
seconds. Per-request timeout defaults to 10 seconds and accepts 1 through 30
seconds. Zero, negative, non-integer, non-finite, and excessive values fail
before execution. A request is further capped by the remaining overall
deadline. A fixed 300-second fingerprint-constrained cleanup reserve keeps
total runtime bounded even when the polling deadline expires.

The harness generates a cryptographically random 96-bit run scope containing
5,001 expired sentinels, two recent sentinels, and one protected sentinel.
Before insertion it checks that every exact ID and the whole generated scope
are absent. That check reserves nothing and establishes no ownership. It also
checks the cleanup ordering `(retain_until_ms, ticket_id)` for unrelated rows
that would sort ahead of or within the sentinel range. Such competition makes
the proof inconclusive and fails closed before insertion.

Each intended sentinel has a deterministic complete immutable fingerprint:
ticket ID, ticket-token digest, transcript digest, schema, submission timestamp,
retention timestamp, and receipt text. Insertion marks only an attempt. After
every confirmed or ambiguous insertion result, an exact read classifies every
reserved row as confirmed owned, absent, mismatching/non-owned, or unresolved.
Partial insertion cannot broaden cleanup to uninserted reserved IDs. When
shared-D1 preconditions remain deterministic, it requires the first observed
scheduled invocation to remove exactly 5,000 expired sentinels while the last
expired sentinel and all protected sentinels remain, then requires a later
invocation to remove the last expired sentinel. This proves the bounded
behavior for that observed run; it does not claim that every shared preview
database will always offer deterministic ordering or polling visibility.

The `finally` path receives only proven-owned fingerprints. Before every
destructive chunk it re-reads current rows, treats absent rows as already gone,
and refuses mismatches. Its single logical `DELETE` is parameterized on every
immutable field, never an ID or prefix alone, and requires exactly the intended
`meta.changes` count. Each request contains at most 14 seven-field fingerprints,
derived from D1's 100-bound-parameter maximum. Zero-change and ambiguous
deletion outcomes receive one read-only exact reconciliation and are not
retried automatically. A successful read records absent, still-owned, or
mismatching/non-owned precisely; `unresolved` is reserved for a failed or
inconclusive reconciliation read. Mismatching rows remain untouched. The
failure record preserves reserved, attempted, owned, absent, mismatching,
deleted, and unresolved states together with independently known fingerprints.

Success ends with `Retention smoke passed`. The nonzero errors distinguish
shared-database contention, inconclusive ordering or observation, a missed
scheduled-run boundary, timeout, ownership ambiguity, and conditional cleanup
failure. A shared preview D1 can receive concurrent inserts, deletes, or
multiple scheduled runs between polls. Unexpected count transitions are
therefore conservative: without independent repository evidence of a cleanup
contract violation, the harness reports shared contention or an inconclusive
observation rather than claiming an implementation failure.

## Rollback

Rollback changes configuration state; it does not reverse D1 schema 2 or delete
unrelated records.

From `cron-enabled` to `submission-enabled`:

1. Run the validator and review `submission-enabled`.
2. Prepare the matching state pair.
3. Under separate authorization, apply the reviewed private-Worker config.
4. Verify preview Cron is absent and Pages health still reports configured,
   schema-ready submission intent with writes externally unverified. No Pages
   configuration difference is expected.

From `submission-enabled` to `disabled`:

1. Run the validator and review `disabled`.
2. Prepare the matching state pair.
3. Under separate authorization, apply the reviewed Pages and private-Worker
   configs, removing the public submission gate first when sequencing them.
4. Verify health publishes submission schema `null`, submissions `disabled`,
   writes `disabled`, and preview Cron remains absent.

If rollback verification cannot prove those exact results, stop. Do not change
production, routes, bindings, migrations, or secrets as part of either rollback.
