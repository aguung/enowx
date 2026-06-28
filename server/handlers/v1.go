// Package handlers holds the HTTP handlers (thin: decode → core → encode).
package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/enowdev/enowx/core/convert"
	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/server/sse"
)

type V1 struct {
	proxy *proxy.Proxy
	route func(modelID string) string // model → provider name
}

func NewV1(p *proxy.Proxy, route func(string) string) *V1 {
	return &V1{proxy: p, route: route}
}

func (h *V1) ChatCompletions(w http.ResponseWriter, r *http.Request) {
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
	stream, err := h.proxy.Forward(r.Context(), h.route(req.Model), req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if req.Stream {
		sse.WriteOpenAI(w, stream)
		return
	}
	writeJSON(w, stream)
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
