// Package sqlite is the default Store impl (modernc, CGO-free).
package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

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
	custom   *customProviderStore
	filters  *filterStore
	proxies  *proxyStore
	combos   *comboStore
}

func Open(path string) (*DB, error) {
	// WAL lets readers run concurrently with a writer, and busy_timeout makes a
	// blocked write wait for the lock instead of failing immediately — together
	// these stop the "database is locked (SQLITE_BUSY)" errors under concurrent
	// requests (e.g. an OAuth add running while sync writes). _txlock=immediate
	// takes the write lock up front so transactions don't deadlock upgrading.
	dsn := path
	if !strings.Contains(dsn, "?") {
		dsn += "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)&_txlock=immediate"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// A single writer connection serializes writes; SQLite is single-writer
	// anyway, and this removes lock contention entirely for the write path.
	db.SetMaxOpenConns(1)
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
	d.custom = &customProviderStore{db: db}
	d.filters = &filterStore{db: db}
	d.proxies = &proxyStore{db: db}
	d.combos = &comboStore{db: db}
	seedApiTest(db)
	backfillApiTest(db)
	return d, nil
}

// backfillApiTest adds newer built-in sample requests to an EXISTING Gateway
// collection (seedApiTest only runs on a fresh DB). Idempotent: it inserts each
// sample only when a request with that url isn't already present, so users who
// created the collection before a sample existed still get it.
func backfillApiTest(db *sql.DB) {
	var cid int64
	if err := db.QueryRow(`SELECT id FROM apitest_collections WHERE name = 'Gateway' ORDER BY id LIMIT 1`).Scan(&cid); err != nil {
		return // no built-in collection (or a totally custom setup) — leave it alone
	}
	auth := `{"type":"bearer","token":"{{api_key}}"}`
	ensureReq := func(name, method, url, auth string, sort int) {
		var n int
		db.QueryRow(`SELECT COUNT(*) FROM apitest_requests WHERE collection_id = ? AND url = ?`, cid, url).Scan(&n)
		if n > 0 {
			return
		}
		db.Exec(`INSERT INTO apitest_requests (collection_id, name, method, base_url, url, body, body_type, auth, sort)
			 VALUES (?,?,?,?,?,?,?,?,?)`, cid, name, method, "{{base_url}}", url, "", "none", auth, sort)
	}
	ensureReq("List models (OpenAI)", "GET", "/v1/models", auth, 7)
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
  "model": "cb/gemini-3.1-pro",
  "max_tokens": 64,
  "stream": true,
  "system": "You are a helpful assistant.",
  "messages": [{ "role": "user", "content": "hi" }]
}`
	imageBody := `{
  "model": "cb/gemini-2.5-flash-image",
  "prompt": "a red bicycle on a sunny street",
  "n": 1,
  "size": "1024x1024"
}`
	musicBody := `{
  "prompt": "a warm lofi hip hop beat about rainy evenings",
  "model": "V4_5",
  "instrumental": false
}`
	// Gateway samples use {{base_url}} + a Bearer {{api_key}} so the built-in
	// "Local" environment supplies both — no magic auto-key injection.
	const base = "{{base_url}}"
	auth := `{"type":"bearer","token":"{{api_key}}"}`
	stmt := `INSERT INTO apitest_requests (collection_id, name, method, base_url, url, body, body_type, auth, sort) VALUES (?,?,?,?,?,?,?,?,?)`
	db.Exec(stmt, cid, "Chat Completions", "POST", base, "/v1/chat/completions", chatBody, "json", auth, 0)
	db.Exec(stmt, cid, "Anthropic Messages", "POST", base, "/anthropic/v1/messages", anthBody, "json", auth, 1)
	db.Exec(stmt, cid, "Image Generation", "POST", base, "/v1/images/generations", imageBody, "json", auth, 2)
	db.Exec(stmt, cid, "Music Generation", "POST", base, "/api/music/generate", musicBody, "json", "none", 3)
	db.Exec(stmt, cid, "Music Status (poll)", "GET", base, "/api/music/generate/status?task_id={{task_id}}", "", "none", "none", 4)
	db.Exec(stmt, cid, "List accounts", "GET", base, "/api/accounts", "", "none", auth, 5)
	db.Exec(stmt, cid, "List models", "GET", base, "/api/models", "", "none", auth, 6)
	db.Exec(stmt, cid, "List models (OpenAI)", "GET", base, "/v1/models", "", "none", auth, 7)

	// Built-in "Local" environment: base_url + api_key (from an existing gateway
	// key if there is one), so the Gateway samples run out of the box.
	var key string
	db.QueryRow(`SELECT secret FROM api_keys WHERE enabled = 1 ORDER BY id LIMIT 1`).Scan(&key)
	vars := `[{"key":"base_url","value":"http://localhost:1430"},{"key":"api_key","value":"` + key + `"}]`
	db.Exec(`INSERT INTO apitest_environments (name, vars, active) VALUES ('Local', ?, 1)`, vars)
}

func (d *DB) Accounts() store.AccountStore               { return d.acct }
func (d *DB) Logs() store.LogStore                       { return d.logs }
func (d *DB) Keys() store.KeyStore                       { return d.keys }
func (d *DB) Warmups() store.WarmupStore                 { return d.warmups }
func (d *DB) Music() store.MusicStore                    { return d.music }
func (d *DB) Settings() store.SettingsStore              { return d.settings }
func (d *DB) Aliases() store.AliasStore                  { return d.aliases }
func (d *DB) ApiTest() store.ApiTestStore                { return d.apitest }
func (d *DB) CustomProviders() store.CustomProviderStore { return d.custom }
func (d *DB) Filters() store.FilterStore                 { return d.filters }
func (d *DB) Proxies() store.ProxyStore                  { return d.proxies }
func (d *DB) Combos() store.ComboStore                   { return d.combos }
func (d *DB) Close() error                               { return d.db.Close() }

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
	if err := ensureColumn(db, "request_logs", "proxy_used", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := ensureColumn(db, "request_logs", "account_label", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := ensureColumn(db, "apitest_requests", "base_url", "TEXT NOT NULL DEFAULT ''"); err != nil {
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
