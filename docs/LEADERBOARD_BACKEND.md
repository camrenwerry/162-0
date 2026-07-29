# Leaderboard backend foundation

Milestone 2 adds a local-only, disabled-by-default foundation for a future
public leaderboard beta. It does not apply a remote migration, deploy code,
enable submissions, configure a signing secret, choose a public player
identity, or activate a public leaderboard.

## Architecture and data flow

The authoritative path remains:

```text
completed Classic draft
  -> signed short-lived draft ticket plus transcript
  -> private Worker ticket verification and deterministic replay
  -> canonical server scoring
  -> one atomic D1 batch
       - retained idempotency receipt
       - optional server-authoritative player identity
       - durable leaderboard run
       - reconciliation reads
  -> immutable submission receipt
```

The Pages submission proxy remains the public trust boundary for same-origin
requests and the private rate-limit key. The private Worker verifies the
ticket, transcript, complete roster, supported versions, replay, and score.
Client-supplied score fields and eligibility booleans are not used.

Migration `0003_leaderboard_foundation.sql` adds two tables. A
`leaderboard_players` row represents a future stable public identity using an
HMAC-SHA-256 identity digest and a bounded display label. A
`leaderboard_runs` row is an append-only audit record for one accepted ticket
and its server-verified result. Its unique `source_ticket_id` prevents duplicate
credit while allowing two independent tickets with identical rosters and
scores.

Standings are computed on read. Public-beta scale does not justify a queue,
cache table, or materialized ranking. The query indexes begin with board scope
and eligibility fields and include time, player, and deterministic score order.
A separate player-history index supports future profile and recent-run reads.

Existing `draft_submissions` rows are not backfilled. They contain a retained
receipt and digests, but no stable player identity or explicit game-mode
column, and they are deleted after 24 hours. Treating those rows as historical
leaderboard evidence would be ambiguous and would break all-time history.

## Identity and privacy

The current game has no account, device identity, or other trustworthy stable
player key. The default identity resolver therefore returns no identity.
Accepted non-test submissions are durably recorded as `identity_pending` and
cannot appear on a public board.

Before public activation, the product must choose a stable identity and
public-label policy. A future resolver must derive the identity digest on the
server with a secret HMAC key; it must not store or expose the raw account,
device, ticket, submission, IP, user-agent, or fingerprint value. A
client-provided display name is not an identity. Label normalization,
moderation, rename behavior, collision handling, and account migration must be
specified before labels are accepted publicly.

The public query joins only active players to eligible runs. Its response
contains no database keys, identity digests, ticket IDs, internal moderation
reasons, or anti-abuse evidence. Public labels are trimmed, length-bounded, and
rejected if they contain control or bidirectional-formatting characters.
Malformed stored data fails with a generic unavailable response rather than
being reflected.

## Eligibility and durable audit state

A run can be public only when all of these conditions are true:

- the existing signed ticket is authentic, unexpired, transcript-bound, and
  consumed exactly once;
- server replay produces a complete valid Classic roster;
- the canonical server scorer produces the persisted wins, overall score, and
  tier;
- a server-authoritative player identity resolves to an active player;
- the server classifies the run for the queried environment;
- the run is not test or smoke data; and
- its status is `eligible`, with no invalidation or moderation timestamp.

The application cannot promote itself by sending `eligible: true`. Test and
smoke runs are stored only as `excluded_test`; an accepted run without identity
is stored only as `identity_pending`. The database enforces these cross-field
relationships. `invalidated` and `moderated` states require a server timestamp
and stop contributing on the next read. No moderation or mutation endpoint is
part of this milestone.

The submission receipt and leaderboard run are inserted in one D1 batch. The
ticket is the idempotency key for both records. An exact retry returns the
original receipt and adds no run. A conflicting transcript for an already-used
ticket is rejected. Concurrent delivery relies on database uniqueness and
post-batch reconciliation rather than an application-only check. Different
tickets remain independent even when their verified result is identical.

## Ranking definitions

### Best Run

Each player contributes at most one eligible run to a board. Runs are ordered:

1. higher server-verified projected wins;
2. higher server-verified overall score;
3. earlier server submission time; then
4. lower internal run key as a final stable, non-public tie-break.

The board applies the same complete ordering across player winners. Every row
receives a unique ordinal rank; tied gameplay values do not share a rank. The
final internal key is never returned.

### Cumulative Performance

The repository contains no approved definition of cumulative performance.
Summed wins, summed overall score, run count, an average, and a capped formula
would reward different behavior. This milestone therefore does not invent a
ranking.

The data model preserves every eligible run, and an internal query primitive
can return per-player qualifying-run count, verified-win sum, verified-score
sum, and first/last server timestamps. It assigns no score or rank. Public
requests for `family=cumulative-performance` return a fixed unsupported-board
response, and the API capability flag remains false. A product decision must
define the formula, tie-breaks, volume/anti-grinding policy, and whether
historical data should be recomputed before this family can be exposed.

## Period rules

Server `submitted_at_ms` is the only time authority. Client time and ticket
issue time do not select a period.

- Daily is `[00:00:00.000 UTC, next 00:00:00.000 UTC)`.
- Weekly starts Monday at `00:00:00.000 UTC` and ends at the following Monday,
  using a half-open interval.
- All-time has no lower bound and includes eligible runs through the query's
  captured `asOf` time.

UTC has no daylight-saving shift. A legitimately accepted late retry retains
the first server submission time from its immutable receipt; it cannot move
between periods. New pages reuse the authenticated cursor's `asOf` and exact
window, so later submissions do not move the snapshot boundary.

Invalidation or player disabling can still remove a row between page requests.
That operational mutation is intentionally reflected immediately; callers
should restart pagination when a moderation change occurs.

## Read API

The endpoint is `GET /api/v1/leaderboards`; `HEAD` is also accepted. It is
available only when all of these independently supplied runtime values are
valid:

- `LEADERBOARD_READ_MODE=enabled`;
- `LEADERBOARD_ENVIRONMENT=preview` or `production`;
- `LEADERBOARD_CURSOR_SIGNING_KEY` is a secret of at least 32 characters;
- the `DB` binding is present; and
- schema version 3 is reachable.

None of the protected checked-in environments supplies those leaderboard
values. The absent flag returns the existing generic API 404 before database
access.

Allowlisted query parameters are:

- `mode=classic` (default; Hard Mode is schema-reserved but not public);
- `period=daily|weekly|all-time` (default `all-time`);
- `family=best-run|cumulative-performance` (default `best-run`);
- `limit=1..50` (default `25`); and
- `cursor=<authenticated opaque cursor>`.

Unknown, repeated, malformed, or scope-conflicting parameters are rejected.
Queries are fixed SQL with bound parameters. The cursor is a canonical,
HMAC-SHA-256-authenticated snapshot containing only API scope, period bounds,
`asOf`, and the last ordinal rank. Offset pagination is not used.

Successful responses use schema `pennant-leaderboard-response-v1` and include
`generatedAt`, board scope, explicit ranking and window metadata, public
eligibility definitions, capability flags, entries, and page metadata. An
entry contains only rank, player label, projected wins, overall score, tier,
server submission time, and mode. Empty boards return the same schema with an
empty entries array.

Successes allow a short shared cache:
`public, max-age=15, s-maxage=30, stale-while-revalidate=30`. Errors and blocked
boards use `no-store`. Database and configuration failures return fixed generic
errors with no SQL or exception details.

## Retention, history, and rollback

The 24-hour cleanup job deletes only expired `draft_submissions` receipts.
Durable `leaderboard_runs` and `leaderboard_players` are independent, so daily,
weekly, and all-time history survives receipt cleanup. Invalidating a run or
disabling a player removes current credit without deleting the audit row.

Migration 0003 is forward-only and requires exact predecessor schema version 2
before any DDL. Foreign keys use `ON UPDATE RESTRICT` and `ON DELETE RESTRICT`;
leaderboard history cannot be orphaned by an ordinary player deletion. There
is no automatic down migration. A code rollback can disable reads and
submissions, but it does not remove schema or durable rows. A released schema
defect requires a reviewed forward migration or separately authorized D1 Time
Travel recovery.

## Local verification and future activation

Local-only migration and focused verification:

```bash
npm run db:migrations:list:local
npm run db:migrations:apply:local
npm run test:leaderboard
npm run test:validation-worker
npm run functions:typecheck
npm run validation-worker:typecheck
```

The integration suite exercises a real signed-ticket fixture, authoritative
replay and scoring, atomic SQLite-backed D1 behavior, exact retry,
independent identical runs, ranking, and receipt cleanup. It performs no
network request.

Future activation is not a single switch. It requires a reviewed identity and
label decision, an approved cumulative decision if that board is desired,
schema 3 applied to the intended remote database, an environment-specific
cursor secret, explicit preview flags and classification, privacy/moderation
review, platform rate-limit and load review, preview smoke validation, and
separate deployment authorization. Production migration, deployment, binding,
secret, and feature activation remain separately authorized operations.
