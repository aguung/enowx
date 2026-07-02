package sqlite

import (
	"context"
	"database/sql"

	"github.com/enowdev/enowx/core/syncbus"
	"github.com/enowdev/enowx/store"
)

type aliasStore struct{ db *sql.DB }

func (s *aliasStore) List(ctx context.Context) ([]store.ModelAlias, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT alias, target FROM model_aliases ORDER BY alias`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ModelAlias{}
	for rows.Next() {
		var a store.ModelAlias
		if err := rows.Scan(&a.Alias, &a.Target); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *aliasStore) Set(ctx context.Context, alias, target string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO model_aliases (alias, target) VALUES (?, ?)
		 ON CONFLICT(alias) DO UPDATE SET target = excluded.target`,
		alias, target)
	if err == nil {
		syncbus.Dirty("alias")
	}
	return err
}

func (s *aliasStore) Delete(ctx context.Context, alias string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM model_aliases WHERE alias = ?`, alias)
	if err == nil {
		syncbus.Dirty("alias")
	}
	return err
}

func (s *aliasStore) Map(ctx context.Context) map[string]string {
	out := map[string]string{}
	rows, err := s.db.QueryContext(ctx, `SELECT alias, target FROM model_aliases`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var a, t string
		if rows.Scan(&a, &t) == nil && a != "" {
			out[a] = t
		}
	}
	return out
}
