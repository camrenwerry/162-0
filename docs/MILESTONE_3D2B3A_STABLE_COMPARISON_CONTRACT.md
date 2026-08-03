# Milestone 3D-2B.3a stable comparison contract

Milestone 3D-2B.3a adds a pure contract for comparing two opaque, validated
Preview single-read snapshots. Read-one versus read-two stability is a separate
axis from local-versus-remote agreement. It does not populate or change the
3D-2B.1 `MATCH`/`DRIFT` artifact.

The comparison accepts only snapshot identities issued by the 3D-2B.2
validation authority. It checks both identities before reading either snapshot.
Structural objects, clones, serialization round trips, proxies, inherited or
accessor-bearing objects, copied properties or symbols, and identities from a
foreign authority fail closed. Candidate capability projections are derived
internally through the approved 3D-2B.2 projection authority.

## Closed meanings

- `MATCH` means only that two normalized Preview reads are semantically equal.
- `DRIFT` means that two complete Preview reads differ semantically.
- `UNKNOWN` means stability is unproven because required evidence is absent,
  missing, unavailable, partial, malformed, contradictory, or otherwise
  unknown.

For applicable capability surfaces, two enabled states match, two disabled
states match, a known state change drifts, and an unknown state in either read
is unknown. Non-applicable surfaces remain explicitly non-applicable and do not
participate in aggregation. Overall `UNKNOWN` precedes `DRIFT`, which precedes
`MATCH`; incomplete or failed evidence can never become a match.

Every result permanently retains `releaseCurrentness: "UNKNOWN"`,
`executionAuthorization: "prohibited"`, `noRemoteMutation: true`, and
`productionContacted: false`. A stable match does not mean current, ready,
approved, fresh, no-op, recommended, or permitted to execute.

## TypeScript and runtime authority boundary

Runtime validation and private object identity are the authority boundary.
TypeScript declarations provide developer guidance: declaration-private nominal
types reject hand-authored structural values, ordinary concrete spreads, and
nested concrete spreads. They do not claim that TypeScript can reject explicit
assertions, `any`, casts through `unknown`, or deliberately created intersection
types. TypeScript defines an intersection such as `T & Extra` to be a subtype of
`T`; assignability therefore is not proof of provenance or authorization.

These compile-time escape mechanisms create no runtime authority. A widened
clone has a different identity and is rejected before property reads when used
where an opaque validated snapshot is required. An assertion applied to the
original value is erased and registers no new identity. Authorized runtime
outputs remain closed and deeply frozen, so an extra field on a clone cannot
alter the original or enter serialized comparison output. Consumers must never
infer currentness, execution permission, or provenance from TypeScript
assignability.

## Semantic projections and exclusions

The comparison retains only normalized fields that determine meaningful
resource stability. Inventories are canonically ordered; semantic sets are
also deduplicated. Pages project stability includes the approved Preview
identity, compatibility date and flags, protected variables, approved bindings,
and reviewed Wrangler build-input hash. Deployment projections retain approved
identities, Preview environment and branch, commit, stage, creation time, HTTPS
origin, aliases, active version identities, and traffic allocations. Worker
settings, URL booleans, schedules, domains, routes, D1 identity, discovered
migration tables, ordered migration rows, and the backend schema singleton use
their approved normalized semantic fields.

The following fields are deliberately excluded because they do not change the
effective normalized resource state:

- snapshot and resource capture timestamps;
- request start or completion times and scheduler timing;
- provider pagination boundaries and provider array ordering after complete
  normalization;
- API envelopes, request IDs, trace IDs, raw response data, and provider
  messages;
- credentials, secret values, and the unavailable Worker secret-presence
  marker;
- custom-domain certificate identity, because certificate rotation does not
  change attachment;
- the local-only pending migration suffix; and
- unavailable applied-migration source hashes.

Fields already discarded by the 3D-2B.2 normalizers cannot enter the projection.
No field that changes the effective normalized resource state is silently
excluded.

The focused regression suite mutates every independently variable retained
field. The following closed tuples cannot be varied field-by-field because the
3D-2B.2 precursor contract rejects any other complete form; their rejection is
tested directly:

| Resource family | Inseparable closed tuple |
| --- | --- |
| Account | `owned: true` |
| Pages project | approved Preview project identity |
| Pages deployments | Preview environment and `develop` target branch |
| Pages and Worker identity-bearing bindings | binding category, approved name, and approved target identity |
| Worker routes | approved Worker script identity |
| D1 database | approved Preview database identity and name |
| Backend schema | backend schema singleton identity |

Plain-text binding names and values are not classified as inseparable tuples.
The projection retains each field independently, and the focused suite changes
each field independently for Pages and Worker bindings. Provider inventory
permutations remain order-insensitive after canonical sorting.

## Deferred and excluded work

3D-2B.3a is deterministic and performs no network, filesystem, credential,
transport, clock, deployment, migration, planning, packaging, reporting,
rollback, or mutation work. Implementation and review use fixtures only; no
authenticated Preview observation occurs, and Production observation remains
excluded.

Double-read execution, the required delay, clocks, and request accounting are
deferred to 3D-2B.3b. Freshness, expiration, and construction of the final
stable artifact are deferred to 3D-2B.3c.
