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
	Status    string            // active | exhausted | banned
	CreatedAt time.Time
}

// RequestLog is one served request record.
type RequestLog struct {
	ID        int64
	Provider  string
	Model     string
	Status    string // success | error
	InTokens  int64
	OutTokens int64
	LatencyMS int64
	CreatedAt time.Time
}

type Store interface {
	Accounts() AccountStore
	Logs() LogStore
	Close() error
}

type AccountStore interface {
	List(ctx context.Context, provider string) ([]Account, error)
	Add(ctx context.Context, a Account) (int64, error)
	SetStatus(ctx context.Context, id int64, status string) error
	UpdateCreds(ctx context.Context, id int64, creds map[string]string) error
	Delete(ctx context.Context, id int64) error
}

type LogStore interface {
	Insert(ctx context.Context, l RequestLog) error
	Recent(ctx context.Context, limit int) ([]RequestLog, error)
}
