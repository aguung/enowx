CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    provider   TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    secret     TEXT NOT NULL DEFAULT '',
    creds      TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider, status);

CREATE TABLE IF NOT EXISTS request_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    provider   TEXT NOT NULL,
    model      TEXT NOT NULL,
    status     TEXT NOT NULL,
    in_tokens  INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON request_logs(created_at DESC);
