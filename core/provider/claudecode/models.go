package claudecode

import "github.com/enowdev/enowx/core/provider"

// catalog is the static set of models a Claude Code subscription can serve.
var catalog = []provider.Model{
	{ID: "claude-opus-4-8", Name: "Claude Opus 4.8", Type: "chat", OwnedBy: "anthropic"},
	{ID: "claude-sonnet-5", Name: "Claude Sonnet 5", Type: "chat", OwnedBy: "anthropic"},
	{ID: "claude-haiku-4-5", Name: "Claude Haiku 4.5", Type: "chat", OwnedBy: "anthropic"},
}

// Models returns the static catalog (Claude Code doesn't expose a /models list).
func (p *Provider) Models(acc provider.Account) ([]provider.Model, error) {
	return catalog, nil
}
