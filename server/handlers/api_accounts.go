package handlers

import (
	"context"
	"fmt"
	"encoding/json"
	"io"
	"strings"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/localcreds"
	"github.com/enowdev/enowx/store"
)

// Accounts is the management API over the credential pool.
type Accounts struct {
	store   store.AccountStore
	warmer  Warmer
	onWrite func() // fire-and-forget: push local changes to the cloud now
	// donate hands an account's creds to the cloud Free-AI pool; returns the
	// cloud's raw JSON reply (nil disables the feature — not syncing).
	donate func(ctx context.Context, provider string, creds map[string]string, models []string) (string, error)
	// resolveEmail resolves an account's email via its provider (EmailReporter),
	// returning "" if unavailable. Used to backfill generic labels.
	resolveEmail func(a store.Account) string
}

func NewAccounts(s store.AccountStore) *Accounts { return &Accounts{store: s} }

// SetEmailResolver wires provider-based email resolution for label backfill.
func (h *Accounts) SetEmailResolver(f func(a store.Account) string) { h.resolveEmail = f }

// backfillLabels resolves + persists emails for generic-labelled accounts in the
// background, so a re-list shows the real email. Fire-and-forget; each account is
// only resolved when its label is still generic.
func (h *Accounts) backfillLabels(rows []store.Account) {
	if h.resolveEmail == nil {
		return
	}
	go func() {
		ctx := context.Background()
		for _, a := range rows {
			if a.Creds["email"] != "" || !genericLabel(a.Label) {
				continue
			}
			if email := h.resolveEmail(a); email != "" {
				a.Creds["email"] = email
				_ = h.store.UpdateCreds(ctx, a.ID, a.Creds)
				if genericLabel(a.Label) {
					_ = h.store.SetLabel(ctx, a.ID, email)
				}
			}
		}
	}()
}

// SetDonate wires the Free-AI donation call (via the sync manager).
func (h *Accounts) SetDonate(f func(ctx context.Context, provider string, creds map[string]string, models []string) (string, error)) {
	h.donate = f
}

// SetWarmer enables automatic warmup of newly-added accounts.
func (h *Accounts) SetWarmer(w Warmer) { h.warmer = w }

// SetSyncPush registers a callback that pushes local account changes to the
// cloud immediately. Called after a delete so the deletion's tombstone lands
// before the next background pull can re-add the account (bug: deleted accounts
// coming back). A no-op if the user isn't syncing.
func (h *Accounts) SetSyncPush(f func()) { h.onWrite = f }

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
	// Fall back the display label to the account email when no label was set —
	// so every provider that resolves an email (including claudecode) shows it.
	label := a.Label
	if label == "" {
		label = a.Creds["email"]
	}
	return accountDTO{
		ID:        a.ID,
		Provider:  a.Provider,
		Label:     label,
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
	h.backfillLabels(rows) // resolve missing emails in the background
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

// Donate hands a local account's credentials to the cloud Free-AI pool, then —
// on success — deletes it locally (it now lives in the shared pool). The client
// supplies the models this account should serve.
func (h *Accounts) Donate(w http.ResponseWriter, r *http.Request) {
	if h.donate == nil {
		writeAPIErr(w, http.StatusServiceUnavailable, "sign in to the cloud to donate accounts")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Models []string `json:"models"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<14))
	_ = json.Unmarshal(body, &in)

	// Find the account (with creds) by id.
	rows, err := h.store.List(r.Context(), "")
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var acc *store.Account
	for i := range rows {
		if rows[i].ID == id {
			acc = &rows[i]
			break
		}
	}
	if acc == nil {
		writeAPIErr(w, http.StatusNotFound, "account not found")
		return
	}
	// Assemble the credential map (secret folds into api_key for single-token).
	creds := map[string]string{}
	for k, v := range acc.Creds {
		creds[k] = v
	}
	if acc.Secret != "" {
		if _, ok := creds["api_key"]; !ok {
			creds["api_key"] = acc.Secret
		}
	}
	raw, err := h.donateOne(r.Context(), acc, in.Models)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if h.onWrite != nil {
		go h.onWrite()
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"data":` + raw + `}`))
}

// nonDonatable are providers that must never be donated to the community pool
// (e.g. Claude Code — its accounts are ban-prone when shared).
var nonDonatable = map[string]bool{"claudecode": true}

// donateOne hands one account's creds to the pool and, on success, deletes it
// locally. Returns the cloud's raw JSON reply.
func (h *Accounts) donateOne(ctx context.Context, acc *store.Account, models []string) (string, error) {
	if nonDonatable[acc.Provider] {
		return "", fmt.Errorf("%s accounts cannot be donated", acc.Provider)
	}
	creds := map[string]string{}
	for k, v := range acc.Creds {
		creds[k] = v
	}
	if acc.Secret != "" {
		if _, ok := creds["api_key"]; !ok {
			creds["api_key"] = acc.Secret
		}
	}
	raw, err := h.donate(ctx, acc.Provider, creds, models)
	if err != nil {
		return "", err
	}
	if err := h.store.Delete(ctx, acc.ID); err != nil {
		return "", err
	}
	return raw, nil
}

// DonateBulk donates up to `quantity` LIVE accounts of a provider from the local
// pool: it warms (health-checks) each candidate and donates the ones that come
// back active, until the quantity is met. The user just picks a provider + count.
func (h *Accounts) DonateBulk(w http.ResponseWriter, r *http.Request) {
	if h.donate == nil {
		writeAPIErr(w, http.StatusServiceUnavailable, "sign in to the cloud to donate accounts")
		return
	}
	var in struct {
		Provider string `json:"provider"`
		Quantity int    `json:"quantity"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<14))
	_ = json.Unmarshal(body, &in)
	provider := strings.TrimSpace(in.Provider)
	if provider == "" || in.Quantity < 1 {
		writeAPIErr(w, http.StatusBadRequest, "provider and a positive quantity are required")
		return
	}
	if in.Quantity > 100 {
		in.Quantity = 100
	}

	rows, err := h.store.List(r.Context(), provider)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	donated, checked, failed := 0, 0, 0
	var lastErr string
	for i := range rows {
		if donated >= in.Quantity {
			break
		}
		acc := rows[i]
		if acc.Disabled {
			continue
		}
		checked++
		// Health check: warm the account; only donate if it comes back active.
		if h.warmer != nil {
			status, _ := h.warmer.WarmAccount(r.Context(), &acc)
			if status != "" && status != "active" {
				failed++
				continue
			}
		}
		if _, err := h.donateOne(r.Context(), &acc, nil); err != nil {
			failed++
			lastErr = err.Error()
			continue
		}
		donated++
	}
	if h.onWrite != nil {
		go h.onWrite()
	}
	writeData(w, map[string]any{"donated": donated, "checked": checked, "failed": failed, "last_error": lastErr})
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
	// Propagate the deletion to the cloud now (tombstone push) so a background
	// pull can't resurrect it. Non-blocking; no-op when the user isn't syncing.
	if h.onWrite != nil {
		go h.onWrite()
	}
	writeData(w, map[string]any{"ok": true})
}
