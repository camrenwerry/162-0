CREATE TABLE backend_schema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 1)
);

INSERT INTO backend_schema (id, version) VALUES (1, 1);
