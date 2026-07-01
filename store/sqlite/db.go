// Package sqlite is the default Store impl (modernc, CGO-free).
package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"

	_ "modernc.org/sqlite"

	"github.com/enowdev/enowx/store"
)

//go:embed migrations/*.sql
var migrations embed.FS

type DB struct {
	db       *sql.DB
	acct     *accountStore
	logs     *logStore
	keys     *keyStore
	warmups  *warmupStore
	music    *musicStore
	settings *settingsStore
	aliases  *aliasStore
	apitest  *apiTestStore
}

func Open(path string) (*DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	d := &DB{db: db}
	d.acct = &accountStore{db: db}
	d.logs = &logStore{db: db}
	d.keys = &keyStore{db: db}
	d.warmups = &warmupStore{db: db}
	d.music = &musicStore{db: db}
	d.settings = &settingsStore{db: db}
	d.aliases = &aliasStore{db: db}
	d.apitest = &apiTestStore{db: db}
	seedApiTest(db)
	return d, nil
}

// seedApiTest inserts a built-in "Gateway" collection with example requests the
// first time (no collections yet), so the dev tool isn't empty on first open.
func seedApiTest(db *sql.DB) {
	var n int
	if db.QueryRow(`SELECT COUNT(*) FROM apitest_collections`).Scan(&n); n > 0 {
		return
	}
	res, err := db.Exec(`INSERT INTO apitest_collections (name, sort) VALUES ('Gateway', 0)`)
	if err != nil {
		return
	}
	cid, _ := res.LastInsertId()
	chatBody := `{
  "model": "cb/gemini-3.1-pro",
  "stream": true,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "hi" }
  ]
}`
	anthBody := `{
  "model": "cb/claude-sonnet-4.5",
  "max_tokens": 64,
  "stream": true,
  "system": "You are a helpful assistant.",
  "messages": [{ "role": "user", "content": "hi" }]
}`
	stmt := `INSERT INTO apitest_requests (collection_id, name, method, url, body, body_type, sort) VALUES (?,?,?,?,?,?,?)`
	db.Exec(stmt, cid, "Chat Completions", "POST", "/v1/chat/completions", chatBody, "json", 0)
	db.Exec(stmt, cid, "Anthropic Messages", "POST", "/anthropic/v1/messages", anthBody, "json", 1)
	db.Exec(stmt, cid, "List accounts", "GET", "/api/accounts", "", "none", 2)
	db.Exec(stmt, cid, "List models", "GET", "/api/models", "", "none", 3)
}

func (d *DB) Accounts() store.AccountStore  { return d.acct }
func (d *DB) Logs() store.LogStore          { return d.logs }
func (d *DB) Keys() store.KeyStore          { return d.keys }
func (d *DB) Warmups() store.WarmupStore    { return d.warmups }
func (d *DB) Music() store.MusicStore       { return d.music }
func (d *DB) Settings() store.SettingsStore { return d.settings }
func (d *DB) Aliases() store.AliasStore     { return d.aliases }
func (d *DB) ApiTest() store.ApiTestStore   { return d.apitest }
func (d *DB) Close() error                  { return d.db.Close() }

func migrate(db *sql.DB) error {
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, f := range files {
		b, err := migrations.ReadFile(f)
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(b)); err != nil {
			return fmt.Errorf("migrate %s: %w", f, err)
		}
	}
	if err := ensureColumn(db, "accounts", "creds", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := ensureColumn(db, "accounts", "disabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := ensureColumn(db, "request_logs", "source", "TEXT NOT NULL DEFAULT 'api'"); err != nil {
		return err
	}
	for _, c := range []struct{ name, decl string }{
		{"token_limit", "INTEGER NOT NULL DEFAULT 0"},
		{"tokens_used", "INTEGER NOT NULL DEFAULT 0"},
		{"max_concurrent", "INTEGER NOT NULL DEFAULT 0"},
		{"expires_at", "TIMESTAMP"},
		{"enabled", "INTEGER NOT NULL DEFAULT 1"},
	} {
		if err := ensureColumn(db, "api_keys", c.name, c.decl); err != nil {
			return err
		}
	}
	// Playlist sync columns (LWW): unix-millis updated_at, version, tombstone.
	for _, c := range []struct{ name, decl string }{
		{"sync_updated_at", "INTEGER NOT NULL DEFAULT 0"},
		{"sync_version", "INTEGER NOT NULL DEFAULT 0"},
		{"deleted", "INTEGER NOT NULL DEFAULT 0"},
	} {
		if err := ensureColumn(db, "playlists", c.name, c.decl); err != nil {
			return err
		}
	}
	return nil
}

// ensureColumn adds a column to an existing table if it is missing (SQLite has
// no ADD COLUMN IF NOT EXISTS), so older DBs pick up new fields.
func ensureColumn(db *sql.DB, table, col, decl string) error {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == col {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, col, decl))
	return err
}
