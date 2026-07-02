-- Named sets of content filters. Save the current filters under a name, then
-- load a template later to replace the active set (like enowx-ai templates).
CREATE TABLE IF NOT EXISTS filter_templates (
    name       TEXT PRIMARY KEY,
    rules      TEXT NOT NULL DEFAULT '[]', -- JSON array of {pattern,replacement,is_regex}
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
