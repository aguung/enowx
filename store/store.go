// Package store persists local state behind an interface. Default impl is sqlite
// (pure-Go modernc, CGO-free). core never imports this directly.
package store

import (
	"context"
	"time"
)

// Account is one upstream credential (a provider's key/token set).
type Account struct {
	ID        int64
	Provider  string
	Label     string
	Secret    string            // single-token case (opaque here)
	Creds     map[string]string // multi-field credentials (opaque here)
	Status    string            // active | exhausted | banned (from upstream)
	Disabled  bool              // turned off by the user (independent of status)
	CreatedAt time.Time
}

// RequestLog is one served request record.
type RequestLog struct {
	ID        int64
	Provider  string
	Model     string
	Status    string // success | error
	Source    string // api | warmup
	InTokens  int64
	OutTokens int64
	LatencyMS int64
	CreatedAt time.Time
}

// APIKey is a gateway key that protects /v1 and /anthropic when any exist.
type APIKey struct {
	ID        int64
	Label     string
	Secret    string
	CreatedAt time.Time
	LastUsed  *time.Time
}

// WarmupLog records one account warmup attempt (a real probe request).
type WarmupLog struct {
	ID         int64
	AccountID  int64
	Provider   string
	Label      string
	OK         bool
	Outcome    string
	Status     string
	Request    string
	Response   string
	Usage      string
	DurationMS int64
	CreatedAt  time.Time
}

type Store interface {
	Accounts() AccountStore
	Logs() LogStore
	Keys() KeyStore
	Warmups() WarmupStore
	Close() error
}

type WarmupStore interface {
	Insert(ctx context.Context, l WarmupLog) error
	Recent(ctx context.Context, limit int) ([]WarmupLog, error)
	Clear(ctx context.Context) error
}

type KeyStore interface {
	List(ctx context.Context) ([]APIKey, error)
	Add(ctx context.Context, k APIKey) (int64, error)
	Delete(ctx context.Context, id int64) error
	Valid(ctx context.Context, secret string) (bool, error)
	Count(ctx context.Context) (int, error)
}

type AccountStore interface {
	List(ctx context.Context, provider string) ([]Account, error)
	Add(ctx context.Context, a Account) (int64, error)
	SetStatus(ctx context.Context, id int64, status string) error
	SetDisabled(ctx context.Context, id int64, disabled bool) error
	UpdateCreds(ctx context.Context, id int64, creds map[string]string) error
	Delete(ctx context.Context, id int64) error
}

// LogSummary aggregates request_logs for the current day (server-local).
type LogSummary struct {
	Total     int64 `json:"total"`
	OK        int64 `json:"ok"`
	Errors    int64 `json:"errors"`
	InTokens  int64 `json:"in_tokens"`
	OutTokens int64 `json:"out_tokens"`
	AvgMS     int64 `json:"avg_ms"`
}

// SeriesPoint is one time bucket (hour or day) of request/token counts.
type SeriesPoint struct {
	Bucket    string `json:"bucket"`
	Requests  int64  `json:"requests"`
	InTokens  int64  `json:"in_tokens"`
	OutTokens int64  `json:"out_tokens"`
}

// SeriesRange selects the window + bucket granularity for Series.
type SeriesRange string

const (
	RangeDaily SeriesRange = "daily" // last 24h, hourly buckets
	Range7d    SeriesRange = "7d"    // last 7 days, daily buckets
	Range30d   SeriesRange = "30d"   // last 30 days, daily buckets
	RangeAll   SeriesRange = "all"   // everything, daily buckets
)

// ModelStat is per-model usage for the current day.
type ModelStat struct {
	Model     string `json:"model"`
	Requests  int64  `json:"requests"`
	InTokens  int64  `json:"in_tokens"`
	OutTokens int64  `json:"out_tokens"`
}

type LogStore interface {
	Insert(ctx context.Context, l RequestLog) error
	Recent(ctx context.Context, limit int) ([]RequestLog, error)
	SummaryToday(ctx context.Context) (LogSummary, error)
	Series(ctx context.Context, r SeriesRange) ([]SeriesPoint, error)
	TopModels(ctx context.Context, limit int) ([]ModelStat, error)
}
