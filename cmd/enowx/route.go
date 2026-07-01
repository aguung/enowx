package main

import (
	"strings"

	"github.com/enowdev/enowx/core/proxy"
)

// routeModel maps an incoming model id to a provider name. A provider prefix
// (kr/, cb/, kiro/, codebuddy/) wins; otherwise well-known patterns pick the
// provider; default codebuddy.
func routeModel(modelID string) string {
	if p, _ := proxy.SplitModel(modelID); p != "" {
		return p
	}
	switch {
	case strings.HasPrefix(modelID, "kiro-"), strings.Contains(modelID, "codewhisperer"):
		return "kiro"
	default:
		return "codebuddy"
	}
}
