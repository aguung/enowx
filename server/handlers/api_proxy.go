package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/proxypool"
	"github.com/enowdev/enowx/store"
)

// settings keys for proxy routing (KV in the settings store).
const (
	setProxyEnabled   = "proxy_enabled"   // "true" to route through the pool
	setProxyMode      = "proxy_mode"      // rotate | random | sticky
	setProxyProviders = "proxy_providers" // JSON array of provider names ([] = all)
)

// Proxy is the management API over the outbound proxy pool.
type Proxy struct {
	store    store.ProxyStore
	settings store.SettingsStore
	onWrite  func() // push pool changes to the cloud now (nil if not syncing)
}

func NewProxy(s store.ProxyStore, settings store.SettingsStore) *Proxy {
	return &Proxy{store: s, settings: settings}
}

// SetSyncPush registers a callback to propagate pool changes (esp. deletes) to
// the cloud immediately, so a background pull can't resurrect them.
func (h *Proxy) SetSyncPush(f func()) { h.onWrite = f }

func (h *Proxy) pushSoon() {
	if h.onWrite != nil {
		go h.onWrite()
	}
}

// List returns the whole pool.
func (h *Proxy) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Never leak passwords to the UI; it doesn't need them to render.
	for i := range list {
		list[i].Password = ""
	}
	writeData(w, map[string]any{"proxies": list})
}

// Add accepts one or many proxies in any format ({"text": "..."} for bulk, or a
// single {"raw": "..."}). Returns how many were added + any parse errors.
func (h *Proxy) Add(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Raw  string `json:"raw"`
		Text string `json:"text"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	_ = json.Unmarshal(body, &in)
	input := in.Text
	if input == "" {
		input = in.Raw
	}
	parsed, bad := proxypool.ParseBulk(input)
	if len(parsed) == 0 {
		writeAPIErr(w, http.StatusBadRequest, "no valid proxies found")
		return
	}
	added := 0
	for _, p := range parsed {
		if _, err := h.store.Add(r.Context(), store.Proxy{
			Label: p.Label(), Scheme: p.Scheme, Host: p.Host, Port: p.Port,
			Username: p.User, Password: p.Pass,
		}); err == nil {
			added++
		}
	}
	h.pushSoon()
	writeData(w, map[string]any{"added": added, "errors": bad})
}

// Delete removes one proxy.
func (h *Proxy) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.store.Delete(r.Context(), id); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.pushSoon()
	writeData(w, map[string]any{"ok": true})
}

// Toggle enables/disables one proxy.
func (h *Proxy) Toggle(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Enabled bool `json:"enabled"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	_ = json.Unmarshal(body, &in)
	if err := h.store.SetEnabled(r.Context(), id, in.Enabled); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.pushSoon()
	writeData(w, map[string]any{"ok": true})
}

// Test dials one proxy and does a small HTTP GET to confirm it works + measures
// latency, updating the stored status.
func (h *Proxy) Test(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	list, err := h.store.List(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var target *store.Proxy
	for i := range list {
		if list[i].ID == id {
			target = &list[i]
			break
		}
	}
	if target == nil {
		writeAPIErr(w, http.StatusNotFound, "proxy not found")
		return
	}
	status, latency, terr := probeProxy(r.Context(), *target)
	_ = h.store.SetStatus(r.Context(), id, status, latency)
	out := map[string]any{"status": status, "latency_ms": latency}
	if terr != nil {
		out["error"] = terr.Error()
	}
	writeData(w, out)
}

// GetSettings returns the proxy routing config (mode + provider whitelist).
func (h *Proxy) GetSettings(w http.ResponseWriter, r *http.Request) {
	enabled, _ := h.settings.Get(r.Context(), setProxyEnabled)
	mode, _ := h.settings.Get(r.Context(), setProxyMode)
	provRaw, _ := h.settings.Get(r.Context(), setProxyProviders)
	providers := []string{}
	if provRaw != "" {
		_ = json.Unmarshal([]byte(provRaw), &providers)
	}
	writeData(w, map[string]any{
		"enabled":   enabled == "true",
		"mode":      nzStr(mode, "rotate"),
		"providers": providers,
	})
}

// SaveSettings updates the proxy routing config.
func (h *Proxy) SaveSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled   bool     `json:"enabled"`
		Mode      string   `json:"mode"`
		Providers []string `json:"providers"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if json.Unmarshal(body, &in) != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	mode := in.Mode
	if mode != "rotate" && mode != "random" && mode != "sticky" {
		mode = "rotate"
	}
	provJSON, _ := json.Marshal(in.Providers)
	_ = h.settings.Set(r.Context(), setProxyEnabled, boolStr(in.Enabled))
	_ = h.settings.Set(r.Context(), setProxyMode, mode)
	_ = h.settings.Set(r.Context(), setProxyProviders, string(provJSON))
	writeData(w, map[string]any{"ok": true})
}

// probeProxy dials the proxy and fetches a tiny endpoint, returning
// (status, latencyMS, err). status is "ok" or "dead".
func probeProxy(ctx context.Context, p store.Proxy) (string, int, error) {
	pp := proxypool.Proxy{Scheme: p.Scheme, Host: p.Host, Port: p.Port, User: p.Username, Pass: p.Password}
	client, err := proxypool.HTTPClient(pp, 12*time.Second)
	if err != nil {
		return "dead", 0, err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.ipify.org", nil)
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return "dead", 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	latency := int(time.Since(start).Milliseconds())
	if resp.StatusCode >= 400 {
		return "dead", latency, nil
	}
	return "ok", latency, nil
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func nzStr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
