# Preview release workflow

Milestone 3D-1 left the legacy Preview release workflow disabled-only while
adding the protected schema-4 capability-model foundation. Milestone 3D-2A
adds strict local release-inspection contracts and projection without making
that legacy workflow capability-oriented or executable. Milestone 3D-2B.2 adds
closed Preview resource normalization, single-read observation, and a pure
candidate capability projection. These milestones do not authorize remote
inspection, release execution, deployment, migration, smoke execution, secret
provisioning, or capability activation.

The 3D-2B.2 candidate projection has no operator CLI. It can consume only an
opaque validated normalized single-read snapshot, and it permanently retains
`releaseCurrentness: "UNKNOWN"` and
`executionAuthorization: "prohibited"`. See
[Milestone 3D-2B.2 Preview resource observation and candidate projection](MILESTONE_3D2B2_PREVIEW_RESOURCE_OBSERVATION.md).

The 3D-2B.3a pure comparison contract can compare exactly two opaque validated
single-read snapshots, but it does not perform either read or wait between
them. Its `MATCH` means only read-to-read semantic stability and grants neither
currentness nor execution authority. See
[Milestone 3D-2B.3a stable comparison contract](MILESTONE_3D2B3A_STABLE_COMPARISON_CONTRACT.md).
TypeScript assignability is not release provenance: assertions, `any`,
`unknown` casts, and deliberate intersections cannot create the private runtime
identity required by the comparison authority. Runtime-produced results remain
closed and deeply frozen.

## Current command boundary

The authoritative local check is offline by default:

```bash
npm exec --offline -- node scripts/preview-check.mjs
npm exec --offline -- node scripts/preview-check.mjs --offline
```

It verifies repository identity, clean Git state, exact branch and upstream
relationship, protected hashes, schema-4 authority and readiness, generated
types, type checks, tests, lint, production builds, Pages Functions, and
private-Worker dry-run builds. The local command graph rejects deployment,
migration, secret, remote database, and other unsafe commands.

No ordinary 3D-1 validation command requires Cloudflare credentials. Local
validation must run in a credential-free child environment.

## Protected capability contract

The canonical capabilities are `leaderboardRead`, `identityClaim`,
`identityStatus`, `identityRename`, `draftSubmission`, `identityRecovery`, and
`cleanupCron`. `workers/draft-validation/d1c4-activation-states.json` carries
capability-model version `2`; each environment document uses authority schema
version `1` and a review window no longer than 24 hours.

Preview and Production are exact, separate identities. Missing or extra fields,
unknown capabilities, malformed modes, unsupported versions, environment
mismatch, future review times, expired authority, excessive review windows, and
contradictory emergency state fail closed.

The legacy identity mode is a disable-only compatibility ceiling. It never
enables claim, status, rename, or recovery. When it is disabled, those four
capabilities are effectively disabled even if a narrow field says enabled. An
engaged emergency stop effectively disables all seven capabilities.

The checked-in protected model requires both environments to be emergency
stopped and all disabled. Both private-Worker Cron lists are empty and the
Production private Worker has no D1 binding.

## Disabled-only planning

The planner currently accepts only:

```bash
npm exec --offline -- node scripts/preview-plan.mjs --target-state disabled
```

It may use read-only observations when separately authorized and when all
protected remote identities are complete, but it cannot construct an enabled
target. The protected compiler also emits only disabled Preview material and
strips Production target sections from that local material.

The operator-facing readiness entry point likewise accepts only the disabled
target:

```bash
npm exec --offline -- node scripts/preview-readiness.mjs --target-state disabled
```

Any evidence package is evidence only, never approval. The current manifest's
`releaseTooling` value is `disabled-only`, and execution-contract construction
rejects every enabled target before a mutation command can be selected.

Milestone 3D-1 does not authorize running either command against Cloudflare.
Their local parsers and planners are covered by fixtures so the disabled-state
contract can be validated without network access.

## Protected inventories

The protected configuration inventory is exact and duplicate-free:

- `config/preview-release.json`;
- `config/release-inspection-manifest.json`;
- `config/preview-schema4-readiness.json`;
- `shared/schema4-capabilities.mjs`;
- `shared/schema4-runtime-consumers.mjs`;
- `src/config/protectedCapabilities.mjs`;
- `src/features/leaderboard/runtimeConfig.registrations.json`;
- `functions/lib/leaderboard-mode.registrations.json`;
- `functions/lib/leaderboard-identity-mode.registrations.json`;
- `functions/lib/draft-submission-mode.registrations.json`;
- `workers/draft-validation/src/retention-cleanup-mode.registrations.json`;
- `workers/draft-validation/d1c4-activation-states.json`;
- `wrangler.toml`;
- `workers/draft-validation/wrangler.toml`.

Protected SHA-256 validation also covers migrations `0001` through `0004` and
the immutable public routing files. No migration `0005` exists.

The Pages binding inventory includes only the disabled Pages Functions runtime
variables for read, claim, status, rename, submission, and recovery, the legacy
identity ceiling, and the exact environment marker. It contains no protected
`VITE_*` variables because Wrangler Pages `[vars]` do not configure the static
Vite bundle. The private-Worker inventory
includes disabled claim, status, rename, submission, recovery, cleanup, and the
legacy identity ceiling. Missing, extra, duplicate, malformed, or enabled
protected values fail validation.

Milestone 3D-1 historically had no protected frontend build-time source.
Milestone 3D-2A now establishes `src/config/protectedCapabilities.mjs` as the
single protected static-bundle source with exactly seven literal disabled
states. Runtime frontend gates consume it instead of ambient `VITE_*`, process,
query, storage, or global values. The structural validator understands enabled
states only to reject them under the checked-in all-disabled policy. Any future
frontend activation still requires a separate protected change and reviewed
remote evidence.

## Environment isolation

Production stays independent from Preview:

- every Production capability field is disabled;
- the Production private Worker has no D1 binding;
- Production and Preview Cron lists are both empty;
- existing Preview and Production Service Bindings are unchanged;
- no secret value or placeholder is stored in source;
- no environment can consume authority reviewed for the other environment.

## Local release-inspection projection

Milestone 3D-2A provides an environment-neutral, stdout-only Node entry point:

```bash
node scripts/release-inspection-local.mjs
```

It validates exact Preview and Production capability matrices, binding and
secret policies, authority context, protected source hashes, migration and
routing provenance, and explicit remote-observation placeholders. It performs
no network request and no filesystem write. Preview remote evidence is
unavailable, Production inspection is excluded, remote currentness is unknown,
and execution authorization is prohibited. Platform prerequisites such as
draft-ticket validation remain explicit and outside the seven capabilities.
The legacy planner, package, reports, and executor reject these artifacts.

`npm run release-inspection:local` is a convenience wrapper for the same entry
point. The program itself makes no filesystem write, including no repository
artifact or evidence write. That guarantee does not claim that npm performs
literally zero package-manager filesystem calls: npm may inspect or maintain
its own cache and logs outside the program. Those wrapper operations are not
release-inspection evidence and do not weaken the Node entry point's no-write
boundary.

## Deferred release work

Milestone 3D-2B owns separately authorized authenticated read-only Preview
inspection after complete identity grounding and least-privilege review.
Milestone 3D-2C owns non-executable package, planning, diff, evidence-freshness,
rollback-contract, and reporting integration. Neither may infer `NO-OP` from
local intent; independent complete current remote evidence is required.

Milestone 3D-3 or later separately owns any authorized migration application,
secret provisioning, deployment, smoke execution, rollback execution, and
capability activation. Production work requires an independent authorization.

Until those milestones are reviewed, structurally valid enabled authority
fixtures exist only to prove the evaluator's independence and failure modes.
They cannot be compiled into an authorized release, cannot select a mutation
command, and cannot activate a checked-in capability.

## Exit behavior

Local command-line parsers use the established exit categories:

| Code | Meaning |
| ---: | --- |
| `0` | Successful local check or disabled-only plan |
| `2` | Invalid command-line usage |
| `10` | Local precondition, command-safety, or quality failure |
| `11` | Remote read, stale snapshot, or ambiguous remote state |
| `12` | Production-protection or identity-guard refusal |
Milestone 3D-1 does not authorize reaching remote or mutation behavior.
