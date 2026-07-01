package proxy

import "strings"

// providerByPrefix maps a short provider prefix (as seen in a model id like
// "kr/claude-sonnet-4.5") to the internal provider name. The long form is also
// accepted. Keep in sync with the display prefixes the model list exposes.
var providerByPrefix = map[string]string{
	"kr":        "kiro",
	"kiro":      "kiro",
	"cb":        "codebuddy",
	"codebuddy": "codebuddy",
}

// prefixByProvider is the canonical short prefix shown in model ids.
var prefixByProvider = map[string]string{
	"kiro":      "kr",
	"codebuddy": "cb",
}

// ProviderPrefix returns the short display prefix for a provider ("kr", "cb"),
// or "" if the provider has none.
func ProviderPrefix(provider string) string { return prefixByProvider[provider] }

// PrefixModel returns the provider-prefixed display id ("kr/claude-...").
func PrefixModel(provider, modelID string) string {
	if p := prefixByProvider[provider]; p != "" {
		return p + "/" + modelID
	}
	return modelID
}

// SplitModel takes a possibly-prefixed model id and returns the internal
// provider (empty if unknown/absent) plus the bare model id upstream expects.
func SplitModel(modelID string) (provider, bare string) {
	if i := strings.Index(modelID, "/"); i > 0 {
		if p, ok := providerByPrefix[modelID[:i]]; ok {
			return p, modelID[i+1:]
		}
	}
	return "", modelID
}
