package sqlite

import (
	"context"
	"database/sql"

	"github.com/enowdev/enowx/store"
)

type apiTestStore struct{ db *sql.DB }

// --- collections ---

func (s *apiTestStore) Collections(ctx context.Context) ([]store.ApiCollection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, sort FROM apitest_collections ORDER BY sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ApiCollection{}
	for rows.Next() {
		var c store.ApiCollection
		if err := rows.Scan(&c.ID, &c.Name, &c.Sort); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *apiTestStore) AddCollection(ctx context.Context, name string) (int64, error) {
	res, err := s.db.ExecContext(ctx, `INSERT INTO apitest_collections (name) VALUES (?)`, name)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *apiTestStore) RenameCollection(ctx context.Context, id int64, name string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE apitest_collections SET name = ? WHERE id = ?`, name, id)
	return err
}

func (s *apiTestStore) DeleteCollection(ctx context.Context, id int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM apitest_requests WHERE collection_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM apitest_collections WHERE id = ?`, id)
	return err
}

// --- requests ---

func (s *apiTestStore) Requests(ctx context.Context) ([]store.ApiRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, collection_id, name, method, base_url, url, headers, query, body, body_type, auth, sort
		 FROM apitest_requests ORDER BY sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ApiRequest{}
	for rows.Next() {
		var r store.ApiRequest
		if err := rows.Scan(&r.ID, &r.CollectionID, &r.Name, &r.Method, &r.BaseURL, &r.URL, &r.Headers, &r.Query, &r.Body, &r.BodyType, &r.Auth, &r.Sort); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *apiTestStore) SaveRequest(ctx context.Context, r store.ApiRequest) (int64, error) {
	if r.Method == "" {
		r.Method = "GET"
	}
	if r.Headers == "" {
		r.Headers = "[]"
	}
	if r.Query == "" {
		r.Query = "[]"
	}
	if r.Auth == "" {
		r.Auth = "{}"
	}
	if r.BodyType == "" {
		r.BodyType = "none"
	}
	if r.ID == 0 {
		res, err := s.db.ExecContext(ctx,
			`INSERT INTO apitest_requests (collection_id, name, method, base_url, url, headers, query, body, body_type, auth, sort)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			r.CollectionID, r.Name, r.Method, r.BaseURL, r.URL, r.Headers, r.Query, r.Body, r.BodyType, r.Auth, r.Sort)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE apitest_requests SET collection_id=?, name=?, method=?, base_url=?, url=?, headers=?, query=?, body=?, body_type=?, auth=?, sort=?
		 WHERE id=?`,
		r.CollectionID, r.Name, r.Method, r.BaseURL, r.URL, r.Headers, r.Query, r.Body, r.BodyType, r.Auth, r.Sort, r.ID)
	return r.ID, err
}

func (s *apiTestStore) DeleteRequest(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM apitest_requests WHERE id = ?`, id)
	return err
}

// --- environments ---

func (s *apiTestStore) Environments(ctx context.Context) ([]store.ApiEnvironment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, vars, active FROM apitest_environments ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ApiEnvironment{}
	for rows.Next() {
		var e store.ApiEnvironment
		if err := rows.Scan(&e.ID, &e.Name, &e.Vars, &e.Active); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *apiTestStore) SaveEnvironment(ctx context.Context, e store.ApiEnvironment) (int64, error) {
	if e.Vars == "" {
		e.Vars = "[]"
	}
	if e.ID == 0 {
		res, err := s.db.ExecContext(ctx, `INSERT INTO apitest_environments (name, vars) VALUES (?, ?)`, e.Name, e.Vars)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := s.db.ExecContext(ctx, `UPDATE apitest_environments SET name=?, vars=? WHERE id=?`, e.Name, e.Vars, e.ID)
	return e.ID, err
}

func (s *apiTestStore) DeleteEnvironment(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM apitest_environments WHERE id = ?`, id)
	return err
}

func (s *apiTestStore) SetActiveEnvironment(ctx context.Context, id int64) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE apitest_environments SET active = 0`); err != nil {
		return err
	}
	if id == 0 {
		return nil // deactivate all
	}
	_, err := s.db.ExecContext(ctx, `UPDATE apitest_environments SET active = 1 WHERE id = ?`, id)
	return err
}

// --- history ---

func (s *apiTestStore) History(ctx context.Context, limit int) ([]store.ApiHistory, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, method, url, status, duration_ms, at FROM apitest_history ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ApiHistory{}
	for rows.Next() {
		var h store.ApiHistory
		if err := rows.Scan(&h.ID, &h.Method, &h.URL, &h.Status, &h.DurationMS, &h.At); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *apiTestStore) AddHistory(ctx context.Context, h store.ApiHistory) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO apitest_history (method, url, status, duration_ms) VALUES (?, ?, ?, ?)`,
		h.Method, h.URL, h.Status, h.DurationMS)
	if err != nil {
		return err
	}
	// Keep the history bounded.
	_, _ = s.db.ExecContext(ctx,
		`DELETE FROM apitest_history WHERE id NOT IN (SELECT id FROM apitest_history ORDER BY id DESC LIMIT 200)`)
	return nil
}

func (s *apiTestStore) ClearHistory(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM apitest_history`)
	return err
}
