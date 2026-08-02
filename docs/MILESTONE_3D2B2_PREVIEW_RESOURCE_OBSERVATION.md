# Milestone 3D-2B.2 Preview resource observation and candidate projection

Milestone 3D-2B.2 supplies a closed, read-only foundation for observing
normalized Preview resource state once and projecting candidate capability
states from that observation. It does not decide whether a release is current,
compare local and remote final state, or authorize any action.

The implementation was divided into three reviewable parts:

1. 3D-2B.2a established the Preview-only transport and contract foundation.
2. 3D-2B.2b added resource normalization and single-read orchestration.
3. 3D-2B.2c adds the pure candidate capability projection described here.

Implementation and review of all three parts are fixture-driven and require no
authenticated observation. Authenticated online execution remains a separate
operator-authorized activity. Production observation is excluded.

## 3D-2B.2a transport and contract foundation

The first subdivision established the closed Preview operation registry,
bounded response and request contracts, strict credential separation,
Production-poisoning protection, identity grounding, canonical serialization,
deeply immutable data, and dormant HTTP transport authority. It also
established the normalized single-read snapshot boundary. It did not contact
Cloudflare or add a general-purpose provider client.

The credential contract accepts only the dedicated Preview observation token
environment when an independently authorized caller constructs online
transport. Token material is never retained in snapshots or candidate
projections. Generic Cloudflare credentials, Production identities, caller
URLs, caller SQL, redirects, automatic retries, and mutation methods remain
outside the contract.

## 3D-2B.2b normalization and single-read orchestration

The second subdivision added strict, field-specific normalization for the
reviewed Preview Pages project, Preview deployments, private Worker settings,
deployments, public-URL settings, schedules, custom domains, routes, the
Preview D1 identity, migration metadata, and backend schema version.

Provider records are reduced to closed normalized values before entering the
single-read snapshot. Missing, unavailable, partial, malformed, and
contradictory outcomes stay explicit. Incidental Production data cannot become
Production evidence. Secret values are excluded. The observer takes one read;
it does not coordinate stable reads or claim freshness.

## 3D-2B.2c candidate capability projection

The final subdivision adds
`scripts/lib/release-inspection/preview-capability-projection.mjs`. The module
accepts only an opaque input produced by successful validation of a normalized
single-read snapshot. It performs no network request, credential access,
filesystem access, clock read, deployment, execution, or mutation. The
projection is deterministic, closed, canonically serialized, deeply frozen,
and bounded to 16 KiB.

Validation and projection authority are created inseparably behind a
closure-owned identity registry. No registration function, constructor,
marker, symbol, token, or raw-snapshot projection factory is exported. The
projection confirms identity in that private registry before reading any
snapshot field; structural copies, serialization round trips, proxies,
accessors, inherited objects, and authorities from another module instance
therefore fail closed.

The exact capability inventory is:

- `leaderboardRead`;
- `identityClaim`;
- `identityStatus`;
- `identityRename`;
- `draftSubmission`;
- `identityRecovery`; and
- `cleanupCron`.

The exact surface inventory and applicability are:

| Capability | frontend | pages | worker | schedule |
| --- | --- | --- | --- | --- |
| `leaderboardRead` | applicable | applicable | not applicable | not applicable |
| `identityClaim` | applicable | applicable | applicable | not applicable |
| `identityStatus` | applicable | applicable | applicable | not applicable |
| `identityRename` | applicable | applicable | applicable | not applicable |
| `draftSubmission` | applicable | applicable | applicable | not applicable |
| `identityRecovery` | applicable | applicable | applicable | not applicable |
| `cleanupCron` | not applicable | not applicable | applicable | applicable |

Applicable surfaces project exactly `disabled`, `enabled`, or `unknown`.
Non-applicable surfaces use the existing exact representation:
`applicability: "not-applicable"` and
`candidateState: "not-applicable"`.

## Frontend and Pages evidence

Frontend and Pages states are calculated independently from the same closed,
normalized Preview Pages variable inventory. Only the protected gate names
approved by the schema-4 runtime registry are interpreted. A complete exact
`disabled` value projects disabled. A complete exact `enabled` value projects
enabled unless an identity compatibility ceiling disables it. Missing or
duplicated gate evidence projects unknown.

The projection does not inspect deployed asset contents. It does not use a
deployment's existence, stage, URL, commit hash, or Wrangler configuration
hash to infer a capability or release currentness. Pages evidence cannot set a
Worker state.

## Worker evidence

Each Worker-applicable capability is calculated independently from normalized
plain-text gate bindings in the Preview private Worker settings outcome. Only
the exact gate variable recorded in the shared runtime registry is used. D1,
service, rate-limit, deployment, route, subdomain, and custom-domain evidence
cannot enable a capability.

The broad `LEADERBOARD_IDENTITY_MODE` is a compatibility ceiling for claim,
status, rename, and recovery. A disabled narrow gate is disabled regardless of
the ceiling. An enabled narrow gate can project enabled only when the exact
ceiling is also enabled. A missing or unsupported required value remains
unknown. Worker evidence cannot set Frontend, Pages, or schedule state.

## Schedule evidence

Only `cleanupCron.schedule` uses the normalized schedule inventory. A complete
empty inventory projects disabled. A complete non-empty valid inventory
projects enabled. A missing, unavailable, partial, malformed, contradictory,
or absent schedule outcome projects unknown. This candidate state does not
authorize scheduled execution or Cron activation.

## Unknown state and authority separation

Missing evidence never defaults to disabled. Deployment existence never
defaults to enabled. A normalized resource error affects only the surfaces
that depend on that resource family. Unrelated resource evidence is ignored.

Every candidate projection permanently contains:

- `releaseCurrentness: "UNKNOWN"`;
- `executionAuthorization: "prohibited"`;
- `noRemoteMutation: true`; and
- `productionContacted: false`.

The contract has no `MATCH`, `DRIFT`, readiness, approval, no-op, permission,
freshness, expiration, release recommendation, mutation plan, or execution
surface. A candidate state is descriptive evidence only and cannot grant
authorization.

## Deferred work and exclusions

Stable double reads, stable-evidence comparison, and freshness are deferred to
Milestone 3D-2B.3. Authenticated online observation requires separate explicit
authorization and is not performed by implementation, tests, or review of
3D-2B.2. Production observation remains excluded.

Deployment, migration execution, capability activation, enabled release
planning, packaging, reporting, rollback artifacts, currentness determination,
and execution authorization are later or separately scoped work. Nothing in
3D-2B.2 makes those behaviors available.
