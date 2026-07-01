package codex

import "github.com/enowdev/enowx/core/provider"

// catalog is the hardcoded Codex model list (no live /models endpoint). The
// caller prefixes these ids with cx/.
func catalog() []provider.Model {
	return []provider.Model{
		{ID: "gpt-5.5", Name: "GPT 5.5", Type: "chat", OwnedBy: "openai"},
		{ID: "gpt-5.4", Name: "GPT 5.4", Type: "chat", OwnedBy: "openai"},
		{ID: "gpt-5.4-mini", Name: "GPT 5.4 Mini", Type: "chat", OwnedBy: "openai"},
		{ID: "gpt-5.3-codex", Name: "GPT 5.3 Codex", Type: "chat", OwnedBy: "openai"},
		{ID: "gpt-5.3-codex-high", Name: "GPT 5.3 Codex (High)", Type: "chat", OwnedBy: "openai"},
		{ID: "gpt-5.3-codex-low", Name: "GPT 5.3 Codex (Low)", Type: "chat", OwnedBy: "openai"},
	}
}
