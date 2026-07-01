package codex

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/proxy"
)

// buildResponsesBody translates the normalized request into a Codex Responses
// API body (a whitelist — anything not represented here is dropped). It returns
// the JSON body and a sanitized→original tool-name map for restoring names in
// the response stream.
func buildResponsesBody(req *model.Request) ([]byte, map[string]string) {
	// Strip the cx/ prefix so upstream sees the bare model id.
	upstream := req.Model
	if _, bare := proxy.SplitModel(req.Model); bare != "" {
		upstream = bare
	}
	if upstream == "" {
		upstream = "gpt-5.4"
	}

	instructions := ""
	input := []any{}
	// call ids that produced a function_call, and which of those got an output.
	seenCall := map[string]bool{}
	haveOutput := map[string]bool{}

	for _, m := range req.Messages {
		switch m.Role {
		case model.RoleSystem:
			if t := partsText(m.Parts); t != "" {
				instructions = t
			}
		case model.RoleAssistant:
			text := partsText(m.Parts)
			calls := toolCallParts(m.Parts)
			if text != "" || len(calls) == 0 {
				input = append(input, map[string]any{"role": "assistant", "content": text})
			}
			for _, c := range calls {
				id := c.id
				if id == "" {
					continue
				}
				seenCall[id] = true
				input = append(input, map[string]any{
					"type": "function_call", "call_id": id, "name": c.name, "arguments": orJSON(c.args),
				})
			}
		case model.RoleTool:
			id := callIDOf(m.Parts)
			if id == "" {
				continue
			}
			haveOutput[id] = true
			input = append(input, map[string]any{
				"type": "function_call_output", "call_id": id, "output": partsText(m.Parts),
			})
		default: // user
			input = append(input, map[string]any{"role": string(m.Role), "content": userContent(m.Parts)})
		}
	}

	// Every function_call needs a matching output.
	for id := range seenCall {
		if !haveOutput[id] {
			input = append(input, map[string]any{"type": "function_call_output", "call_id": id, "output": ""})
		}
	}
	if len(input) == 0 {
		input = []any{map[string]any{"role": "user", "content": ""}}
	}
	if instructions == "" {
		instructions = "You are a helpful assistant."
	}

	body := map[string]any{
		"model":        upstream,
		"instructions": instructions,
		"input":        input,
		"stream":       true,
		"store":        false,
		"include":      []string{"reasoning.encrypted_content"},
		"reasoning":    map[string]any{"effort": "medium"},
	}

	reverse := map[string]string{}
	if tools := buildTools(req.Tools, reverse); len(tools) > 0 {
		body["tools"] = tools
		body["tool_choice"] = "auto"
		pc := true
		body["parallel_tool_calls"] = pc
	}

	b, _ := json.Marshal(body)
	return b, reverse
}

// --- helpers over model.Message parts ---

type partList = []model.Part

func partsText(parts partList) string {
	var b strings.Builder
	for _, p := range parts {
		if p.Type == "text" || p.Type == "" {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

// userContent returns a Responses-API content value: a plain string for
// text-only, otherwise input_text / input_image parts.
func userContent(parts partList) any {
	hasImage := false
	for _, p := range parts {
		if p.Type == "image" {
			hasImage = true
		}
	}
	if !hasImage {
		return partsText(parts)
	}
	arr := []any{}
	for _, p := range parts {
		if p.Type == "image" {
			arr = append(arr, map[string]any{"type": "input_image", "image_url": p.ImageURL})
		} else {
			arr = append(arr, map[string]any{"type": "input_text", "text": p.Text})
		}
	}
	return arr
}

type toolCallPart struct{ id, name, args string }

// toolCallParts pulls assistant tool calls out of the parts (they arrive as
// tool_use parts with Raw carrying {id,name,arguments} from convert).
func toolCallParts(parts partList) []toolCallPart {
	var out []toolCallPart
	for _, p := range parts {
		if p.Type != "tool_use" && p.Type != "tool_call" {
			continue
		}
		tc := toolCallPart{id: p.ToolCallID, name: p.ToolName}
		if len(p.Raw) > 0 {
			var r struct {
				ID   string          `json:"id"`
				Name string          `json:"name"`
				Args json.RawMessage `json:"arguments"`
			}
			if json.Unmarshal(p.Raw, &r) == nil {
				if r.ID != "" {
					tc.id = r.ID
				}
				if r.Name != "" {
					tc.name = r.Name
				}
				if len(r.Args) > 0 {
					tc.args = string(r.Args)
				}
			}
		}
		out = append(out, tc)
	}
	return out
}

// callIDOf finds a tool_result part's call id.
func callIDOf(parts partList) string {
	for _, p := range parts {
		if p.ToolCallID != "" {
			return p.ToolCallID
		}
	}
	return ""
}

var toolNameRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// buildTools converts normalized tools to Codex function tools, sanitizing names
// and recording sanitized→original in reverse.
func buildTools(tools []model.Tool, reverse map[string]string) []any {
	if len(tools) == 0 {
		return nil
	}
	used := map[string]bool{}
	out := []any{}
	for _, t := range tools {
		name := sanitizeToolName(t.Name, used)
		if t.Name != name {
			reverse[name] = t.Name
		}
		params := t.Parameters
		if len(params) == 0 {
			params = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		out = append(out, map[string]any{
			"type": "function", "name": name, "description": t.Description, "parameters": params,
		})
	}
	return out
}

func sanitizeToolName(name string, used map[string]bool) string {
	s := toolNameRe.ReplaceAllString(name, "_")
	s = strings.Trim(s, "_")
	if len(s) > 64 {
		s = s[:64]
	}
	if s == "" {
		s = "tool"
	}
	base := s
	for i := 2; used[s]; i++ {
		s = base + "_" + itoa(i)
	}
	used[s] = true
	return s
}

func orJSON(s string) string {
	if strings.TrimSpace(s) == "" {
		return "{}"
	}
	return s
}
