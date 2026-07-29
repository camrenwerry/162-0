-- Abort before DDL unless the database is exactly at the reviewed predecessor.
SELECT CASE
  WHEN (SELECT COUNT(*) FROM backend_schema) = 1
    AND (SELECT COUNT(*) FROM backend_schema WHERE id = 1 AND version = 3) = 1
  THEN 1
  ELSE json('backend_schema predecessor must be exactly version 3')
END;

-- Version 3 deliberately left identity authentication unresolved. These
-- nullable columns preserve any local version-3 fixtures while ensuring that
-- only fully claimed version-4 identities can participate in public reads.
ALTER TABLE leaderboard_players
ADD COLUMN public_name_key TEXT
  CHECK (
    public_name_key IS NULL
    OR (
      length(public_name_key) BETWEEN 3 AND 80
      AND public_name_key = trim(public_name_key)
    )
  );

ALTER TABLE leaderboard_players
ADD COLUMN device_credential_digest TEXT
  CHECK (
    device_credential_digest IS NULL
    OR (
      length(device_credential_digest) = 64
      AND device_credential_digest NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE leaderboard_players
ADD COLUMN recovery_code_digest TEXT
  CHECK (
    recovery_code_digest IS NULL
    OR (
      length(recovery_code_digest) = 64
      AND recovery_code_digest NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE leaderboard_players
ADD COLUMN recovery_version INTEGER NOT NULL DEFAULT 0
  CHECK (
    typeof(recovery_version) = 'integer'
    AND recovery_version >= 0
  );

ALTER TABLE leaderboard_players
ADD COLUMN last_renamed_at_ms INTEGER
  CHECK (
    last_renamed_at_ms IS NULL
    OR (
      typeof(last_renamed_at_ms) = 'integer'
      AND last_renamed_at_ms >= created_at_ms
    )
  );

ALTER TABLE leaderboard_players
ADD COLUMN credential_rotated_at_ms INTEGER
  CHECK (
    credential_rotated_at_ms IS NULL
    OR (
      typeof(credential_rotated_at_ms) = 'integer'
      AND credential_rotated_at_ms >= created_at_ms
    )
  );

ALTER TABLE leaderboard_players
ADD COLUMN identity_updated_at_ms INTEGER
  CHECK (
    identity_updated_at_ms IS NULL
    OR (
      typeof(identity_updated_at_ms) = 'integer'
      AND identity_updated_at_ms >= created_at_ms
    )
  );

ALTER TABLE leaderboard_players
ADD COLUMN identity_state TEXT NOT NULL DEFAULT 'inactive'
  CHECK (
    identity_state IN ('inactive', 'active', 'moderated', 'invalidated')
    AND (
      (
        identity_state = 'inactive'
        AND
        public_name_key IS NULL
        AND device_credential_digest IS NULL
        AND recovery_code_digest IS NULL
        AND recovery_version = 0
        AND credential_rotated_at_ms IS NULL
        AND identity_updated_at_ms IS NULL
      )
      OR (
        identity_state IN ('active', 'moderated', 'invalidated')
        AND
        public_name_key IS NOT NULL
        AND device_credential_digest IS NOT NULL
        AND recovery_code_digest IS NOT NULL
        AND recovery_version >= 1
        AND credential_rotated_at_ms IS NOT NULL
        AND identity_updated_at_ms IS NOT NULL
      )
    )
  );

CREATE UNIQUE INDEX idx_leaderboard_players_public_name_key
ON leaderboard_players(public_name_key)
WHERE public_name_key IS NOT NULL;

CREATE UNIQUE INDEX idx_leaderboard_players_device_credential
ON leaderboard_players(device_credential_digest)
WHERE device_credential_digest IS NOT NULL;

CREATE UNIQUE INDEX idx_leaderboard_players_recovery_code
ON leaderboard_players(recovery_code_digest)
WHERE recovery_code_digest IS NOT NULL;

CREATE TABLE leaderboard_identity_claims (
  claim_id INTEGER PRIMARY KEY,

  run_id INTEGER NOT NULL UNIQUE
    REFERENCES leaderboard_runs(run_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  claim_token_digest TEXT NOT NULL UNIQUE
    CHECK (
      length(claim_token_digest) = 64
      AND claim_token_digest NOT GLOB '*[^0-9a-f]*'
    ),

  created_at_ms INTEGER NOT NULL
    CHECK (
      typeof(created_at_ms) = 'integer'
      AND created_at_ms >= 0
    ),

  expires_at_ms INTEGER NOT NULL
    CHECK (
      typeof(expires_at_ms) = 'integer'
      AND expires_at_ms > created_at_ms
    ),

  used_at_ms INTEGER
    CHECK (
      used_at_ms IS NULL
      OR (
        typeof(used_at_ms) = 'integer'
        AND used_at_ms >= created_at_ms
        AND used_at_ms < expires_at_ms
      )
    ),

  claimed_player_id INTEGER
    REFERENCES leaderboard_players(player_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  claimed_name_key TEXT,

  CHECK (
    (
      used_at_ms IS NULL
      AND claimed_player_id IS NULL
      AND claimed_name_key IS NULL
    )
    OR (
      used_at_ms IS NOT NULL
      AND claimed_player_id IS NOT NULL
      AND claimed_name_key IS NOT NULL
    )
  )
);

CREATE INDEX idx_leaderboard_identity_claims_expiry
ON leaderboard_identity_claims(expires_at_ms, claim_id);

CREATE TABLE leaderboard_recovery_operations (
  operation_digest TEXT PRIMARY KEY NOT NULL
    CHECK (
      length(operation_digest) = 64
      AND operation_digest NOT GLOB '*[^0-9a-f]*'
    ),

  request_binding_digest TEXT NOT NULL
    CHECK (
      length(request_binding_digest) = 64
      AND request_binding_digest NOT GLOB '*[^0-9a-f]*'
    ),

  player_id INTEGER NOT NULL
    REFERENCES leaderboard_players(player_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  source_recovery_version INTEGER NOT NULL
    CHECK (
      typeof(source_recovery_version) = 'integer'
      AND source_recovery_version >= 1
    ),

  replacement_recovery_version INTEGER NOT NULL
    CHECK (
      typeof(replacement_recovery_version) = 'integer'
      AND replacement_recovery_version = source_recovery_version + 1
    ),

  replacement_device_digest TEXT NOT NULL UNIQUE
    CHECK (
      length(replacement_device_digest) = 64
      AND replacement_device_digest NOT GLOB '*[^0-9a-f]*'
    ),

  replacement_recovery_digest TEXT NOT NULL UNIQUE
    CHECK (
      length(replacement_recovery_digest) = 64
      AND replacement_recovery_digest NOT GLOB '*[^0-9a-f]*'
    ),

  derivation_version INTEGER NOT NULL
    CHECK (
      typeof(derivation_version) = 'integer'
      AND derivation_version = 1
    ),

  created_at_ms INTEGER NOT NULL
    CHECK (
      typeof(created_at_ms) = 'integer'
      AND created_at_ms >= 0
    ),

  expires_at_ms INTEGER NOT NULL
    CHECK (
      typeof(expires_at_ms) = 'integer'
      AND expires_at_ms > created_at_ms
    ),

  UNIQUE(player_id, source_recovery_version)
);

CREATE INDEX idx_leaderboard_recovery_operations_expiry
ON leaderboard_recovery_operations(expires_at_ms, operation_digest);

CREATE TABLE leaderboard_identity_events (
  event_id INTEGER PRIMARY KEY,

  event_key TEXT NOT NULL UNIQUE
    CHECK (length(event_key) BETWEEN 3 AND 160),

  player_id INTEGER NOT NULL
    REFERENCES leaderboard_players(player_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  event_type TEXT NOT NULL
    CHECK (
      event_type IN (
        'claimed',
        'recovered',
        'renamed',
        'recovery_rotated',
        'moderated',
        'invalidated'
      )
    ),

  occurred_at_ms INTEGER NOT NULL
    CHECK (
      typeof(occurred_at_ms) = 'integer'
      AND occurred_at_ms >= 0
    )
);

CREATE INDEX idx_leaderboard_identity_events_player
ON leaderboard_identity_events(player_id, occurred_at_ms DESC, event_id DESC);

CREATE INDEX idx_leaderboard_runs_qualification
ON leaderboard_runs (
  environment,
  game_mode,
  eligibility_status,
  is_smoke,
  player_id,
  submitted_at_ms,
  verified_wins DESC,
  verified_overall_score_tenths DESC,
  run_id
);

UPDATE backend_schema
SET version = 4
WHERE id = 1 AND version = 3;
