package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/internal/integrations"
	"github.com/enowdev/enowx/store"
	"github.com/enowdev/enowx/core/tunnel"
)

// Integrations connects local CLI coding tools to this gateway by writing their
// config files (base URL + API key + model).
type Integrations struct {
	keys    store.KeyStore
	tunnel  *tunnel.Manager
	port    int
	changed func() // register a newly-created key with the cloud (Free-AI auth)
}

func NewIntegrations(keys store.KeyStore, tun *tunnel.Manager, port int) *Integrations {
	return &Integrations{keys: keys, tunnel: tun, port: port, changed: func() {}}
}

// SetKeyChanged wires the callback fired when a key is auto-created.
func (h *Integrations) SetKeyChanged(f func()) {
	if f != nil {
		h.changed = f
	}
}

// baseURL resolves the gateway base the tools should target: the public tunnel
// hostname when one is up, else localhost:<port>.
func (h *Integrations) baseURL() string {
	if h.tunnel != nil {
		if st := h.tunnel.Status(); st.Hostname != "" {
			return "https://" + st.Hostname
		}
	}
	return fmt.Sprintf("http://localhost:%d", h.port)
}

// apiKey returns an existing gateway key's secret, creating one if none exists —
// so connecting a tool is one click even for a fresh install.
func (h *Integrations) apiKey(ctx context.Context) (string, error) {
	rows, err := h.keys.List(ctx)
	if err != nil {
		return "", err
	}
	for _, k := range rows {
		if k.Enabled && k.Secret != "" {
			return k.Secret, nil
		}
	}
	secret, err := generateKey()
	if err != nil {
		return "", err
	}
	if _, err := h.keys.Add(ctx, store.APIKey{Label: "Integrations", Secret: secret, Enabled: true}); err != nil {
		return "", err
	}
	h.changed()
	return secret, nil
}

// Info returns the resolved base URL + API key the modal pre-fills.
// GET /api/integrations/info
func (h *Integrations) Info(w http.ResponseWriter, r *http.Request) {
	key, err := h.apiKey(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"base_url": h.baseURL(), "api_key": key})
}

// List returns every tool's live status.
// GET /api/integrations
func (h *Integrations) List(w http.ResponseWriter, r *http.Request) {
	base := h.baseURL()
	out := make([]integrations.Status, 0, len(integrations.Specs()))
	for _, s := range integrations.Specs() {
		out = append(out, integrations.StatusOf(s, base))
	}
	writeData(w, out)
}

// Apply writes a tool's config to point at the gateway.
// POST /api/integrations/{tool}
func (h *Integrations) Apply(w http.ResponseWriter, r *http.Request) {
	spec, ok := integrations.SpecByKey(chi.URLParam(r, "tool"))
	if !ok {
		writeAPIErr(w, http.StatusNotFound, "unknown tool")
		return
	}
	var req integrations.ApplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	req.BaseURL = firstNonEmptyStr(req.BaseURL, h.baseURL())
	if req.APIKey == "" {
		if k, err := h.apiKey(r.Context()); err == nil {
			req.APIKey = k
		}
	}
	if err := integrations.Apply(spec, req); err != nil {
		writeAPIErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeData(w, integrations.StatusOf(spec, h.baseURL()))
}

// Reset removes the gateway's config from a tool.
// DELETE /api/integrations/{tool}
func (h *Integrations) Reset(w http.ResponseWriter, r *http.Request) {
	spec, ok := integrations.SpecByKey(chi.URLParam(r, "tool"))
	if !ok {
		writeAPIErr(w, http.StatusNotFound, "unknown tool")
		return
	}
	if err := integrations.Reset(spec); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, integrations.StatusOf(spec, h.baseURL()))
}

// Snippet returns a tool's config files as copy-paste content (remote setup).
// POST /api/integrations/{tool}/snippet
func (h *Integrations) Snippet(w http.ResponseWriter, r *http.Request) {
	spec, ok := integrations.SpecByKey(chi.URLParam(r, "tool"))
	if !ok {
		writeAPIErr(w, http.StatusNotFound, "unknown tool")
		return
	}
	var req integrations.ApplyRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	req.BaseURL = firstNonEmptyStr(req.BaseURL, h.baseURL())
	if req.APIKey == "" {
		if k, err := h.apiKey(r.Context()); err == nil {
			req.APIKey = k
		}
	}
	writeData(w, map[string]any{"snippets": integrations.Snippets(spec, req)})
}

func firstNonEmptyStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
