package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/sync"
	"github.com/enowdev/enowx/store"
)

// Models lists the models an account can access. Providers whose upstream
// exposes a live model list (ModelFetcher, e.g. kiro, openai-compat) are fetched
// with the account's credentials; the rest fall back to the cloud-managed
// catalog (GET /models?provider=), editable from the admin panel.
type Models struct {
	reg   *provider.Registry
	store store.AccountStore
	mgr   *sync.Manager
}

func NewModels(reg *provider.Registry, s store.AccountStore, mgr *sync.Manager) *Models {
	return &Models{reg: reg, store: s, mgr: mgr}
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
	prov, err := h.reg.Get(acc.Provider)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Fetchable provider → live from upstream using this account's creds.
	if fetcher, ok := prov.(provider.ModelFetcher); ok {
		models, err := fetcher.Models(provider.Account{ID: acc.ID, Secret: acc.Secret, Creds: acc.Creds})
		if err == nil {
			writeData(w, map[string]any{"provider": acc.Provider, "source": "upstream", "models": models})
			return
		}
		// If the live fetch fails, fall through to the DB catalog as a backup.
	}

	// Non-fetchable (or fetch failed) → cloud DB catalog.
	models := h.mgr.ProviderModels(r.Context(), acc.Provider)
	writeData(w, map[string]any{"provider": acc.Provider, "source": "catalog", "models": models})
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
