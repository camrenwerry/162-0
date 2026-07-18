-- The invalid json() branch is an intentional SQL error that aborts before DDL.
SELECT CASE
  WHEN (SELECT COUNT(*) FROM backend_schema) = 1
    AND (SELECT COUNT(*) FROM backend_schema WHERE id = 1 AND version = 1) = 1
  THEN 1
  ELSE json('backend_schema predecessor must be exactly version 1')
END;

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
    CHECK (
      typeof(submitted_at_ms) = 'integer'
      AND submitted_at_ms >= 0
    ),

  retain_until_ms INTEGER NOT NULL
    CHECK (
      typeof(retain_until_ms) = 'integer'
      AND retain_until_ms > submitted_at_ms
    ),

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

UPDATE backend_schema
SET version = 2
WHERE id = 1 AND version = 1;
