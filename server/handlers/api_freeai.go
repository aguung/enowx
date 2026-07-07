package handlers

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	syncpkg "github.com/enowdev/enowx/core/sync"
	"github.com/enowdev/enowx/server/middleware"
)

// FreeAI proxies the Free-AI account-donation endpoints to the cloud.
// Dashboard-gated; the cloud health-checks + stores the donated credentials.
type FreeAI struct {
	dash *middleware.Dashboard
	sync *syncpkg.Manager
}

func NewFreeAI(dash *middleware.Dashboard, sm *syncpkg.Manager) *FreeAI {
	return &FreeAI{dash: dash, sync: sm}
}

func (h *FreeAI) rawJSON(w http.ResponseWriter, raw string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"data":` + raw + `}`))
}

// POST /api/free-ai/donate — JSON {provider, label, creds{endpoint,api_key,model}}.
func (h *FreeAI) Donate(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad request")
		return
	}
	raw, err := h.sync.FreeAIDonate(r.Context(), body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.rawJSON(w, raw)
}

// GET /api/ai/info — where to send Free-AI requests. The inference endpoint
// lives on the cloud (dev or prod, per this gateway's sync config), NOT locally.
func (h *FreeAI) Info(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	base := h.sync.ServerURL(r.Context())
	writeData(w, map[string]any{
		"endpoint": base + "/ai/v1/chat/completions",
		"base":     base,
	})
}

// GET /api/ai/models — models the pool can currently serve.
func (h *FreeAI) Models(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	raw, err := h.sync.FreeAIModels(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.rawJSON(w, raw)
}

// GET /api/free-ai/donations
func (h *FreeAI) List(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	raw, err := h.sync.FreeAIDonations(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.rawJSON(w, raw)
}

// DELETE /api/free-ai/donations/{id}
func (h *FreeAI) Withdraw(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	raw, err := h.sync.FreeAIWithdraw(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.rawJSON(w, raw)
}
