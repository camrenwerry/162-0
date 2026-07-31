# Leaderboard identity and ranking foundation

Milestone 3A completes the local backend contract for the first public-beta
leaderboard. It adds account-free stable identity, recovery, rename,
qualification placement, top-three entries, and shared competition ranks. It
does not add the player-facing leaderboard UI, apply a remote migration,
deploy, configure secrets, or enable submissions, identity mutations, or
leaderboard reads.

## Trust boundary and data flow

The authoritative path is:

```text
completed Classic draft
  -> signed, short-lived draft ticket plus transcript
  -> private Worker ticket verification and deterministic replay
  -> canonical server scoring
  -> atomic D1 persistence
       - immutable retained receipt
       - durable verified leaderboard run
       - optional pending identity claim
       - reconciliation reads
  -> server-calculated Daily, Weekly, and All-Time placement
  -> optional short-lived identity claim capability
```

The client cannot supply a score, rank, eligibility result, player ID, or run
ID. Pages checks the same-origin request boundary, derives a rate key only from
trusted Cloudflare connection metadata, and proxies to a private Worker. The
private Worker performs rate limiting, strict bounded JSON parsing, ticket
verification, replay, scoring, identity authentication, and D1 writes.

This is an account-free beta identity, not an account system. Possession of the
device credential authenticates the identity for ordinary play. Possession of
the recovery code can replace that credential. There is no email, password,
browser fingerprint, IP identity, user-agent identity, customer-support
recovery, or proof of legal identity. A player who loses both secrets cannot
recover the identity under this contract.

## Schema version 4

Migration `0004_leaderboard_identity_ranking.sql` is a forward-only migration
whose exact predecessor is schema version 3. It extends
`leaderboard_players` with:

- a canonical public-name key with a partial unique index;
- HMAC-SHA-256 device-credential and recovery-code digests, each unique;
- recovery version, last rename time, credential rotation time, and identity
  update time; and
- an explicit `inactive`, `active`, `moderated`, or `invalidated` identity
  state. Version-3 placeholders migrate to `inactive`.

`leaderboard_identity_claims` binds one unique claim digest to one unique
accepted run. It records creation, expiry, consumption, claimed identity, and
canonical claimed name, but never the raw capability or either returned
secret. Foreign keys restrict deletion of referenced runs and players.

`leaderboard_identity_events` provides immutable, idempotent event keys for
claim, recovery, rename, recovery rotation, moderation, and invalidation
evidence. Events contain no raw credential, recovery code, claim capability,
ticket, recovery operation identifier, or request body.

`leaderboard_recovery_operations` is the bounded uncertain-outcome receipt for
recovery. It stores only domain-separated keyed digests, the internal player
reference, source and replacement recovery versions, replacement secret
digests, derivation version, and creation/expiry times. It has no raw recovery
code, raw operation identifier, device credential, replacement recovery code,
display name, request body, or response JSON. A unique
`(player_id, source_recovery_version)` constraint permits one recovery winner
from a given version. The migration also adds claim-expiry, recovery-operation
expiry, identity-event, credential lookup, recovery lookup, public-name, and
leaderboard qualification indexes.

Existing version-3 placeholder players and their run history remain valid local
records after the migration, but their new private identity columns are null,
their recovery version remains zero, and their identity state is `inactive`.
Public queries require a fully claimed active identity, so those placeholders
and anonymous legacy rows cannot become public accidentally. Existing accepted,
identity-pending, test/smoke, moderated, and invalidated runs and retained draft
receipts are not rewritten.

## Display-name policy

The server applies the following policy before any availability check or
mutation:

- normalize the display form with Unicode NFKC;
- require 3 through 20 Unicode code points after normalization;
- allow Unicode letters, Unicode numbers, ASCII spaces, underscores, and
  hyphens;
- reject leading or trailing whitespace and repeated ASCII spaces, both before
  and after normalization;
- reject control, format, surrogate, line-separator, and paragraph-separator
  characters; and
- reject every other character.

The unique key is derived by NFKC normalization followed by deterministic
Unicode upper/lower mapping and a final NFKC pass. This makes case variants,
full-width compatibility forms, sharp-s expansions, and final-sigma variants
collide without depending on SQLite's default collation. The canonical key has
a database unique constraint, so an availability response is advisory and
create/create, create/rename, and rename/rename races are still resolved
atomically by D1.

The policy is structural, not a comprehensive profanity or confusable-name
filter. Human moderation remains necessary. Controlled operations may set an
identity or run to `moderated` or `invalidated` while preserving the audit
record. This milestone deliberately adds no public or administrative mutation
endpoint for those operations.

## Qualification-based first identity

A valid non-test, non-smoke Classic run with no resolved identity is stored as
`identity_pending`. The placement service temporarily evaluates that accepted
candidate alongside fully claimed public entries. If it is within the
candidate's applicable top three, the accepted response reports
`identity.setupRequired=true` and may include a short-lived claim capability.

The capability:

- is an HMAC-authenticated, 256-bit value with an explicit version prefix;
- is domain-separated from every credential and stored digest;
- is bound by its digest to exactly one accepted run;
- expires 15 minutes after the server submission time;
- cannot select another run, identity, score, or eligibility state; and
- is returned only in a `Cache-Control: no-store` response.

`POST /api/v1/leaderboard-identity-claim` accepts only that capability and a
validated display name. One D1 batch creates the player, links exactly the
bound pending run, consumes the claim, writes the audit event, and reads the
result. Unique constraints and compare-and-set conditions resolve conflicts.
An exact retry during the claim window safely derives and returns the same
secret bundle; a changed name, expired capability, unrelated run, already
conflicting name, or invalid pending state cannot create credit.

When identity support is disabled, the run remains durable and private and the
accepted response reports the capability as disabled. Expired claim rows may
be deleted without deleting the run. A future UI should present name setup
immediately after a qualifying result because this milestone does not add a
claim-renewal protocol.

## Device credential and returning play

The successful claim returns a `ppd1_` device credential containing 256 bits
of HMAC-derived material. The raw value is intended for future client-side
storage only. D1 stores a domain-separated keyed digest.

A later submission may include exactly one optional `identityCredential`
field. The private Worker validates its shape, hashes it, resolves only an
active identity, and then runs the unchanged ticket verification, replay, and
scoring path. The credential cannot supply or alter a score, rank, ticket,
transcript, environment, or mode. Missing credentials preserve the
identity-pending behavior; malformed or unknown credentials fail closed.

## Recovery

The claim response also returns one recovery code. Its payload contains 130
bits encoded with a transcription-oriented Crockford alphabet plus a 10-bit
checksum. Input is case-insensitive, ignores spaces and hyphens, and accepts
the common `O`/`0` and `I`/`L`/`1` aliases. Only a domain-separated keyed
digest is stored.

`POST /api/v1/leaderboard-identity-recover` requires exactly:

```json
{
  "recoveryCode": "<current private recovery code>",
  "recoveryOperationId": "ppr1_<43 canonical unpadded base64url characters>"
}
```

The operation identifier represents 32 client-generated random bytes. The
client must use a cryptographically secure random generator, create it once per
logical recovery, retain the exact request until the outcome is certain, and
reuse it only to retry that same uncertain operation. It is a private,
single-purpose capability: claim capabilities (`ppc1_`), device credentials
(`ppd1_`), recovery codes (`PP1-`), and recovery operation identifiers
(`ppr1_`) are structurally and cryptographically separate.
The server decodes the 43-character payload to exactly 32 bytes and requires
those bytes to re-encode to the identical canonical unpadded base64url payload;
padding, noncanonical aliases, wrong-length values, and formatting mutations
are rejected.

The Worker derives one keyed operation digest and a separate keyed digest of
the operation identifier plus canonical recovery attempt. Replacement secrets
are deterministic HMAC outputs under distinct v2 domains over the canonical
recovery code, raw operation identifier, internal player ID, and source
recovery version. This binds reproduction to the same recovery attempt, player,
and version without storing any raw input or output. The signing key and raw
client-held inputs are required to reproduce the replacements.

One D1 batch conditionally inserts the operation receipt, rotates both player
digests with a version compare-and-set, asserts the post-rotation invariant,
writes one digest-keyed recovery audit event, and reads the result. D1 batch
transactionality makes an injected error roll back the receipt, rotation, and
event together. The old device credential and old recovery code become invalid
in the same commit.

The retry window is 15 minutes from the server time sampled by the winning
request and stored with its operation receipt. A retry with the same recovery
code and exact operation identifier returns the exact same replacement device
credential and recovery code, `idempotentRetry: true`, and the original
`recoveryRetryExpiresAt`. The response remains `Cache-Control: no-store`. A
same-operation concurrent request reconciles to that bundle. Different
concurrent operation identifiers contend on the player/source-version unique
constraint: exactly one rotates; a loser has no receipt for its identifier and
cannot retrieve the winner's bundle.

At the retry deadline, the receipt no longer authorizes reproduction. Cleanup
deletes only rows with `expires_at_ms <=` its one sampled cutoff, so it retains
every still-valid retry. Expired receipt deletion does not delete or change the
player, current secrets, runs, or audit events. A later valid recovery,
moderation, invalidation, or player disablement also prevents an older receipt
from replaying obsolete or revoked secrets.

Unknown codes, malformed or tampered operation identifiers, mismatched
code/operation pairs, expired receipts, cross-purpose values, concurrent
losers, and attempts against non-active identities receive the same generic
invalid-recovery response. Operation IDs are high entropy but are not accepted
as authentication by themselves, and neither an identifier guess nor receipt
existence creates an identity-enumeration response.

No public API other than the authorized success/retry response, status response,
leaderboard response, URL, log, analytics record, ordinary report, audit event,
receipt, or database row contains a raw recovery code, raw operation ID, or raw
device credential. The future UI must keep the operation ID only while recovery
is uncertain, retry before `recoveryRetryExpiresAt`, securely save both
replacement secrets, then discard the operation ID and old recovery code.

## Rename and history

`POST /api/v1/leaderboard-identity-rename` requires the device credential and a
fully validated new name. A successful database compare-and-set requires that
the last rename is absent or at least 30 days old, updates the current public
label and canonical key, records the timestamp and audit event, and returns
the exact next eligible timestamp.

An exact same-display-name request, including an input that differs only before
NFKC normalization, is a no-op and consumes no cooldown. A case-only change in
the normalized display is a real rename and consumes the cooldown. Name
conflicts and other failed attempts do not consume it. Concurrent attempts
cannot both satisfy the cooldown condition.

Leaderboard entries join the current player row at read time. A rename
therefore updates every historical Daily, Weekly, and All-Time presentation
without creating per-run name snapshots.

## Top-three and shared ranking

Best Run is the only public ranking family. For each independent environment,
mode, period, and family, the query:

1. filters to server-verified, non-smoke, eligible Classic runs whose player
   and identity are active and fully claimed;
2. orders each player's runs by projected wins descending, overall score
   descending, server submission time ascending, and internal run key
   ascending;
3. retains that player's first three rows;
4. assigns public `RANK()` using projected wins and overall score only; and
5. assigns a separate deterministic `ROW_NUMBER()` using the complete order
   for pagination.

Equal projected wins and overall score share a public competition rank. Thus
`110/95`, `108/96`, `108/96`, and `105/94` receive ranks `1, 2, 2, 4`.
Submission time and the internal key stabilize display and pagination but
never improve a tied row's public rank. A player's fourth and weaker runs stay
in history and may become visible if a stronger run is invalidated or falls
outside a Daily or Weekly window.

Classic is the only accepted public mode. Hard Mode remains schema-reserved and
unsupported. Cumulative Performance remains unavailable because no public
formula has been approved. Internal aggregate-ready inputs remain intact but
assign no cumulative score or rank.

## Periods, placement, and pagination

Server `submitted_at_ms` is the only time authority:

- Daily is `[00:00 UTC, next 00:00 UTC)`.
- Weekly is `[Monday 00:00 UTC, next Monday 00:00 UTC)`.
- All-Time has no lower bound and is capped by the captured query time.

The reusable placement service evaluates the accepted run independently for
Daily, Weekly, and All-Time and returns qualification, shared public rank,
whether it displaced a prior personal top-three entry, the prior third-run
cutoff when present, consistent proximity below that cutoff, and
`newPersonalBest`. It also states why identity setup is required and continues
to report cumulative performance as unavailable. Client placement fields are
not accepted.

Leaderboard cursor version 2 is a canonical HMAC-SHA-256-authenticated
snapshot containing scope, period bounds, `asOf`, and the last internal page
ordinal. Pagination resumes after that ordinal, so a page boundary inside a
shared rank neither duplicates nor skips ordinary tied rows in an unchanged
row set. Submissions with a server timestamp later than the captured snapshot
cannot enter. A concurrently in-flight row committed later with a timestamp
already inside the snapshot, or moderation, invalidation, player disablement,
or rename during pagination, can still change current rows; callers should
restart after such an operational mutation.

## API contract

All identity routes use `POST`, require exactly `application/json`, reject
content encoding, bound the body to 16,384 bytes, reject duplicate JSON keys
and unknown fields, use prepared SQL, and return fixed public errors:

- `/api/v1/leaderboard-name-availability`
- `/api/v1/leaderboard-identity-claim`
- `/api/v1/leaderboard-identity-recover`
- `/api/v1/leaderboard-identity-rename`
- `/api/v1/leaderboard-identity-status`

The status route returns current display name, rename eligibility, next rename
time, recovery version, and capability booleans. It does not echo the supplied
credential or return a recovery code, player ID, run ID, or digest.

Recovery success uses the same identity response schema as other identity
mutations. It returns current display name, replacement device credential,
replacement recovery code, replacement recovery version,
`recoveryCodeMustBeStored: true`, `idempotentRetry`, and
`recoveryRetryExpiresAt`. Claim success uses the same
`recoveryCodeMustBeStored` instruction. The field does not claim the value can
appear only once: an authorized same-operation retry reproduces it during the
bounded recovery window. Recovery never echoes the `recoveryOperationId`.
Clients must treat a timeout, connection loss, or other uncertain outcome as
retryable only with the unchanged request; generating a new operation ID after
a possible commit cannot recover the prior result.

`GET` and `HEAD /api/v1/leaderboards` accept only `mode`, `period`, `family`,
`limit`, and `cursor`. `mode=classic`, `period=all-time`,
`family=best-run`, and `limit=25` are defaults; the maximum limit is 50.
Unknown, repeated, malformed, unsupported, or cursor-conflicting parameters
are rejected.

Successful reads use schema `pennant-leaderboard-response-v2` and return only
public rank, current display name, verified projected wins, verified overall
score, tier, server submission time, mode, period metadata, and an opaque next
cursor. They explicitly describe competition-shared rank and the
best-three-runs policy. Cumulative requests return a fixed unsupported-board
response. Reads may use a short shared cache; all identity and error responses
use `no-store`.

## Flags, health, retention, and activation

The canonical seven-capability vocabulary is `leaderboardRead`,
`identityClaim`, `identityStatus`, `identityRename`, `draftSubmission`,
`identityRecovery`, and `cleanupCron`.

Every identity action requires all of:

- `LEADERBOARD_IDENTITY_MODE=enabled` at both Pages and the private Worker;
- its exact narrow flag at both layers:
  `LEADERBOARD_IDENTITY_CLAIM_MODE`, `LEADERBOARD_IDENTITY_STATUS_MODE`,
  `LEADERBOARD_IDENTITY_RENAME_MODE`, or `LEADERBOARD_RECOVERY_MODE`;
- a Worker-only `LEADERBOARD_IDENTITY_SIGNING_KEY` of 32 through 4,096
  characters;
- the private `VALIDATION_SERVICE` binding;
- a reachable `DB`; and
- exact schema version 4.

The broad identity switch is a disable-only ceiling. Enabling it never enables
claim, status, rename, or recovery. Name availability is enabled only by claim
or rename. The private health route uses `status` when no query is supplied and
the exact query values `claim`, `recover`, `rename`, and `status`; identity
recovery is checked with `?capability=recover`.

`leaderboardRead` separately requires `LEADERBOARD_READ_MODE=enabled`, an
allowlisted environment, a cursor signing key of 32 through 4,096 characters,
reachable D1, and exact schema version 4. `draftSubmission` remains controlled
by `DRAFT_SUBMISSION_MODE`. `cleanupCron` requires both
`RETENTION_CLEANUP_MODE=enabled` and the exact reviewed Cron trigger. Missing
or malformed values fail closed. Health
probes the private Worker through the existing service binding and reports
identity as configured but degraded when the Pages flag, service, private
Worker flag or secret, database, or exact schema requirement is incomplete.
The signing key is not copied into Pages.

The checked-in protected configuration supplies none of the new identity or
read flags and none of the signing secrets. It was not changed in Milestone
3A. Public reads, submissions, and identity mutations therefore remain
disabled.

Scheduled retention now performs three separately bounded phases using the same
server cutoff: at most ten 500-row draft-receipt batches, at most ten 500-row
expired-claim batches, and at most ten 500-row expired recovery-operation
batches. Draft receipt deletion does not touch players, runs, identity events,
or ranking history. Claim deletion does not touch its accepted run. Recovery
operation cleanup never deletes an unexpired retry receipt and does not touch
the player or audit event. Used claims cannot be used again while retained, and
their audit event survives claim expiry cleanup. Recovery and rename never
replace a player row, so history remains attached. Automatic identity deletion
is deferred; foreign-key restrictions prevent accidental orphaning.

## Local verification and controlled next step

Local verification is offline:

```bash
npm run db:migrations:list:local
npm run db:migrations:apply:local
npm run test:leaderboard
npm run test:draft-submission
npm run test:d1c3-retention-cleanup
npm run test:validation-worker
npm run functions:typecheck
npm run validation-worker:typecheck
```

The integration suite uses the actual signed-ticket verifier, deterministic
replay and scorer, and a SQLite-backed D1 adapter for:

```text
submission -> pending placement -> claim -> returning credential
  -> shared-rank read -> rename -> second-device recovery -> retention
```

It performs no live network request or remote mutation.

The player-facing local UI now stores the device credential, preserves invalid
local continuity, presents qualification before name setup, shows and
acknowledges one-time recovery material, integrates independently gated
rename/recovery/status, and renders the v2 top-three/shared-rank board
contract. This is local implementation evidence, not activation readiness.
Protected configuration, an additive migration proposal if operator reset is
authorized, secret and binding review, remote migration, deployment, smoke
testing, Preview activation, and Production work remain separate reviewed
operations.
