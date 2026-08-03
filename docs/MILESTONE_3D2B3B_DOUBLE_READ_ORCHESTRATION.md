# Milestone 3D-2B.3b double-read orchestration

Milestone 3D-2B.3b adds a local orchestration authority over the completed
Preview single-read observer. It authorizes exactly two sequential attempts,
uses one previously grounded opaque Preview identity for both, and places one
required 2,000 millisecond delay between read-one settlement and read-two
start. It adds no online command and does not load credentials or contact
Cloudflare.

## Identity and sequencing authority

The opaque identity is resolved once before any clock, wall timestamp, delay,
or read dependency is used. The authority derives one non-secret SHA-256
continuity digest from the privately held reviewed identity and passes the
same frozen opaque object to both attempts. Each attempt must return that exact
object by reference; clones, substitutions, missing evidence, and foreign
authorities fail closed. Receipts contain only the digest, never raw identity
fields, credentials, or secret values.

Read one is fully awaited before the delay is requested. The delay is fully
awaited before read two begins. The orchestration owns invocation counters and
an active-attempt guard, permits at most two observer invocations and one delay
request, and does not expose a retry, callback, cleanup, fallback, or third-read
path. Synchronous dependency throws and rejected promises become bounded
deterministic authority errors; they do not trigger recovery behavior.

## Monotonic timing and the locked delay

All sequencing evidence comes from an injected monotonic clock. Samples are
validated at both attempt starts, both attempt settlements, and delay
settlement. Non-numeric, non-finite, negative, unsafe, decreasing, or thrown
samples fail closed without clamping or repair. Read two cannot start unless
the monotonic interval after read-one settlement is at least 2,000
milliseconds. Scheduler overshoot is accepted and recorded. Wall-clock values
are injected separately and used only as descriptive capture timestamps;
wall-clock rollback has no sequencing authority.

## Independent accounting and bounded outcomes

Each single-read execution returns its own closed request count. Read one and
read two retain independent 64-request ceilings, and their exact sum has a
separate 128-request ceiling. Missing, fractional, negative, contradictory, or
excessive counts fail closed. Unused capacity in one read cannot expand the
other read.

A closed bounded read-one failure may proceed to read two after the required
delay because it still supplies continuous identity evidence and trustworthy
request accounting. A thrown, rejected, malformed, provenance-breaking,
timing-breaking, or accounting-breaking read-one result prevents read two. A
bounded read-two failure is retained without a retry.

Attempt receipts contain only the attempt index, shared identity digest,
monotonic start and settlement samples, descriptive capture timestamp, request
count, outcome classification, result availability, and an allowlisted bounded
failure classification. The orchestration receipt proves the exact two-read
authorization, one delay request, observed delay, non-overlap, per-read and
aggregate counts, identity continuity, and final bounded outcome. Canonical
receipts are deeply frozen and capped at 16 KiB. UTF-8 byte measurement uses a
privately captured trusted authority, while the intrinsic-integrity inventory
pins the runtime encoder binding and prototype. Dependency mutation cannot
substitute receipt byte authority. Canonicalization, byte measurement, and
receipt-bound failures normalize to fixed orchestration error codes without a
raw message, stack, cause, receipt, snapshot, identity, provider response, or
secret-bearing detail. Single-read snapshots remain separate outputs and are
not duplicated inside receipts.

## Validation and deferred work

The deterministic local suite covers the real fixture-backed single-read
observer twice, exact identity reuse, event ordering, non-overlap, exact delay,
scheduler overshoot, early settlement, rollback and invalid samples at every
boundary, wall-clock rollback, bounded failures, synchronous throws, rejected
promises, separate and aggregate request limits, identity substitution,
malformed results, receipt determinism, the exact and over-limit 16 KiB byte
boundary, multibyte UTF-8 accounting, deep freezing, encoder-authority mutation
at every injected boundary, bounded error shape, and secret exclusion. It also
confirms that the online Preview CLI still refuses before injected dependencies
can be touched.

Freshness, expiration, stable comparison invocation, construction of the final
stable evidence artifact, local-versus-remote comparison, release currentness,
and execution authorization remain deferred to 3D-2B.3c. This milestone
performs no authenticated observation, Production observation, deployment,
migration, capability activation, binding or secret change, schedule change,
remote mutation, commit, or push. `releaseCurrentness` remains `UNKNOWN` and
`executionAuthorization` remains `prohibited`.
