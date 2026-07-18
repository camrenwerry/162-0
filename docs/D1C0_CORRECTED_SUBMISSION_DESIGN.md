# Pennant Pursuit — Corrected D1C.0 Authoritative Submission Contract

## Status and authority

Corrected D1C.0 is the authoritative design baseline for Pennant Pursuit draft
submission. The retained-row ordering correction in this document overrides
only the original retry-ordering sequence. All other approved D1C.0 behavior
remains unchanged.

D1C.0 approval did not authorize implementation, migration, deployment,
activation, secrets, frontend integration, or production changes. D1C.1
implemented only the disabled persistence foundation. D1C.2 remains a separate
implementation phase.

This document distinguishes normative approved behavior from the explicitly
unresolved implementation details listed at the end.

## Status and scope

- Public submission route: `POST /api/v1/submit-draft`
- Private authoritative Worker route: `POST /api/v1/submit-draft`
- Reuse the existing `VALIDATION_SERVICE` Service Binding.
- `POST /api/v1/validate-draft` remains read-only and D1-free.
- Submission remains preview-only in design and disabled through D1C.1–D1C.3.
- Production submission, ticket issuance, D1 binding, migration, Cron, writes,
  and leaderboard remain disabled and excluded.

Explicitly excluded:

- Frontend submission timing, UX, retries, or offline queueing.
- Leaderboards and leaderboard eligibility.
- Accounts, identity, authentication, display names, cookies, or sessions.
- Production activation or infrastructure.
- Public administrative, lookup, cleanup, or list APIs.
- Player-level, roster, transcript, identity, analytics-history, or
  attempt-history persistence.

## Public Pages Function contract

Processing order:

1. Evaluate `DRAFT_SUBMISSION_MODE`.
2. Unless its exact value is `enabled`, return generic `404 not_found` before
   method, origin, IP, Service Binding, or body processing.
3. Require `POST`; otherwise return `405` with `Allow: POST`.
4. Apply the existing exact same-origin and host rules.
5. Require trusted `CF-Connecting-IP` metadata and derive the existing hashed
   internal rate key.
6. Require the existing `VALIDATION_SERVICE`.
7. Forward without parsing or buffering the body.
8. Forward only `Content-Type`, `Content-Length`, `Content-Encoding`, and the
   server-derived internal rate key.
9. Relay the private Worker’s sanitized response.

Every response uses:

- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-origin`

Prohibitions:

- No CORS relaxation.
- No cookies.
- No redirects.
- No infrastructure identifiers.
- No signing secrets in the Pages layer.
- No direct submission D1 access from Pages.

## Private Worker contract

The private submission route remains reachable only through the existing
Service Binding.

General processing requirements:

1. Exact private `DRAFT_SUBMISSION_MODE` gate.
2. Validate internal rate key.
3. Apply existing burst limit: 5 per 10 seconds.
4. Apply existing sustained limit: 20 per 60 seconds.
5. Require `POST` and existing origin/host contract.
6. Require exact `Content-Type: application/json`.
7. Allow no `Content-Encoding` except absent or `identity`.
8. Read at most 16,384 UTF-8 bytes and 16,384 stream chunks.
9. Strictly parse JSON and reject duplicate keys.
10. Strictly validate the submission envelope.
11. Require the signing secret and preview D1 binding.
12. Follow the corrected retained-row reconciliation order.
13. For a new ticket, verify ticket and transcript bindings.
14. Perform deterministic replay and authoritative scoring.
15. Commit through the database-enforced atomic operation.
16. Return only the fixed public response contract.

The original approved design states that a missing signing secret returns
`503`, including during retained retrieval. The retained-row correction did not
expressly revoke that requirement. The implementation must preserve that rule
unless a later approved design amendment changes it.

## Exact request schema

The body contains exactly:

```json
{
  "ticket": "<opaque ticket, 1–4096 characters>",
  "transcript": {
    "header": {
      "transcriptSchemaVersion": "draft-transcript-v1",
      "appVersion": "1.0.0",
      "gameRulesVersion": "classic-rules-v1",
      "rngVersion": "seeded-v1",
      "scoringVersion": "2.3",
      "dataVersion": "lahman-2025-v1",
      "canonicalDataDigest": "e033f463caf37aa38037ba58c8fafe3be8358c93afe17f13a49ef117b6d4ed05",
      "draftId": "<canonical lowercase UUIDv4>",
      "gameplaySeed": "seeded-v1:<32 lowercase hexadecimal characters>",
      "createdAt": "<canonical ISO-8601 UTC timestamp with milliseconds>"
    },
    "events": []
  }
}
```

The events array contains:

- Exactly fourteen initial-roll events.
- Exactly fourteen pick events.
- At most one team reroll.
- At most one era reroll.
- Between twenty-eight and thirty total events.
- Events in replay-valid order.

Event variants:

Initial roll:

```json
{
  "type": "initial-roll",
  "round": 1,
  "combinationId": "..."
}
```

Reroll:

```json
{
  "type": "reroll",
  "reroll": "team",
  "round": 1,
  "discardedCombinationId": "...",
  "resultingCombinationId": "..."
}
```

Pick:

```json
{
  "type": "pick",
  "round": 1,
  "pickOrder": 1,
  "combinationId": "...",
  "canonicalCardId": "...",
  "sourcePlayerId": "...",
  "assignedPosition": "C",
  "featuredSeason": 2025
}
```

Allowed positions:

`C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`, `DH`, `SP`, `RP`

Reject:

- Additional fields.
- Missing fields.
- Duplicate JSON keys.
- Client-supplied submission IDs.
- Client-supplied digests.
- Client-supplied scores.
- Client-supplied results.
- Client-supplied receipt timestamps.
- Client-supplied idempotency keys.

Structural parsing and currently supported-version enforcement must remain
separate concerns.

## Canonical transcript serialization

Canonical input contains only:

- `transcript.header`
- `transcript.events`

Top-level field order:

1. `header`
2. `events`

Header field order:

1. `transcriptSchemaVersion`
2. `appVersion`
3. `gameRulesVersion`
4. `rngVersion`
5. `scoringVersion`
6. `dataVersion`
7. `canonicalDataDigest`
8. `draftId`
9. `gameplaySeed`
10. `createdAt`

Preserve original event-array order.

Per-event field order:

Initial roll:

1. `type`
2. `round`
3. `combinationId`

Reroll:

1. `type`
2. `reroll`
3. `round`
4. `discardedCombinationId`
5. `resultingCombinationId`

Pick:

1. `type`
2. `round`
3. `pickOrder`
4. `combinationId`
5. `canonicalCardId`
6. `sourcePlayerId`
7. `assignedPosition`
8. `featuredSeason`

Serialization rule:

> The compact canonical JSON is rebuilt from the strictly parsed transcript,
> not copied from request bytes.

Use compact `JSON.stringify` semantics with no whitespace.

Additional rules:

- Ignore client property order.
- Reconstruct object fields in fixed approved order.
- Preserve events array order.
- Use no locale-sensitive conversion.
- `createdAt` must already be canonical ISO-8601 UTC with milliseconds.
- `draftId` must already be canonical lowercase UUIDv4.
- `gameplaySeed` must already use the canonical `seeded-v1` lowercase
  hexadecimal form.
- Serialize validated numbers using normal `JSON.stringify` number semantics.
- Reject unknown, missing, duplicate, null-for-required, or incorrectly typed
  fields before canonicalization.
- The schema excludes non-finite numbers and unsupported numeric edge cases.

## Canonical transcript digest

Algorithm:

`SHA-256`

Exact input bytes:

```text
UTF-8(
  "pennant-pursuit:submission-transcript:v1\n"
  + compact canonical transcript JSON
)
```

Output:

- 64 lowercase hexadecimal characters.

Exclude:

- Raw request formatting.
- Client property order.
- Ticket envelope.
- Ticket signature.
- Opaque ticket string.
- Authoritative result.
- Server timestamps.
- Submission identifiers.
- Client-supplied digests.

Golden tests must prove:

- Whitespace changes do not alter the digest.
- Property permutations do not alter the digest.
- Equivalent JSON escaping does not alter the digest.
- Meaningful field mutations alter the digest.
- Array reordering alters the digest.
- Every event variant is covered.
- Local and Worker implementations match.

## Exact opaque-ticket digest

Algorithm and exact input:

```text
SHA-256(
  UTF-8(
    "pennant-pursuit:submission-ticket-token:v1\n"
    + exact opaque ticket string
  )
)
```

Rules:

- Hash the exact token string.
- Do not semantically reserialize the ticket.
- A differently encoded equivalent ticket is a different token.
- Never store the raw ticket or signature.
- Use this digest for retained retry reconciliation.

## D1 persistence contract

Logical table:

```sql
CREATE TABLE draft_submissions (
  ticket_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(ticket_id) = 36),
  ticket_token_digest TEXT NOT NULL
    CHECK (
      length(ticket_token_digest) = 64
      AND ticket_token_digest NOT GLOB '*[^0-9a-f]*'
    ),
  transcript_digest TEXT NOT NULL
    CHECK (
      length(transcript_digest) = 64
      AND transcript_digest NOT GLOB '*[^0-9a-f]*'
    ),
  submitted_at_ms INTEGER NOT NULL
    CHECK (submitted_at_ms >= 0),
  retain_until_ms INTEGER NOT NULL
    CHECK (retain_until_ms > submitted_at_ms),
  submission_schema_version TEXT NOT NULL
    CHECK (submission_schema_version = 'pennant-draft-submission-v1'),
  success_response_json TEXT NOT NULL
    CHECK (
      length(success_response_json) >= 2
      AND length(success_response_json) <= 8192
    )
);

CREATE INDEX idx_draft_submissions_retain_until
ON draft_submissions(retain_until_ms);
```

D1C.1 subsequently hardened predecessor-version and SQLite integer
storage-class checks. Those mechanical hardening changes remain authoritative.

Column meanings:

- `ticket_id`: signed draft ticket ID and uniqueness/idempotency key.
- `ticket_token_digest`: domain-separated SHA-256 of the exact opaque ticket.
- `transcript_digest`: domain-separated SHA-256 of the canonical parsed
  transcript.
- `submitted_at_ms`: server time of the first committed submission.
- `retain_until_ms`: server deadline for retained idempotent recovery.
- `submission_schema_version`: fixed `pennant-draft-submission-v1`.
- `success_response_json`: exact immutable successful response bytes.

## Persistence prohibitions

Never store:

- Raw ticket.
- HMAC signature.
- Signing input.
- Raw transcript.
- Canonical transcript JSON.
- Player roster.
- Player-level data.
- Player names.
- Seed.
- IP address.
- Internal rate key.
- User agent.
- Cookies.
- Client identifiers.
- Identity.
- Display name.
- Error history.
- Attempt history.
- SQL.
- Secret state.
- Request body.
- Analytics event history.

Versions and the authoritative result summary exist only inside the immutable
receipt JSON, not as normalized columns.

## Stored successful receipt

Persist the exact immutable successful response JSON.

Shape:

```json
{
  "ok": true,
  "verified": true,
  "submitted": true,
  "submissionSchema": "pennant-draft-submission-v1",
  "submittedAt": "<server canonical ISO timestamp>",
  "versions": {
    "transcriptSchema": "<authoritative transcript schema>",
    "app": "<authoritative app version>",
    "gameRules": "<authoritative rules version>",
    "rng": "<authoritative RNG version>",
    "scoring": "<authoritative scoring version>",
    "data": "<authoritative data version>",
    "canonicalDataDigest": "<authoritative canonical data digest>"
  },
  "result": {
    "projectedWins": "<authoritative number>",
    "projectedLosses": "<authoritative number>",
    "overallScore": "<authoritative number>",
    "overallGrade": "<authoritative string>",
    "tier": "<authoritative string>",
    "categories": {
      "offense": {
        "score": "<authoritative number>",
        "grade": "<authoritative string>"
      },
      "defense": {
        "score": "<authoritative number>",
        "grade": "<authoritative string>"
      },
      "startingPitching": {
        "score": "<authoritative number>",
        "grade": "<authoritative string>"
      },
      "reliefPitching": {
        "score": "<authoritative number>",
        "grade": "<authoritative string>"
      },
      "rosterBalance": {
        "score": "<authoritative number>",
        "grade": "<authoritative string>"
      }
    },
    "strongestCategory": "<authoritative string>",
    "weakestCategory": "<authoritative string>"
  }
}
```

Do not include:

- Submission ID.
- Ticket ID.
- Transcript digest.
- Raw ticket.
- Roster.
- Player data.
- `idempotentRetry`.

The initial success and retained retry return identical stored response bytes.
Their HTTP statuses distinguish them.

## Corrected retained-row reconciliation order

This correction overrides the original ordering only:

1. Strictly parse the request and transcript.
2. Derive `ticket_id` from `transcript.header.draftId`.
3. Compute the exact opaque-ticket digest.
4. Check for a retained row using `ticket_id`.
5. If a row exists, compare token and transcript digests in constant time.
6. Exact token and identical transcript digest:
   - Return stored receipt.
   - HTTP `200`.
7. Exact token and different transcript digest:
   - HTTP `409`.
   - Code `draft_ticket_already_consumed`.
8. Different token digest:
   - HTTP `422`.
   - Code `invalid_draft_ticket`.
9. Only when no retained row exists perform current ticket verification, expiry
   checks, transcript binding, deterministic replay, authoritative scoring, and
   insertion.

This ordering supports recovery after:

- Ticket expiry.
- Signing-key rotation.
- Uncertain response delivery.

## First submission behavior

For a valid, bound, unconsumed ticket after successful replay and scoring:

- Perform the database-enforced consume operation.
- Store the immutable receipt.
- Return HTTP `201`.
- Return the stored receipt body.

## Identical retained retry

Same exact opaque ticket and same canonical transcript digest:

- Return the original stored receipt.
- Return HTTP `200`.
- Do not replay.
- Do not rescore.
- Do not rewrite the row.
- Do not change `submittedAt`.

## Conflict behavior

Same exact opaque ticket and different canonical transcript digest:

- HTTP `409`.
- Code: `draft_ticket_already_consumed`.
- Message: `Draft ticket has already been used for another submission.`
- Do not create or overwrite a row.

Different opaque token digest for the same draft ID:

- HTTP `422`.
- Code: `invalid_draft_ticket`.
- Do not reveal whether a retained row exists.

## Atomic write strategy

Use prepared statements.

Execute in one D1 batch:

1. `INSERT ... ON CONFLICT(ticket_id) DO NOTHING`.
2. `SELECT` the authoritative stored row by `ticket_id`.

Rules:

- `ticket_id` primary-key uniqueness is authoritative.
- `meta.changes` identifies whether this request inserted.
- The selected row determines the final response.
- No isolate-global mutex.
- No in-memory correctness dependency.
- No unprotected `SELECT`-then-`INSERT`.
- Batch failure rolls back.
- Worker scheduling does not determine correctness.

## Concurrency guarantees

Two identical near-simultaneous requests:

- One returns HTTP `201`.
- One returns HTTP `200`.
- Both bodies are byte-for-byte identical.
- Exactly one row exists.

Two conflicting near-simultaneous requests:

- One request commits and returns HTTP `201`.
- The other reconciles with the stored row.
- Same exact ticket plus different transcript returns HTTP `409`.
- Exactly one row exists.

Commit succeeds but response delivery fails:

- The row remains committed.
- Later exact retry returns HTTP `200` with the stored receipt.

Batch failure:

- Return HTTP `503 submission_unavailable`.
- Roll back.
- Do not consume the ticket.
- Never return success without a committed and reconciled authoritative row.

## Retention

Logical retention:

- Twenty-four hours from `submitted_at_ms`.

Normative arithmetic for implementation:

```text
retain_until_ms = submitted_at_ms + 86_400_000
```

This arithmetic is the direct mathematical expression of the approved
twenty-four-hour retention period and introduces no new policy.

Cleanup eligibility:

```text
retain_until_ms <= current server time in milliseconds
```

After cleanup, an expired ticket cannot create a new submission.

## Cleanup design

Preview private Worker scheduled handler only.

Cron:

```text
17 * * * *
```

Rules:

- UTC.
- Run hourly.
- At most ten deletion batches per invocation.
- At most 500 rows per batch.
- Stop early if fewer than 500 rows are deleted.
- No public cleanup endpoint.
- No production Cron.
- Expected physical retention is approximately twenty-four to twenty-five
  hours under normal scheduling.
- Trigger delays may extend physical retention.
- A growing backlog is a stop condition.

Deletion query design:

```sql
DELETE FROM draft_submissions
WHERE ticket_id IN (
  SELECT ticket_id
  FROM draft_submissions
  WHERE retain_until_ms <= ?
  ORDER BY retain_until_ms
  LIMIT 500
);
```

Cleanup deployment remains separately unauthorized.

## Success and error response contract

First committed submission:

- HTTP `201`.
- Stored receipt body.

Exact retained retry:

- HTTP `200`.
- Exact stored receipt body.

Same exact ticket and different transcript:

- HTTP `409`.
- `draft_ticket_already_consumed`.

Standard error envelope:

```json
{
  "ok": false,
  "verified": false,
  "submitted": false,
  "error": {
    "code": "<stable code>",
    "message": "<sanitized message>"
  }
}
```

Disabled route envelope:

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "API route not found"
  }
}
```

Approved public errors:

- `404 not_found` — API route not found
- `405 method_not_allowed` — Method Not Allowed
- `403 origin_not_allowed` — Request origin is not allowed.
- `415 unsupported_media_type` — Request must use application/json without
  content encoding.
- `413 payload_too_large` — Request body exceeds the allowed size.
- `400 malformed_json` — Request body must contain valid JSON.
- `400 invalid_request_schema` — Request does not match the required schema.
- `422 invalid_draft_ticket` — Draft ticket is invalid or expired.
- `422 draft_ticket_mismatch` — Draft ticket does not match the submitted
  draft.
- `422 unsupported_transcript_version` — Transcript schema version is not
  supported.
- `422 unsupported_app_version` — Application version is not supported.
- `422 unsupported_rng_version` — RNG version is not supported.
- `422 unsupported_rules_version` — Game rules version is not supported.
- `422 unsupported_scoring_version` — Scoring version is not supported.
- `422 unsupported_data_version` — Data version is not supported.
- `422 canonical_data_mismatch` — Canonical game data does not match.
- `422 invalid_seed` — Gameplay seed is invalid.
- `422 invalid_roll_sequence` — Draft roll sequence is invalid.
- `422 invalid_reroll` — Draft reroll sequence is invalid.
- `422 invalid_card` — Draft card is invalid.
- `422 wrong_pool` — Draft card does not belong to the required pool.
- `422 invalid_position` — Draft position assignment is invalid.
- `422 duplicate_card` — Draft contains a duplicate canonical card.
- `422 incomplete_roster` — Draft roster is incomplete.
- `422 unexpected_event_order` — Draft events are not in the required order.
- `409 draft_ticket_already_consumed` — Draft ticket has already been used for
  another submission.
- `429 rate_limited` — Too Many Requests
- `500 scoring_failed` — Authoritative scoring failed.
- `503 submission_unavailable` — Draft submission is temporarily unavailable.

Headers:

- HTTP `405` includes `Allow: POST`.
- HTTP `429` includes `Retry-After: 60`.

Do not expose:

- SQL.
- Table or index names.
- Database names or IDs.
- Signing-key state.
- Ticket presence.
- Retained-row existence.
- Internal exceptions.
- Stack traces.
- Replay internals.
- Infrastructure identifiers.

## Ticket consumption rules

A ticket is consumed only when the unique D1 row commits.

No ticket consumption occurs for failures involving:

- Feature gate.
- Method.
- Origin or host.
- Trusted IP or internal rate key.
- Rate limit.
- Content type or encoding.
- Body-size bounds.
- JSON parsing.
- Duplicate keys.
- Request schema.
- Ticket verification.
- Ticket/transcript binding.
- Version checks.
- Canonical-data checks.
- Replay.
- Roster validation.
- Scoring.
- Schema compatibility.
- D1 availability.
- Rolled-back D1 batch.

## Feature gating

Flag:

`DRAFT_SUBMISSION_MODE`

Only the exact lowercase string `enabled` activates submission.

Missing, malformed, or disabled values fail closed.

Disabled behavior:

- Generic `404` before method inspection.
- No origin processing.
- No IP processing.
- No body read.
- No Service Binding call.
- No D1 access.

D1C.1–D1C.3:

- Pages disabled.
- Private Worker disabled.

Production:

- Pages disabled.
- Private Worker disabled.
- Ticket issuance disabled.
- No production signing secret.
- No production Worker D1 binding.
- No submission migration.
- No submission Cron.
- No runtime writes.
- No leaderboard.

## Trust boundaries

- Browser is untrusted.
- Client scores, results, timestamps, IDs, and digests are never authoritative.
- Pages is a bounded proxy.
- Pages never receives the signing secret.
- Pages does not parse, replay, score, or persist submissions.
- Private Worker verifies tickets and bindings.
- Private Worker performs deterministic replay.
- Private Worker performs authoritative scoring.
- Private Worker owns D1 writes.
- Private Worker has no public route.
- D1 uniqueness resolves races.
- Existing ticket issuance and validation remain storage-free.
- Existing validation remains read-only.
- No public read, list, cleanup, or administrative route.
- Single-use submission does not establish leaderboard eligibility.

## Logging and observability

Allowed completion structure:

```json
{
  "event": "draft_submission",
  "outcome": "idempotency.retry",
  "status": 200,
  "durationBucket": "50-99ms"
}
```

Latency buckets:

- `<25ms`
- `25-49ms`
- `50-99ms`
- `100-249ms`
- `250-499ms`
- `500ms+`

Allowed outcomes may include:

- `submission.created`
- `idempotency.retry`
- `cleanup.completed`
- `cleanup.backlog`
- Other bounded approved internal result categories.

Never log:

- Ticket ID.
- Raw ticket.
- Signature.
- Ticket digest.
- Transcript digest.
- Request body.
- Transcript.
- Roster.
- Player.
- Result.
- Score.
- IP address.
- Rate key.
- Origin.
- Host.
- User agent.
- D1 row.
- SQL.
- Secret state.
- Exception message.
- Stack trace.
- Client identifier.
- Infrastructure identifier.

No Analytics Engine or new analytics binding is approved.

## Version and health behavior

Protocol identifier:

`pennant-draft-submission-v1`

During D1C.1–D1C.3:

- Internal constant may exist.
- `submissionSchemaVersion` remains `null`.
- Health reports submissions disabled.
- `leaderboardVersion` remains `null`.

Disabled health:

- Schema version 1 or 2 may be healthy.

Future separately approved preview activation:

- `submissionSchemaVersion` becomes `pennant-draft-submission-v1`.
- Enabled submission requires D1 reachable at schema version 2.
- Otherwise health reports degraded.

Production remains:

- Submission disabled.
- Writes disabled.
- `submissionSchemaVersion` null.
- `leaderboardVersion` null.

## Explicitly unresolved implementation details

The original approved wording did not name:

- A specific constant-time comparison API.
- A specific helper name for canonical serialization.
- Exact final SQL placeholder text.
- Exact stored-receipt semantic validation helper.
- Exact source-code helper boundaries.
- Exact placement of the signing-secret check relative to retained lookup,
  beyond the retained-order correction and the original rule that a missing
  secret returns `503` even for retained retrieval.

These are implementation details, not permission to change the approved
behavior. Implementations must choose the narrowest secure approach consistent
with the normative contract and must stop rather than change policy.
