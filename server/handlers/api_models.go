package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/core/sync"
	"github.com/enowdev/enowx/store"
)

// Models lists the models an account can access. Providers whose upstream
// exposes a live model list (ModelFetcher, e.g. kiro, openai-compat) are fetched
// with the account's credentials; the rest fall back to the cloud-managed
// catalog (GET /models?provider=), editable from the admin panel.
type Models struct {
	reg    *provider.Registry
	store  store.AccountStore
	mgr    *sync.Manager
	combos store.ComboStore
}

func NewModels(reg *provider.Registry, s store.AccountStore, mgr *sync.Manager, combos store.ComboStore) *Models {
	return &Models{reg: reg, store: s, mgr: mgr, combos: combos}
}

func (h *Models) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	acc, err := h.account(r, id)
	if err != nil {
		writeAPIErr(w, http.StatusNotFound, "account not found")
		return
	}
	out, source := h.modelsFor(r.Context(), acc)
	writeData(w, map[string]any{"provider": acc.Provider, "source": source, "models": out})
}

// modelsFor resolves the models an account can access: live from upstream for
// fetchable providers, otherwise the cloud DB catalog. Ids carry the provider
// prefix (e.g. "kr/…"). Returns the list and its source ("upstream"|"catalog").
func (h *Models) modelsFor(ctx context.Context, acc store.Account) ([]modelDTO, string) {
	prov, err := h.reg.Get(acc.Provider)
	if err != nil {
		return nil, "catalog"
	}
	prefix := proxy.ProviderPrefix(acc.Provider)

	if fetcher, ok := prov.(provider.ModelFetcher); ok {
		if models, err := fetcher.Models(provider.Account{ID: acc.ID, Secret: acc.Secret, Creds: acc.Creds}); err == nil {
			out := make([]modelDTO, 0, len(models))
			for _, m := range models {
				out = append(out, modelDTO{ID: prefixed(prefix, m.ID), ModelID: prefixed(prefix, m.ID), Name: m.Name, Type: m.Type, OwnedBy: m.OwnedBy})
			}
			return out, "upstream"
		}
		// Live fetch failed → fall through to the catalog.
	}
	cat := h.mgr.ProviderModels(ctx, acc.Provider)
	out := make([]modelDTO, 0, len(cat))
	for _, m := range cat {
		out = append(out, modelDTO{ID: prefixed(prefix, m.ModelID), ModelID: prefixed(prefix, m.ModelID), Name: m.Name, Type: m.Type, OwnedBy: m.OwnedBy, MaxInput: m.MaxInput, MaxOutput: m.MaxOutput})
	}
	return out, "catalog"
}

// All aggregates the models across every enabled account, deduped by model id —
// the unified picker list for the Chat view (no account selection).
func (h *Models) All(w http.ResponseWriter, r *http.Request) {
	rows, err := h.store.List(r.Context(), "")
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	seen := map[string]bool{}
	out := []modelDTO{}
	seenProvider := map[string]bool{} // one account per provider is enough
	for _, acc := range rows {
		if acc.Disabled || seenProvider[acc.Provider] {
			continue
		}
		seenProvider[acc.Provider] = true
		models, _ := h.modelsFor(r.Context(), acc)
		for _, m := range models {
			if m.ModelID == "" || seen[m.ModelID] {
				continue
			}
			seen[m.ModelID] = true
			out = append(out, m)
		}
	}
	if h.combos != nil {
		if combos, err := h.combos.List(r.Context()); err == nil {
			for _, c := range combos {
				if c.Name == "" || seen[c.Name] {
					continue
				}
				seen[c.Name] = true
				out = append(out, modelDTO{ID: c.Name, ModelID: c.Name, Name: c.Name, Type: "chat", OwnedBy: "combo"})
			}
		}
	}
	writeData(w, map[string]any{"models": out})
}

// V1Models serves the OpenAI-standard GET /v1/models: the list of model ids
// this gateway accepts (same prefixed ids as /v1/chat/completions), in the
// {"object":"list","data":[{"id","object":"model",...}]} shape OpenAI clients
// (and tools like 9router) expect. Without this route the request fell through
// to the SPA and returned HTML, so clients reported "failed to fetch models".
func (h *Models) V1Models(w http.ResponseWriter, r *http.Request) {
	rows, err := h.store.List(r.Context(), "")
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	seen := map[string]bool{}
	seenProvider := map[string]bool{}
	data := []map[string]any{}
	for _, acc := range rows {
		if acc.Disabled || seenProvider[acc.Provider] {
			continue
		}
		seenProvider[acc.Provider] = true
		models, _ := h.modelsFor(r.Context(), acc)
		for _, m := range models {
			if m.ModelID == "" || seen[m.ModelID] {
				continue
			}
			seen[m.ModelID] = true
			owned := m.OwnedBy
			if owned == "" {
				owned = acc.Provider
			}
			data = append(data, map[string]any{
				"id": m.ModelID, "object": "model", "created": 0, "owned_by": owned,
			})
		}
	}
	// Bare OpenAI shape (not wrapped in {"data":...} like the dashboard API).
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data})
}

// modelDTO is the per-account model list item (model_id carries the provider
// prefix, e.g. "kr/claude-sonnet-4.5").
type modelDTO struct {
	ID        string `json:"id"`
	ModelID   string `json:"model_id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	OwnedBy   string `json:"owned_by,omitempty"`
	MaxInput  int    `json:"max_input,omitempty"`
	MaxOutput int    `json:"max_output,omitempty"`
}

func prefixed(prefix, id string) string {
	if prefix == "" {
		return id
	}
	return prefix + "/" + id
}

func (h *Models) account(r *http.Request, id int64) (store.Account, error) {
	rows, err := h.store.List(r.Context(), "")
	if err != nil {
		return store.Account{}, err
	}
	for _, a := range rows {
		if a.ID == id {
			return a, nil
		}
	}
	return store.Account{}, errNotFound
}
