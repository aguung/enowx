package mitm

import "strings"

// Tool describes a proprietary IDE we can intercept: the hosts it talks to, the
// URL substrings that mark a chat request, and how to translate its wire format.
type Tool struct {
	Key    string   `json:"key"`
	Name   string   `json:"name"`
	Hosts  []string `json:"hosts"`        // domains redirected to us via the hosts file
	Match  []string `json:"-"`            // path substrings that mark an interceptable request
	Format string   `json:"format"`       // gemini | openai — how to read/rewrite the body
	Models []string `json:"models"`       // suggested model list for the UI mapping editor
}

// tools is the registry of interceptable IDEs. Kiro (AWS EventStream binary
// codec) is intentionally omitted for now — it's the brittle, high-maintenance
// case; Antigravity and Copilot are simple model-swap forwards.
var tools = []Tool{
	{
		Key: "antigravity", Name: "Antigravity", Format: "gemini",
		Hosts: []string{"cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com"},
		Match: []string{":generateContent", ":streamGenerateContent"},
		Models: []string{"gemini-3-pro", "gemini-3-flash"},
	},
	{
		Key: "copilot", Name: "GitHub Copilot", Format: "openai",
		Hosts: []string{"api.individual.githubcopilot.com"},
		Match: []string{"/chat/completions", "/responses", "/v1/messages"},
		Models: []string{"gpt-5.5", "claude-sonnet-5"},
	},
}

// Tools returns the registry.
func Tools() []Tool { return append([]Tool(nil), tools...) }

// ToolByKey looks up a tool.
func ToolByKey(key string) (Tool, bool) {
	for _, t := range tools {
		if t.Key == key {
			return t, true
		}
	}
	return Tool{}, false
}

// toolForHost returns the tool that owns a hostname, if any.
func toolForHost(host string) (Tool, bool) {
	host = strings.ToLower(host)
	for _, t := range tools {
		for _, h := range t.Hosts {
			if strings.EqualFold(h, host) {
				return t, true
			}
		}
	}
	return Tool{}, false
}

// interceptable reports whether a request path is one this tool's chat calls use.
func (t Tool) interceptable(path string) bool {
	for _, m := range t.Match {
		if strings.Contains(path, m) {
			return true
		}
	}
	return false
}

// allHosts is every host across all tools (for the hosts-file + DNS layer).
func allHosts() []string {
	var out []string
	for _, t := range tools {
		out = append(out, t.Hosts...)
	}
	return out
}
