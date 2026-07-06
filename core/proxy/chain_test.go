package proxy

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/store"
)

// fakeAccounts is a minimal store.AccountStore backing one account per
// provider name, for exercising Forward's existing account-rotation path.
type fakeAccounts struct{ byProvider map[string][]store.Account }

func (f *fakeAccounts) List(_ context.Context, providerName string) ([]store.Account, error) {
	return f.byProvider[providerName], nil
}
func (f *fakeAccounts) Add(context.Context, store.Account) (int64, error) { return 0, nil }
func (f *fakeAccounts) SetStatus(_ context.Context, id int64, status string) error {
	for p, accs := range f.byProvider {
		for i := range accs {
			if accs[i].ID == id {
				f.byProvider[p][i].Status = status
			}
		}
	}
	return nil
}
func (f *fakeAccounts) SetDisabled(context.Context, int64, bool) error              { return nil }
func (f *fakeAccounts) SetLabel(context.Context, int64, string) error               { return nil }
func (f *fakeAccounts) UpdateCreds(context.Context, int64, map[string]string) error { return nil }
func (f *fakeAccounts) Delete(context.Context, int64) error                         { return nil }

// fakeProvider is a minimal Provider: BuildRequest targets a host named after
// the provider, so the fake Doer below can decide success/failure per provider.
type fakeProvider struct{ name string }

func (p *fakeProvider) Name() string        { return p.name }
func (p *fakeProvider) Caps() provider.Caps { return provider.Caps{Chat: true} }
func (p *fakeProvider) BuildRequest(_ *model.Request, _ provider.Account) (*http.Request, error) {
	return &http.Request{URL: &url.URL{Scheme: "http", Host: p.name + ".test"}}, nil
}
func (p *fakeProvider) ParseResponse(_ *http.Response, _ *model.Request) (model.Stream, error) {
	return &fakeStream{}, nil
}
func (p *fakeProvider) Classify(status int, _ []byte) provider.Outcome {
	if status >= 500 {
		return provider.OutcomeDead
	}
	return provider.OutcomeTransient
}

type fakeStream struct{ done bool }

func (s *fakeStream) Recv() (model.Event, error) {
	if s.done {
		return model.Event{}, io.EOF
	}
	s.done = true
	return model.Event{Type: model.EventDone}, nil
}
func (s *fakeStream) Close() error { return nil }

// fakeDoer fails (500) for hosts in deadHosts and succeeds (200) otherwise,
// recording which hosts were actually called.
type fakeDoer struct {
	deadHosts map[string]bool
	called    []string
}

func (d *fakeDoer) Do(r *http.Request) (*http.Response, error) {
	d.called = append(d.called, r.URL.Host)
	status := http.StatusOK
	if d.deadHosts[r.URL.Host] {
		status = http.StatusInternalServerError
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("{}"))}, nil
}

func newTestProxy(t *testing.T, deadHosts map[string]bool) (*Proxy, *fakeDoer) {
	t.Helper()
	reg := provider.NewRegistry()
	reg.Register(&fakeProvider{name: "fakeA"})
	reg.Register(&fakeProvider{name: "fakeB"})
	AddPrefix("fakeA", "fakeA")
	AddPrefix("fakeB", "fakeB")
	t.Cleanup(func() { RemovePrefix("fakeA", "fakeA"); RemovePrefix("fakeB", "fakeB") })

	accounts := &fakeAccounts{byProvider: map[string][]store.Account{
		"fakeA": {{ID: 1, Provider: "fakeA", Status: "active"}},
		"fakeB": {{ID: 2, Provider: "fakeB", Status: "active"}},
	}}
	doer := &fakeDoer{deadHosts: deadHosts}
	return New(reg, pool.New(accounts), doer), doer
}

func testRoute(modelID string) string {
	p, _ := SplitModel(modelID)
	return p
}

func TestForwardChain_FallsThroughOnFailure(t *testing.T) {
	p, doer := newTestProxy(t, map[string]bool{"fakeA.test": true})
	req := &model.Request{Model: "combo"}

	stream, served, err := p.ForwardChain(context.Background(), testRoute, []string{"fakeA/model-a", "fakeB/model-b"}, 0, req)
	if err != nil {
		t.Fatalf("expected success via fallthrough, got err: %v", err)
	}
	if served != "fakeB/model-b" {
		t.Errorf("served = %q, want fakeB/model-b", served)
	}
	if stream == nil {
		t.Error("expected a non-nil stream")
	}
	if len(doer.called) != 2 {
		t.Errorf("expected both targets to be attempted, called = %v", doer.called)
	}
}

func TestForwardChain_AllFail(t *testing.T) {
	p, _ := newTestProxy(t, map[string]bool{"fakeA.test": true, "fakeB.test": true})
	req := &model.Request{Model: "combo"}

	_, _, err := p.ForwardChain(context.Background(), testRoute, []string{"fakeA/model-a", "fakeB/model-b"}, 0, req)
	if err == nil {
		t.Fatal("expected an error when every target fails")
	}
}

func TestForwardChain_RoundRobinStartsAtGivenIndex(t *testing.T) {
	p, doer := newTestProxy(t, nil) // both healthy
	req := &model.Request{Model: "combo"}

	_, served, err := p.ForwardChain(context.Background(), testRoute, []string{"fakeA/model-a", "fakeB/model-b"}, 1, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if served != "fakeB/model-b" {
		t.Errorf("served = %q, want fakeB/model-b (start index 1)", served)
	}
	if len(doer.called) != 1 || doer.called[0] != "fakeB.test" {
		t.Errorf("expected only fakeB to be called, got %v", doer.called)
	}
}

func TestForwardChain_EmptyTargets(t *testing.T) {
	p, _ := newTestProxy(t, nil)
	req := &model.Request{Model: "combo"}

	stream, served, err := p.ForwardChain(context.Background(), testRoute, []string{}, 0, req)
	if err == nil {
		t.Fatal("expected an error for empty targets")
	}
	if stream != nil {
		t.Error("expected a nil stream for empty targets")
	}
	if served != "" {
		t.Errorf("served = %q, want empty string", served)
	}
}
