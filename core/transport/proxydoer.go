package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/proxypool"
	"github.com/enowdev/enowx/core/pooltypes"
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

// Trace records which account + proxy actually served a request, filled in as
// the request flows through the layers and read by the handler for logging.
type Trace struct {
	Account string // account label the pool picked
	Proxy   string // proxy label the doer routed through ("" = direct)
}

type traceKey struct{}

// WithTrace attaches a fresh Trace to the context; the returned *Trace is filled
// in by the proxy/pool layers during the request and read afterward.
func WithTrace(ctx context.Context) (context.Context, *Trace) {
	t := &Trace{}
	return context.WithValue(ctx, traceKey{}, t), t
}

// TraceFrom returns the Trace attached to ctx, or nil.
func TraceFrom(ctx context.Context) *Trace {
	t, _ := ctx.Value(traceKey{}).(*Trace)
	return t
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
	proxies  pooltypes.ProxyStore
	settings pooltypes.SettingsStore

	mu     sync.Mutex
	rr     int                        // round-robin cursor
	sticky map[string]int64           // provider → chosen proxy id (sticky mode)
	rtc    map[int64]http.RoundTripper // cache transports by proxy id
}

// NewProxyDoer wraps inner with proxy routing driven by the given stores.
func NewProxyDoer(inner Doer, proxies pooltypes.ProxyStore, settings pooltypes.SettingsStore) *ProxyDoer {
	return &ProxyDoer{
		inner: inner, proxies: proxies, settings: settings,
		sticky: map[string]int64{}, rtc: map[int64]http.RoundTripper{},
	}
}

func (d *ProxyDoer) Do(r *http.Request) (*http.Response, error) {
	prov := providerFrom(r.Context())
	rt, id, label, ok := d.pick(r.Context(), prov)
	if !ok {
		return d.inner.Do(r)
	}
	if t := TraceFrom(r.Context()); t != nil {
		t.Proxy = label
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
// proxy's transport, id, and label. Returns ok=false to go direct.
func (d *ProxyDoer) pick(ctx context.Context, prov string) (http.RoundTripper, int64, string, bool) {
	if d.proxies == nil || d.settings == nil {
		return nil, 0, "", false
	}
	if v, _ := d.settings.Get(ctx, setProxyEnabled); v != "true" {
		return nil, 0, "", false
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
				return nil, 0, "", false
			}
		}
	}
	all, err := d.proxies.List(ctx)
	if err != nil {
		return nil, 0, "", false
	}
	live := all[:0]
	for _, p := range all {
		if p.Enabled && p.Status != "dead" {
			live = append(live, p)
		}
	}
	if len(live) == 0 {
		return nil, 0, "", false
	}

	mode, _ := d.settings.Get(ctx, setProxyMode)
	chosen := d.choose(prov, mode, live)
	rt, err := d.transportFor(chosen)
	if err != nil {
		return nil, 0, "", false
	}
	return rt, chosen.ID, chosen.Label, true
}

// choose selects a proxy from the live set per mode (rotate | random | sticky).
func (d *ProxyDoer) choose(prov, mode string, live []pooltypes.Proxy) pooltypes.Proxy {
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
func (d *ProxyDoer) transportFor(p pooltypes.Proxy) (http.RoundTripper, error) {
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
