package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/mitm"
)

// MITM exposes the local HTTPS-intercept proxy that reroutes a proprietary IDE's
// hardcoded endpoint through this gateway.
type MITM struct {
	mgr  *mitm.Manager
	dash guardFn
}

// guardFn authorizes a request (dashboard login when remote).
type guardFn func(r *http.Request) bool

func NewMITM(mgr *mitm.Manager, dash guardFn) *MITM { return &MITM{mgr: mgr, dash: dash} }

func (h *MITM) ok(w http.ResponseWriter, r *http.Request) bool {
	if h.mgr == nil {
		writeAPIErr(w, http.StatusServiceUnavailable, "mitm is not available")
		return false
	}
	if h.dash != nil && !h.dash(r) {
		writeAPIErr(w, http.StatusForbidden, "mitm requires the dashboard login when accessed remotely")
		return false
	}
	return true
}

// Status returns the CA/proxy/tool state. GET /api/mitm
func (h *MITM) Status(w http.ResponseWriter, r *http.Request) {
	if !h.ok(w, r) {
		return
	}
	writeData(w, h.mgr.Status())
}

// InstallTrust installs the CA into the trust store. POST /api/mitm/trust
func (h *MITM) InstallTrust(w http.ResponseWriter, r *http.Request) {
	if !h.ok(w, r) {
		return
	}
	if err := h.mgr.InstallTrust(); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, h.mgr.Status())
}

// Start / Stop the proxy. POST /api/mitm/start | /api/mitm/stop
func (h *MITM) Start(w http.ResponseWriter, r *http.Request) {
	if !h.ok(w, r) {
		return
	}
	if err := h.mgr.Start(); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, h.mgr.Status())
}

func (h *MITM) Stop(w http.ResponseWriter, r *http.Request) {
	if !h.ok(w, r) {
		return
	}
	h.mgr.Stop()
	writeData(w, h.mgr.Status())
}

// EnableTool toggles a tool's DNS redirect. POST /api/mitm/{tool}/enable {on}
func (h *MITM) EnableTool(w http.ResponseWriter, r *http.Request) {
	if !h.ok(w, r) {
		return
	}
	var in struct {
		On bool `json:"on"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	if err := h.mgr.EnableTool(chi.URLParam(r, "tool"), in.On); err != nil {
		writeAPIErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeData(w, h.mgr.Status())
}

// SetAliases replaces a tool's model map. PUT /api/mitm/{tool}/aliases {aliases}
func (h *MITM) SetAliases(w http.ResponseWriter, r *http.Request) {
	if !h.ok(w, r) {
		return
	}
	var in struct {
		Aliases map[string]string `json:"aliases"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	if err := h.mgr.SetAliases(chi.URLParam(r, "tool"), in.Aliases); err != nil {
		writeAPIErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeData(w, h.mgr.Status())
}
