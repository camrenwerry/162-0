# Milestone 3B leaderboard UX foundation

Date: 2026-07-30

## Independent product direction

Pennant Pursuit's leaderboard experience extends its existing modern ballpark
identity. The visual language is a premium live-scoreboard surface: deep
charcoal glass, cool stadium light, restrained pennant-gold accents, crisp
typography, and compact baseball score details. The completed roster and
projected season remain the emotional hero; competition supplies context and a
reason to draft again.

This direction is independently developed. It does not use “162-0” as product
branding, competitor wording or instructions, vintage general-manager cards,
cream/navy/red treatment, player cards, competitor mode names, achievements,
Head-to-Head language, Daily Challenge structure, or competitor sharing
presentation. “162–0” remains only a possible perfect-season result.

Public rows show rank, display name, projected wins, overall score, time
context, and mode. They do not reveal another player's roster. The strongest
personal story point appears first, while Play Again remains the obvious
primary action after a result.

## Experience decisions

- Home keeps Play Classic as the sole primary action and adds a prominent,
  secondary Leaderboards route.
- Results reveal the projected season before qualification or placement.
  First-time qualification then moves through achievement, display-name claim,
  a clearly labeled recovery-code demonstration, and local-name confirmation.
- Returning players skip identity setup and receive at most two priority story
  points, selected from personal best, rank movement, Top 10 proximity, and
  distance from 162–0.
- Daily, Weekly, and All-Time are the only leaderboard controls. A highlighted
  personal row is anchored only when the player falls outside the visible
  leaders, preventing duplicate rows.
- Loading, empty, recoverable error, offline, disabled, and no-personal-result
  states use the same calm scoreboard shell and always provide one clear way
  forward.

## Safe implementation boundary

The checked-in runtime remains production-disabled. The client does not call a
leaderboard, submission, or identity endpoint in this milestone. A typed,
deterministic in-memory provider supplies development-only fixtures for browser
and automated validation. Fixture selection is accepted only by a development
build; production builds resolve to an honest disabled state with no fallback
to mock or live data.

The local claim demonstration reuses the Milestone 3A display-name validation
contract. It stores only the validated display name and schema version after
explicit acknowledgement of the recovery-code demonstration. The result and
recovery code are not stored. Recovery material is isolated from public rows,
never placed in URLs, and never logged.

## Deferred activation

Remote migration, public reads, submissions, identity mutations, roster
sharing, authentication expansion, and release configuration changes require a
separate reviewed milestone and are not part of this implementation.
