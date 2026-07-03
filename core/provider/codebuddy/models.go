package codebuddy

import "github.com/enowdev/enowx/core/provider"

// Models returns the account's available models. CodeBuddy doesn't expose a live
// model list, so we ship a curated static catalog per variant (global .ai vs
// China .cn) — implementing ModelFetcher so the UI shows the right models
// instead of falling back to the cloud catalog.
func (p *Provider) Models(acc provider.Account) ([]provider.Model, error) {
	src := codebuddyModels
	if p.v.name == variantCN.name {
		src = codebuddyCnModels
	}
	out := make([]provider.Model, 0, len(src))
	for _, m := range src {
		t := "chat"
		if m.image {
			t = "image"
		}
		out = append(out, provider.Model{ID: m.id, Name: m.id, Type: t, OwnedBy: m.ownedBy})
	}
	return out, nil
}

type cbModel struct {
	id      string
	ownedBy string
	image   bool
}

// codebuddyModels is the global (.ai) catalog.
var codebuddyModels = []cbModel{
	{id: "enowx-default", ownedBy: "enowxlabs"},
	{id: "gemini-3.1-pro", ownedBy: "google"},
	{id: "gemini-3.1-flash-lite", ownedBy: "google"},
	{id: "gemini-3.0-flash", ownedBy: "google"},
	{id: "gemini-2.5-pro", ownedBy: "google"},
	{id: "gemini-2.5-flash", ownedBy: "google"},
	{id: "gpt-5.5", ownedBy: "openai"},
	{id: "gpt-5.4", ownedBy: "openai"},
	{id: "gpt-5.2", ownedBy: "openai"},
	{id: "gpt-5.3-codex", ownedBy: "openai"},
	{id: "gpt-5.2-codex", ownedBy: "openai"},
	{id: "gpt-5.1", ownedBy: "openai"},
	{id: "gpt-5.1-codex", ownedBy: "openai"},
	{id: "gpt-5.1-codex-max", ownedBy: "openai"},
	{id: "gpt-5.1-codex-mini", ownedBy: "openai"},
	{id: "deepseek-v3-2-volc", ownedBy: "deepseek"},
	{id: "claude-opus-4.6", ownedBy: "anthropic"},
	{id: "claude-opus-4.7-1m", ownedBy: "anthropic"},
	{id: "kimi-k2.5", ownedBy: "moonshot"},
}

// codebuddyCnModels is the China (.cn) catalog (GLM / DeepSeek / Kimi / etc.).
var codebuddyCnModels = []cbModel{
	{id: "auto", ownedBy: "enowxlabs"},
	{id: "glm-5.2", ownedBy: "zhipu"},
	{id: "glm-5.1", ownedBy: "zhipu"},
	{id: "glm-5.0", ownedBy: "zhipu"},
	{id: "glm-5.0-turbo", ownedBy: "zhipu"},
	{id: "glm-5v-turbo", ownedBy: "zhipu"},
	{id: "glm-4.7", ownedBy: "zhipu"},
	{id: "glm-4.6", ownedBy: "zhipu"},
	{id: "glm-4.6v", ownedBy: "zhipu"},
	{id: "hunyuan-image-v3.0", ownedBy: "tencent", image: true},
	{id: "deepseek-v4-pro", ownedBy: "deepseek"},
	{id: "deepseek-v4-flash", ownedBy: "deepseek"},
	{id: "deepseek-r1", ownedBy: "deepseek"},
	{id: "kimi-k2.7", ownedBy: "moonshot"},
	{id: "kimi-k2.6", ownedBy: "moonshot"},
	{id: "kimi-k2.5", ownedBy: "moonshot"},
	{id: "minimax-m3", ownedBy: "minimax"},
	{id: "minimax-m2.7", ownedBy: "minimax"},
	{id: "hy3-preview", ownedBy: "tencent"},
	{id: "claude-haiku-4.5", ownedBy: "anthropic"},
}
