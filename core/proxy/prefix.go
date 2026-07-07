package proxy

import (
	"strings"
	"sync"
)

// prefixMu guards the prefix maps, which are mutated at runtime when custom
// providers are added/removed.
var prefixMu sync.RWMutex

// AddPrefix registers a runtime provider prefix (custom providers).
func AddPrefix(prefix, provider string) {
	prefixMu.Lock()
	providerByPrefix[prefix] = provider
	providerByPrefix[provider] = provider
	if _, ok := prefixByProvider[provider]; !ok {
		prefixByProvider[provider] = prefix
	}
	prefixMu.Unlock()
}

// RemovePrefix unregisters a runtime provider prefix.
func RemovePrefix(prefix, provider string) {
	prefixMu.Lock()
	delete(providerByPrefix, prefix)
	delete(providerByPrefix, provider)
	delete(prefixByProvider, provider)
	prefixMu.Unlock()
}

// PrefixTaken reports whether a prefix or provider name is already registered
// (built-in or custom) — used to reject clashing custom prefixes.
func PrefixTaken(s string) bool {
	prefixMu.RLock()
	_, a := providerByPrefix[s]
	_, b := prefixByProvider[s]
	prefixMu.RUnlock()
	return a || b
}

// providerByPrefix maps a short provider prefix (as seen in a model id like
// "kr/claude-sonnet-4.5") to the internal provider name. The long form is also
// accepted. Keep in sync with the display prefixes the model list exposes.
var providerByPrefix = map[string]string{
	"kr":           "kiro",
	"kiro":         "kiro",
	"cb":           "codebuddy",
	"codebuddy":    "codebuddy",
	"cbc":          "codebuddy-cn",
	"codebuddy-cn": "codebuddy-cn",
	"cc":           "commandcode",
	"commandcode":  "commandcode",
	"clc":          "claudecode",
	"claudecode":   "claudecode",
	"cx":           "codex",
	"codex":        "codex",
	"ag":           "antigravity",
	"antigravity":  "antigravity",
	"sn":           "suno",
	"suno":         "suno",
	"ld":           "leonardo",
	"leonardo":     "leonardo",
}

// prefixByProvider is the canonical short prefix shown in model ids.
var prefixByProvider = map[string]string{
	"kiro":         "kr",
	"codebuddy":    "cb",
	"codebuddy-cn": "cbc",
	"commandcode":  "cc",
	"claudecode":   "clc",
	"codex":        "cx",
	"antigravity":  "ag",
	"suno":         "sn",
	"leonardo":     "ld",
}

// ProviderPrefix returns the short display prefix for a provider ("kr", "cb"),
// or "" if the provider has none.
func ProviderPrefix(provider string) string {
	prefixMu.RLock()
	defer prefixMu.RUnlock()
	return prefixByProvider[provider]
}

// PrefixModel returns the provider-prefixed display id ("kr/claude-...").
func PrefixModel(provider, modelID string) string {
	prefixMu.RLock()
	p := prefixByProvider[provider]
	prefixMu.RUnlock()
	if p != "" {
		return p + "/" + modelID
	}
	return modelID
}

// SplitModel takes a possibly-prefixed model id and returns the internal
// provider (empty if unknown/absent) plus the bare model id upstream expects.
func SplitModel(modelID string) (provider, bare string) {
	if i := strings.Index(modelID, "/"); i > 0 {
		prefixMu.RLock()
		p, ok := providerByPrefix[modelID[:i]]
		prefixMu.RUnlock()
		if ok {
			return p, modelID[i+1:]
		}
	}
	return "", modelID
}
