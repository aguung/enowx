-- Model combos: an ordered list of provider-prefixed model ids a request can
-- fail over (or round-robin) across, addressed by one virtual model name.
CREATE TABLE IF NOT EXISTS model_combos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    targets    TEXT NOT NULL,                   -- JSON array, ordered
    strategy   SMALLINT NOT NULL DEFAULT 0,      -- 0 = failover, 1 = round_robin
    last_index INTEGER NOT NULL DEFAULT 0,       -- round-robin cursor, persisted (never in memory)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
