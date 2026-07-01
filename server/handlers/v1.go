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
	"github.com/enowdev/enowx/server/sse"
	"github.com/enowdev/enowx/store"
)

type V1 struct {
	proxy    *proxy.Proxy
	route    func(modelID string) string // model → provider name
	logs     store.LogStore
	keys     store.KeyStore
	resolver *proxy.AliasResolver // optional: alias → real model id
}

func NewV1(p *proxy.Proxy, route func(string) string, logs store.LogStore, keys store.KeyStore) *V1 {
	return &V1{proxy: p, route: route, logs: logs, keys: keys}
}

// SetAliasResolver enables alias resolution on incoming model ids.
func (h *V1) SetAliasResolver(r *proxy.AliasResolver) { h.resolver = r }

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
	stream, err := h.proxy.Forward(r.Context(), providerName, req)
	if err != nil {
		h.log(providerName, req.Model, "error", start, model.Usage{})
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	us := wrapUsage(stream)
	if req.Stream {
		sse.WriteOpenAI(w, us)
	} else {
		writeJSON(w, us)
	}
	h.log(providerName, req.Model, "success", start, us.usage)
	chargeKey(r, h.keys, us.usage)
}

func (h *V1) log(provider, modelID, status string, start time.Time, usage model.Usage) {
	if h.logs == nil {
		return
	}
	_ = h.logs.Insert(context.Background(), store.RequestLog{
		Provider:  provider,
		Model:     modelID,
		Status:    status,
		InTokens:  usage.PromptTokens,
		OutTokens: usage.CompletionTokens,
		LatencyMS: time.Since(start).Milliseconds(),
	})
}

func writeJSON(w http.ResponseWriter, s interface{ Recv() (model.Event, error) }) {
	var text, modelID string
	for {
		ev, err := s.Recv()
		if err != nil || ev.Type == model.EventDone {
			break
		}
		text += ev.Text
		if ev.Model != "" {
			modelID = ev.Model
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"object": "chat.completion",
		"model":  modelID,
		"choices": []map[string]any{{
			"index":         0,
			"message":       map[string]any{"role": "assistant", "content": text},
			"finish_reason": "stop",
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
