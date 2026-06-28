package sse

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/enowdev/enowx/core/model"
)

// WriteAnthropic streams events in the Anthropic Messages SSE shape.
func WriteAnthropic(w http.ResponseWriter, s model.Stream, modelID string) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	defer s.Close()

	emitEvent(w, fl, "message_start", map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id":      "msg_enx",
			"type":    "message",
			"role":    "assistant",
			"model":   modelID,
			"content": []any{},
		},
	})
	emitEvent(w, fl, "content_block_start", map[string]any{
		"type":          "content_block_start",
		"index":         0,
		"content_block": map[string]any{"type": "text", "text": ""},
	})

	for {
		ev, err := s.Recv()
		if err == io.EOF || (err == nil && ev.Type == model.EventDone) {
			break
		}
		if err != nil || ev.Type == model.EventError {
			break
		}
		if ev.Text == "" {
			continue
		}
		emitEvent(w, fl, "content_block_delta", map[string]any{
			"type":  "content_block_delta",
			"index": 0,
			"delta": map[string]any{"type": "text_delta", "text": ev.Text},
		})
	}

	emitEvent(w, fl, "content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
	emitEvent(w, fl, "message_delta", map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": "end_turn"},
	})
	emitEvent(w, fl, "message_stop", map[string]any{"type": "message_stop"})
}

func emitEvent(w io.Writer, fl http.Flusher, event string, v any) {
	b, _ := json.Marshal(v)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
	fl.Flush()
}
