package proxy

import (
	"context"
	"sync"
	"time"

	"github.com/enowdev/enowx/store"
)

// ComboResolver looks up a model id against the user's local combo definitions
// (name -> ordered targets + strategy). Definitions are cached with a lazy TTL
// refresh, the same shape as AliasResolver — this cache is small and bounded
// by however many combos exist. It does NOT cache round-robin state; that is
// always read fresh from the store (see store.ComboStore.NextIndex).
type ComboResolver struct {
	source func(ctx context.Context) map[string]store.ModelCombo
	ttl    time.Duration

	mu      sync.RWMutex
	combos  map[string]store.ModelCombo
	fetched time.Time
}

// NewComboResolver builds a resolver over a local combo-map source (e.g. the
// SQLite combo store's Map method).
func NewComboResolver(source func(ctx context.Context) map[string]store.ModelCombo, ttl time.Duration) *ComboResolver {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &ComboResolver{source: source, ttl: ttl, combos: map[string]store.ModelCombo{}}
}

// Lookup returns the combo definition for a model id, if one exists. The
// cached map is refreshed lazily when stale.
func (r *ComboResolver) Lookup(ctx context.Context, modelID string) (store.ModelCombo, bool) {
	r.mu.RLock()
	stale := time.Since(r.fetched) > r.ttl
	c, ok := r.combos[modelID]
	r.mu.RUnlock()

	if stale {
		if m := r.source(ctx); m != nil {
			r.mu.Lock()
			r.combos = m
			r.fetched = time.Now()
			c, ok = m[modelID]
			r.mu.Unlock()
		}
	}
	return c, ok
}
