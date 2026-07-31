# Milestone 3C-3 schema-4 activation authority and identity recovery readiness

Milestone 3C-3 established the local authority and operator-preparation
contracts for schema 4. It does not authorize a migration, deployment, remote
inspection, feature activation, secret or binding change, or identity
mutation. Existing migrations `0001` through `0004` remained unchanged.

The local evaluator, runtime gates, and read-only operator-preparation
contracts are implemented and locally testable. This is not full activation
readiness. Milestone 3D-1 subsequently added the protected, all-disabled
capability-model foundation described in
[Milestone 3D-1 protected capability-model foundation](MILESTONE_3D1_PROTECTED_CAPABILITY_MODEL.md). Preview and
Production remain disabled, enabled release planning is deferred to 3D-2, and
neither environment is an activation target in 3D-1.

## Authority contract

`scripts/lib/schema4-activation-authority.mjs` is the versioned, fail-closed
authority evaluator and the canonical seven-capability vocabulary is:
`leaderboardRead`, `identityClaim`, `identityStatus`, `identityRename`,
`draftSubmission`, `identityRecovery`, and `cleanupCron`. A reviewed authority
document has exactly:

- schema version `1`;
- one exact environment, `preview` or `production`;
- a bounded review and expiry window of at most 24 hours;
- an emergency stop, `clear` or `engaged`;
- the legacy identity compatibility ceiling;
- all seven capability modes, each exactly `enabled` or `disabled`.

Missing fields, extra fields, partial objects, unknown modes, unsupported
versions, invalid timestamps, future review times, expired authority,
environment mismatch, and contradictory emergency state disable every
capability. An engaged emergency stop is valid only when both timestamps are
`null`, the compatibility ceiling is disabled, and all capabilities are
disabled.

The identity compatibility ceiling is a disable-only safety layer. Enabling it
does not enable claim, status, rename, or recovery. Disabling it prevents all
four even if a narrower field says `enabled`.

| Canonical capability | Frontend gate | Pages gate | Private Worker gate | Additional boundary |
| --- | --- | --- | --- | --- |
| `leaderboardRead` | `VITE_LEADERBOARD_READ_MODE` | `LEADERBOARD_READ_MODE` | none | exact environment and cursor-signing configuration |
| `identityClaim` | `VITE_LEADERBOARD_IDENTITY_CLAIM_MODE` | `LEADERBOARD_IDENTITY_CLAIM_MODE` | `LEADERBOARD_IDENTITY_CLAIM_MODE` | identity compatibility ceiling and signing key |
| `identityStatus` | `VITE_LEADERBOARD_IDENTITY_STATUS_MODE` | `LEADERBOARD_IDENTITY_STATUS_MODE` | `LEADERBOARD_IDENTITY_STATUS_MODE` | identity compatibility ceiling and signing key |
| `identityRename` | `VITE_LEADERBOARD_IDENTITY_RENAME_MODE` | `LEADERBOARD_IDENTITY_RENAME_MODE` | `LEADERBOARD_IDENTITY_RENAME_MODE` | identity compatibility ceiling and signing key |
| `draftSubmission` | `VITE_DRAFT_SUBMISSION_MODE` | `DRAFT_SUBMISSION_MODE` | `DRAFT_SUBMISSION_MODE` | ticket, replay, schema, and Service Binding checks |
| `identityRecovery` | `VITE_LEADERBOARD_RECOVERY_MODE` | `LEADERBOARD_RECOVERY_MODE` | `LEADERBOARD_RECOVERY_MODE` | identity compatibility ceiling and signing key |
| `cleanupCron` | none | none | `RETENTION_CLEANUP_MODE` | exact reviewed Cron trigger must also be present |

The frontend column records the future build-time vocabulary established by
3C-3. Milestone 3D-1 subsequently left that protected build-time source
deliberately undefined and hard-disabled; Pages Wrangler `[vars]` are not
frontend configuration. See the 3D-1 document for the current boundary.

Name availability is read-only and is reachable only when claim or rename
authority is enabled. Submission can attribute a returning identity under the
compatibility ceiling, but submission does not enable claim, status, rename,
or recovery. A claim capability is created and returned only when claim
authority is independently enabled.

The checked-in Pages and Worker configuration now explicitly contains every
applicable capability-specific field as disabled. Missing fields still fail
closed. Both Worker Cron lists remain empty. Consequently the effective
checked-in matrix is:

| Environment | Reads | Claim | Status | Rename | Submission | Recovery | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preview | disabled | disabled | disabled | disabled | disabled | disabled | disabled |
| Production | disabled | disabled | disabled | disabled | disabled | disabled | disabled |

The automated model test evaluates all 128 capability combinations separately
for Preview and Production, 256 evaluations in total. No combination is inferred from another and an
authority document for one environment is invalid in the other.

## Rollback and emergency disablement

Emergency response disables public and scheduled mutation in this order:

1. Engage the environment-specific emergency stop.
2. Disable Pages submission, claim, status, rename, recovery, and reads.
3. Disable the private Worker submission, claim, status, rename, recovery, and
   cleanup modes.
4. Remove the Preview cleanup Cron trigger.
5. Verify every public route is absent or disabled and the scheduled handler
   does not inspect D1.

A narrower disabled mode always wins over the identity compatibility ceiling.
The cleanup mode and Cron trigger are both required, so removing either stops
scheduled cleanup. Rollback never reverses schema 4. Use a separately reviewed
forward migration for a schema defect.

## Bounded identity recovery preparation

`npm run identity:recovery:prepare` is a local evidence tool. It has no
Cloudflare client, network call, Wrangler command, D1 binding, SQL parser, SQL
execution path, credential generator, mutation adapter, execution mode,
confirmation input, or plan-consumption path. Its shipped module exports
read-only preview creation and read-only verification only.

The tool accepts:

- a fresh, reviewed, Preview-only authority file whose recovery capability is
  enabled;
- a fresh `reviewed-local-snapshot` JSON file containing only the exact
  operator evidence fields;
- one integer player ID.

Both inputs must be regular, non-symlink files. The command refuses
directories, FIFOs, devices, sockets, final-component symlinks, invalid UTF-8,
malformed or non-normalized Unicode, duplicate JSON keys at any depth,
overlong strings, excess bytes, excess records, unsafe timestamps, and a
record update later than its snapshot observation. Authority input is capped
at 32 KiB; snapshot input is capped at 512 KiB and 1,000 records. The snapshot
grammar rejects extra fields, including raw device credentials or recovery
material. Each record contains only status, recovery version, update time, an
identity-continuity hash, and a credential-state hash. The snapshot is valid
for at most 15 minutes.

Generate privacy-safe preview evidence:

```bash
npm run identity:recovery:prepare -- \
  --authority-file /path/to/reviewed-preview-authority.json \
  --snapshot-file /path/to/reviewed-local-snapshot.json \
  --player-id 42
```

The schema-2 output includes a cryptographically random, 256-bit opaque
`planRef`; the canonical digest of the exact reviewed Preview authority; an
opaque `playerBinding`; a plan-specific target-state commitment; observation
and expiry times; and a deterministic canonical plan hash. The binding is the
SHA-256 digest of canonical structured JSON containing the exact integer
player ID, the Preview environment, the plan reference, and the explicit
`pennant-pursuit.identity-recovery.player-binding.v1` domain. The raw player ID
is used only as hash input and is not written into the plan or evidence output.
Different exact IDs produce different bindings in the same plan context, and
the random plan reference makes bindings from separate plans unlinkable by
direct equality.

Opaque identity binding is distinct from raw identity disclosure: the output
contains the digest, not the integer ID. The digest is a binding commitment,
not encryption or an anonymity guarantee for a low-entropy ID. Output also
contains no display name, raw credential, recovery code, token, recovery
version, identity update time, stable continuity hash, or credential-state
hash.

The target-state commitment hashes canonical structured JSON under the
separate `pennant-pursuit.identity-recovery.target-state.v2` domain and
includes the environment, plan reference, opaque player binding, and every
allowed target-state field. The whole plan is committed under the distinct
`pennant-pursuit.identity-recovery.plan.v2` domain. Canonical object encoding,
rather than string concatenation, makes field names, types, nesting, and order
unambiguous. The resulting commitments are both plan-specific and
target-specific.

The preparation refuses malformed, nonexistent, ambiguous, inactive,
moderated, or invalidated targets. Read-only verification revalidates exact
plan integrity and expiry, an exact canonical authority-digest match, current
recovery authorization, snapshot freshness, the exact-player binding, and the
plan-specific target-state commitment. Verification recomputes the binding
from the newly supplied exact target. Substituting another player returns
`target_mismatch` even when every allowed state field is identical. A changed
state for the same player continues to return the applicable stale-state or
eligibility refusal. Changed, expired, emergency-disabled, or
cross-environment authority is invalid. Verification evidence must have been
observed at or after the preview; older or changed target state is refused.

The plan grammar requires the schema-2 binding and both commitments to be
well-formed canonical SHA-256 digests. Missing or malformed bindings and
legacy schema-1 plans that cannot prove exact-target binding fail closed as
`malformed_plan`; older unbound commitments are never accepted as exact-target
evidence.

There is no shipped adapter, callback factory, confirmation sentence, or
execution function. Any `--execute`, `--confirm`, or `--plan-file` attempt
refuses with `remote_execution_blocked` before input files are opened. Repeated
read-only verification—sequentially, concurrently, or in another local
process—is intentionally non-consuming and returns
`consumption: not-performed`. This is not replay protection because no shipped
side-effect boundary exists for a copied plan to cross.

Preparation and verification are both read-only evidence operations. Neither
operation executes recovery, rotates credentials, consumes a plan, writes a
database, or contacts a remote service.

A future mutation implementation requires trusted private state that binds the
opaque `planRef` to the exact player ID and reviewed evidence. It must
atomically insert a persistent unused-plan record, compare-and-swap the exact
target state, rotate credentials, and mark the plan consumed in one
transaction. An in-memory set, a successful read-only verification, or a
process-local lock is not single-use protection.

## Protected configuration follow-up

Milestone 3D-1 implements the versioned, environment-bound, emergency-stopped
protected representation with every capability disabled. It extends the
applicable Pages Functions and private-Worker inventories, generated runtime
types, protected hashes, and local disabled-state compiler contracts. Frontend
protected build-time integration remains deliberately absent.

Milestone 3D-2 must separately add capability-oriented remote read-only
inspection, evidence, sequencing, immutable binding comparison, and protected
frontend build-time integration. Until that review, the
planner and compiler accept only the disabled target. Secret provisioning,
migration execution, deployment, remote verification, and activation remain
separate later authorizations. No broad state may silently enable a narrower
capability.

## Additive migration proposal for an operator reset adapter

End-user recovery already fits schema 4. A future mutation-capable operator
credential reset needs an additive audit and idempotency record; it must not
reuse a generic SQL interface or overload the existing end-user recovery
operation ambiguously.

Propose, but do not create or apply,
`migrations/0005_identity_operator_recovery.sql` with a dedicated
`leaderboard_operator_recovery_resets` table. The table should bind one
cryptographic plan ID to one player ID, expected and replacement recovery
versions, expected identity-update time, a privacy-safe evidence hash,
created/applied/expired timestamps, a fixed reason-code vocabulary, and a
unique `(player_id, expected_recovery_version)` constraint. It must contain no
raw credential, recovery code, token, display name, or arbitrary operator
text.

The future adapter must perform one parameterized transaction that:

1. rechecks the exact active player, recovery version, identity-update time,
   and continuity evidence;
2. inserts the unused plan record;
3. rotates both device and recovery digests;
4. increments recovery version exactly once;
5. preserves player ID, public name, runs, and active status;
6. records a bounded audit event;
7. returns only privacy-safe result evidence.

Migration creation, migration execution, secret provisioning, protected
configuration, deployment, and any remote adapter remain separate
authorizations. Until all are independently reviewed and validated, Preview
and Production activation remains **NO-GO**.
