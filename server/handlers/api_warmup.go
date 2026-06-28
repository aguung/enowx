package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

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
	proxy *proxy.Proxy
	reg   *provider.Registry
	store store.AccountStore
}

func NewWarmup(p *proxy.Proxy, reg *provider.Registry, s store.AccountStore) *Warmup {
	return &Warmup{proxy: p, reg: reg, store: s}
}

// warmupModel is the cheap model used to probe each provider.
var warmupModel = map[string]string{
	"codebuddy": "gpt-4o-mini",
	"kiro":      "claude-sonnet-4",
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

	outcome, probeErr := h.proxy.Probe(r.Context(), acc.Provider, pacc, req)
	status := statusFromOutcome(outcome)
	_ = h.store.SetStatus(r.Context(), acc.ID, status)

	resp := map[string]any{
		"ok":     outcome == provider.OutcomeOK,
		"status": status,
	}
	if probeErr != nil && outcome != provider.OutcomeOK {
		resp["error"] = probeErr.Error()
	}

	// Credit usage when the provider supports it.
	if prov, err := h.reg.Get(acc.Provider); err == nil {
		if reporter, ok := prov.(provider.UsageReporter); ok {
			resp["usage_supported"] = true
			if u, err := reporter.Usage(pacc); err == nil {
				resp["usage"] = u
			}
		} else {
			resp["usage_supported"] = false
		}
	}

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

// warmupRequest builds a minimal "reply with hi" probe usable by both
// passthrough providers (via Raw) and structured ones (via Messages).
func warmupRequest(providerName string) *model.Request {
	modelID := warmupModel[providerName]
	if modelID == "" {
		modelID = "gpt-4o-mini"
	}
	raw, _ := json.Marshal(map[string]any{
		"model":      modelID,
		"stream":     true,
		"max_tokens": 8,
		"messages":   []map[string]string{{"role": "user", "content": "reply with hi"}},
	})
	return &model.Request{
		Source: model.APIOpenAIChat,
		Model:  modelID,
		Stream: true,
		Messages: []model.Message{
			{Role: model.RoleUser, Parts: []model.Part{{Type: "text", Text: "reply with hi"}}},
		},
		Raw: raw,
	}
}
