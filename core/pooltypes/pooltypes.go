// Package pooltypes holds the small data types and store interfaces that the
// transport/proxy/provider layers need, decoupled from the concrete `store`
// package (which pulls in SQLite). The `store` package aliases these back, so
// call-sites keep using store.Proxy etc. unchanged, while core/provider/* no
// longer transitively depends on store — letting the cloud import the provider
// adapters without dragging in the local store.
package pooltypes

import (
	"context"
	"time"
)

// Account is one upstream credential (a provider's key/token set). Creds are
// opaque here — the provider adapter interprets them.
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

// AccountStore is the credential pool the request router draws from.
type AccountStore interface {
	List(ctx context.Context, provider string) ([]Account, error)
	Add(ctx context.Context, a Account) (int64, error)
	SetStatus(ctx context.Context, id int64, status string) error
	SetDisabled(ctx context.Context, id int64, disabled bool) error
	SetLabel(ctx context.Context, id int64, label string) error
	UpdateCreds(ctx context.Context, id int64, creds map[string]string) error
	Delete(ctx context.Context, id int64) error
}

// SettingsStore is a tiny key/value settings reader/writer.
type SettingsStore interface {
	Get(ctx context.Context, key string) (string, error) // "" if unset
	Set(ctx context.Context, key, value string) error
}

// Proxy is one outbound proxy in the pool.
type Proxy struct {
	ID          int64  `json:"id"`
	Label       string `json:"label"`
	Scheme      string `json:"scheme"` // http | https | socks5 | socks5h
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	Enabled     bool   `json:"enabled"`
	Status      string `json:"status"` // unknown | ok | dead
	LatencyMS   int    `json:"latency_ms"`
	LastChecked string `json:"last_checked,omitempty"`
	CreatedAt   string `json:"created_at"`
}

// ProxyStore manages the outbound proxy pool.
type ProxyStore interface {
	List(ctx context.Context) ([]Proxy, error)
	Add(ctx context.Context, p Proxy) (int64, error)
	Delete(ctx context.Context, id int64) error
	SetEnabled(ctx context.Context, id int64, enabled bool) error
	SetStatus(ctx context.Context, id int64, status string, latencyMS int) error
}

// ComboStrategy selects how a combo picks among its ordered targets.
type ComboStrategy int16

const (
	ComboFailover   ComboStrategy = 0
	ComboRoundRobin ComboStrategy = 1
)

// ModelCombo is a per-user local virtual model that resolves to an ordered list
// of real provider-prefixed targets, tried in order (failover) or starting from
// a rotating position (round_robin).
type ModelCombo struct {
	ID       int64         `json:"id"`
	Name     string        `json:"name"`
	Targets  []string      `json:"targets"`
	Strategy ComboStrategy `json:"strategy"`
}

// ComboStore holds the user's local model combos.
type ComboStore interface {
	List(ctx context.Context) ([]ModelCombo, error)
	Add(ctx context.Context, c ModelCombo) (int64, error)
	Update(ctx context.Context, c ModelCombo) error
	Delete(ctx context.Context, id int64) error
	Map(ctx context.Context) map[string]ModelCombo
	NextIndex(ctx context.Context, id int64, mod int) (int, error)
	SetByName(ctx context.Context, name string, targets []string, strategy ComboStrategy) error
	DeleteByName(ctx context.Context, name string) error
}
