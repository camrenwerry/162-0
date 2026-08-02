# Milestone 3D-2B.1 Observation Contracts and Transport Hardening

Milestone 3D-2B is divided into three separately reviewable changes:

1. 3D-2B.1 — Observation Contracts and Transport Hardening
2. 3D-2B.2 — Preview Resource Observation
3. 3D-2B.3 — Capability Projection and Stable Evidence

Only 3D-2B.1 is implemented here. It provides strict data contracts, a pure
request-construction allowlist, bounded response parsing, local credential and
environment guards, request budgets, exact D1 SELECT declarations, legacy
execution barriers, and an offline CLI placeholder. It does not initialize a
Cloudflare client, make a network request, normalize a remote resource, compare
remote state, coordinate a double read, write an evidence file, or grant
execution authority.

## Official documentation review

The following public Cloudflare documentation was reviewed on 2026-08-01. No
authenticated documentation, dashboard, account, project, Worker, zone, or D1
resource was accessed.

- [Make API calls](https://developers.cloudflare.com/fundamentals/api/how-to/make-api-calls/)
  documents RFC Bearer authentication and the stable v4 HTTPS base URL
  `https://api.cloudflare.com/client/v4/`.
- [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
  documents resource-scoped API tokens, Read versus Edit permissions, and the
  requirement to protect the token secret. This milestone does not verify a
  token or infer its scope.
- [List Zones](https://developers.cloudflare.com/api/resources/zones/methods/list/)
  documents `GET /zones`, account filtering, `page` and `per_page`, and the
  `result_info` fields `count`, `page`, `per_page`, `total_count`, and
  `total_pages`.
- [Pages Projects](https://developers.cloudflare.com/api/resources/pages/subresources/projects)
  documents the Pages project and project-deployment paths and the common v4
  `result`, `success`, `errors`, and `messages` response envelope.
- [Pages Deployments](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/)
  documents the project deployment list as a GET operation. The future request
  contract fixes `env=preview`, `page`, and `per_page`; Production deployments
  are never requested as evidence.
- [Workers API](https://developers.cloudflare.com/api/resources/workers/)
  documents the read paths for script settings, deployments, subdomain state,
  schedules, custom domains, routes, and their v4 response conventions.
- [List Worker Domains](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/)
  documents the account-level domain inventory and its `service` filter. The
  future observer must discard unrelated account data and must never promote
  incidental Production metadata to Production evidence.
- [Query D1 Database](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
  documents `POST /accounts/{account_id}/d1/database/{database_id}/query` and a
  single-query JSON body with `sql` and `params`. Although the provider endpoint
  accepts multiple statements, this project permits only three exact canonical
  SELECT statements and always fixes `params` to an empty array.
- [List script secrets](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/)
  does not establish a safe value-free contract. Its examples show names and
  types, but its return schema also permits `text`, `key_base64`, and `key_jwk`.
  That contradiction is not acceptable proof that secret values can never be
  returned. Secret-name/type presence therefore remains `UNAVAILABLE`, and the
  secret endpoint is absent from the operation registry.
- [3xx Redirection](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/3xx-redirection/)
  confirms that clients may follow redirects and that some redirect codes can
  alter or preserve methods. The management API references do not establish a
  redirect target as part of any approved operation. Every 3xx is therefore
  rejected rather than followed.

The Pages project and Worker settings schemas can contain binding or environment
configuration. Nothing in 3D-2B.1 parses those resources into evidence. A later
milestone must define field-specific normalizers that discard unrelated data and
fail closed on undocumented or secret-bearing shapes before an authenticated
call can be authorized.

## Additive observation artifact

The separate artifact contract is:

- kind: `pennant-pursuit-release-inspection-remote-observation`
- schema version: exact integer token `1`
- tool contract: `release-inspection-read-only-observation-v1`

It is not a legacy Preview plan, package, readiness report, execution report, or
approval artifact. The top-level contract always requires:

- `releaseCurrentness: "UNKNOWN"`
- `executionAuthorization: "prohibited"`
- `noRemoteMutation: true`
- `noFilesystemWrites: true`
- `noSecretValues: true`
- `productionContacted: false`

The artifact contains immutable local expectation hashes as local declarations,
not remote evidence. It separately models capture timestamps, request counts,
credential scope, stable-read metadata, pagination completeness, response
completeness, the reviewed route-zone count, Preview resources, all seven capabilities across all four
surfaces, and migration observation. Applied migration rows never inherit local
source hashes: remote applied source hashes remain unavailable because D1's
migration metadata does not prove the applied bytes.

Production has only the exact exclusion record: contact not attempted,
comparison `UNAVAILABLE`, completeness not attempted, reason
`production-remote-inspection-excluded`, and remote evidence excluded. Shared
account or Pages responses may later contain incidental metadata, but that data
must be discarded and cannot populate the Production record.

## Evidence contract

Every future field-level evidence record has the exact keys:

- availability;
- completeness;
- comparison;
- expected and observed;
- reason;
- endpoint family and operation;
- HTTP method;
- read ordinals;
- `capturedAtMs`, with the exact keys `firstRead` and `secondRead`.

Unknown, missing, inherited, accessor-backed, proxy, cyclic, symbolic, BigInt,
and extra data is rejected. `MATCH` requires available, complete, equal expected
and observed values from an allowlisted operation. `DRIFT` requires complete,
unequal values. Partial evidence can only be `UNKNOWN`. Not-attempted evidence
cannot claim an endpoint, method, read ordinal, timestamp, or observed value.
Evidence values use one positive schema: `null`, booleans, finite numbers,
bounded safe strings, or dense arrays recursively containing only those values.
Objects and arbitrary object keys are not evidence values in 3D-2B.1; later
resource milestones must introduce separate field-specific closed schemas
before structured resource values can be retained. Before rejecting an object,
the validator classifies its descriptor keys without reading accessors.
Potentially secret-bearing key concepts or text are rejected before copying or
freezing. Field names are NFKC-normalized, case-folded, and reduced to a
punctuation-free skeleton; the classifier rejects both standalone and compound
forms containing concepts such as `secret`, `token`, `credential`,
`authorization`, `auth`, `value`, `text`, `payload`, `digest`, `preview`,
`content`, `raw`, `body`, `data`, and `key`. Consequently forms such as `access_token`,
`apiToken`, `client_secret`, `auth-token`, `secret_value`, and
`credentialValue` cannot enter a validated artifact. Non-ASCII and mixed-script
names fail closed.

Every completed evidence record uses exact read ordinals `[1, 2]`. Resource and
migration slots are bound to their single reviewed operation, and applicable
capability surfaces are bound to the Pages-project, Worker-settings, or
Worker-schedules provenance required by that surface. Non-applicable surfaces
use one exact value-free, operation-free representation.

All time fields are non-negative JavaScript safe-integer milliseconds. Online
capture metadata uses the exact sequence `captureStartedAtMs`,
`stableRead.firstReadCompletedAtMs`,
`stableRead.secondReadStartedAtMs`,
`stableRead.secondReadCompletedAtMs`, and `captureCompletedAtMs`. The first read
must complete after capture starts, the second read cannot start until at least
2,000 milliseconds after the first read completes, the second read must
complete after it starts, and the capture cannot complete before the second
read. Evidence ordinal `1` is bound to the first-read window and ordinal `2` to
the second-read window; `[1, 2]` therefore requires two explicit evidence
timestamps. `expiresAtMs` is exactly 300,000 milliseconds after the second read
completes, not after the overall capture completes. Online validation requires
an injected exact `{ nowMs }` context, derives `fresh` or `stale` from that
clock, rejects capture times more than 1,000 milliseconds in the future, and
prevents stale evidence from satisfying `MATCH`. Offline timestamps remain
exactly null and require no clock context.

Top-level Preview `MATCH` will be valid only when a future stable double read is
complete, all pagination is complete, first- and second-read request totals
equal the count derived from operation weights, page counts, and reviewed route
zones, and every required observable Preview field matches. Any applicable
drift forces `DRIFT`; unknown, unavailable, partial, missing, or contradictory
applicable evidence prevents `MATCH`. Even then,
release currentness remains `UNKNOWN` and execution authorization remains
prohibited. `MATCH` is never `NO-OP`, never proof that the deployed release is
current, and never permission to deploy or mutate anything.

## Closed Preview operation registry

The pure registry contains only these future operations:

| Operation | Method | Fixed path family | Pagination |
| --- | --- | --- | --- |
| account | GET | `/client/v4/accounts/{accountId}` | none |
| account-zones | GET | `/client/v4/zones` | 25 per page, at most 10 pages |
| pages-project | GET | `/client/v4/accounts/{accountId}/pages/projects/{pagesProject}` | none |
| pages-preview-deployments | GET | Pages project deployments | `env=preview`, 25 per page, at most 10 pages |
| worker-settings | GET | Worker script settings | none |
| worker-deployments | GET | Worker script deployments | none |
| worker-subdomain | GET | Worker script subdomain | none |
| worker-schedules | GET | Worker script schedules | none |
| worker-custom-domains | GET | account Worker domains | exact `service` filter, one complete page |
| worker-routes | GET | one grounded zone's Worker routes | one page per approved zone |
| d1-database | GET | one grounded Preview D1 database | none |
| migration-table-discovery | POST | grounded Preview D1 query | exact SELECT only |
| migration-rows | POST | grounded Preview D1 query | exact SELECT only |
| backend-schema-version | POST | grounded Preview D1 query | exact SELECT only |

Every descriptor fixes its origin, method, path template, exact parameter keys,
pagination policy, 1 MiB response limit, unit request weight, Preview identity
fields, Production-poisoning policy, and GET or exact-SELECT-POST class. The
builder accepts no caller URL, origin, path, query, method, body, SQL, token, or
extension. It also accepts no caller denylist, classifier, environment marker,
Preview-only flag, or Production-boundary override. The reviewed Preview Pages
project, Worker service, and D1 UUID are fixed in the checked-in transport
policy. A separate immutable checked-in Production boundary rejects the known
Production Worker and service target, D1 name and UUID, and rate-limit namespace
IDs in raw, case-varied, NFKC-normalized, percent-encoded, repeatedly encoded,
decoded, nested, inherited, aliased, and substituted forms before a URL is
constructed. Preview-only status is derived by the validated builder, never
accepted as a caller assertion. Preview account and route-zone identities must
still be separately grounded before request construction because the reviewed
configuration records them as unresolved.

No network transport exists in 3D-2B.1. These descriptors are inert data for a
later independently authorized milestone.

## Exact D1 SELECT exception

Only the following canonical strings are registered, always with `params: []`:

```sql
SELECT name FROM sqlite_schema
WHERE type = 'table'
  AND name IN ('backend_schema', 'd1_migrations')
ORDER BY name ASC
```

```sql
SELECT id, name, applied_at
FROM d1_migrations
ORDER BY id ASC
```

```sql
SELECT version
FROM backend_schema
WHERE id = 1
```

Whitespace changes, alternate casing, comments, semicolons, additional
statements, identifier substitutions, parameters, mutation keywords, pragmas,
transactions, and caller-supplied SQL are rejected. The POST exception is a
future request contract only; 3D-2B.1 never contacts D1.

## Parser and budgets

The strict response parser accepts bytes only and rejects a UTF-8 BOM, malformed
UTF-8, duplicate keys, dangerous keys, malformed JSON, trailing content,
unsupported top-level envelopes, more than 1 MiB, nesting beyond 48 levels, and
more than 50,000 structural values. Errors report only bounded categories and
never include a raw response body.

The immutable budget contract is:

- 32 reviewed route zones;
- 64 requests per full read and 128 per double-read capture;
- 10 pages and 250 records per family;
- 1 MiB per response and 1 MiB per serialized artifact;
- 10 seconds per request, 120 seconds per full read, and 300 seconds per double read;
- one concurrent request, zero automatic retries, and rejection of every 3xx;
- 2 seconds between stable reads, a 5-minute freshness window, and at most 1
  second of injected-clock future skew.

3D-2B.1 implements pure accounting and validation, not timers or a double-read
coordinator.

## Credential separation

Future online validation accepts only the dedicated environment variable
`PENNANT_PREVIEW_API_TOKEN`. It rejects generic Cloudflare credentials, Wrangler
OAuth, Preview deploy credentials, Production credentials, and runtime account
identity overrides. No token argument, JSON token, config token, arbitrary
option, alias, or generic fallback is accepted. The complete own and inherited
descriptor graph is inspected without invoking accessors. The environment must
be a non-proxy ordinary object with exactly one own data property named
`PENNANT_PREVIEW_API_TOKEN`; normalized equivalents, duplicates, symbols,
accessors, hostile prototypes, and inherited credential or identity variables
fail closed. Validation returns only the credential
name, availability, and `unverified` scope; it never returns, serializes, hashes,
logs, echoes, snapshots, or embeds token contents.

Offline mode does not read the environment. Credential validation is pure and
does not initialize transport. Scope remains `unverified`; no token-verification
or permission-metadata endpoint is called.

Before identity or parameter scanning, credential scanning, evidence scanning,
legacy execution filtering, rendering, or CLI dependency initialization, one
shared fail-closed integrity boundary compares the protected intrinsic graph
with its trusted startup snapshot.

The protected global binding inventory is exact: `Array`, `Boolean`, `Date`,
`Error`, `Function`, `JSON`, `Map`, `Math`, `Number`, `Object`, `Reflect`,
`RegExp`, `Set`, `String`, `Symbol`, `TextDecoder`, `TypeError`, `Uint8Array`,
`URL`, `URLSearchParams`, `WeakSet`, `decodeURIComponent`, and
`encodeURIComponent`. Their constructor, prototype, static-helper, prototype-
helper, accessor, symbol, and prototype-chain records are rooted in the trusted
graph. Array, String, Set, and Map iterator prototypes are also explicit roots,
so changing `Symbol.iterator` or an iterator `next` implementation is covered.
The graph includes the String normalization and comparison helpers, Number
integer/finite predicates, Set/Map/WeakSet methods, RegExp behavior, JSON
parsing/stringification, URL and query construction, TextDecoder, time helpers,
and every Array, Object, Reflect, and Function helper used by protected paths.

Every protected target is compared by captured `Reflect` and `Object` functions
using index-based loops. The check verifies own string and symbol key
inventories, data-versus-accessor kind, function/data/getter/setter identities,
enumerable/configurable/writable flags, and prototype linkage without invoking
the inspected getters, setters, proxies, coercion hooks, or iterators. Added or
removed fields, global-constructor replacement, revoked proxies, exotic values,
descriptor failures, and graph traversal beyond 4,096 targets or 65,536 own
keys fail with one bounded generic error. Node/runtime helpers that are not
safely represented only by the protected global graph are captured once at
module initialization: `util.types.isProxy`, `path.join`, the required `Buffer`
allocation, conversion, and byte-length functions, `Stats.prototype.isFile`,
`TextDecoder.prototype.decode`, and the SHA-256 hash object's `update` and
`digest` methods. Hashing, strict UTF-8 decoding, and regular-file checks call
those captured functions with captured `Reflect.apply`; the BOM check is an
index loop rather than a mutable Buffer prototype call. Protected paths
therefore do not dynamically read those mutable module-object or Node prototype
properties. The Node `Buffer` constructor is also a separately imported graph
root because Node filesystem internals can consult its statics; replacing any
Buffer static, prototype field, descriptor, or linkage fails before protected
work, while protected code never rereads the accessor-backed global binding.

Remote-artifact validation and remote-transport descriptor construction each
use a module-private synchronous integrity context. The complete check is the
first operation of every exported contract or transport function, while nested
calls in the same module reuse that proof only until the outer public call
returns. The observer argument parser and CLI establish the same complete check
directly; the human renderer first delegates to the wrapped artifact validator
before reading fields. No caller can acquire an integrity context, and no caller
getter, proxy trap, callback, clock, environment, renderer, filesystem, network,
or subprocess hook runs within one before the inputs have been proved
descriptor-only. Separate public calls therefore perform a fresh complete check.

Isolated child-process tests enumerate the exact exported-function inventories
of `remote-contracts.mjs`, `remote-transport.mjs`, and
`release-inspection-observe.mjs`. Every exported function is invoked directly
under mutations distributed across every inventoried binding and helper; the
harness records caller-input reads and replacement-function, getter, or setter
calls and requires both counters to remain zero. It replaces helpers with
functions, getters, setters, injected data, proxies, revoked proxies, exotic
objects, changed flags, removed properties, nested symbol fields, and altered
prototype links. Each descriptor is restored in a `finally` block, valid public
calls are repeated, and the clean integrity check is rerun before the child
exits. Dedicated direct regressions cover `createUnavailableRemoteEvidence()`
under `Set.prototype.has` replacement and `createRequestBudget()` under
`Object.getPrototypeOf` replacement, in addition to the former String
normalization, Number safe-integer, Production identity, fractional-timestamp,
CLI-token, and legacy-marker bypasses.

## Offline CLI

The safe skeleton is:

```text
node scripts/release-inspection-observe.mjs [--offline] [--json] [--no-color]
```

Offline is the default. It emits either a deterministic human summary or a
canonical JSON placeholder to stdout. Preview contact is not attempted and its
comparison is `UNAVAILABLE`; Production remains excluded and `UNAVAILABLE`;
currentness is `UNKNOWN`; authorization is prohibited. Success leaves stderr
empty. Both output modes validate and deeply freeze the created artifact through
the same canonical validator before rendering; human output uses only validated
closed-vocabulary fields and fixed labels.

`--online-preview` is recognized only to refuse explicitly before any credential,
transport, clock, filesystem, network, subprocess, or time-sensitive capture
initialization. The CLI has no target, output-file, approval, package, evidence,
plan, execution, deploy, migration, or remote-Git option.

## Legacy barrier and remaining work

Legacy plan, package, report, readiness, and executor entry points reject the new
artifact kind, tool contract, distinctive fields, fragments, mixed-case and
Unicode-normalized variants, nested copies, inherited markers, accessors,
proxies, cycles, symbols, BigInt, traversal exhaustion, and forged legacy
wrappers before sensitive inputs or execution dependencies can be read. Valid
legacy disabled-only plan and package behavior remains unchanged.

3D-2B.2 Preview Resource Observation and 3D-2B.3 Capability Projection and Stable
Evidence remain unimplemented. An authenticated Preview call requires separate
explicit authorization after independent review of this unstaged milestone and
separate grounding of the exact Preview-only identities. Production remote
inspection remains excluded.

The public local aggregate `npm run test:release-observation` runs the runtime
observation boundary and its compile-time declaration contract. It is reachable
from routine, release, and CI validation through the existing credential-free
command graph. Declaration files are included in text-integrity scanning and in
the type-check coordinator.
