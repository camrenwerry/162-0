# Milestone 3D-1 protected capability-model foundation

Milestone 3D-1 establishes a checked-in, protected, all-disabled capability
model for schema 4. It is a local configuration and validation foundation. It
does not make Preview or Production deployment-ready or activation-ready, and
it authorizes no remote operation.

The historical D1C.4 submission-state record remains in
`docs/D1C4_ACTIVATION.md`. This document records the later 3D-1 contract; it
does not rewrite what D1C.4 established.

## Canonical capabilities and environments

The one canonical vocabulary is:

- `leaderboardRead`;
- `identityClaim`;
- `identityStatus`;
- `identityRename`;
- `draftSubmission`;
- `identityRecovery`;
- `cleanupCron`.

Preview and Production have separate authority documents. The checked-in
authority for each environment has its emergency stop engaged, its identity
compatibility ceiling disabled, null review and expiry timestamps, and all
seven capabilities disabled. Authority reviewed for one environment is invalid
for the other.

The legacy identity mode is a compatibility ceiling only. It cannot enable a
narrow identity capability. When the ceiling is disabled, claim, status,
rename, and recovery are effectively disabled even if an untrusted narrow
field says `enabled`.

## Authority snapshot and parser boundary

Authority evaluation first creates one immutable snapshot using own-property
descriptors. It evaluates only that snapshot. Accessors are never invoked.
Null or custom prototypes, inherited state, symbols, proxies, sparse or exotic
arrays, non-enumerable or non-data properties, unsupported nested values, and
snapshot failures are malformed and resolve to all disabled.

Repository-owned JSON uses fatal UTF-8 decoding and bounded reads before
parsing. It rejects a UTF-8 BOM, NUL, U+FFFD, invalid UTF-8, malformed or
trailing JSON, duplicate keys at any depth, `__proto__`, `prototype`,
`constructor`, unpaired UTF-16 surrogates, excessive depth, and excessive
structural nodes. NUL and U+FFFD are checked again after JSON escape decoding
in every key and value. Limits are centralized in
`scripts/lib/preview-release/canonical.mjs`:

| Category | Maximum bytes | Maximum depth | Maximum nodes |
| --- | ---: | ---: | ---: |
| Authority model | 65,536 | 16 | 512 |
| Readiness model | 65,536 | 16 | 1,024 |
| Release manifest | 131,072 | 24 | 4,096 |
| Release package | 2,097,152 | 48 | 50,000 |
| Package metadata | 524,288 | 16 | 20,000 |

Parser diagnostics identify JavaScript character positions, not byte offsets.
No Unicode normalization is performed, and ordinary valid Unicode and valid
surrogate pairs remain accepted.

## Runtime wiring and frontend build-time limitation

`shared/schema4-capabilities.mjs` is the executable registry used by the
runtime gates and the readiness validator. Each actual runtime module exports
frozen registration records sourced from a strict JSON file immediately beside
that module. Each record identifies its capability, surface, exact descriptor
path, consumer identity, active or deliberately absent status, and applicable
compatibility ceiling. The helper or handler consumes that adjacent record;
the default inventory is not derived by filtering the descriptor registry.

Readiness strictly reads the five consumer-owned registration files, requires
the exact seven-capability matrix for all three surfaces, and compares it with
an independently authored list of expected active consumer identities. It
rejects missing, duplicate, extra, cross-surface, swapped, wrong, and
nonexistent consumers, as well as descriptors without the required consumer.
Behavior tests call exported Pages and private-Worker helpers and dispatchers
with deliberately different descriptor variables. They prove Pages and Worker
selection, claim/rename separation, Worker-only cleanup, and Pages-only reads.
Those tests do not treat imports, comments, strings, or dead source branches as
consumer evidence. This is runtime-composition and behavioral evidence, not a
general static proof of arbitrary source code.

The frontend is different from Pages Functions. Vite reads `VITE_*` values at
static build time. Wrangler Pages `[vars]` are Pages Functions runtime bindings;
they do not configure the static bundle. Milestone 3D-1 therefore provides no
protected frontend build-time source. Every protected frontend capability is
deliberately unconfigured and evaluates to disabled, even if an ambient value
with a future `VITE_*` name is present.

`wrangler.toml` contains only the applicable Pages Functions runtime variables.
It contains no protected `VITE_*` capability variables. A future frontend
activation requires separately reviewed 3D-2 build-time integration and
protected evidence. Provider build settings are not established here.

This section records the 3D-1 checkpoint. Milestone 3D-2A subsequently added
`src/config/protectedCapabilities.mjs` as a protected local source containing
the exact seven disabled frontend states. It does not establish provider build
settings or activation authority. See
[Milestone 3D-2A canonical contracts and local projection](MILESTONE_3D2A_RELEASE_INSPECTION_CONTRACTS.md).

## Protected checked-in state

The applicable Pages Functions and private-Worker capability variables are
explicitly `disabled` in Preview and Production. Both private-Worker Cron lists
are explicitly empty. The Production private Worker has no D1 binding. Preview
and Production resource identities, rate-limit namespaces, D1 identities, and
Service Bindings remain distinct and unchanged.

The protected inventory covers the release manifest, readiness model, runtime
gate registry and evaluator, the five consumer-owned registration files, Pages
configuration, private-Worker configuration, and authority model. Protected
integrity checks also pin migrations `0001` through `0004` and
`public/_redirects` and `public/_routes.json`.

## Disabled-only release boundary

The current tool contract is `preview-release-disabled-only-v2`. Current plans
use plan schema `4`, release packages use schema `2`, and execution contracts
use `preview-release-execution-disabled-only-v2`.

Plan construction, package creation, package validation, package loading,
artifact writing, CLI ingestion, and execution ingestion all require:

- the exact current schema and tool contract;
- the embedded manifest contract `releaseTooling: disabled-only`;
- `canonicalCheckedInState: all-disabled`;
- `targetState: disabled` and an observed disabled state;
- exact disabled capability binding inventories;
- empty Cron;
- no pending migration;
- the exact generated disabled execution contract.

Older schemas, replayed artifacts, enabled or unknown targets, hidden enabled
configuration, missing manifest metadata, modified packages, migration stages,
submission or retention smoke stages, and Cron stages are rejected at the
first material boundary. The only current deploy-stage descriptors are the
existing all-disabled Preview Worker and Pages Functions compatibility stages.
Milestone 3D-1 does not authorize running them.

Historical enabled-state construction and sequencing are not reachable from
current release schemas or public execution entry points. No current disabled
plan contains migration application, submission smoke, retention smoke, or
Cron deployment actions.
The shipped D1C.4 smoke modules are refusal-only compatibility CLIs and export
no smoke executor. They refuse `--execute` and alternative execution flags
before reading credentials, constructing adapters, or contacting an endpoint.
Historical deterministic orchestration lives only under `scripts/test-only/`;
it has no default network or D1 implementation and rejects omitted in-memory
adapters.

## Prohibited and deferred work

Milestone 3D-1 prohibits deployment, release execution, remote mutation,
migration creation or application, secret provisioning, Service Binding
changes, routes, custom domains, Cron enablement, Production Worker D1, and any
capability activation.

Milestone 3D-2A subsequently added local-only canonical contracts, protected
frontend integration, and an `UNKNOWN`, non-executable local projection.
Milestone 3D-2B owns separately reviewed remote read-only Preview inspection,
and 3D-2C owns non-executable package, planning, diff, and reporting
integration. Milestone 3D-3 or later owns any
authorized deployment, migration application, secret provisioning, smoke
execution, rollback execution, or capability activation. Production requires
its own independent authorization.
