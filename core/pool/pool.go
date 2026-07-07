// Package pool selects a usable account for a provider and reacts to outcomes.
package pool

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/pooltypes"
)

var ErrNoAccount = errors.New("no usable account")

// rotationKey is the admin setting that selects a provider's account-selection
// mode: "round-robin" spreads load across accounts, anything else (default) is
// sticky — always the first active account until it dies.
func rotationKey(provider string) string { return "pool_rotation:" + provider }

type Pool struct {
	accounts pooltypes.AccountStore
	settings pooltypes.SettingsStore // optional; nil → always sticky

	mu   sync.Mutex
	next map[string]int // per-provider round-robin cursor
}

func New(a pooltypes.AccountStore) *Pool {
	return &Pool{accounts: a, next: map[string]int{}}
}

// WithSettings enables per-provider rotation modes read from the settings store.
func (p *Pool) WithSettings(s pooltypes.SettingsStore) *Pool {
	p.settings = s
	return p
}

// Pick returns a usable account for a provider.
func (p *Pool) Pick(ctx context.Context, providerName string) (provider.Account, error) {
	return p.PickExcept(ctx, providerName, nil)
}

// PickExcept returns a usable account for a provider whose id is not in tried
// (so a failed account is skipped on rotation). Selection is sticky by default —
// the first active account — or round-robin when the provider's pool_rotation
// setting is "round-robin", which advances a cursor each call to spread load
// across accounts (useful for ban-sensitive providers like claudecode, so no one
// account carries all the traffic).
func (p *Pool) PickExcept(ctx context.Context, providerName string, tried map[int64]bool) (provider.Account, error) {
	rows, err := p.accounts.List(ctx, providerName)
	if err != nil {
		return provider.Account{}, err
	}

	// Collect usable candidates in list order.
	usable := make([]pooltypes.Account, 0, len(rows))
	for _, a := range rows {
		if a.Status == "active" && !a.Disabled && !tried[a.ID] {
			usable = append(usable, a)
		}
	}
	if len(usable) == 0 {
		return provider.Account{}, ErrNoAccount
	}

	idx := 0
	if len(usable) > 1 && p.roundRobin(ctx, providerName) {
		idx = p.advance(providerName, len(usable))
	}
	a := usable[idx]
	return provider.Account{ID: a.ID, Secret: a.Secret, Creds: a.Creds}, nil
}

// roundRobin reports whether the provider is set to round-robin selection.
func (p *Pool) roundRobin(ctx context.Context, providerName string) bool {
	if p.settings == nil {
		return false
	}
	v, err := p.settings.Get(ctx, rotationKey(providerName))
	if err != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(v), "round-robin")
}

// advance returns the next cursor position (mod n) for a provider.
func (p *Pool) advance(providerName string, n int) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	i := p.next[providerName] % n
	p.next[providerName] = (i + 1) % n
	return i
}

// React applies an outcome to an account (ban/exhaust).
func (p *Pool) React(ctx context.Context, id int64, o provider.Outcome) {
	switch o {
	case provider.OutcomeDead:
		_ = p.accounts.SetStatus(ctx, id, "banned")
	case provider.OutcomeExhausted:
		_ = p.accounts.SetStatus(ctx, id, "exhausted")
	}
}
