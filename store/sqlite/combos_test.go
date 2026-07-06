package sqlite

import (
	"context"
	"testing"

	"github.com/enowdev/enowx/store"
)

func TestComboStore(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	ctx := context.Background()
	combos := db.Combos()

	id, err := combos.Add(ctx, store.ModelCombo{
		Name:     "myclaude",
		Targets:  []string{"kr/claude-sonnet-4-5", "cc/claude-sonnet-4-20250514", "ag/gemini-3-pro"},
		Strategy: store.ComboRoundRobin,
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	list, err := combos.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: got %d combos, err %v", len(list), err)
	}
	if got := list[0].Targets; len(got) != 3 || got[1] != "cc/claude-sonnet-4-20250514" {
		t.Fatalf("targets not round-tripped: %v", got)
	}

	// NextIndex must cycle 0,1,2,0,1,... for a 3-target combo. Nothing is held
	// in memory between calls — each one reads/writes the row directly.
	want := []int{0, 1, 2, 0, 1}
	for i, w := range want {
		got, err := combos.NextIndex(ctx, id, 3)
		if err != nil {
			t.Fatalf("NextIndex[%d]: %v", i, err)
		}
		if got != w {
			t.Errorf("NextIndex[%d] = %d, want %d", i, got, w)
		}
	}

	if err := combos.Update(ctx, store.ModelCombo{ID: id, Name: "renamed", Targets: []string{"kr/x"}, Strategy: store.ComboFailover}); err != nil {
		t.Fatalf("update: %v", err)
	}
	m := combos.Map(ctx)
	if _, ok := m["myclaude"]; ok {
		t.Error("old name still present after rename")
	}
	if c, ok := m["renamed"]; !ok || c.Strategy != store.ComboFailover {
		t.Errorf("renamed combo not found or strategy wrong: %+v", c)
	}

	if err := combos.SetByName(ctx, "synced", []string{"kr/y"}, store.ComboFailover); err != nil {
		t.Fatalf("SetByName: %v", err)
	}
	if err := combos.SetByName(ctx, "synced", []string{"kr/y", "cc/z"}, store.ComboRoundRobin); err != nil {
		t.Fatalf("SetByName (upsert): %v", err)
	}
	if c, ok := combos.Map(ctx)["synced"]; !ok || len(c.Targets) != 2 || c.Targets[1] != "cc/z" || c.Strategy != store.ComboRoundRobin {
		t.Errorf("SetByName did not upsert in place: %+v (ok=%v)", c, ok)
	}
	if err := combos.DeleteByName(ctx, "synced"); err != nil {
		t.Fatalf("DeleteByName: %v", err)
	}

	if err := combos.Delete(ctx, id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if list, _ = combos.List(ctx); len(list) != 0 {
		t.Fatalf("expected empty list after delete, got %d", len(list))
	}
}
