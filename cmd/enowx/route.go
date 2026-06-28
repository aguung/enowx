package main

import "strings"

// routeModel maps an incoming model id to a provider name. A "provider/model"
// prefix wins; otherwise well-known prefixes pick the provider; default openai.
func routeModel(modelID string) string {
	if i := strings.Index(modelID, "/"); i > 0 {
		switch modelID[:i] {
		case "codebuddy", "kiro", "openai":
			return modelID[:i]
		}
	}
	switch {
	case strings.HasPrefix(modelID, "kiro-"), strings.Contains(modelID, "codewhisperer"):
		return "kiro"
	case strings.HasPrefix(modelID, "codebuddy-"):
		return "codebuddy"
	default:
		return "openai"
	}
}
