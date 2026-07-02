package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/enowdev/enowx/core/syncbus"
	"github.com/enowdev/enowx/store"
)

type customProviderStore struct{ db *sql.DB }

func scanCustom(row interface{ Scan(...any) error }) (store.CustomProvider, error) {
	var p store.CustomProvider
	var modelsJSON string
	err := row.Scan(&p.ID, &p.Name, &p.Prefix, &p.Format, &p.BaseURL, &p.DefaultModel, &modelsJSON)
	if err != nil {
		return p, err
	}
	if modelsJSON != "" {
		_ = json.Unmarshal([]byte(modelsJSON), &p.Models)
	}
	if p.Models == nil {
		p.Models = []store.CustomModel{}
	}
	return p, nil
}

func (s *customProviderStore) List(ctx context.Context) ([]store.CustomProvider, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, prefix, format, base_url, default_model, models FROM custom_providers ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.CustomProvider{}
	for rows.Next() {
		p, err := scanCustom(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *customProviderStore) Get(ctx context.Context, id int64) (*store.CustomProvider, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, name, prefix, format, base_url, default_model, models FROM custom_providers WHERE id = ?`, id)
	p, err := scanCustom(row)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *customProviderStore) Create(ctx context.Context, p store.CustomProvider) (int64, error) {
	models, _ := json.Marshal(p.Models)
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO custom_providers (name, prefix, format, base_url, default_model, models) VALUES (?,?,?,?,?,?)`,
		p.Name, p.Prefix, p.Format, p.BaseURL, p.DefaultModel, string(models))
	if err != nil {
		return 0, err
	}
	syncbus.Dirty("custom_provider")
	return res.LastInsertId()
}

func (s *customProviderStore) Update(ctx context.Context, p store.CustomProvider) error {
	models, _ := json.Marshal(p.Models)
	_, err := s.db.ExecContext(ctx,
		`UPDATE custom_providers SET name=?, prefix=?, format=?, base_url=?, default_model=?, models=? WHERE id=?`,
		p.Name, p.Prefix, p.Format, p.BaseURL, p.DefaultModel, string(models), p.ID)
	if err == nil {
		syncbus.Dirty("custom_provider")
	}
	return err
}

func (s *customProviderStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM custom_providers WHERE id = ?`, id)
	if err == nil {
		syncbus.Dirty("custom_provider")
	}
	return err
}
