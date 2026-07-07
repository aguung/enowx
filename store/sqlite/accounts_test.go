package sqlite

import (
	"context"
	"testing"

	"github.com/enowdev/enowx/store"
)

// Re-adding an OAuth account (same email, refreshed tokens) must update in place,
// not clone — this is the antigravity "37 copies" bug.
func TestAddDedupByEmail(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	ctx := context.Background()
	acc := db.Accounts()

	id1, _ := acc.Add(ctx, store.Account{Provider: "antigravity", Label: "a@x.com",
		Creds: map[string]string{"email": "a@x.com", "access_token": "tok1", "refresh_token": "r1"}})
	// Same email, new tokens (a re-auth) → should update id1, not insert.
	id2, _ := acc.Add(ctx, store.Account{Provider: "antigravity", Label: "a@x.com",
		Creds: map[string]string{"email": "a@x.com", "access_token": "tok2", "refresh_token": "r2"}})
	if id1 != id2 {
		t.Fatalf("re-add cloned: id1=%d id2=%d", id1, id2)
	}
	rows, _ := acc.List(ctx, "antigravity")
	if len(rows) != 1 {
		t.Fatalf("want 1 account, got %d", len(rows))
	}
	if rows[0].Creds["access_token"] != "tok2" {
		t.Fatalf("creds not refreshed: %s", rows[0].Creds["access_token"])
	}

	// A different email is a different account.
	acc.Add(ctx, store.Account{Provider: "antigravity", Label: "b@x.com", Creds: map[string]string{"email": "b@x.com"}})
	if rows, _ := acc.List(ctx, "antigravity"); len(rows) != 2 {
		t.Fatalf("different email should insert; got %d", len(rows))
	}
}

// API-key providers (no email) dedup on the secret.
func TestAddDedupBySecret(t *testing.T) {
	db, _ := Open(":memory:")
	defer db.Close()
	ctx := context.Background()
	acc := db.Accounts()

	id1, _ := acc.Add(ctx, store.Account{Provider: "codebuddy", Secret: "key-abc"})
	id2, _ := acc.Add(ctx, store.Account{Provider: "codebuddy", Secret: "key-abc"})
	if id1 != id2 {
		t.Fatalf("same secret cloned: %d %d", id1, id2)
	}
	acc.Add(ctx, store.Account{Provider: "codebuddy", Secret: "key-xyz"})
	if rows, _ := acc.List(ctx, "codebuddy"); len(rows) != 2 {
		t.Fatalf("want 2, got %d", len(rows))
	}
}

// Re-adding reactivates a disabled/banned account (same identity).
func TestAddReactivates(t *testing.T) {
	db, _ := Open(":memory:")
	defer db.Close()
	ctx := context.Background()
	acc := db.Accounts()

	id, _ := acc.Add(ctx, store.Account{Provider: "kiro", Creds: map[string]string{"email": "c@x.com"}})
	_ = acc.SetStatus(ctx, id, "banned")
	acc.Add(ctx, store.Account{Provider: "kiro", Creds: map[string]string{"email": "c@x.com", "access_token": "new"}})
	rows, _ := acc.List(ctx, "kiro")
	if len(rows) != 1 || rows[0].Status != "active" {
		t.Fatalf("want 1 active, got %d status=%s", len(rows), rows[0].Status)
	}
}
