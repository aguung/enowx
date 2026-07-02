package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/enowdev/enowx/store"
)

type filterStore struct{ db *sql.DB }

func (s *filterStore) List(ctx context.Context) ([]store.ContentFilter, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, pattern, replacement, is_regex, is_active FROM content_filters ORDER BY sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ContentFilter{}
	for rows.Next() {
		var f store.ContentFilter
		if err := rows.Scan(&f.ID, &f.Pattern, &f.Replacement, &f.IsRegex, &f.IsActive); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *filterStore) Add(ctx context.Context, f store.ContentFilter) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO content_filters (pattern, replacement, is_regex, is_active) VALUES (?, ?, ?, ?)`,
		f.Pattern, f.Replacement, f.IsRegex, f.IsActive)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *filterStore) Update(ctx context.Context, f store.ContentFilter) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE content_filters SET pattern=?, replacement=?, is_regex=?, is_active=? WHERE id=?`,
		f.Pattern, f.Replacement, f.IsRegex, f.IsActive, f.ID)
	return err
}

func (s *filterStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM content_filters WHERE id = ?`, id)
	return err
}

// ReplaceAll swaps the entire active filter set atomically (template load).
func (s *filterStore) ReplaceAll(ctx context.Context, rules []store.ContentFilter) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM content_filters`); err != nil {
		return err
	}
	for _, r := range rules {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO content_filters (pattern, replacement, is_regex, is_active) VALUES (?, ?, ?, ?)`,
			r.Pattern, r.Replacement, r.IsRegex, r.IsActive); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *filterStore) ListTemplates(ctx context.Context) ([]store.FilterTemplate, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, rules FROM filter_templates ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.FilterTemplate{}
	for rows.Next() {
		var t store.FilterTemplate
		var raw string
		if err := rows.Scan(&t.Name, &raw); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &t.Rules)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *filterStore) SaveTemplate(ctx context.Context, name string, rules []store.ContentFilter) error {
	raw, _ := json.Marshal(rules)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO filter_templates (name, rules) VALUES (?, ?)
		 ON CONFLICT(name) DO UPDATE SET rules = excluded.rules`,
		name, string(raw))
	return err
}

func (s *filterStore) LoadTemplate(ctx context.Context, name string) ([]store.ContentFilter, error) {
	var raw string
	if err := s.db.QueryRowContext(ctx, `SELECT rules FROM filter_templates WHERE name = ?`, name).Scan(&raw); err != nil {
		return nil, err
	}
	var rules []store.ContentFilter
	_ = json.Unmarshal([]byte(raw), &rules)
	return rules, nil
}

func (s *filterStore) DeleteTemplate(ctx context.Context, name string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM filter_templates WHERE name = ?`, name)
	return err
}
