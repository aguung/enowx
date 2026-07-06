package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/enowdev/enowx/core/syncbus"
	"github.com/enowdev/enowx/store"
)

type comboStore struct{ db *sql.DB }

func (s *comboStore) List(ctx context.Context) ([]store.ModelCombo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, targets, strategy FROM model_combos ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []store.ModelCombo{}
	for rows.Next() {
		var c store.ModelCombo
		var targets string
		if err := rows.Scan(&c.ID, &c.Name, &targets, &c.Strategy); err != nil {
			return nil, err
		}
		c.Targets = decodeTargets(targets)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *comboStore) Add(ctx context.Context, c store.ModelCombo) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO model_combos (name, targets, strategy) VALUES (?, ?, ?)`,
		c.Name, encodeTargets(c.Targets), c.Strategy)
	if err != nil {
		return 0, err
	}
	syncbus.Dirty("combo")
	return res.LastInsertId()
}

func (s *comboStore) Update(ctx context.Context, c store.ModelCombo) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE model_combos SET name = ?, targets = ?, strategy = ? WHERE id = ?`,
		c.Name, encodeTargets(c.Targets), c.Strategy, c.ID)
	if err == nil {
		syncbus.Dirty("combo")
	}
	return err
}

func (s *comboStore) Delete(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM model_combos WHERE id = ?`, id)
	if err == nil {
		syncbus.Dirty("combo")
	}
	return err
}

func (s *comboStore) Map(ctx context.Context) map[string]store.ModelCombo {
	out := map[string]store.ModelCombo{}
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, targets, strategy FROM model_combos`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var c store.ModelCombo
		var targets string
		if rows.Scan(&c.ID, &c.Name, &targets, &c.Strategy) == nil && c.Name != "" {
			c.Targets = decodeTargets(targets)
			out[c.Name] = c
		}
	}
	return out
}

// NextIndex reads the combo's current last_index and advances it by one,
// wrapping at mod, returning the PRE-advance value. Both the read and the
// write hit the row directly on every call — nothing is cached in the process.
func (s *comboStore) NextIndex(ctx context.Context, id int64, mod int) (int, error) {
	if mod <= 0 {
		return 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var cur int
	if err := tx.QueryRowContext(ctx, `SELECT last_index FROM model_combos WHERE id = ?`, id).Scan(&cur); err != nil {
		return 0, err
	}
	next := (cur + 1) % mod
	if _, err := tx.ExecContext(ctx, `UPDATE model_combos SET last_index = ? WHERE id = ?`, next, id); err != nil {
		return 0, err
	}
	return cur, tx.Commit()
}

func (s *comboStore) SetByName(ctx context.Context, name string, targets []string, strategy store.ComboStrategy) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO model_combos (name, targets, strategy) VALUES (?, ?, ?)
		 ON CONFLICT(name) DO UPDATE SET targets = excluded.targets, strategy = excluded.strategy`,
		name, encodeTargets(targets), strategy)
	if err == nil {
		syncbus.Dirty("combo")
	}
	return err
}

func (s *comboStore) DeleteByName(ctx context.Context, name string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM model_combos WHERE name = ?`, name)
	if err == nil {
		syncbus.Dirty("combo")
	}
	return err
}

func encodeTargets(t []string) string {
	if len(t) == 0 {
		return "[]"
	}
	b, err := json.Marshal(t)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func decodeTargets(s string) []string {
	out := []string{}
	if s == "" {
		return out
	}
	_ = json.Unmarshal([]byte(s), &out)
	return out
}
