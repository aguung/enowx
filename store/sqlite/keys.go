package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/enowdev/enowx/core/syncbus"
	"github.com/enowdev/enowx/store"
)

type keyStore struct{ db *sql.DB }

func scanKey(s interface {
	Scan(dest ...any) error
}) (store.APIKey, error) {
	var k store.APIKey
	var expires, last sql.NullTime
	if err := s.Scan(&k.ID, &k.Label, &k.Secret, &k.TokenLimit, &k.TokensUsed, &k.MaxConcurrent,
		&expires, &k.Enabled, &k.CreatedAt, &last); err != nil {
		return k, err
	}
	if expires.Valid {
		k.ExpiresAt = &expires.Time
	}
	if last.Valid {
		k.LastUsed = &last.Time
	}
	return k, nil
}

const keyCols = `id, label, secret, token_limit, tokens_used, max_concurrent, expires_at, enabled, created_at, last_used`

func (s *keyStore) List(ctx context.Context) ([]store.APIKey, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+keyCols+` FROM api_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.APIKey
	for rows.Next() {
		k, err := scanKey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *keyStore) Add(ctx context.Context, k store.APIKey) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO api_keys (label, secret, token_limit, max_concurrent, expires_at, enabled)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		k.Label, k.Secret, k.TokenLimit, k.MaxConcurrent, nullTime(k.ExpiresAt), k.Enabled)
	if err != nil {
		return 0, err
	}
	syncbus.Dirty("apikey")
	return res.LastInsertId()
}

func (s *keyStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM api_keys WHERE id = ?`, id)
	if err == nil {
		syncbus.Dirty("apikey")
	}
	return err
}

func (s *keyStore) BySecret(ctx context.Context, secret string) (*store.APIKey, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+keyCols+` FROM api_keys WHERE secret = ?`, secret)
	k, err := scanKey(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE api_keys SET last_used = ? WHERE id = ?`, time.Now(), k.ID)
	return &k, nil
}

func (s *keyStore) AddUsage(ctx context.Context, id, tokens int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE api_keys SET tokens_used = tokens_used + ? WHERE id = ?`, tokens, id)
	return err
}

func (s *keyStore) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM api_keys`).Scan(&n)
	return n, err
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}
