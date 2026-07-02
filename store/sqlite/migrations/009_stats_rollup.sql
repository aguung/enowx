-- Aggregated statistics, kept separate from the detailed request_logs so that
-- "clear logs" (which wipes request_logs) never erases stats. Incremented on
-- every request; never decremented. Granularity: hour + provider + model +
-- status reconstructs summary, hourly/daily series, top models, ok/errors.
CREATE TABLE IF NOT EXISTS stats_rollup (
    hour        TEXT NOT NULL,          -- 'YYYY-MM-DD HH:00' (local, matches Series bucket)
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    status      TEXT NOT NULL,
    requests    INTEGER NOT NULL DEFAULT 0,
    in_tokens   INTEGER NOT NULL DEFAULT 0,
    out_tokens  INTEGER NOT NULL DEFAULT 0,
    latency_sum INTEGER NOT NULL DEFAULT 0,  -- sum(latency_ms); AVG = latency_sum/requests
    PRIMARY KEY (hour, provider, model, status)
);

-- Backfill from existing detailed logs so current stats aren't lost.
INSERT INTO stats_rollup (hour, provider, model, status, requests, in_tokens, out_tokens, latency_sum)
SELECT strftime('%Y-%m-%d %H:00', created_at), provider, model, status,
       COUNT(*), COALESCE(SUM(in_tokens),0), COALESCE(SUM(out_tokens),0), COALESCE(SUM(latency_ms),0)
FROM request_logs
GROUP BY 1, 2, 3, 4
ON CONFLICT(hour, provider, model, status) DO NOTHING;
