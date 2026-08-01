# Milestone 3D-2A canonical contracts and local projection

Milestone 3D-2A adds a strict, environment-neutral release-inspection model
for the protected schema-4 capability foundation. It is local-only and
read-only. It does not authorize Cloudflare inspection, deployment, migration,
secret provisioning, binding changes, capability activation, release
execution, rollback execution, or any other remote operation.

The local report is produced on standard output only by the program entry
point:

```bash
node scripts/release-inspection-local.mjs
```

The command accepts only `--help`; it has no output-path, network, target,
execution, confirmation, or credential option. The default command writes no
file. Its canonical JSON is evidence about checked-in local intent, not proof
of remote currentness and not approval.

`npm run release-inspection:local` is a convenience wrapper. The no-write
guarantee belongs to the Node program and its local module graph. npm itself
may make package-manager housekeeping calls for its cache or logs, so invoking
the wrapper is not described as literally zero package-manager filesystem
calls. Neither path writes a repository evidence artifact.

## Versioned contract family

All 3D-2A artifacts use schema version `1` and tool contract
`release-inspection-local-only-v1`. Exact artifact kinds distinguish the
manifest, capability matrix, binding policy, observation placeholder, and
local projection. Each validator requires an exact shape and exact vocabulary.
Unknown, missing, duplicated, cross-environment, malformed, obsolete, or
oversized input fails closed.

Strict repository JSON handling retains the established bounded, fatal UTF-8
boundary. It rejects a BOM, invalid UTF-8, duplicate keys, dangerous object
keys, unpaired surrogates, trailing input, excessive depth, and excessive
structural nodes. Validated output is a detached immutable snapshot and uses a
deterministic canonical serialization and hash.

Legacy Preview plan, package, execution-contract, report, and executor entry
points explicitly reject every 3D-2A artifact kind and tool contract, including
nested or wrapped occurrences. A release-inspection artifact cannot be
reinterpreted as a legacy disabled-only execution artifact.

## Exact capability and environment model

The only environments are `preview` and `production`. The only capabilities
are:

- `leaderboardRead`;
- `identityClaim`;
- `identityStatus`;
- `identityRename`;
- `draftSubmission`;
- `identityRecovery`;
- `cleanupCron`.

The checked-in target for both environments is exactly all disabled. The
contract understands structurally valid enabled states so it can reject them
at the all-disabled 3D-2A policy boundary. No environment variable, query
parameter, local storage value, runtime global, or other ambient input can
enable a protected frontend capability.

Capability applicability is independently declared rather than inferred by
filtering the runtime descriptor registry:

| Capability | Frontend | Pages Functions | Private Worker | Schedule |
| --- | --- | --- | --- | --- |
| `leaderboardRead` | applicable | applicable | not applicable | not applicable |
| `identityClaim` | applicable | applicable | applicable | not applicable |
| `identityStatus` | applicable | applicable | applicable | not applicable |
| `identityRename` | applicable | applicable | applicable | not applicable |
| `draftSubmission` | applicable | applicable | applicable | not applicable |
| `identityRecovery` | applicable | applicable | applicable | not applicable |
| `cleanupCron` | not applicable | not applicable | applicable | applicable |

Every applicable surface reports both configured and effective state.
Non-applicable surfaces are explicit; they are not represented as disabled or
silently omitted.

## Authority chain

The local projection keeps these claims separate:

1. the requested target is the exact all-disabled capability object;
2. protected authority is loaded independently for Preview and Production;
3. the broad identity mode is only a disable-only ceiling over claim, status,
   rename, and recovery;
4. an engaged emergency stop forces all seven effective states disabled;
5. protected frontend, Pages Functions, private-Worker, and schedule
   configuration are inspected separately;
6. local configuration does not establish remote currentness;
7. execution authorization is always `prohibited`.

Review and expiry timestamps are represented explicitly. The checked-in
all-disabled authority has no approval window, so reviewed and expiry values
remain null. Authority for one environment is never accepted for the other.

## Protected frontend source

`src/config/protectedCapabilities.mjs` is the single protected frontend source.
It contains exactly the seven literal disabled states. The frontend runtime
consumes this module instead of protected `VITE_*` variables. Wrangler Pages
`[vars]` remain Pages Functions runtime bindings and are not treated as Vite
bundle inputs.

The structural source validator recognizes only `disabled` and `enabled`, but
the checked-in policy accepts only the exact all-disabled object. Unknown
capabilities, misspellings, extra keys, absent keys, and enabled checked-in
states fail closed.

`config/release-inspection-manifest.json` and the executable protected frontend
source are included in the protected configuration inventory and SHA-256
integrity contract.

## Bindings, prerequisites, and secret policies

The binding policy models frontend, Pages Functions, private Worker, and
schedule surfaces separately for Preview and Production. It inventories
ordinary variables, D1, Service Bindings, rate-limit bindings, public exposure,
schedules, and secret requirements without reading or storing any secret
value.

`DRAFT_VALIDATION_MODE` and `DRAFT_TICKET_MODE` are platform
prerequisites, not members of the seven protected capabilities. The projection
reports them separately so an already-enabled prerequisite cannot be mistaken
for protected capability activation.

Secret policy uses only `required`, `allowed`, `forbidden`, `not-applicable`,
and unresolved status vocabulary. Secret names cannot masquerade as ordinary
variables. In 3D-2A:

- the Preview private Worker requires `DRAFT_TICKET_SIGNING_KEY` as an existing
  platform prerequisite;
- the Production private Worker forbids that ticket secret;
- protected leaderboard cursor and identity signing secrets remain forbidden
  on their future applicable surfaces;
- irrelevant surfaces are explicitly not applicable;
- no secret value, placeholder value, digest, or remote existence claim is
  emitted.

Both schedules must be exactly empty. Preview private-Worker public exposure
is forbidden. The Production private Worker must have no D1 binding. Missing,
extra, duplicated, mistyped, secret-masquerading, or cross-environment bindings
fail validation.

## Evidence and result semantics

Evidence has explicit availability and provenance. Checked-in sources include
their repository path and local content hash. Non-applicable evidence is
explicit. Remote evidence is not synthesized from local intent.

Preview remote observation is `unavailable` because 3D-2A performs no remote
inspection and the remaining provider identities require separate grounding.
Production remote observation is `unavailable` and marked `excluded`: this
milestone does not inspect Production. Provider-side Pages build settings,
domains, routes, bindings, secret existence, deployments, schedules, and D1
state therefore remain unproven.

The final projection result is always `UNKNOWN`. `NO-OP` is reserved for a
future contract that independently proves local intent equals a complete,
current remote observation. No 3D-2A output can claim readiness, approval,
deployment currentness, rollback readiness, or execution authority.

## Work remaining after 3D-2A

Milestone 3D-2B should add authenticated read-only inspection after exact
Preview identities and least-privilege access are independently reviewed. It
must preserve bounded GET-only allowlists, complete pagination, stable repeated
reads, environment isolation, secret-value non-disclosure, and explicit
unknown/unavailable evidence. Production inspection remains separately scoped
and authorized.

Milestone 3D-2C should add non-executable release planning, serialized package
and report integration, exact local-versus-remote capability diffing, freshness
rules, rollback-contract completeness checks, and independent review. It must
not make the inspection contract executable or reuse the legacy disabled-only
executor.

Milestone 3D-3 or later still owns any separately authorized migration
application, secret provisioning, deployment, smoke execution, rollback
execution, or capability activation. Production requires independent
authorization.
