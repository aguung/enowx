package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/store"
)

// Combos manages the user's local model combos: virtual models that resolve to
// an ordered list of real provider/model targets. Per-instance, cloud-synced
// for Full Sync users the same way aliases are (see core/sync).
type Combos struct {
	store   store.ComboStore
	aliases store.AliasStore // for cross-namespace name-collision checks
}

func NewCombos(s store.ComboStore, aliases store.AliasStore) *Combos {
	return &Combos{store: s, aliases: aliases}
}

func (h *Combos) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"combos": list})
}

type comboBody struct {
	Name     string              `json:"name"`
	Targets  []string            `json:"targets"`
	Strategy store.ComboStrategy `json:"strategy"`
}

func (h *Combos) Create(w http.ResponseWriter, r *http.Request) {
	var in comboBody
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if json.Unmarshal(body, &in) != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(in.Targets) == 0 {
		writeAPIErr(w, http.StatusBadRequest, "name and at least one target required")
		return
	}
	if h.nameTaken(r.Context(), name, 0) {
		writeAPIErr(w, http.StatusConflict, "name already used by an alias or combo")
		return
	}
	id, err := h.store.Add(r.Context(), store.ModelCombo{Name: name, Targets: in.Targets, Strategy: in.Strategy})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"id": id})
}

func (h *Combos) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in comboBody
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if json.Unmarshal(body, &in) != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(in.Targets) == 0 {
		writeAPIErr(w, http.StatusBadRequest, "name and at least one target required")
		return
	}
	if h.nameTaken(r.Context(), name, id) {
		writeAPIErr(w, http.StatusConflict, "name already used by an alias or combo")
		return
	}
	if err := h.store.Update(r.Context(), store.ModelCombo{ID: id, Name: name, Targets: in.Targets, Strategy: in.Strategy}); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Combos) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.store.Delete(r.Context(), id); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"deleted": id})
}

// nameTaken reports whether name is already used by an alias or by another
// combo. excludeID skips that combo id, so updating a combo without changing
// its name doesn't collide with itself (0 never matches a real id).
func (h *Combos) nameTaken(ctx context.Context, name string, excludeID int64) bool {
	if h.aliases != nil {
		if aliases, err := h.aliases.List(ctx); err == nil {
			for _, a := range aliases {
				if a.Alias == name {
					return true
				}
			}
		}
	}
	combos, err := h.store.List(ctx)
	if err != nil {
		return false
	}
	for _, c := range combos {
		if c.Name == name && c.ID != excludeID {
			return true
		}
	}
	return false
}
