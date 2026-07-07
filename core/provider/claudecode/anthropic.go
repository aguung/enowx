package claudecode

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/core/model"
)

// anthropicBody serializes a normalized request into an Anthropic /v1/messages
// body. System messages are hoisted to the top-level "system" field.
func anthropicBody(req *model.Request) []byte {
	out := map[string]any{
		"model":  req.Model,
		"stream": req.Stream,
	}
	maxTok := req.MaxTokens
	if maxTok <= 0 {
		maxTok = 4096 // Anthropic requires max_tokens
	}
	out["max_tokens"] = maxTok
	if req.Temperature != nil {
		out["temperature"] = *req.Temperature
	}
	var system []string
	msgs := make([]map[string]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		text := partsText(m)
		if m.Role == "system" {
			if text != "" {
				system = append(system, text)
			}
			continue
		}
		role := string(m.Role)
		if role != "user" && role != "assistant" {
			role = "user"
		}
		msgs = append(msgs, map[string]any{"role": role, "content": text})
	}
	if len(system) > 0 {
		out["system"] = strings.Join(system, "\n\n")
	}
	out["messages"] = msgs
	b, _ := json.Marshal(out)
	return b
}

// partsText flattens a message's parts to plain text.
func partsText(m model.Message) string {
	var sb strings.Builder
	for _, p := range m.Parts {
		if p.Text != "" {
			sb.WriteString(p.Text)
		}
	}
	return sb.String()
}

// parseAnthropic reads an Anthropic Messages response (streaming SSE or a single
// JSON body) and yields normalized events.
func parseAnthropic(resp *http.Response, streaming bool) (model.Stream, error) {
	if !streaming {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		var out struct {
			Model   string `json:"model"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			Usage struct {
				InputTokens  int64 `json:"input_tokens"`
				OutputTokens int64 `json:"output_tokens"`
			} `json:"usage"`
			StopReason string `json:"stop_reason"`
		}
		_ = json.Unmarshal(raw, &out)
		var text strings.Builder
		for _, c := range out.Content {
			if c.Type == "text" {
				text.WriteString(c.Text)
			}
		}
		ev := model.Event{
			Type: model.EventDelta, Text: text.String(), Model: out.Model, FinishReason: out.StopReason,
			Usage: &model.Usage{PromptTokens: out.Usage.InputTokens, CompletionTokens: out.Usage.OutputTokens},
		}
		return &oneShot{ev: ev}, nil
	}
	return &anthStream{r: bufio.NewReader(resp.Body), body: resp.Body}, nil
}

// oneShot yields one delta then done.
type oneShot struct {
	ev   model.Event
	sent bool
}

func (s *oneShot) Recv() (model.Event, error) {
	if !s.sent {
		s.sent = true
		return s.ev, nil
	}
	return model.Event{Type: model.EventDone}, io.EOF
}
func (s *oneShot) Close() error { return nil }

// anthStream translates Anthropic SSE into normalized delta events.
type anthStream struct {
	r    *bufio.Reader
	body io.ReadCloser
	done bool
	usage model.Usage
	model string
}

func (s *anthStream) Close() error { return s.body.Close() }

func (s *anthStream) Recv() (model.Event, error) {
	if s.done {
		return model.Event{Type: model.EventDone, Usage: usagePtr(s.usage), Model: s.model}, io.EOF
	}
	for {
		line, err := s.r.ReadString('\n')
		if err != nil {
			s.done = true
			return model.Event{Type: model.EventDone, Usage: usagePtr(s.usage), Model: s.model}, io.EOF
		}
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		var chunk struct {
			Type  string `json:"type"`
			Delta struct {
				Type       string `json:"type"`
				Text       string `json:"text"`
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
			Message struct {
				Model string `json:"model"`
				Usage struct {
					InputTokens int64 `json:"input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Usage struct {
				OutputTokens int64 `json:"output_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		switch chunk.Type {
		case "message_start":
			s.model = chunk.Message.Model
			s.usage.PromptTokens = chunk.Message.Usage.InputTokens
		case "content_block_delta":
			if chunk.Delta.Text != "" {
				return model.Event{Type: model.EventDelta, Text: chunk.Delta.Text, Model: s.model}, nil
			}
		case "message_delta":
			if chunk.Usage.OutputTokens > 0 {
				s.usage.CompletionTokens = chunk.Usage.OutputTokens
			}
		case "message_stop":
			s.done = true
			return model.Event{Type: model.EventDone, Usage: usagePtr(s.usage), Model: s.model}, io.EOF
		}
	}
}

func usagePtr(u model.Usage) *model.Usage {
	if u.PromptTokens == 0 && u.CompletionTokens == 0 {
		return nil
	}
	return &u
}
