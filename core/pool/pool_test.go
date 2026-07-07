package pool

import (
	"context"
	"testing"

	"github.com/enowdev/enowx/core/pooltypes"
)

type fakeAccounts struct{ rows []pooltypes.Account }

func (f *fakeAccounts) List(context.Context, string) ([]pooltypes.Account, error) {
	return f.rows, nil
}
func (f *fakeAccounts) Add(context.Context, pooltypes.Account) (int64, error)   { return 0, nil }
func (f *fakeAccounts) SetStatus(context.Context, int64, string) error          { return nil }
func (f *fakeAccounts) SetDisabled(context.Context, int64, bool) error          { return nil }
func (f *fakeAccounts) SetLabel(context.Context, int64, string) error           { return nil }
func (f *fakeAccounts) UpdateCreds(context.Context, int64, map[string]string) error { return nil }
func (f *fakeAccounts) Delete(context.Context, int64) error                     { return nil }

type fakeSettings struct{ m map[string]string }

func (f fakeSettings) Get(_ context.Context, k string) (string, error) { return f.m[k], nil }
func (f fakeSettings) Set(_ context.Context, k, v string) error        { f.m[k] = v; return nil }

func threeActive() *fakeAccounts {
	return &fakeAccounts{rows: []pooltypes.Account{
		{ID: 1, Status: "active"}, {ID: 2, Status: "active"}, {ID: 3, Status: "active"},
	}}
}

// Sticky (default): every pick returns the first active account.
func TestPickSticky(t *testing.T) {
	p := New(threeActive()).WithSettings(fakeSettings{m: map[string]string{}})
	for i := 0; i < 5; i++ {
		a, err := p.Pick(context.Background(), "claudecode")
		if err != nil || a.ID != 1 {
			t.Fatalf("sticky pick %d = #%d (err %v), want #1", i, a.ID, err)
		}
	}
}

// Round-robin: picks cycle through all accounts.
func TestPickRoundRobin(t *testing.T) {
	p := New(threeActive()).WithSettings(fakeSettings{m: map[string]string{"pool_rotation:claudecode": "round-robin"}})
	want := []int64{1, 2, 3, 1, 2, 3}
	for i, w := range want {
		a, err := p.Pick(context.Background(), "claudecode")
		if err != nil || a.ID != w {
			t.Fatalf("rr pick %d = #%d (err %v), want #%d", i, a.ID, err, w)
		}
	}
}

// Round-robin still skips tried (failed) accounts on rotation.
func TestRoundRobinSkipsTried(t *testing.T) {
	p := New(threeActive()).WithSettings(fakeSettings{m: map[string]string{"pool_rotation:claudecode": "round-robin"}})
	a, err := p.PickExcept(context.Background(), "claudecode", map[int64]bool{1: true, 2: true})
	if err != nil || a.ID != 3 {
		t.Fatalf("PickExcept skipping 1,2 = #%d (err %v), want #3", a.ID, err)
	}
}

// No settings store → sticky.
func TestNilSettingsSticky(t *testing.T) {
	p := New(threeActive())
	a, _ := p.Pick(context.Background(), "claudecode")
	if a.ID != 1 {
		t.Fatalf("nil-settings pick = #%d, want #1", a.ID)
	}
}
