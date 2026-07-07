package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"
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

	setProxyAutoCheck    = "proxy_autocheck_enabled" // "true" to periodically re-test every proxy
	setProxyAutoCheckMin = "proxy_autocheck_minutes" // interval in minutes (default 30)
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

// RunAutoCheck periodically re-tests every proxy when auto-check is enabled,
// updating each proxy's status + latency. It re-reads the interval each tick so
// changing the setting takes effect without a restart. Launch once at startup.
func (h *Proxy) RunAutoCheck(ctx context.Context) {
	// Check at a fixed 30s cadence whether it's time to run; this lets the
	// configurable interval change live without recreating the ticker.
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	var last time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if v, _ := h.settings.Get(ctx, setProxyAutoCheck); v != "true" {
				continue
			}
			interval := time.Duration(h.autoCheckMinutes(ctx)) * time.Minute
			if time.Since(last) < interval {
				continue
			}
			last = time.Now()
			h.checkAll(ctx)
		}
	}
}

// checkAll probes every proxy in the pool (bounded concurrency) and records the
// result. Best-effort; individual failures just mark that proxy dead.
func (h *Proxy) checkAll(ctx context.Context) {
	list, err := h.store.List(ctx)
	if err != nil || len(list) == 0 {
		return
	}
	sem := make(chan struct{}, 8) // don't hammer all proxies at once
	var wg sync.WaitGroup
	for i := range list {
		p := list[i]
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			status, latency, _ := probeProxy(ctx, p)
			_ = h.store.SetStatus(ctx, p.ID, status, latency)
		}()
	}
	wg.Wait()
	h.pushSoon() // reflect updated statuses to the cloud
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
	autoCheck, _ := h.settings.Get(r.Context(), setProxyAutoCheck)
	writeData(w, map[string]any{
		"enabled":           enabled == "true",
		"mode":              nzStr(mode, "rotate"),
		"providers":         providers,
		"autocheck_enabled": autoCheck == "true",
		"autocheck_minutes": h.autoCheckMinutes(r.Context()),
	})
}

// autoCheckMinutes reads the stored interval, defaulting to 30 and clamping to
// a sane [1, 1440] range.
func (h *Proxy) autoCheckMinutes(ctx context.Context) int {
	raw, _ := h.settings.Get(ctx, setProxyAutoCheckMin)
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 30
	}
	if n > 1440 {
		n = 1440
	}
	return n
}

// SaveSettings updates the proxy routing config.
func (h *Proxy) SaveSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled          bool     `json:"enabled"`
		Mode             string   `json:"mode"`
		Providers        []string `json:"providers"`
		AutoCheckEnabled bool     `json:"autocheck_enabled"`
		AutoCheckMinutes int      `json:"autocheck_minutes"`
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
	mins := in.AutoCheckMinutes
	if mins < 1 {
		mins = 30
	} else if mins > 1440 {
		mins = 1440
	}
	provJSON, _ := json.Marshal(in.Providers)
	_ = h.settings.Set(r.Context(), setProxyEnabled, boolStr(in.Enabled))
	_ = h.settings.Set(r.Context(), setProxyMode, mode)
	_ = h.settings.Set(r.Context(), setProxyProviders, string(provJSON))
	_ = h.settings.Set(r.Context(), setProxyAutoCheck, boolStr(in.AutoCheckEnabled))
	_ = h.settings.Set(r.Context(), setProxyAutoCheckMin, strconv.Itoa(mins))
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

// rotationKey mirrors core/pool: the per-provider account-selection mode.
func rotationKey(provider string) string { return "pool_rotation:" + provider }

// GetRotation returns a provider's account-selection mode ("sticky"|"round-robin").
// GET /api/providers/{name}/rotation
func (h *Proxy) GetRotation(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	v, _ := h.settings.Get(r.Context(), rotationKey(name))
	mode := "sticky"
	if v == "round-robin" {
		mode = "round-robin"
	}
	writeData(w, map[string]any{"mode": mode})
}

// SetRotation sets a provider's account-selection mode.
// PUT /api/providers/{name}/rotation {mode}
func (h *Proxy) SetRotation(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var in struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	mode := "sticky"
	if in.Mode == "round-robin" {
		mode = "round-robin"
	}
	_ = h.settings.Set(r.Context(), rotationKey(name), mode)
	writeData(w, map[string]any{"ok": true, "mode": mode})
}
