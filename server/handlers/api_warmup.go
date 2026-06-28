package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/store"
)

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
	"codebuddy": "gemini-2.5-flash",
	"kiro":      "claude-sonnet-4",
}

// warmupSystem is set for providers that reject requests without a system turn
// (codebuddy returns "parse failed" otherwise).
var warmupSystem = map[string]string{
	"codebuddy": "You are a helpful assistant.",
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

	pacc := provider.Account{ID: acc.ID, Secret: acc.Secret, Creds: acc.Creds}
	req := warmupRequest(acc.Provider)

	start := time.Now()
	res := h.proxy.Probe(r.Context(), acc.Provider, pacc, req)
	durMS := time.Since(start).Milliseconds()
	status := statusFromOutcome(res.Outcome)
	_ = h.store.SetStatus(r.Context(), acc.ID, status)

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
		_ = h.reqLogs.Insert(r.Context(), store.RequestLog{
			Provider:  acc.Provider,
			Model:     req.Model,
			Status:    logStatus,
			Source:    "warmup",
			InTokens:  inTok,
			OutTokens: outTok,
			LatencyMS: durMS,
		})
	}

	_ = h.logs.Insert(r.Context(), store.WarmupLog{
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

	writeData(w, resp)
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
// passthrough providers (via Raw) and structured ones (via Messages). A system
// turn is included for providers that require it (e.g. codebuddy).
func warmupRequest(providerName string) *model.Request {
	modelID := warmupModel[providerName]
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
