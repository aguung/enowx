package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/proxypool"
	"github.com/enowdev/enowx/store"
)

// ctxKey carries the target provider name through the request context so the
// proxy layer can decide (per the whitelist) whether to route this request.
type ctxKey struct{}

// WithProvider tags a context with the provider a request targets. The proxy
// Doer reads it to apply per-provider routing.
func WithProvider(ctx context.Context, provider string) context.Context {
	return context.WithValue(ctx, ctxKey{}, provider)
}

func providerFrom(ctx context.Context) string {
	s, _ := ctx.Value(ctxKey{}).(string)
	return s
}

// settings keys (mirror handlers/api_proxy.go; kept in sync by value, not import
// to avoid a server→core dependency).
const (
	setProxyEnabled   = "proxy_enabled"
	setProxyMode      = "proxy_mode"
	setProxyProviders = "proxy_providers"
)

// ProxyDoer wraps an inner Doer and, when enabled, routes a request through a
// proxy from the pool based on the target provider + configured mode. A proxy
// that errors is marked dead and the request falls back to the inner Doer, so a
// bad proxy never hard-fails a request.
type ProxyDoer struct {
	inner    Doer
	proxies  store.ProxyStore
	settings store.SettingsStore

	mu     sync.Mutex
	rr     int                        // round-robin cursor
	sticky map[string]int64           // provider → chosen proxy id (sticky mode)
	rtc    map[int64]http.RoundTripper // cache transports by proxy id
}

// NewProxyDoer wraps inner with proxy routing driven by the given stores.
func NewProxyDoer(inner Doer, proxies store.ProxyStore, settings store.SettingsStore) *ProxyDoer {
	return &ProxyDoer{
		inner: inner, proxies: proxies, settings: settings,
		sticky: map[string]int64{}, rtc: map[int64]http.RoundTripper{},
	}
}

func (d *ProxyDoer) Do(r *http.Request) (*http.Response, error) {
	prov := providerFrom(r.Context())
	rt, id, ok := d.pick(r.Context(), prov)
	if !ok {
		return d.inner.Do(r)
	}
	client := &http.Client{Transport: rt}
	resp, err := client.Do(r)
	if err != nil {
		// Proxy failed — mark it dead + drop its cached transport, then fall back
		// to a direct request so the user isn't blocked by one bad proxy.
		_ = d.proxies.SetStatus(context.Background(), id, "dead", 0)
		d.mu.Lock()
		delete(d.rtc, id)
		d.mu.Unlock()
		return d.inner.Do(r)
	}
	return resp, nil
}

// pick decides whether to route `prov` through a proxy and, if so, returns the
// proxy's transport + id. Returns ok=false to go direct.
func (d *ProxyDoer) pick(ctx context.Context, prov string) (http.RoundTripper, int64, bool) {
	if d.proxies == nil || d.settings == nil {
		return nil, 0, false
	}
	if v, _ := d.settings.Get(ctx, setProxyEnabled); v != "true" {
		return nil, 0, false
	}
	// Whitelist: empty = all providers; otherwise the target must be listed.
	if raw, _ := d.settings.Get(ctx, setProxyProviders); raw != "" {
		var list []string
		if json.Unmarshal([]byte(raw), &list) == nil && len(list) > 0 {
			found := false
			for _, p := range list {
				if p == prov {
					found = true
					break
				}
			}
			if !found {
				return nil, 0, false
			}
		}
	}
	all, err := d.proxies.List(ctx)
	if err != nil {
		return nil, 0, false
	}
	live := all[:0]
	for _, p := range all {
		if p.Enabled && p.Status != "dead" {
			live = append(live, p)
		}
	}
	if len(live) == 0 {
		return nil, 0, false
	}

	mode, _ := d.settings.Get(ctx, setProxyMode)
	chosen := d.choose(prov, mode, live)
	rt, err := d.transportFor(chosen)
	if err != nil {
		return nil, 0, false
	}
	return rt, chosen.ID, true
}

// choose selects a proxy from the live set per mode (rotate | random | sticky).
func (d *ProxyDoer) choose(prov, mode string, live []store.Proxy) store.Proxy {
	d.mu.Lock()
	defer d.mu.Unlock()
	switch mode {
	case "sticky":
		if id, ok := d.sticky[prov]; ok {
			for _, p := range live {
				if p.ID == id {
					return p
				}
			}
		}
		p := live[d.rr%len(live)]
		d.rr++
		d.sticky[prov] = p.ID
		return p
	case "random":
		// Cheap PRNG off the round-robin cursor + time; not crypto, just spread.
		i := int(time.Now().UnixNano()) % len(live)
		if i < 0 {
			i += len(live)
		}
		return live[i]
	default: // rotate (round-robin)
		p := live[d.rr%len(live)]
		d.rr++
		return p
	}
}

// transportFor returns (and caches) the RoundTripper for a proxy id.
func (d *ProxyDoer) transportFor(p store.Proxy) (http.RoundTripper, error) {
	d.mu.Lock()
	if rt, ok := d.rtc[p.ID]; ok {
		d.mu.Unlock()
		return rt, nil
	}
	d.mu.Unlock()
	rt, err := proxypool.RoundTripper(proxypool.Proxy{
		Scheme: p.Scheme, Host: p.Host, Port: p.Port, User: p.Username, Pass: p.Password,
	})
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	d.rtc[p.ID] = rt
	d.mu.Unlock()
	return rt, nil
}
