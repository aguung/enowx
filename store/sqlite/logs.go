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
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO request_logs (provider, model, status, source, in_tokens, out_tokens, latency_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		l.Provider, l.Model, l.Status, source, l.InTokens, l.OutTokens, l.LatencyMS)
	return err
}

func (s *logStore) Clear(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM request_logs`)
	return err
}

func (s *logStore) SummaryToday(ctx context.Context) (store.LogSummary, error) {
	var sum store.LogSummary
	err := s.db.QueryRowContext(ctx,
		`SELECT
		   COUNT(*),
		   COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END), 0),
		   COALESCE(SUM(in_tokens), 0),
		   COALESCE(SUM(out_tokens), 0),
		   COALESCE(CAST(AVG(latency_ms) AS INTEGER), 0)
		 FROM request_logs
		 WHERE created_at >= date('now')`,
	).Scan(&sum.Total, &sum.OK, &sum.Errors, &sum.InTokens, &sum.OutTokens, &sum.AvgMS)
	return sum, err
}

// TotalOutTokens returns the all-time cumulative output tokens from successful
// requests. Used to credit Kleos for usage (the cloud server idempotently
// credits only the delta past its watermark).
func (s *logStore) TotalOutTokens(ctx context.Context) (int64, error) {
	var total int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(out_tokens), 0) FROM request_logs WHERE status = 'success'`,
	).Scan(&total)
	return total, err
}

func (s *logStore) Series(ctx context.Context, r store.SeriesRange) ([]store.SeriesPoint, error) {
	// bucket = strftime format; where = time window predicate.
	bucket := "%Y-%m-%d" // daily buckets by default
	where := ""
	switch r {
	case store.RangeDaily:
		bucket = "%Y-%m-%d %H:00"
		where = "WHERE created_at >= datetime('now', '-24 hours')"
	case store.Range7d:
		where = "WHERE created_at >= datetime('now', '-7 days')"
	case store.Range30d:
		where = "WHERE created_at >= datetime('now', '-30 days')"
	case store.RangeAll:
		where = ""
	default:
		bucket = "%Y-%m-%d %H:00"
		where = "WHERE created_at >= datetime('now', '-24 hours')"
	}

	q := `SELECT strftime('` + bucket + `', created_at) AS bucket,
	             COUNT(*),
	             COALESCE(SUM(in_tokens), 0),
	             COALESCE(SUM(out_tokens), 0)
	      FROM request_logs ` + where + `
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
		`SELECT model, COUNT(*) AS reqs,
		        COALESCE(SUM(in_tokens), 0),
		        COALESCE(SUM(out_tokens), 0)
		 FROM request_logs
		 WHERE created_at >= date('now')
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
