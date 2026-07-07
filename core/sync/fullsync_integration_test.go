package sync

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/enowdev/enowx/store"
)

// This exercises the real snapshot→push→pull→apply path against the live staging
// server. Opt-in: set SYNC_IT_TOKEN to a session token holding cloud.sync.full.
//   SYNC_IT_TOKEN=sync-tester-token go test ./core/sync/ -run TestFullSyncIntegration -v

func TestFullSyncIntegration(t *testing.T) {
	token := os.Getenv("SYNC_IT_TOKEN")
	if token == "" {
		t.Skip("set SYNC_IT_TOKEN to run the live integration test")
	}
	ctx := context.Background()

	// --- Device A: has a custom provider + an account + a key + an alias. ---
	a := newFakeMgr(t, token)
	a.custom.rows = []store.CustomProvider{{Prefix: "itpfx", Name: "ITProv", Format: "openai", BaseURL: "https://x/v1", Models: []store.CustomModel{{ID: "m1", Name: "m1"}}}}
	a.accts.rows = []store.Account{{Provider: "ITProv", Label: "k1", Secret: "sk-it-secret", Creds: map[string]string{"api_key": "sk-it-secret"}}}
	a.keys.rows = []store.APIKey{{Label: "gw", Secret: "gw-it-secret", Enabled: true}}
	a.alias.rows = map[string]string{"fast": "itpfx/m1"}

	if _, _, err := a.mgr.Sync(ctx); err != nil {
		t.Fatalf("device A sync: %v", err)
	}

	// --- Device B: empty; pulls from cursor 0 and should materialize them. ---
	b := newFakeMgr(t, token)
	b.setCursor("0")
	if _, pulled, err := b.mgr.Sync(ctx); err != nil {
		t.Fatalf("device B sync: %v", err)
	} else {
		t.Logf("device B pulled %d", pulled)
	}

	if len(b.custom.rows) == 0 {
		t.Error("custom provider not synced to device B")
	}
	if len(b.accts.rows) == 0 {
		t.Error("account not synced to device B")
	} else if b.accts.rows[0].Secret != "sk-it-secret" {
		t.Errorf("account secret mismatch: %q", b.accts.rows[0].Secret)
	}
	if len(b.keys.rows) == 0 {
		t.Error("gateway key not synced to device B")
	}
	if b.alias.rows["fast"] != "itpfx/m1" {
		t.Errorf("alias not synced: %v", b.alias.rows)
	}

	// --- Device A deletes the account, then syncs → should tombstone on cloud. ---
	a.accts.rows = nil // user deleted the account locally
	if _, _, err := a.mgr.Sync(ctx); err != nil {
		t.Fatalf("device A re-sync after delete: %v", err)
	}

	// --- Device C: fresh, pulls from 0 → account must NOT re-appear. ---
	c := newFakeMgr(t, token)
	c.setCursor("0")
	if _, _, err := c.mgr.Sync(ctx); err != nil {
		t.Fatalf("device C sync: %v", err)
	}
	if len(c.accts.rows) != 0 {
		t.Errorf("deleted account resurrected on device C: %+v", c.accts.rows)
	}
	// Custom provider (not deleted) should still be there.
	if len(c.custom.rows) == 0 {
		t.Error("custom provider should still sync to device C")
	}
}

// --- fakes ---

type fakeMgr struct {
	mgr    *Manager
	set    *fakeSettings
	custom *fakeCustom
	accts  *fakeAccts
	keys   *fakeKeys
	alias  *fakeAlias
}

func newFakeMgr(t *testing.T, token string) *fakeMgr {
	t.Helper()
	set := &fakeSettings{kv: map[string]string{}}
	m := New(set, nil, nil)
	// Point at staging + set the token, then fetch /me to cache sync_key + entitlements.
	_ = m.SetServer(context.Background(), DefaultServerURL)
	set.kv[keyToken] = token
	if _, err := m.Me(context.Background()); err != nil {
		t.Fatalf("refresh /me: %v", err)
	}
	f := &fakeMgr{
		mgr: m, set: set,
		custom: &fakeCustom{}, accts: &fakeAccts{}, keys: &fakeKeys{}, alias: &fakeAlias{rows: map[string]string{}},
	}
	m.SetFullSync(f.accts, f.keys, f.alias, nil, f.custom, nil, func(store.CustomProvider) {}, func(string, string) {})
	// music is nil, so stub playlist snapshot: override by having no playlists.
	return f
}

func (f *fakeMgr) setCursor(v string) { f.set.kv[keyCursor] = v }

type fakeSettings struct{ kv map[string]string }

func (s *fakeSettings) Get(_ context.Context, k string) (string, error) { return s.kv[k], nil }
func (s *fakeSettings) Set(_ context.Context, k, v string) error        { s.kv[k] = v; return nil }

type fakeCustom struct{ rows []store.CustomProvider }

func (c *fakeCustom) List(context.Context) ([]store.CustomProvider, error) { return c.rows, nil }
func (c *fakeCustom) Get(_ context.Context, id int64) (*store.CustomProvider, error) {
	for i := range c.rows {
		if c.rows[i].ID == id {
			return &c.rows[i], nil
		}
	}
	return nil, nil
}
func (c *fakeCustom) Create(_ context.Context, p store.CustomProvider) (int64, error) {
	p.ID = int64(len(c.rows) + 1)
	c.rows = append(c.rows, p)
	return p.ID, nil
}
func (c *fakeCustom) Update(context.Context, store.CustomProvider) error { return nil }
func (c *fakeCustom) Delete(context.Context, int64) error                { return nil }

type fakeAccts struct{ rows []store.Account }

func (a *fakeAccts) List(_ context.Context, provider string) ([]store.Account, error) {
	if provider == "" {
		return a.rows, nil
	}
	var out []store.Account
	for _, r := range a.rows {
		if r.Provider == provider {
			out = append(out, r)
		}
	}
	return out, nil
}
func (a *fakeAccts) Add(_ context.Context, acc store.Account) (int64, error) {
	acc.ID = int64(len(a.rows) + 1)
	a.rows = append(a.rows, acc)
	return acc.ID, nil
}
func (a *fakeAccts) SetStatus(context.Context, int64, string) error              { return nil }
func (a *fakeAccts) SetDisabled(context.Context, int64, bool) error              { return nil }
func (a *fakeAccts) SetLabel(context.Context, int64, string) error               { return nil }
func (a *fakeAccts) UpdateCreds(context.Context, int64, map[string]string) error { return nil }
func (a *fakeAccts) Delete(context.Context, int64) error                         { return nil }

type fakeKeys struct{ rows []store.APIKey }

func (k *fakeKeys) List(context.Context) ([]store.APIKey, error) { return k.rows, nil }
func (k *fakeKeys) Add(_ context.Context, key store.APIKey) (int64, error) {
	key.ID = int64(len(k.rows) + 1)
	k.rows = append(k.rows, key)
	return key.ID, nil
}
func (k *fakeKeys) Delete(context.Context, int64) error { return nil }
func (k *fakeKeys) BySecret(_ context.Context, secret string) (*store.APIKey, error) {
	for i := range k.rows {
		if k.rows[i].Secret == secret {
			return &k.rows[i], nil
		}
	}
	return nil, nil
}
func (k *fakeKeys) AddUsage(context.Context, int64, int64) error { return nil }
func (k *fakeKeys) Count(context.Context) (int, error)           { return len(k.rows), nil }

type fakeAlias struct{ rows map[string]string }

func (a *fakeAlias) List(context.Context) ([]store.ModelAlias, error) {
	out := []store.ModelAlias{}
	for al, t := range a.rows {
		out = append(out, store.ModelAlias{Alias: al, Target: t})
	}
	return out, nil
}
func (a *fakeAlias) Set(_ context.Context, al, t string) error { a.rows[al] = t; return nil }
func (a *fakeAlias) Delete(_ context.Context, al string) error { delete(a.rows, al); return nil }
func (a *fakeAlias) Map(context.Context) map[string]string     { return a.rows }

var _ = json.Marshal
