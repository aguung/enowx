package convert

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/enowdev/enowx/core/model"
)

type anthReq struct {
	Model       string          `json:"model"`
	Stream      bool            `json:"stream"`
	MaxTokens   int             `json:"max_tokens"`
	Temperature *float64        `json:"temperature"`
	System      json.RawMessage `json:"system"`
	Messages    []anthMsg       `json:"messages"`
	Tools       []anthTool      `json:"tools"`
}

type anthMsg struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type anthTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

func fromAnthropic(body []byte) (*model.Request, error) {
	var in anthReq
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, fmt.Errorf("decode anthropic: %w", err)
	}
	if in.Model == "" {
		return nil, fmt.Errorf("missing model")
	}
	req := &model.Request{
		Source:      model.APIAnthropic,
		Model:       in.Model,
		Stream:      in.Stream,
		MaxTokens:   in.MaxTokens,
		Temperature: in.Temperature,
		Raw:         body,
	}
	if sys := anthTextBlocks(in.System); sys != "" {
		req.Messages = append(req.Messages, model.Message{
			Role:  model.RoleSystem,
			Parts: []model.Part{{Type: "text", Text: sys}},
		})
	}
	for _, m := range in.Messages {
		req.Messages = append(req.Messages, model.Message{
			Role:  model.Role(m.Role),
			Parts: anthContentToParts(m.Content),
		})
	}
	for _, t := range in.Tools {
		req.Tools = append(req.Tools, model.Tool{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.InputSchema,
		})
	}
	return req, nil
}

// anthTextBlocks flattens Anthropic's string-or-blocks shape to plain text.
func anthTextBlocks(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var arr []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &arr); err != nil {
		return ""
	}
	var out strings.Builder
	for _, b := range arr {
		if b.Type == "text" {
			out.WriteString(b.Text)
		}
	}
	return out.String()
}

func anthContentToParts(raw json.RawMessage) []model.Part {
	if len(raw) == 0 {
		return nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return []model.Part{{Type: "text", Text: s}}
	}
	var arr []struct {
		Type      string          `json:"type"`
		Text      string          `json:"text"`
		ToolUseID string          `json:"tool_use_id"`
		Name      string          `json:"name"`
		Input     json.RawMessage `json:"input"`
		Content   json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil
	}
	parts := make([]model.Part, 0, len(arr))
	for _, b := range arr {
		switch b.Type {
		case "tool_use":
			parts = append(parts, model.Part{Type: "tool_use", ToolName: b.Name, Raw: b.Input})
		case "tool_result":
			parts = append(parts, model.Part{Type: "tool_result", ToolCallID: b.ToolUseID, Text: anthTextBlocks(b.Content)})
		default:
			parts = append(parts, model.Part{Type: "text", Text: b.Text})
		}
	}
	return parts
}
