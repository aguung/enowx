package transport

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/enowdev/enowx/store"
)

// fakeSettings is a minimal in-memory SettingsStore.
type fakeSettings struct{ m map[string]string }

func (f *fakeSettings) Get(_ context.Context, k string) (string, error) { return f.m[k], nil }
func (f *fakeSettings) Set(_ context.Context, k, v string) error        { f.m[k] = v; return nil }

// fakeProxyStore is a minimal in-memory ProxyStore holding one proxy.
type fakeProxyStore struct{ p store.Proxy }

func newFakeProxyStore(host string, port int) *fakeProxyStore {
	return &fakeProxyStore{p: store.Proxy{ID: 1, Scheme: "http", Host: host, Port: port, Enabled: true, Status: "ok"}}
}
func (f *fakeProxyStore) List(context.Context) ([]store.Proxy, error) { return []store.Proxy{f.p}, nil }
func (f *fakeProxyStore) Add(context.Context, store.Proxy) (int64, error) { return 1, nil }
func (f *fakeProxyStore) Delete(context.Context, int64) error            { return nil }
func (f *fakeProxyStore) SetEnabled(context.Context, int64, bool) error  { return nil }
func (f *fakeProxyStore) SetStatus(_ context.Context, _ int64, status string, _ int) error {
	f.p.Status = status
	return nil
}

func TestProxyDoerRoutesThroughProxy(t *testing.T) {
	// A stand-in "proxy": an http server that records it was hit, then serves a
	// 200. For an http proxy, the client sends the full URL in the request line;
	// our handler just answers 200 regardless, which is enough to prove routing.
	var hits int32
	proxySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(200)
		_, _ = w.Write([]byte("ok"))
	}))
	defer proxySrv.Close()
	u, _ := url.Parse(proxySrv.URL)
	host := u.Hostname()
	port, _ := strconv.Atoi(u.Port())

	settings := &fakeSettings{m: map[string]string{
		setProxyEnabled:   "true",
		setProxyMode:      "rotate",
		setProxyProviders: "", // all providers
	}}
	proxies := newFakeProxyStore(host, port)

	// Inner doer should NOT be called when the proxy handles it.
	inner := doerFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("inner doer called; request was not routed through the proxy")
		return nil, nil
	})
	d := NewProxyDoer(inner, proxies, settings)

	// A request tagged with a provider that's in scope (whitelist empty = all).
	req, _ := http.NewRequestWithContext(WithProvider(context.Background(), "codebuddy"),
		http.MethodGet, "http://example.com/", nil)
	resp, err := d.Do(req)
	if err != nil {
		t.Fatalf("Do error: %v", err)
	}
	resp.Body.Close()
	if atomic.LoadInt32(&hits) == 0 {
		t.Fatal("proxy was never hit")
	}
}

func TestProxyDoerBypassesWhenDisabled(t *testing.T) {
	settings := &fakeSettings{m: map[string]string{setProxyEnabled: "false"}}
	var innerCalled bool
	inner := doerFunc(func(*http.Request) (*http.Response, error) {
		innerCalled = true
		return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
	})
	d := NewProxyDoer(inner, newFakeProxyStore("127.0.0.1", 1), settings)
	req, _ := http.NewRequestWithContext(WithProvider(context.Background(), "kiro"), http.MethodGet, "http://x/", nil)
	resp, _ := d.Do(req)
	if resp != nil {
		resp.Body.Close()
	}
	if !innerCalled {
		t.Fatal("expected direct (inner) request when proxy routing is disabled")
	}
}

func TestProxyDoerWhitelistExcludes(t *testing.T) {
	settings := &fakeSettings{m: map[string]string{
		setProxyEnabled:   "true",
		setProxyProviders: `["codebuddy"]`, // only codebuddy is proxied
	}}
	var innerCalled bool
	inner := doerFunc(func(*http.Request) (*http.Response, error) {
		innerCalled = true
		return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
	})
	d := NewProxyDoer(inner, newFakeProxyStore("127.0.0.1", 1), settings)
	// "kiro" is NOT in the whitelist → must go direct.
	req, _ := http.NewRequestWithContext(WithProvider(context.Background(), "kiro"), http.MethodGet, "http://x/", nil)
	resp, _ := d.Do(req)
	if resp != nil {
		resp.Body.Close()
	}
	if !innerCalled {
		t.Fatal("expected direct request for a provider outside the whitelist")
	}
}

// doerFunc adapts a func to the Doer interface.
type doerFunc func(*http.Request) (*http.Response, error)

func (f doerFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }
