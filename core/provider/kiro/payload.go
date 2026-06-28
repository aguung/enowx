package kiro

import (
	"encoding/json"
	"strings"

	"github.com/enowdev/enowx/core/model"
	"github.com/google/uuid"
)

// buildPayload turns the normalized request into the CodeWhisperer body. The
// last user turn becomes currentMessage; earlier turns become history. System
// turns are prepended to the first user content.
func buildPayload(req *model.Request, profileARN, conversationID string) ([]byte, error) {
	if conversationID == "" {
		conversationID = uuid.NewString()
	}

	var system strings.Builder
	type turn struct {
		role string
		text string
	}
	var turns []turn
	for _, m := range req.Messages {
		text := partsText(m.Parts)
		switch m.Role {
		case model.RoleSystem:
			if text != "" {
				system.WriteString(text)
				system.WriteString("\n\n")
			}
		default:
			turns = append(turns, turn{role: string(m.Role), text: text})
		}
	}

	if len(turns) > 0 && turns[0].role == string(model.RoleUser) && system.Len() > 0 {
		turns[0].text = system.String() + turns[0].text
	}

	history := make([]map[string]any, 0, len(turns))
	var current map[string]any
	for i, t := range turns {
		if i == len(turns)-1 {
			current = userInput(t.text, req.Model)
			break
		}
		if t.role == string(model.RoleAssistant) {
			history = append(history, map[string]any{
				"assistantResponseMessage": map[string]any{"content": t.text},
			})
		} else {
			history = append(history, map[string]any{"userInputMessage": userInput(t.text, req.Model)})
		}
	}
	if current == nil {
		current = userInput("", req.Model)
	}

	payload := map[string]any{
		"conversationState": map[string]any{
			"conversationId":  conversationID,
			"chatTriggerType": "MANUAL",
			"currentMessage":  map[string]any{"userInputMessage": current},
			"history":         history,
		},
	}
	if profileARN != "" {
		payload["profileArn"] = profileARN
	}
	return json.Marshal(payload)
}

func userInput(content, modelID string) map[string]any {
	return map[string]any{
		"content": content,
		"modelId": modelID,
		"origin":  "AI_EDITOR",
	}
}

func partsText(parts []model.Part) string {
	var b strings.Builder
	for _, p := range parts {
		if p.Text != "" {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}
