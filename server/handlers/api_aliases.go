package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/store"
)

// Aliases manages the user's local model aliases (per-instance, not synced).
type Aliases struct {
	store  store.AliasStore
	combos store.ComboStore // for cross-namespace name-collision checks
}

func NewAliases(s store.AliasStore, combos store.ComboStore) *Aliases {
	return &Aliases{store: s, combos: combos}
}

func (h *Aliases) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"aliases": list})
}

func (h *Aliases) Set(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Alias  string `json:"alias"`
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	alias := strings.TrimSpace(body.Alias)
	target := strings.TrimSpace(body.Target)
	if alias == "" || target == "" {
		writeAPIErr(w, http.StatusBadRequest, "alias and target required")
		return
	}
	if h.combos != nil {
		if combos, err := h.combos.List(r.Context()); err == nil {
			for _, c := range combos {
				if c.Name == alias {
					writeAPIErr(w, http.StatusConflict, "name already used by a combo")
					return
				}
			}
		}
	}
	if err := h.store.Set(r.Context(), alias, target); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"alias": alias, "target": target})
}

func (h *Aliases) Delete(w http.ResponseWriter, r *http.Request) {
	alias := chi.URLParam(r, "alias")
	if err := h.store.Delete(r.Context(), alias); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"deleted": alias})
}
