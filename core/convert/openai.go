package convert

import (
	"encoding/json"
	"fmt"

	"github.com/enowdev/enowx/core/model"
)

type oaiChat struct {
	Model       string    `json:"model"`
	Stream      bool      `json:"stream"`
	MaxTokens   int       `json:"max_tokens"`
	Temperature *float64  `json:"temperature"`
	Messages    []oaiMsg  `json:"messages"`
	Tools       []oaiTool `json:"tools"`
}

type oaiMsg struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCallID string          `json:"tool_call_id"`
	Name       string          `json:"name"`
}

type oaiTool struct {
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Parameters  json.RawMessage `json:"parameters"`
	} `json:"function"`
}

func fromOpenAIChat(body []byte) (*model.Request, error) {
	var in oaiChat
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, fmt.Errorf("decode openai chat: %w", err)
	}
	if in.Model == "" {
		return nil, fmt.Errorf("missing model")
	}
	req := &model.Request{
		Source:      model.APIOpenAIChat,
		Model:       in.Model,
		Stream:      in.Stream,
		MaxTokens:   in.MaxTokens,
		Temperature: in.Temperature,
		Raw:         body,
	}
	for _, m := range in.Messages {
		req.Messages = append(req.Messages, model.Message{
			Role:  model.Role(m.Role),
			Parts: oaiContentToParts(m.Content, m.ToolCallID),
		})
	}
	for _, t := range in.Tools {
		req.Tools = append(req.Tools, model.Tool{
			Name:        t.Function.Name,
			Description: t.Function.Description,
			Parameters:  t.Function.Parameters,
		})
	}
	return req, nil
}

// oaiContentToParts handles both string content and the array-of-parts form.
func oaiContentToParts(raw json.RawMessage, toolCallID string) []model.Part {
	if len(raw) == 0 {
		return nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return []model.Part{{Type: "text", Text: s, ToolCallID: toolCallID}}
	}
	var arr []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil
	}
	parts := make([]model.Part, 0, len(arr))
	for _, p := range arr {
		switch p.Type {
		case "image_url":
			parts = append(parts, model.Part{Type: "image", ImageURL: p.ImageURL.URL})
		default:
			parts = append(parts, model.Part{Type: "text", Text: p.Text})
		}
	}
	return parts
}
