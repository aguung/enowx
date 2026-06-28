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
	db      *sql.DB
	acct    *accountStore
	logs    *logStore
	keys    *keyStore
	warmups *warmupStore
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
	return d, nil
}

func (d *DB) Accounts() store.AccountStore { return d.acct }
func (d *DB) Logs() store.LogStore         { return d.logs }
func (d *DB) Keys() store.KeyStore         { return d.keys }
func (d *DB) Warmups() store.WarmupStore   { return d.warmups }
func (d *DB) Close() error                 { return d.db.Close() }

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
	return ensureColumn(db, "request_logs", "source", "TEXT NOT NULL DEFAULT 'api'")
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
