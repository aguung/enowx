package commandcode

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/enowdev/enowx/core/model"
)

// ccStream decodes CommandCode's AI-SDK-v5 event stream (one JSON object per
// line, optionally "data:"-framed) into normalized events: text/reasoning
// deltas, tool-call deltas, and a final finish/usage event.
type ccStream struct {
	resp *http.Response
	sc   *bufio.Scanner

	done    bool
	pending []model.Event

	// tool-call state: upstream keys argument deltas by the tool block id.
	toolIdx  map[string]int
	nextIdx  int
	sawTool  bool
	finish   string
	usage    *model.Usage
}

func newStream(resp *http.Response) *ccStream {
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	return &ccStream{resp: resp, sc: sc, toolIdx: map[string]int{}}
}

type ccEvent struct {
	Type           string          `json:"type"`
	Text           string          `json:"text"`
	Delta          string          `json:"delta"`
	InputTextDelta string          `json:"inputTextDelta"`
	ID             string          `json:"id"`
	ToolCallID     string          `json:"toolCallId"`
	ToolName       string          `json:"toolName"`
	Input          json.RawMessage `json:"input"`
	FinishReason   string          `json:"finishReason"`
	Usage          *ccUsage        `json:"usage"`
	TotalUsage     *ccUsage        `json:"totalUsage"`
	Model          string          `json:"model"`
	Error          json.RawMessage `json:"error"`
	Message        string          `json:"message"`
}

type ccUsage struct {
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
	// AI SDK also emits promptTokens/completionTokens in some steps.
	PromptTokens     int64 `json:"promptTokens"`
	CompletionTokens int64 `json:"completionTokens"`
}

func (u *ccUsage) normalized() *model.Usage {
	if u == nil {
		return nil
	}
	in := u.InputTokens
	if in == 0 {
		in = u.PromptTokens
	}
	out := u.OutputTokens
	if out == 0 {
		out = u.CompletionTokens
	}
	if in == 0 && out == 0 {
		return nil
	}
	return &model.Usage{PromptTokens: in, CompletionTokens: out}
}

func (s *ccStream) Recv() (model.Event, error) {
	if len(s.pending) > 0 {
		ev := s.pending[0]
		s.pending = s.pending[1:]
		return ev, nil
	}
	if s.done {
		return model.Event{}, io.EOF
	}
	for s.sc.Scan() {
		line := bytes.TrimSpace(s.sc.Bytes())
		if len(line) == 0 {
			continue
		}
		if bytes.HasPrefix(line, []byte("data:")) {
			line = bytes.TrimSpace(line[5:])
		}
		if len(line) == 0 || bytes.Equal(line, []byte("[DONE]")) {
			continue
		}
		var e ccEvent
		if json.Unmarshal(line, &e) != nil || e.Type == "" {
			continue
		}
		if ev, ok := s.handle(&e); ok {
			return ev, nil
		}
	}
	s.done = true
	return model.Event{Type: model.EventDone}, nil
}

// handle turns one upstream event into a normalized event (ok=false → skip).
func (s *ccStream) handle(e *ccEvent) (model.Event, bool) {
	switch e.Type {
	case "text-delta":
		if t := firstNonEmpty(e.Text, e.Delta); t != "" {
			return model.Event{Type: model.EventDelta, Text: t}, true
		}
	case "reasoning-delta":
		if e.Text != "" {
			return model.Event{Type: model.EventDelta, Reasoning: e.Text}, true
		}
	case "tool-input-start":
		id := firstNonEmpty(e.ID, e.ToolCallID)
		idx := s.openTool(id)
		return model.Event{Type: model.EventDelta, ToolCalls: []model.ToolCallDelta{
			{Index: idx, ID: id, Name: e.ToolName},
		}}, true
	case "tool-input-delta":
		id := firstNonEmpty(e.ID, e.ToolCallID)
		idx, ok := s.toolIdx[id]
		if !ok {
			return model.Event{}, false
		}
		if d := firstNonEmpty(e.Delta, e.InputTextDelta); d != "" {
			return model.Event{Type: model.EventDelta, ToolCalls: []model.ToolCallDelta{
				{Index: idx, ArgsDelta: d},
			}}, true
		}
	case "tool-call":
		// Consolidated call — emit only if we never saw streamed input deltas.
		id := firstNonEmpty(e.ToolCallID, e.ID)
		if _, seen := s.toolIdx[id]; seen {
			return model.Event{}, false
		}
		idx := s.openTool(id)
		return model.Event{Type: model.EventDelta, ToolCalls: []model.ToolCallDelta{
			{Index: idx, ID: id, Name: e.ToolName, ArgsDelta: rawArgs(e.Input)},
		}}, true
	case "finish-step":
		if e.FinishReason != "" {
			s.finish = mapFinish(e.FinishReason)
		}
		if u := e.Usage.normalized(); u != nil {
			s.usage = u
		}
	case "finish":
		return s.completed(e), true
	case "error":
		s.done = true
		return model.Event{Type: model.EventError, Err: errText(e)}, true
	}
	return model.Event{}, false
}

func (s *ccStream) openTool(id string) int {
	if idx, ok := s.toolIdx[id]; ok {
		return idx
	}
	idx := s.nextIdx
	s.nextIdx++
	s.toolIdx[id] = idx
	s.sawTool = true
	return idx
}

func (s *ccStream) completed(e *ccEvent) model.Event {
	s.done = true
	finish := s.finish
	if finish == "" {
		finish = mapFinish(e.FinishReason)
	}
	if s.sawTool && finish == "stop" {
		finish = "tool_calls"
	}
	usage := s.usage
	if u := e.TotalUsage.normalized(); u != nil {
		usage = u
	}
	s.pending = append(s.pending, model.Event{Type: model.EventDone})
	return model.Event{Type: model.EventDelta, FinishReason: finish, Usage: usage}
}

func (s *ccStream) Close() error { return s.resp.Body.Close() }

// mapFinish maps an AI-SDK finish reason to the OpenAI-style value clients want.
func mapFinish(reason string) string {
	switch reason {
	case "tool-calls", "tool_calls":
		return "tool_calls"
	case "length", "max-tokens":
		return "length"
	case "content-filter":
		return "content_filter"
	case "", "stop", "end-turn":
		return "stop"
	default:
		return "stop"
	}
}

func rawArgs(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func errText(e *ccEvent) string {
	if len(e.Error) > 0 {
		var s string
		if json.Unmarshal(e.Error, &s) == nil && s != "" {
			return s
		}
		return string(e.Error)
	}
	if e.Message != "" {
		return e.Message
	}
	return "commandcode error"
}
