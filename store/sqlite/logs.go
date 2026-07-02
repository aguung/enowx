package sqlite

import (
	"context"
	"database/sql"

	"github.com/enowdev/enowx/store"
)

type logStore struct{ db *sql.DB }

func (s *logStore) Insert(ctx context.Context, l store.RequestLog) error {
	source := l.Source
	if source == "" {
		source = "api"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO request_logs (provider, model, status, source, in_tokens, out_tokens, latency_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		l.Provider, l.Model, l.Status, source, l.InTokens, l.OutTokens, l.LatencyMS); err != nil {
		return err
	}
	// Accumulate the aggregate rollup (survives "clear logs").
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO stats_rollup (hour, provider, model, status, requests, in_tokens, out_tokens, latency_sum)
		 VALUES (strftime('%Y-%m-%d %H:00','now'), ?, ?, ?, 1, ?, ?, ?)
		 ON CONFLICT(hour, provider, model, status) DO UPDATE SET
		   requests    = requests + 1,
		   in_tokens   = in_tokens + excluded.in_tokens,
		   out_tokens  = out_tokens + excluded.out_tokens,
		   latency_sum = latency_sum + excluded.latency_sum`,
		l.Provider, l.Model, l.Status, l.InTokens, l.OutTokens, l.LatencyMS); err != nil {
		return err
	}
	return tx.Commit()
}

// Clear removes the detailed request logs. Stats live in stats_rollup and are
// intentionally NOT touched, so clearing logs never wipes statistics.
func (s *logStore) Clear(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM request_logs`)
	return err
}

func (s *logStore) SummaryToday(ctx context.Context) (store.LogSummary, error) {
	var sum store.LogSummary
	var reqs, latSum int64
	err := s.db.QueryRowContext(ctx,
		`SELECT
		   COALESCE(SUM(requests), 0),
		   COALESCE(SUM(CASE WHEN status = 'success' THEN requests ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN status != 'success' THEN requests ELSE 0 END), 0),
		   COALESCE(SUM(in_tokens), 0),
		   COALESCE(SUM(out_tokens), 0),
		   COALESCE(SUM(latency_sum), 0)
		 FROM stats_rollup
		 WHERE hour >= strftime('%Y-%m-%d 00:00', 'now')`,
	).Scan(&sum.Total, &sum.OK, &sum.Errors, &sum.InTokens, &sum.OutTokens, &latSum)
	reqs = sum.Total
	if reqs > 0 {
		sum.AvgMS = latSum / reqs
	}
	return sum, err
}

// TotalOutTokens returns the all-time cumulative output tokens from successful
// requests. Used to credit Kleos for usage (the cloud server idempotently
// credits only the delta past its watermark).
func (s *logStore) TotalOutTokens(ctx context.Context) (int64, error) {
	var total int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(out_tokens), 0) FROM stats_rollup WHERE status = 'success'`,
	).Scan(&total)
	return total, err
}

// Totals returns lifetime aggregates (all statuses) from the rollup, for syncing
// a per-user summary to the cloud.
func (s *logStore) Totals(ctx context.Context) (requests, inTokens, outTokens int64, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(requests),0), COALESCE(SUM(in_tokens),0), COALESCE(SUM(out_tokens),0) FROM stats_rollup`,
	).Scan(&requests, &inTokens, &outTokens)
	return
}

func (s *logStore) Series(ctx context.Context, r store.SeriesRange) ([]store.SeriesPoint, error) {
	// The rollup's `hour` column is already 'YYYY-MM-DD HH:00'. Hourly buckets use
	// it as-is; daily buckets take its date prefix. Windows compare the string.
	bucket := "hour"                         // hourly by default
	where := "WHERE hour >= strftime('%Y-%m-%d %H:00', datetime('now','-24 hours'))"
	switch r {
	case store.RangeDaily:
		bucket = "hour"
		where = "WHERE hour >= strftime('%Y-%m-%d %H:00', datetime('now','-24 hours'))"
	case store.Range7d:
		bucket = "substr(hour, 1, 10)"
		where = "WHERE hour >= strftime('%Y-%m-%d %H:00', datetime('now','-7 days'))"
	case store.Range30d:
		bucket = "substr(hour, 1, 10)"
		where = "WHERE hour >= strftime('%Y-%m-%d %H:00', datetime('now','-30 days'))"
	case store.RangeAll:
		bucket = "substr(hour, 1, 10)"
		where = ""
	}

	q := `SELECT ` + bucket + ` AS bucket,
	             COALESCE(SUM(requests), 0),
	             COALESCE(SUM(in_tokens), 0),
	             COALESCE(SUM(out_tokens), 0)
	      FROM stats_rollup ` + where + `
	      GROUP BY bucket ORDER BY bucket`
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SeriesPoint
	for rows.Next() {
		var p store.SeriesPoint
		if err := rows.Scan(&p.Bucket, &p.Requests, &p.InTokens, &p.OutTokens); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *logStore) TopModels(ctx context.Context, limit int) ([]store.ModelStat, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT model, COALESCE(SUM(requests), 0) AS reqs,
		        COALESCE(SUM(in_tokens), 0),
		        COALESCE(SUM(out_tokens), 0)
		 FROM stats_rollup
		 WHERE hour >= strftime('%Y-%m-%d 00:00', 'now')
		 GROUP BY model ORDER BY reqs DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.ModelStat
	for rows.Next() {
		var m store.ModelStat
		if err := rows.Scan(&m.Model, &m.Requests, &m.InTokens, &m.OutTokens); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *logStore) Recent(ctx context.Context, limit int) ([]store.RequestLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, provider, model, status, source, in_tokens, out_tokens, latency_ms, created_at
		 FROM request_logs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.RequestLog
	for rows.Next() {
		var l store.RequestLog
		if err := rows.Scan(&l.ID, &l.Provider, &l.Model, &l.Status, &l.Source, &l.InTokens, &l.OutTokens, &l.LatencyMS, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
