CREATE TABLE IF NOT EXISTS api_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL DEFAULT '',
    secret     TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used  TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_secret ON api_keys(secret);
