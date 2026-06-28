package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/enowdev/enowx/store"
)

type keyStore struct{ db *sql.DB }

func (s *keyStore) List(ctx context.Context) ([]store.APIKey, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, label, secret, created_at, last_used FROM api_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.APIKey
	for rows.Next() {
		var k store.APIKey
		var last sql.NullTime
		if err := rows.Scan(&k.ID, &k.Label, &k.Secret, &k.CreatedAt, &last); err != nil {
			return nil, err
		}
		if last.Valid {
			k.LastUsed = &last.Time
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *keyStore) Add(ctx context.Context, k store.APIKey) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO api_keys (label, secret) VALUES (?, ?)`, k.Label, k.Secret)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *keyStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM api_keys WHERE id = ?`, id)
	return err
}

func (s *keyStore) Valid(ctx context.Context, secret string) (bool, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM api_keys WHERE secret = ?`, secret).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE api_keys SET last_used = ? WHERE id = ?`, time.Now(), id)
	return true, nil
}

func (s *keyStore) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM api_keys`).Scan(&n)
	return n, err
}
