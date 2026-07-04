package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/enowdev/enowx/core/syncbus"
	"github.com/enowdev/enowx/store"
)

type accountStore struct{ db *sql.DB }

func (s *accountStore) List(ctx context.Context, provider string) ([]store.Account, error) {
	query := `SELECT id, provider, label, secret, creds, status, disabled, created_at
		 FROM accounts WHERE (? = '' OR provider = ?) ORDER BY id`
	rows, err := s.db.QueryContext(ctx, query, provider, provider)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Account
	for rows.Next() {
		var a store.Account
		var creds string
		if err := rows.Scan(&a.ID, &a.Provider, &a.Label, &a.Secret, &creds, &a.Status, &a.Disabled, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Creds = decodeCreds(creds)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *accountStore) Add(ctx context.Context, a store.Account) (int64, error) {
	creds := encodeCreds(a.Creds)
	// De-dupe: an account is identified by provider + secret + creds (the same
	// identity the sync layer uses). If one already exists, return it instead of
	// inserting a duplicate — this covers manual re-adds, OAuth re-auth, and
	// re-imports across every add path.
	var existing int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT id FROM accounts WHERE provider = ? AND secret = ? AND creds = ? LIMIT 1`,
		a.Provider, a.Secret, creds).Scan(&existing); err == nil && existing != 0 {
		return existing, nil
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO accounts (provider, label, secret, creds, status) VALUES (?, ?, ?, ?, ?)`,
		a.Provider, a.Label, a.Secret, creds, nz(a.Status, "active"))
	if err != nil {
		return 0, err
	}
	syncbus.Dirty("account")
	return res.LastInsertId()
}

func (s *accountStore) SetStatus(ctx context.Context, id int64, status string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE accounts SET status = ? WHERE id = ?`, status, id)
	return err
}

func (s *accountStore) SetLabel(ctx context.Context, id int64, label string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE accounts SET label = ? WHERE id = ?`, label, id)
	if err == nil {
		syncbus.Dirty("account")
	}
	return err
}

func (s *accountStore) SetDisabled(ctx context.Context, id int64, disabled bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE accounts SET disabled = ? WHERE id = ?`, disabled, id)
	return err
}

func (s *accountStore) UpdateCreds(ctx context.Context, id int64, creds map[string]string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE accounts SET creds = ? WHERE id = ?`, encodeCreds(creds), id)
	if err == nil {
		syncbus.Dirty("account")
	}
	return err
}

func (s *accountStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM accounts WHERE id = ?`, id)
	if err == nil {
		syncbus.Dirty("account")
	}
	return err
}

func encodeCreds(m map[string]string) string {
	if len(m) == 0 {
		return ""
	}
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	return string(b)
}

func decodeCreds(s string) map[string]string {
	if s == "" {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil
	}
	return m
}

func nz(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
