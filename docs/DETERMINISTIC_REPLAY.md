# Deterministic replay foundation

This phase makes a local Pennant Pursuit draft reproducible and internally
validatable. It does not add a leaderboard, networking, persistence, player
identity, or server authority.

## Gameplay RNG: `seeded-v1`

`seeded-v1` uses xoshiro128** with four unsigned 32-bit state words. A seed has
exactly this form:

```text
seeded-v1:<32 lowercase hexadecimal characters>
```

The payload is 16 bytes in written order. Each consecutive four-byte group is
read as one big-endian state word. The all-zero payload is invalid because it
is an absorbing xoshiro state.

For each output, xoshiro128** computes `rotl(s1 * 5, 7) * 9` with unsigned
32-bit overflow, applies the reference xor/shift/rotate state transition, and
divides the emitted unsigned word by `2^32`. Each call therefore consumes one
word and returns a number in `[0, 1)`.

Fresh local seeds and UUIDv4 draft IDs use `crypto.getRandomValues`. The PRNG
is intended only for deterministic replay; xoshiro128** and the transcript are
not cryptographic security mechanisms.

## Gameplay draw order

Candidate filtering is deterministic and happens before any draw. A successful
roll consumes gameplay RNG in this order:

- `both`: one draw chooses uniformly among eligible franchises, then one draw
  chooses uniformly among that franchise's eligible combinations.
- `team`: one draw chooses among filtered combinations that preserve the
  current decade.
- `era`: one draw chooses among filtered combinations that preserve the
  current franchise.
- A failed roll consumes no draws.
- A successful choice from a one-item list still consumes a draw.

Canonical combination order and the resulting insertion order of franchise
groups are part of this contract. Picks, position assignments, browsing,
filtering, sorting, and scoring consume no gameplay RNG. A restart creates a
new seed and a new stream.

Animation cycling uses a separate cosmetic random source. Temporary team and
decade labels never advance gameplay RNG, so reduced-motion settings, timer
duration, frame rate, canceled cosmetic frames, and device performance cannot
change a landed combination.

## Transcript: `draft-transcript-v1`

The transcript header contains:

- `transcriptSchemaVersion` (`draft-transcript-v1`)
- `appVersion`
- `gameRulesVersion`
- `rngVersion`
- `scoringVersion`
- `dataVersion`
- `canonicalDataDigest`
- `draftId`
- `gameplaySeed`
- `createdAt`

Its ordered event union is:

- `initial-roll`: `type`, `round`, `combinationId`
- `reroll`: `type`, `reroll` (`team` or `era`), `round`,
  `discardedCombinationId`, `resultingCombinationId`
- `pick`: `type`, `round`, `pickOrder`, `combinationId`, `canonicalCardId`,
  `sourcePlayerId`, `assignedPosition`, `featuredSeason`

An initial-roll event is retained even when a later reroll discards its landed
combination. A reroll records both the discarded and replacement combinations.
A pick is appended only when its roster assignment commits.

Headers, events, and event arrays are frozen. Appending creates a new frozen
transcript rather than mutating prior events. The active transcript exists only
in engine memory, is excluded from the UI snapshot, and is not written to
localStorage, IndexedDB, a server, or any submission queue. It records canonical
identifiers and choices, not authoritative scores or copied card statistics.

## Replay validation

Replay uses the transcript seed, canonical game data, and supported version
metadata to reconstruct the draft. Validation rejects:

- unsupported transcript, RNG, app, rules, scoring, or data versions, and a
  mismatched canonical data digest;
- malformed or reordered events, incorrect round or pick order, and missing or
  extra rounds;
- a landed combination that differs from the seeded result, is impossible for
  the current roster, or reuses a prior combination;
- an incorrect reroll discard/replacement, an invalid reroll transition, or
  more than one team or one era reroll;
- a card outside the active franchise-decade pool, altered canonical card
  metadata, or a duplicate canonical card ID;
- an ineligible assigned position or an assignment that cannot resolve to an
  open roster slot; and
- any transcript that does not end with the complete canonical 14-player
  roster.

Duplicate real people are intentionally allowed when their canonical card IDs
differ. Replay returns the validated canonical roster and does not calculate or
trust a submitted score.

## Trust boundary

This phase proves that a transcript is self-consistent for its declared seed,
actions, versions, and canonical data. The seed and transcript are still
created on the client. There is no server-issued ticket, signature, identity,
attestation, or submission protocol, so replay alone does not prove that an
untrusted client played the draft once without choosing a seed or rewriting a
transcript and recomputing it. Authenticity is a later server phase.
