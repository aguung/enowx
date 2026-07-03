package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/localcreds"
	"github.com/enowdev/enowx/store"
)

// Accounts is the management API over the credential pool.
type Accounts struct {
	store  store.AccountStore
	warmer Warmer
}

func NewAccounts(s store.AccountStore) *Accounts { return &Accounts{store: s} }

// SetWarmer enables automatic warmup of newly-added accounts.
func (h *Accounts) SetWarmer(w Warmer) { h.warmer = w }

type accountDTO struct {
	ID        int64    `json:"id"`
	Provider  string   `json:"provider"`
	Label     string   `json:"label"`
	Status    string   `json:"status"`
	Disabled  bool     `json:"disabled"`
	Has       []string `json:"has"` // credential keys present (never the values)
	CanApply  bool     `json:"can_apply"` // creds can be written to a local IDE/CLI
	CreatedAt string   `json:"created_at"`
}

func toDTO(a store.Account) accountDTO {
	has := make([]string, 0, len(a.Creds)+1)
	if a.Secret != "" {
		has = append(has, "secret")
	}
	for k := range a.Creds {
		has = append(has, k)
	}
	return accountDTO{
		ID:        a.ID,
		Provider:  a.Provider,
		Label:     a.Label,
		Status:    a.Status,
		Disabled:  a.Disabled,
		Has:       has,
		CanApply:  localcreds.SupportsApply(a.Provider) && len(a.Creds) > 0,
		CreatedAt: a.CreatedAt.Format("2006-01-02 15:04"),
	}
}

func (h *Accounts) List(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	rows, err := h.store.List(r.Context(), provider)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]accountDTO, 0, len(rows))
	for _, a := range rows {
		out = append(out, toDTO(a))
	}
	writeData(w, out)
}

type addAccountReq struct {
	Provider string            `json:"provider"`
	Label    string            `json:"label"`
	Secret   string            `json:"secret"`
	Creds    map[string]string `json:"creds"`
}

func (h *Accounts) Add(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var in addAccountReq
	if err := json.Unmarshal(body, &in); err != nil || in.Provider == "" {
		writeAPIErr(w, http.StatusBadRequest, "provider is required")
		return
	}
	if in.Secret == "" && len(in.Creds) == 0 {
		writeAPIErr(w, http.StatusBadRequest, "a secret or credentials are required")
		return
	}
	id, err := h.store.Add(r.Context(), store.Account{
		Provider: in.Provider,
		Label:    in.Label,
		Secret:   in.Secret,
		Creds:    in.Creds,
		Status:   "active",
	})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Auto-warmup before the account enters the pool (credit check + test
	// request); the result is included so the UI can show it immediately. Bulk
	// importers pass ?warmup=0 to skip it (warming hundreds of accounts inline is
	// slow + rate-limited; the user can Warm all afterwards).
	out := map[string]any{"id": id}
	if q := r.URL.Query().Get("warmup"); q != "0" && q != "false" {
		if warm := autoWarm(r.Context(), h.warmer, h.store, id); warm != nil {
			out["warmup"] = warm
		}
	}
	writeData(w, out)
}

type setStatusReq struct {
	Status string `json:"status"`
}

func (h *Accounts) SetStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in setStatusReq
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &in); err != nil || in.Status == "" {
		writeAPIErr(w, http.StatusBadRequest, "status is required")
		return
	}
	if err := h.store.SetStatus(r.Context(), id, in.Status); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Accounts) SetDisabled(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Disabled bool `json:"disabled"`
	}
	body, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(body, &in)
	if err := h.store.SetDisabled(r.Context(), id, in.Disabled); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Accounts) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.store.Delete(r.Context(), id); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}
