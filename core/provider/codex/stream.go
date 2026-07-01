package codex

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/core/model"
)

// codexStream parses the Codex Responses SSE stream into normalized events:
// text deltas, reasoning deltas, tool-call deltas, and a final usage/finish.
type codexStream struct {
	resp    *http.Response
	sc      *bufio.Scanner
	reverse map[string]string // sanitized→original tool name

	done bool
	// tool-call state: Codex keys argument deltas by item_id, not call_id.
	itemToIdx  map[string]int
	itemToCall map[string]string
	nextIdx    int
	sawTool    bool
	pending    []model.Event // queued events to emit before reading more
}

func newCodexStream(resp *http.Response, reverse map[string]string) *codexStream {
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	sc.Split(splitSSE)
	return &codexStream{
		resp: resp, sc: sc, reverse: reverse,
		itemToIdx: map[string]int{}, itemToCall: map[string]string{},
	}
}

// splitSSE splits the stream on blank lines (\n\n), the SSE record separator.
func splitSSE(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.Index(data, []byte("\n\n")); i >= 0 {
		return i + 2, data[:i], nil
	}
	if i := bytes.Index(data, []byte("\r\n\r\n")); i >= 0 {
		return i + 4, data[:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

type codexEvent struct {
	Type    string          `json:"type"`
	Delta   string          `json:"delta"`
	ItemID  string          `json:"item_id"`
	Item    json.RawMessage `json:"item"`
	CallID  string          `json:"call_id"`
	Response json.RawMessage `json:"response"`
	Error   json.RawMessage `json:"error"`
}

func (s *codexStream) Recv() (model.Event, error) {
	if len(s.pending) > 0 {
		ev := s.pending[0]
		s.pending = s.pending[1:]
		return ev, nil
	}
	if s.done {
		return model.Event{}, io.EOF
	}
	for s.sc.Scan() {
		block := s.sc.Bytes()
		evType, data := parseSSEBlock(block)
		if len(data) == 0 {
			continue
		}
		if bytes.Equal(bytes.TrimSpace(data), []byte("[DONE]")) {
			s.done = true
			return model.Event{Type: model.EventDone}, nil
		}
		var e codexEvent
		if json.Unmarshal(data, &e) != nil {
			continue
		}
		if e.Type == "" {
			e.Type = evType
		}
		if ev, ok := s.handle(&e); ok {
			return ev, nil
		}
	}
	s.done = true
	return model.Event{Type: model.EventDone}, nil
}

// handle turns one Codex event into a normalized event (ok=false → skip).
func (s *codexStream) handle(e *codexEvent) (model.Event, bool) {
	switch e.Type {
	case "response.output_text.delta":
		if e.Delta != "" {
			return model.Event{Type: model.EventDelta, Text: e.Delta}, true
		}
	case "response.reasoning_summary_text.delta", "response.reasoning_text.delta":
		if e.Delta != "" {
			return model.Event{Type: model.EventDelta, Reasoning: e.Delta}, true
		}
	case "response.output_item.added":
		if tc := s.openToolCall(e); tc != nil {
			return *tc, true
		}
	case "response.function_call_arguments.delta":
		idx, ok := s.resolveIdx(e)
		if ok && e.Delta != "" {
			return model.Event{Type: model.EventDelta, ToolCalls: []model.ToolCallDelta{{Index: idx, ArgsDelta: e.Delta}}}, true
		}
	case "response.completed":
		return s.completed(e), true
	case "error", "response.failed":
		var er struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(e.Error, &er)
		msg := strings.TrimSpace(er.Code + " " + er.Message)
		if msg == "" {
			msg = "codex error"
		}
		s.done = true
		return model.Event{Type: model.EventError, Err: msg}, true
	}
	return model.Event{}, false
}

// openToolCall handles a function_call item being added to the response.
func (s *codexStream) openToolCall(e *codexEvent) *model.Event {
	var item struct {
		Type   string `json:"type"`
		ID     string `json:"id"`
		CallID string `json:"call_id"`
		Name   string `json:"name"`
	}
	if json.Unmarshal(e.Item, &item) != nil || item.Type != "function_call" {
		return nil
	}
	idx := s.nextIdx
	s.nextIdx++
	s.sawTool = true
	if item.ID != "" {
		s.itemToIdx[item.ID] = idx
		s.itemToCall[item.ID] = item.CallID
	}
	if e.ItemID != "" {
		s.itemToIdx[e.ItemID] = idx
	}
	name := item.Name
	if orig, ok := s.reverse[name]; ok {
		name = orig
	}
	return &model.Event{Type: model.EventDelta, ToolCalls: []model.ToolCallDelta{{Index: idx, ID: item.CallID, Name: name}}}
}

func (s *codexStream) resolveIdx(e *codexEvent) (int, bool) {
	if e.ItemID != "" {
		if i, ok := s.itemToIdx[e.ItemID]; ok {
			return i, true
		}
	}
	if e.CallID != "" {
		for item, call := range s.itemToCall {
			if call == e.CallID {
				return s.itemToIdx[item], true
			}
		}
	}
	return 0, false
}

func (s *codexStream) completed(e *codexEvent) model.Event {
	s.done = true
	finish := "stop"
	if s.sawTool {
		finish = "tool_calls"
	}
	var usage *model.Usage
	var wrap struct {
		Usage struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(e.Response, &wrap) == nil && (wrap.Usage.InputTokens > 0 || wrap.Usage.OutputTokens > 0) {
		usage = &model.Usage{PromptTokens: wrap.Usage.InputTokens, CompletionTokens: wrap.Usage.OutputTokens}
	}
	// Emit the finish/usage as a delta event, then EventDone on the next Recv.
	s.pending = append(s.pending, model.Event{Type: model.EventDone})
	return model.Event{Type: model.EventDelta, FinishReason: finish, Usage: usage}
}

func (s *codexStream) Close() error { return s.resp.Body.Close() }

// parseSSEBlock extracts the event type and data payload from one SSE record.
func parseSSEBlock(block []byte) (evType string, data []byte) {
	var buf bytes.Buffer
	for _, line := range bytes.Split(block, []byte("\n")) {
		line = bytes.TrimRight(line, "\r")
		switch {
		case bytes.HasPrefix(line, []byte("event:")):
			evType = string(bytes.TrimSpace(line[6:]))
		case bytes.HasPrefix(line, []byte("data:")):
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.Write(bytes.TrimSpace(line[5:]))
		}
	}
	return evType, buf.Bytes()
}
