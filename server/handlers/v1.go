// Package handlers holds the HTTP handlers (thin: decode → core → encode).
package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/enowdev/enowx/core/convert"
	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/server/sse"
	"github.com/enowdev/enowx/store"
)

type V1 struct {
	proxy      *proxy.Proxy
	route      func(modelID string) string // model → provider name
	logs       store.LogStore
	keys       store.KeyStore
	resolver   *proxy.AliasResolver // optional: alias → real model id
	combos     *proxy.ComboResolver
	comboStore store.ComboStore
}

func NewV1(p *proxy.Proxy, route func(string) string, logs store.LogStore, keys store.KeyStore) *V1 {
	return &V1{proxy: p, route: route, logs: logs, keys: keys}
}

// SetAliasResolver enables alias resolution on incoming model ids.
func (h *V1) SetAliasResolver(r *proxy.AliasResolver) { h.resolver = r }

// SetCombos enables combo resolution (virtual multi-target models) on incoming
// model ids.
func (h *V1) SetCombos(r *proxy.ComboResolver, s store.ComboStore) {
	h.combos, h.comboStore = r, s
}

func (h *V1) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read body")
		return
	}
	req, err := convert.Inbound(model.APIOpenAIChat, body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	if h.combos != nil {
		if combo, ok := h.combos.Lookup(r.Context(), req.Model); ok {
			h.serveCombo(w, r, req, combo, start)
			return
		}
	}
	// Resolve an aliased model to its real id, then strip any provider prefix
	// (kr/, cb/) so upstream sees the bare model id. The raw body is rewritten to
	// match; routing still uses the prefixed/aliased id first.
	orig := req.Model
	if h.resolver != nil {
		req.Model = h.resolver.Resolve(r.Context(), req.Model)
	}
	providerName := h.route(req.Model)
	if _, bare := proxy.SplitModel(req.Model); bare != req.Model {
		req.Model = bare
	}
	if req.Model != orig {
		req.Raw = proxy.RewriteBody(req.Raw, orig, req.Model)
	}
	// Attach a trace so the proxy/pool layers can report which account + proxy
	// actually served this request, for the log.
	ctx, trace := transport.WithTrace(r.Context())
	stream, err := h.proxy.Forward(ctx, providerName, req)
	if err != nil {
		h.log(providerName, req.Model, "error", start, model.Usage{}, trace)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	us := wrapUsage(stream)
	if req.Stream {
		sse.WriteOpenAI(w, us)
	} else {
		writeJSON(w, us)
	}
	h.log(providerName, req.Model, "success", start, us.usage, trace)
	chargeKey(r, h.keys, us.usage)
}

// serveCombo dispatches a request whose model id matched a combo definition:
// picks a start index per the combo's strategy, walks the target chain via
// ForwardChain, and logs/serves like a direct request would.
func (h *V1) serveCombo(w http.ResponseWriter, r *http.Request, req *model.Request, combo store.ModelCombo, start time.Time) {
	startIdx := 0
	if combo.Strategy == store.ComboRoundRobin && h.comboStore != nil {
		startIdx, _ = h.comboStore.NextIndex(r.Context(), combo.ID, len(combo.Targets))
	}
	ctx, trace := transport.WithTrace(r.Context())
	stream, served, err := h.proxy.ForwardChain(ctx, h.route, combo.Targets, startIdx, req)
	if err != nil {
		h.log("combo", req.Model, "error", start, model.Usage{}, trace)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	us := wrapUsage(stream)
	if req.Stream {
		sse.WriteOpenAI(w, us)
	} else {
		writeJSON(w, us)
	}
	h.log(h.route(served), served, "success", start, us.usage, trace)
	chargeKey(r, h.keys, us.usage)
}

func (h *V1) log(provider, modelID, status string, start time.Time, usage model.Usage, trace *transport.Trace) {
	if h.logs == nil {
		return
	}
	l := store.RequestLog{
		Provider:  provider,
		Model:     modelID,
		Status:    status,
		InTokens:  usage.PromptTokens,
		OutTokens: usage.CompletionTokens,
		LatencyMS: time.Since(start).Milliseconds(),
	}
	if trace != nil {
		l.ProxyUsed = trace.Proxy
		l.AccountLabel = trace.Account
	}
	_ = h.logs.Insert(context.Background(), l)
}

func writeJSON(w http.ResponseWriter, s interface{ Recv() (model.Event, error) }) {
	var text, modelID, finish string
	// Reassemble streamed tool-call fragments (by index) into whole calls.
	type acc struct {
		id, name, args string
	}
	calls := map[int]*acc{}
	var order []int
	for {
		ev, err := s.Recv()
		if err != nil || ev.Type == model.EventDone {
			break
		}
		text += ev.Text
		if ev.Model != "" {
			modelID = ev.Model
		}
		if ev.FinishReason != "" {
			finish = ev.FinishReason
		}
		for _, t := range ev.ToolCalls {
			a := calls[t.Index]
			if a == nil {
				a = &acc{}
				calls[t.Index] = a
				order = append(order, t.Index)
			}
			if t.ID != "" {
				a.id = t.ID
			}
			if t.Name != "" {
				a.name = t.Name
			}
			a.args += t.ArgsDelta
		}
	}
	msg := map[string]any{"role": "assistant", "content": text}
	if len(order) > 0 {
		tc := make([]map[string]any, 0, len(order))
		for _, i := range order {
			a := calls[i]
			tc = append(tc, map[string]any{
				"id": a.id, "type": "function",
				"function": map[string]any{"name": a.name, "arguments": a.args},
			})
		}
		msg["tool_calls"] = tc
		if finish == "" {
			finish = "tool_calls"
		}
	}
	if finish == "" {
		finish = "stop"
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"object": "chat.completion",
		"model":  modelID,
		"choices": []map[string]any{{
			"index":         0,
			"message":       msg,
			"finish_reason": finish,
		}},
	})
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": msg}})
}

// writeData wraps a payload in {"data": ...} for the /api client envelope.
func writeData(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}

// writeAPIErr matches the {"error": "..."} shape the /api client reads.
func writeAPIErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg})
}
