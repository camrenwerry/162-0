-- Abort before DDL unless the database is exactly at the reviewed predecessor.
SELECT CASE
  WHEN (SELECT COUNT(*) FROM backend_schema) = 1
    AND (SELECT COUNT(*) FROM backend_schema WHERE id = 1 AND version = 2) = 1
  THEN 1
  ELSE json('backend_schema predecessor must be exactly version 2')
END;

CREATE TABLE leaderboard_players (
  player_id INTEGER PRIMARY KEY,

  identity_key_digest TEXT NOT NULL UNIQUE
    CHECK (
      length(identity_key_digest) = 64
      AND identity_key_digest NOT GLOB '*[^0-9a-f]*'
    ),

  public_label TEXT NOT NULL
    CHECK (
      length(public_label) BETWEEN 1 AND 32
      AND public_label = trim(public_label)
      AND instr(public_label, char(0)) = 0
      AND instr(public_label, char(9)) = 0
      AND instr(public_label, char(10)) = 0
      AND instr(public_label, char(13)) = 0
      AND instr(public_label, char(127)) = 0
    ),

  status TEXT NOT NULL
    CHECK (status IN ('active', 'disabled')),

  created_at_ms INTEGER NOT NULL
    CHECK (
      typeof(created_at_ms) = 'integer'
      AND created_at_ms >= 0
    )
);

CREATE TABLE leaderboard_runs (
  run_id INTEGER PRIMARY KEY,

  source_ticket_id TEXT NOT NULL UNIQUE
    CHECK (length(source_ticket_id) = 36),

  player_id INTEGER
    REFERENCES leaderboard_players(player_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  game_mode TEXT NOT NULL
    CHECK (game_mode IN ('classic', 'hard')),

  environment TEXT NOT NULL
    CHECK (environment IN ('preview', 'production', 'test')),

  is_smoke INTEGER NOT NULL
    CHECK (is_smoke IN (0, 1)),

  submitted_at_ms INTEGER NOT NULL
    CHECK (
      typeof(submitted_at_ms) = 'integer'
      AND submitted_at_ms >= 0
    ),

  verified_wins INTEGER NOT NULL
    CHECK (
      typeof(verified_wins) = 'integer'
      AND verified_wins BETWEEN 0 AND 162
    ),

  verified_overall_score_tenths INTEGER NOT NULL
    CHECK (
      typeof(verified_overall_score_tenths) = 'integer'
      AND verified_overall_score_tenths BETWEEN 0 AND 1000
    ),

  tier_label TEXT NOT NULL
    CHECK (
      length(tier_label) BETWEEN 1 AND 64
      AND tier_label = trim(tier_label)
    ),

  eligibility_status TEXT NOT NULL
    CHECK (
      eligibility_status IN (
        'eligible',
        'identity_pending',
        'excluded_test',
        'invalidated',
        'moderated'
      )
    ),

  eligibility_reason TEXT NOT NULL
    CHECK (
      eligibility_reason IN (
        'eligible',
        'identity_unavailable',
        'test_or_smoke_data',
        'invalidated',
        'moderated'
      )
    ),

  invalidated_at_ms INTEGER
    CHECK (
      invalidated_at_ms IS NULL
      OR (
        typeof(invalidated_at_ms) = 'integer'
        AND invalidated_at_ms >= submitted_at_ms
      )
    ),

  CHECK (
    (
      eligibility_status = 'eligible'
      AND eligibility_reason = 'eligible'
      AND player_id IS NOT NULL
      AND environment != 'test'
      AND is_smoke = 0
      AND invalidated_at_ms IS NULL
    )
    OR (
      eligibility_status = 'identity_pending'
      AND eligibility_reason = 'identity_unavailable'
      AND player_id IS NULL
      AND environment != 'test'
      AND is_smoke = 0
      AND invalidated_at_ms IS NULL
    )
    OR (
      eligibility_status = 'excluded_test'
      AND eligibility_reason = 'test_or_smoke_data'
      AND (environment = 'test' OR is_smoke = 1)
      AND invalidated_at_ms IS NULL
    )
    OR (
      eligibility_status = 'invalidated'
      AND eligibility_reason = 'invalidated'
      AND invalidated_at_ms IS NOT NULL
    )
    OR (
      eligibility_status = 'moderated'
      AND eligibility_reason = 'moderated'
      AND invalidated_at_ms IS NOT NULL
    )
  )
);

CREATE INDEX idx_leaderboard_runs_best
ON leaderboard_runs (
  environment,
  game_mode,
  eligibility_status,
  is_smoke,
  submitted_at_ms,
  player_id,
  verified_wins DESC,
  verified_overall_score_tenths DESC,
  run_id
);

CREATE INDEX idx_leaderboard_runs_player_history
ON leaderboard_runs (
  player_id,
  submitted_at_ms DESC,
  run_id DESC
);

UPDATE backend_schema
SET version = 3
WHERE id = 1 AND version = 2;
