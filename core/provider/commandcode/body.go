package commandcode

import (
	"encoding/json"
	"runtime"
	"strings"
	"time"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/proxy"
)

const defaultMaxTokens = 8192

// buildBody translates the normalized request into a CommandCode /alpha/generate
// body: an Anthropic-ish params block (system hoisted to a top-level string,
// message content as typed blocks) wrapped in the CLI envelope the upstream
// expects. Anything not represented here is dropped.
func buildBody(req *model.Request) []byte {
	upstream := req.Model
	if _, bare := proxy.SplitModel(req.Model); bare != "" {
		upstream = bare
	}

	var systemTexts []string
	messages := make([]map[string]any, 0, len(req.Messages))

	for _, m := range req.Messages {
		switch m.Role {
		case model.RoleSystem:
			if t := partsText(m.Parts); t != "" {
				systemTexts = append(systemTexts, t)
			}
		case model.RoleTool:
			messages = append(messages, map[string]any{
				"role": "tool",
				"content": []any{map[string]any{
					"type":       "tool-result",
					"toolCallId": callIDOf(m.Parts),
					"toolName":   toolNameOf(m.Parts),
					"output":     map[string]any{"type": "text", "value": partsText(m.Parts)},
				}},
			})
		case model.RoleAssistant:
			blocks := []any{}
			if t := partsText(m.Parts); t != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": t})
			}
			for _, c := range toolCalls(m.Parts) {
				blocks = append(blocks, map[string]any{
					"type":       "tool-call",
					"toolCallId": c.id,
					"toolName":   c.name,
					"input":      c.input,
				})
			}
			if len(blocks) == 0 {
				blocks = append(blocks, map[string]any{"type": "text", "text": ""})
			}
			messages = append(messages, map[string]any{"role": "assistant", "content": blocks})
		default: // user
			messages = append(messages, map[string]any{"role": "user", "content": userBlocks(m.Parts)})
		}
	}

	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = defaultMaxTokens
	}
	temperature := 0.3
	if req.Temperature != nil {
		temperature = *req.Temperature
	}

	params := map[string]any{
		"model":       upstream,
		"messages":    messages,
		"stream":      true,
		"max_tokens":  maxTokens,
		"temperature": temperature,
	}
	if sys := strings.Join(systemTexts, "\n\n"); sys != "" {
		params["system"] = sys
	}
	if tools := buildTools(req.Tools); len(tools) > 0 {
		params["tools"] = tools
	}

	body := map[string]any{
		"threadId": randomUUID(),
		"memory":   "",
		"config": map[string]any{
			"workingDir":    "",
			"date":          time.Now().UTC().Format("2006-01-02"),
			"environment":   runtime.GOOS,
			"structure":     []any{},
			"isGitRepo":     false,
			"currentBranch": "",
			"mainBranch":    "",
			"gitStatus":     "",
			"recentCommits": []any{},
		},
		"params": params,
	}

	b, _ := json.Marshal(body)
	return b
}

// --- helpers over model.Message parts ---

func partsText(parts []model.Part) string {
	var b strings.Builder
	for _, p := range parts {
		if p.Type == "text" || p.Type == "" {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

// userBlocks returns CommandCode user content blocks. Images are not supported
// upstream, so they collapse to a text placeholder (mirrors the 9router client).
func userBlocks(parts []model.Part) []any {
	blocks := []any{}
	for _, p := range parts {
		switch p.Type {
		case "image":
			blocks = append(blocks, map[string]any{"type": "text", "text": "[image omitted]"})
		default:
			if p.Text != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": p.Text})
			}
		}
	}
	if len(blocks) == 0 {
		blocks = append(blocks, map[string]any{"type": "text", "text": ""})
	}
	return blocks
}

type toolCall struct {
	id, name string
	input    any
}

// toolCalls pulls assistant tool calls out of the parts. They arrive as
// tool_use/tool_call parts whose Raw carries either the bare input object
// (Anthropic inbound) or a {id,name,arguments} envelope.
func toolCalls(parts []model.Part) []toolCall {
	var out []toolCall
	for _, p := range parts {
		if p.Type != "tool_use" && p.Type != "tool_call" {
			continue
		}
		tc := toolCall{id: p.ToolCallID, name: p.ToolName, input: map[string]any{}}
		if len(p.Raw) > 0 {
			var env struct {
				ID   string          `json:"id"`
				Name string          `json:"name"`
				Args json.RawMessage `json:"arguments"`
			}
			if json.Unmarshal(p.Raw, &env) == nil && (env.ID != "" || env.Name != "" || len(env.Args) > 0) {
				if env.ID != "" {
					tc.id = env.ID
				}
				if env.Name != "" {
					tc.name = env.Name
				}
				tc.input = rawToAny(env.Args)
			} else {
				tc.input = rawToAny(p.Raw)
			}
		}
		out = append(out, tc)
	}
	return out
}

// rawToAny decodes a JSON fragment to a generic value, defaulting to an empty
// object so upstream always receives a valid `input`.
func rawToAny(raw json.RawMessage) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var v any
	if json.Unmarshal(raw, &v) != nil || v == nil {
		return map[string]any{}
	}
	return v
}

func callIDOf(parts []model.Part) string {
	for _, p := range parts {
		if p.ToolCallID != "" {
			return p.ToolCallID
		}
	}
	return ""
}

func toolNameOf(parts []model.Part) string {
	for _, p := range parts {
		if p.ToolName != "" {
			return p.ToolName
		}
	}
	return ""
}

// buildTools converts normalized tools to CommandCode's Anthropic-plain tool
// shape ({name, description, input_schema}).
func buildTools(tools []model.Tool) []any {
	if len(tools) == 0 {
		return nil
	}
	out := make([]any, 0, len(tools))
	for _, t := range tools {
		schema := rawToAny(t.Parameters)
		if _, ok := schema.(map[string]any); !ok {
			schema = map[string]any{"type": "object"}
		}
		out = append(out, map[string]any{
			"name":         t.Name,
			"description":  t.Description,
			"input_schema": schema,
		})
	}
	return out
}
