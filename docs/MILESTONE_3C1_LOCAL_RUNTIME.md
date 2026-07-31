# Milestone 3C-1 local runtime integration

> Historical implementation contract: Milestone 3C-3 supersedes this
> document's aggregate activation discussion with seven independent
> capabilities. This document remains authoritative only for the underlying
> browser and schema-4 runtime behavior it describes; it is not an activation
> procedure.

This document describes the local, fail-closed integration of draft tickets,
server-authoritative submissions, Best Run leaderboards, account-free identity,
rename, and recovery. It is an implementation and test contract, not an
activation authorization. The checked-in public gates remain disabled.

## Runtime boundaries

The browser uses same-origin `/api/v1/*` requests only. Pages Functions enforce
public gates and proxy private mutations over the existing
`VALIDATION_SERVICE` binding. The private Worker verifies tickets, replays and
scores transcripts, performs schema-4 D1 transactions, and owns the identity
signing key. Public leaderboard reads use the Pages D1 binding and an
environment-specific cursor-signing secret.

The frontend enables a capability only when its build-time value is exactly
`enabled`:

- `VITE_DRAFT_TICKET_MODE`
- `VITE_DRAFT_SUBMISSION_MODE`
- `VITE_LEADERBOARD_READ_MODE`
- `VITE_LEADERBOARD_IDENTITY_MODE`
- `VITE_LEADERBOARD_IDENTITY_CLAIM_MODE`
- `VITE_LEADERBOARD_IDENTITY_STATUS_MODE`
- `VITE_LEADERBOARD_IDENTITY_RENAME_MODE`
- `VITE_LEADERBOARD_RECOVERY_MODE`

Missing values, different spelling, query parameters, and browser storage all
fail closed. Development fixtures additionally require both a development
build and `VITE_LOCAL_LEADERBOARD_TEST_MODE=enabled`. Production builds ignore
fixture selection and the old development identity record.

The broad `VITE_LEADERBOARD_IDENTITY_MODE` and
`LEADERBOARD_IDENTITY_MODE` switches are disable-only ceilings: enabling one
does not enable a narrow identity action. Claim, status, rename, and recovery
each require their exact narrow frontend, Pages, and private-Worker gate.
Identity claim, status, and rename can operate while recovery is disabled. The
public recovery route returns the established generic 404 when its gate is not
enabled. Private health uses the exact production query
`?capability=recover`; Pages health reports
`features.leaderboardRecovery` readiness separately. The schema-4 authority
capability remains `identityRecovery`.

## Ticket and submission lifecycle

Classic requests one ticket as a new draft starts only when both the ticket and
submission gates are enabled. The request is bounded to four seconds. Success
supplies the authoritative `seeded-v1` seed, draft ID, and creation time used
in the transcript header. The opaque ticket stays only in the mounted draft
component: it is not rendered, logged, placed in a URL, or stored. A failed or
timed-out request starts a normal local draft with honest local-only wording.

Play Again and Restart abandon the engine and mount a new draft, discarding the
old ticket. Refresh, Back navigation, and another tab create a separate browser
runtime and cannot intentionally reuse component state. Submission begins only
after a complete canonical transcript and a still-current ticket exist.

The server receipt is the only authority for acceptance, idempotent retry,
score, qualification, and Daily, Weekly, and All-Time placement. Failed
submission never hides the local result. Mutations do not retry
automatically. The player can deliberately retry the exact ticket/transcript
pair; HTTP 200 is shown as already confirmed and HTTP 201 as newly confirmed.
A conflicting retry, expired ticket, invalid replay, rate limit, offline
failure, schema mismatch, or server failure is never described as public or
saved.

## Identity and credential lifecycle

A first qualifying, identity-pending receipt can carry a short-lived,
run-bound claim capability. The UI validates the display name with the shared
rules, checks server availability, and then performs the claim once. It does
not imply success before the server responds.

The versioned local record is
`pennant-pursuit:leaderboard-identity:v1`. It contains only:

- record version;
- device credential;
- current display name;
- recovery version;
- local update timestamp.

The record is shape-checked, exact-key checked, name-validated, and read back
after writes. Missing, corrupt, outdated, malformed, and inaccessible records
have separate safe states. Status is requested once for a valid stored
credential, and a response can reconcile a server-side rename and recovery
version. A stored identity that cannot be verified never silently becomes an
anonymous submission.

“Remove Identity from This Device” is a secondary, confirmed action. It removes
only local device access; it does not claim to delete server identity or run
history. No email, password, account, or social-login behavior exists.

Rename is secondary to play. It uses shared validation, server availability,
and the authoritative thirty-day eligibility result. Local safe metadata
changes only after the server confirms the rename.

## Recovery lifecycle

Recovery is available only under its independent frontend and backend gates.
The client normalizes the existing recovery code and generates a
cryptographically random `ppr1_` operation ID. An uncertain exact retry reuses
that operation ID; changing the entered code creates a new operation. The
operation ID is held only in memory.

Success replaces the local device credential, displays the replacement recovery
code once, and explains that the prior device credential and recovery material
are invalid. Refresh is protected while the replacement code is visible. The
code is removed from React state and the DOM only after the player confirms
that it was saved. Neither the original nor replacement recovery code is put in
local storage.

If credential storage fails after claim or recovery, the UI says the device is
not ready and keeps the one-time recovery material visible. It does not repeat
the mutation automatically.

## Leaderboard reads

The real read model supports Daily, Weekly, and All-Time Classic Best Run
boards. Server rank and ordering are authoritative. The first page is shown
with rank, display name, projected wins, overall score, time context, and mode.
An authenticated display name is highlighted. Up to three bounded background
pages are searched to anchor the personal row when it is outside the first
page, without duplicating it.

Manual pagination reuses the server snapshot cursor, de-duplicates rows, and
aborts on period change or route exit. An invalid/stale cursor discards the
old page and offers “Restart Board.” Loading, empty, disabled, offline,
rate-limited, general error, and retry states are distinct. React StrictMode
shares the same in-flight first-page request instead of issuing a duplicate.

## Privacy-safe Preview diagnostic events

The Worker and leaderboard read boundary can emit one structured
`preview.operation` diagnostic event per handled operation. Response delivery
does not await logging, and diagnostics never inspect the response body. Fields
are limited to:

- operation from a fixed list;
- outcome from a fixed list;
- one of four coarse latency buckets.

These are ephemeral log events, not retained counters or an analytics store.
Cleanup separately emits bounded completed/backlog/failed observations with
batch and deletion counts. Pages health supplies current schema and feature
readiness. No diagnostic event contains IP, display name, ticket, transcript,
roster, credential, recovery code, claim capability, fingerprint, location,
raw error, or third-party telemetry identifier.

After separate authorization to contact Preview, keep both live tails open for
the entire small-cohort session:

```bash
npx wrangler tail pennant-pursuit-validation-preview --format json --search preview.operation
npx wrangler pages deployment tail --project-name diamond-draft --environment preview --format json --search preview.operation
```

Pause the supervised session and disable the affected gates when the operator
observes any of these live conditions:

- one credible privacy or credential exposure;
- any reproducible rank or placement contradiction;
- three consecutive `server-error` events for the same operation;
- five `rate-limited` events during one supervised session;
- any cleanup failure, or a cleanup backlog that remains at the next observed
  cleanup.

Live tails alone cannot reliably calculate historical percentages, hourly
rates, unique-user rates, or events missed before the operator connected.
Milestone 3C-2 adds an aggregate-only local per-session collector, not durable
remote telemetry; see
[Milestone 3C-2 CI and Preview release stabilization](MILESTONE_3C2_CI_RELEASE_STABILIZATION.md).
Any threshold depending on complete history, percentages, or time-window rates
still requires separately authorized retained telemetry. Never paste raw tester
requests or private material into an incident record.

## Schema-4 activation readiness and rollback

Milestone 3C-3 supersedes the aggregate identity portion of this section with
the canonical `leaderboardRead`, `identityClaim`, `identityStatus`,
`identityRename`, `draftSubmission`, `identityRecovery`, and `cleanupCron`
authority. See
[Schema-4 activation authority and identity recovery readiness](MILESTONE_3C3_SCHEMA4_AUTHORITY.md).
The protected deployment configuration remains unchanged and fail-closed.

`config/preview-schema4-readiness.json` is the local schema-4 contract.
`npm run schema4:readiness:check` requires the exact migration prefix ending in
`0004_leaderboard_identity_ranking.sql`, the frontend gates, the independent
backend recovery gate, and schema-4 health expectations.

Enabled planning accepts only:

- exact schema 3 with exactly migration 0004 pending; or
- exact schema 4 with no pending migration.

Unknown versions, unknown or reordered migration prefixes, missing 0004, more
than one migration pending from exact schema 3, Production identity ambiguity,
dirty/protected local state, or missing capability-specific protected state
refuse activation. The protected legacy D1C.4 model lacks the new gates, so
enabled-state generation and Preview planning currently refuse at the
protected-configuration boundary. Disabled is the only supported target until
a separate authorization updates that model.

Rollback disables public submission, claim, status, rename, recovery, reads,
and cleanup Cron first.
Use a reviewed forward fix for schema defects. Schema reversal is not the
default rollback and must never be improvised.

Preview identities are disposable before public release. An identity-key
compromise or incompatible rotation requires disabling identity and recovery,
notifying testers, and performing a separately authorized Preview identity
reset. This milestone does not add multi-key migration.

## Local browser validation

Install the pinned development dependency and Chromium once:

```bash
npm install
npx playwright install chromium
```

Run:

```bash
npm run test:browser
npm run test:browser:release
npm run test:browser:headed
```

The test configuration starts isolated loopback Vite servers. Tests intercept
only same-origin local API calls and never use Preview or Production hosts.
Reports, screenshots, traces, and browser downloads are ignored; the default
configuration disables screenshot, trace, and video capture and uses
test-only placeholder credentials. Chromium is the release-relevant browser.
Current Safari and Firefox remain expected player browsers but are deferred
from the automated release subset; keyboard, reduced-motion, 320px, 390px, and
desktop contracts remain required.

The browser suite covers fail-closed ticket gating, exact submission retry,
offline/timeout/rate-limit recovery, identity storage failures, stateful
credential rotation, responsive tablet layouts, navigation, and obsolete lazy
chunk recovery. No browser artifact is tracked by Git.

## Tester data policy and deferred Production work

Preview testers should use a non-sensitive display name and must treat the
one-time recovery code as private. A Preview reset can remove identities and
leaderboard history. This task performs only local tests with disposable data.

Remote identity grounding, migration inspection/application, deployment,
feature activation, tester invitations, moderation/deletion operations,
multi-key signing-key migration, Production configuration, and Production
release all require separate work and authorization.
