package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/enowdev/enowx/store"
)

type accountStore struct{ db *sql.DB }

func (s *accountStore) List(ctx context.Context, provider string) ([]store.Account, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, provider, label, secret, creds, status, created_at
		 FROM accounts WHERE provider = ? ORDER BY id`, provider)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Account
	for rows.Next() {
		var a store.Account
		var creds string
		if err := rows.Scan(&a.ID, &a.Provider, &a.Label, &a.Secret, &creds, &a.Status, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Creds = decodeCreds(creds)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *accountStore) Add(ctx context.Context, a store.Account) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO accounts (provider, label, secret, creds, status) VALUES (?, ?, ?, ?, ?)`,
		a.Provider, a.Label, a.Secret, encodeCreds(a.Creds), nz(a.Status, "active"))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *accountStore) SetStatus(ctx context.Context, id int64, status string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE accounts SET status = ? WHERE id = ?`, status, id)
	return err
}

func (s *accountStore) UpdateCreds(ctx context.Context, id int64, creds map[string]string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE accounts SET creds = ? WHERE id = ?`, encodeCreds(creds), id)
	return err
}

func (s *accountStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM accounts WHERE id = ?`, id)
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
