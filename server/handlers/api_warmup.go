package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/store"
)

// Warmer runs an automatic warmup on a freshly-added account (credit check +
// test request) and sets its status before it enters the pool. The Warmup
// handler implements it.
type Warmer interface {
	WarmAccount(ctx context.Context, acc *store.Account) (status string, resp map[string]any)
}

// genericLabel reports whether a label is empty or a known placeholder (so it
// should be replaced by a resolved email). A user's custom label is preserved.
func genericLabel(label string) bool {
	l := strings.TrimSpace(strings.ToLower(label))
	switch l {
	case "", "kiro", "kiro desktop", "kiro cli":
		return true
	}
	return false
}

// autoWarm looks up a just-added account and warms it up (if a Warmer is wired),
// returning the warmup response for inclusion in the add reply. Best-effort: on
// any lookup failure it returns nil and the account keeps its saved status.
func autoWarm(ctx context.Context, warmer Warmer, st store.AccountStore, id int64) map[string]any {
	if warmer == nil {
		return nil
	}
	rows, err := st.List(ctx, "")
	if err != nil {
		return nil
	}
	for i := range rows {
		if rows[i].ID == id {
			_, resp := warmer.WarmAccount(ctx, &rows[i])
			return resp
		}
	}
	return nil
}

// Warmup sends a real probe request to the upstream to verify an account is
// alive, updates its status from the outcome, and fetches credit usage when the
// provider supports it.
type Warmup struct {
	proxy   *proxy.Proxy
	reg     *provider.Registry
	store   store.AccountStore
	logs    store.WarmupStore
	reqLogs store.LogStore
}

func NewWarmup(p *proxy.Proxy, reg *provider.Registry, s store.AccountStore, logs store.WarmupStore, reqLogs store.LogStore) *Warmup {
	return &Warmup{proxy: p, reg: reg, store: s, logs: logs, reqLogs: reqLogs}
}

// warmupModel is a valid, cheap model accepted by each provider's upstream.
var warmupModel = map[string]string{
	"codebuddy":    "gemini-2.5-flash",
	"codebuddy-cn": "deepseek-v4-flash",
	"kiro":         "claude-sonnet-4",
	"codex":        "gpt-5.4-mini",
	"antigravity":  "gemini-3.5-flash-low",
	"claudecode":   "claude-haiku-4-5",
}

// warmupSystem is set for providers that reject requests without a system turn
// (codebuddy returns "parse failed" otherwise).
var warmupSystem = map[string]string{
	"codebuddy":    "You are a helpful assistant.",
	"codebuddy-cn": "You are a helpful assistant.",
}

func (h *Warmup) Run(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
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

	_, resp := h.WarmAccount(r.Context(), acc)
	writeData(w, resp)
}

// TestModel sends a real "reply with hi" probe to a SPECIFIC model on a specific
// account and records it in the request log — the "Test model" button. It does
// not change the account status.
// POST /api/accounts/{id}/test-model  { "model": "cx/gpt-5.4" }
func (h *Warmup) TestModel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in struct {
		Model string `json:"model"`
		Type  string `json:"type"`
	}
	body, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(body, &in)
	if strings.TrimSpace(in.Model) == "" {
		writeAPIErr(w, http.StatusBadRequest, "model is required")
		return
	}

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

	// The picker sends the prefixed id (e.g. cx/gpt-5.4); strip it for upstream.
	_, bare := proxy.SplitModel(in.Model)

	// Image models use the image-generation path.
	if in.Type == "image" {
		h.testImage(w, r, acc, in.Model, bare)
		return
	}

	pacc := provider.Account{ID: acc.ID, Secret: acc.Secret, Creds: acc.Creds}
	req := probeRequest(acc.Provider, bare)

	start := time.Now()
	res := h.proxy.Probe(r.Context(), acc.Provider, pacc, req)
	durMS := time.Since(start).Milliseconds()

	// Record it as a request so it shows in Requests + Statistics.
	if h.reqLogs != nil {
		var inTok, outTok int64
		if res.Usage != nil {
			inTok, outTok = res.Usage.PromptTokens, res.Usage.CompletionTokens
		}
		logStatus := "success"
		if res.Outcome != provider.OutcomeOK {
			logStatus = "error"
		}
		_ = h.reqLogs.Insert(r.Context(), store.RequestLog{
			Provider:  acc.Provider,
			Model:     in.Model,
			Status:    logStatus,
			Source:    "test",
			InTokens:  inTok,
			OutTokens: outTok,
			LatencyMS: durMS,
		})
	}

	resp := map[string]any{
		"ok":       res.Outcome == provider.OutcomeOK,
		"model":    in.Model,
		"latency":  durMS,
		"response": res.Response,
	}
	if res.Err != nil && res.Outcome != provider.OutcomeOK {
		resp["error"] = res.Err.Error()
	}
	writeData(w, resp)
}

// testImage runs a tiny image-generation probe and logs it.
func (h *Warmup) testImage(w http.ResponseWriter, r *http.Request, acc *store.Account, displayModel, bare string) {
	start := time.Now()
	_, err := h.proxy.GenerateImage(r.Context(), acc.Provider, provider.ImageRequest{Model: bare, Prompt: "a small red circle", N: 1, Size: "512x512"})
	durMS := time.Since(start).Milliseconds()

	logStatus := "success"
	if err != nil {
		logStatus = "error"
	}
	if h.reqLogs != nil {
		_ = h.reqLogs.Insert(r.Context(), store.RequestLog{
			Provider: acc.Provider, Model: displayModel, Status: logStatus, Source: "test", LatencyMS: durMS,
		})
	}
	if err != nil {
		writeData(w, map[string]any{"ok": false, "model": displayModel, "latency": durMS, "error": err.Error()})
		return
	}
	writeData(w, map[string]any{"ok": true, "model": displayModel, "latency": durMS, "response": "image generated"})
}

// WarmAccount runs a warmup on an account: a credit check (when the provider
// supports it) plus a real test request, sets the account's status from the
// outcome, and records warmup + request logs. Returns the new status and a
// response map (same shape the Run endpoint returns). Reused for the automatic
// warmup performed when an account is added.
func (h *Warmup) WarmAccount(ctx context.Context, acc *store.Account) (string, map[string]any) {
	pacc := provider.Account{ID: acc.ID, Secret: acc.Secret, Creds: acc.Creds}

	// Non-chat providers (e.g. Suno music) can't be probed with a chat request —
	// accept them as active and just fetch usage/credit if supported.
	if prov, err := h.reg.Get(acc.Provider); err == nil && !prov.Caps().Chat {
		_ = h.store.SetStatus(ctx, acc.ID, "active")
		out := map[string]any{"ok": true, "status": "active"}
		if rep, ok := prov.(provider.UsageReporter); ok {
			out["usage_supported"] = true
			if u, uerr := rep.Usage(pacc); uerr == nil && u != nil {
				out["usage"] = u
			}
		}
		return "active", out
	}

	// Resolve the warmup model: a curated cheap one when known, else the
	// provider's own first model (custom/compat providers), so we never probe an
	// unrelated default (e.g. gpt-4o-mini) against the wrong upstream.
	wm := warmupModel[acc.Provider]
	if wm == "" {
		if prov, err := h.reg.Get(acc.Provider); err == nil {
			if mf, ok := prov.(provider.ModelFetcher); ok {
				if models, merr := mf.Models(pacc); merr == nil && len(models) > 0 {
					wm = models[0].ID
				}
			}
		}
	}
	req := probeRequest(acc.Provider, wm)

	// Label the account by email when the provider can resolve one and the label
	// is empty or generic (e.g. token-added kiro accounts).
	if prov, err := h.reg.Get(acc.Provider); err == nil {
		if er, ok := prov.(provider.EmailReporter); ok && genericLabel(acc.Label) {
			if email := er.Email(pacc); email != "" {
				_ = h.store.SetLabel(ctx, acc.ID, email)
				acc.Label = email
			}
		}
	}

	start := time.Now()
	res := h.proxy.Probe(ctx, acc.Provider, pacc, req)
	durMS := time.Since(start).Milliseconds()
	status := statusFromOutcome(res.Outcome)
	_ = h.store.SetStatus(ctx, acc.ID, status)

	resp := map[string]any{
		"ok":     res.Outcome == provider.OutcomeOK,
		"status": status,
	}
	if res.Err != nil && res.Outcome != provider.OutcomeOK {
		resp["error"] = res.Err.Error()
	}

	// Credit/usage: prefer a dedicated usage endpoint (kiro); otherwise fall back
	// to the usage block returned inside the probe's chat reply (codebuddy).
	var usageJSON string
	var usageMap map[string]any
	if prov, err := h.reg.Get(acc.Provider); err == nil {
		if reporter, ok := prov.(provider.UsageReporter); ok {
			resp["usage_supported"] = true
			if u, err := reporter.Usage(pacc); err == nil {
				usageMap = map[string]any{"limit": u.Limit, "used": u.Used, "remaining": u.Remaining, "plan": u.Plan}
			}
		} else {
			resp["usage_supported"] = false
		}
	}
	if usageMap == nil && res.Usage != nil && res.Usage.Credit > 0 {
		// codebuddy: credit comes back in the chat reply's usage block.
		resp["usage_supported"] = true
		usageMap = map[string]any{"credit": res.Usage.Credit, "in_tokens": res.Usage.PromptTokens, "out_tokens": res.Usage.CompletionTokens}
	}
	if usageMap != nil {
		resp["usage"] = usageMap
		if b, e := json.Marshal(usageMap); e == nil {
			usageJSON = string(b)
		}
	}

	// Record the warmup as a request so it shows in Requests + Statistics.
	if h.reqLogs != nil {
		var inTok, outTok int64
		if res.Usage != nil {
			inTok, outTok = res.Usage.PromptTokens, res.Usage.CompletionTokens
		}
		logStatus := "success"
		if res.Outcome != provider.OutcomeOK {
			logStatus = "error"
		}
		_ = h.reqLogs.Insert(ctx, store.RequestLog{
			Provider:  acc.Provider,
			Model:     req.Model,
			Status:    logStatus,
			Source:    "warmup",
			InTokens:  inTok,
			OutTokens: outTok,
			LatencyMS: durMS,
		})
	}

	_ = h.logs.Insert(ctx, store.WarmupLog{
		AccountID:  acc.ID,
		Provider:   acc.Provider,
		Label:      acc.Label,
		OK:         res.Outcome == provider.OutcomeOK,
		Outcome:    outcomeName(res.Outcome),
		Status:     status,
		Request:    string(req.Raw),
		Response:   res.Response,
		Usage:      usageJSON,
		DurationMS: durMS,
	})

	return status, resp
}

func statusFromOutcome(o provider.Outcome) string {
	switch o {
	case provider.OutcomeOK:
		return "active"
	case provider.OutcomeExhausted:
		return "exhausted"
	case provider.OutcomeDead:
		return "banned"
	default:
		return "active" // transient: leave usable
	}
}

func outcomeName(o provider.Outcome) string {
	switch o {
	case provider.OutcomeOK:
		return "ok"
	case provider.OutcomeExhausted:
		return "exhausted"
	case provider.OutcomeDead:
		return "dead"
	default:
		return "transient"
	}
}

// Clear deletes all warmup log entries.
func (h *Warmup) Clear(w http.ResponseWriter, r *http.Request) {
	if err := h.logs.Clear(r.Context()); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

// List returns recent warmup log entries for the Warmup Logs app.
func (h *Warmup) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.logs.Recent(r.Context(), limit)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, l := range rows {
		out = append(out, map[string]any{
			"id":          l.ID,
			"account_id":  l.AccountID,
			"provider":    l.Provider,
			"label":       l.Label,
			"ok":          l.OK,
			"outcome":     l.Outcome,
			"status":      l.Status,
			"request":     l.Request,
			"response":    l.Response,
			"usage":       l.Usage,
			"duration_ms": l.DurationMS,
			"created_at":  l.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}
	writeData(w, out)
}

// warmupRequest builds a minimal "reply with hi" probe usable by both

// probeRequest builds a "reply with hi" probe for a specific model id.
func probeRequest(providerName, modelID string) *model.Request {
	if modelID == "" {
		modelID = "gpt-4o-mini"
	}

	msgs := []map[string]string{}
	parts := []model.Message{}
	if sys := warmupSystem[providerName]; sys != "" {
		msgs = append(msgs, map[string]string{"role": "system", "content": sys})
		parts = append(parts, model.Message{Role: model.RoleSystem, Parts: []model.Part{{Type: "text", Text: sys}}})
	}
	msgs = append(msgs, map[string]string{"role": "user", "content": "reply with hi"})
	parts = append(parts, model.Message{Role: model.RoleUser, Parts: []model.Part{{Type: "text", Text: "reply with hi"}}})

	raw, _ := json.Marshal(map[string]any{
		"model":          modelID,
		"stream":         true,
		"max_tokens":     8,
		"stream_options": map[string]any{"include_usage": true},
		"messages":       msgs,
	})
	return &model.Request{
		Source:   model.APIOpenAIChat,
		Model:    modelID,
		Stream:   true,
		Messages: parts,
		Raw:      raw,
	}
}
