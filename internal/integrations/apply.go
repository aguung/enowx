package integrations

import (
	"fmt"
	"os/exec"
	"strings"
)

// StatusOf returns the live status for a tool: installed (binary on PATH or a
// config file present) and connected (config points at our gateway).
func StatusOf(s Spec, ourBase string) Status {
	st := Status{Spec: s}
	for _, p := range s.ConfigPaths {
		st.Paths = append(st.Paths, expand(p))
	}
	// Installed: binary on PATH, or any config file already present.
	if _, err := exec.LookPath(s.Binary); err == nil {
		st.Installed = true
	} else {
		for _, p := range st.Paths {
			if fileExists(p) {
				st.Installed = true
				break
			}
		}
	}
	st.Connected, st.Models = toolConnected(s, ourBase)
	if st.Models == nil {
		st.Models = []string{} // marshal as [] not null so the UI can .length safely
	}
	return st
}

// Apply writes the tool's config to point at the gateway. Returns the resolved
// model list actually written.
func Apply(s Spec, req ApplyRequest) error {
	models := req.Models
	if len(models) == 0 && req.Model != "" {
		models = []string{req.Model}
	}
	if len(models) == 0 {
		return fmt.Errorf("at least one model is required")
	}
	switch s.Key {
	case "claude":
		return applyClaude(req.BaseURL, req.APIKey, models[0])
	case "codex":
		return applyCodex(req.BaseURL, req.APIKey, models[0])
	case "opencode":
		return applyOpenCode(req.BaseURL, req.APIKey, models)
	case "cline":
		return applyCline(req.BaseURL, req.APIKey, models[0])
	case "kilo":
		return applyKilo(req.BaseURL, req.APIKey, models[0])
	case "droid":
		return applyDroid(req.BaseURL, req.APIKey, models)
	case "openclaw":
		return applyOpenClaw(req.BaseURL, req.APIKey, models)
	case "hermes":
		return applyHermes(req.BaseURL, req.APIKey, models[0])
	}
	return fmt.Errorf("unknown tool %q", s.Key)
}

// Reset removes only the gateway's fields from the tool's config.
func Reset(s Spec) error {
	switch s.Key {
	case "claude":
		return resetClaude()
	case "codex":
		return resetCodex()
	case "opencode":
		return resetOpenCode()
	case "cline":
		return resetCline()
	case "kilo":
		return resetKilo()
	case "droid":
		return resetDroid()
	case "openclaw":
		return resetOpenClaw()
	case "hermes":
		return resetHermes()
	}
	return fmt.Errorf("unknown tool %q", s.Key)
}

// toolConnected reads a tool's config and reports whether it currently targets
// our gateway, plus the models configured for us.
func toolConnected(s Spec, ourBase string) (bool, []string) {
	switch s.Key {
	case "claude":
		m := mustJSON(s.ConfigPaths[0])
		env, _ := m["env"].(map[string]any)
		if env == nil {
			return false, nil
		}
		base, _ := env["ANTHROPIC_BASE_URL"].(string)
		tok, _ := env["ANTHROPIC_AUTH_TOKEN"].(string)
		if isOurBase(base, ourBase) || isOurKey(tok) {
			var models []string
			if mv, ok := env["ANTHROPIC_MODEL"].(string); ok && mv != "" {
				models = []string{mv}
			}
			return true, models
		}
	case "opencode":
		m := mustJSON(s.ConfigPaths[0])
		prov := asMapRO(asMapRO(m, "provider"), "enowx")
		if len(prov) > 0 {
			return true, providerModels(prov)
		}
	case "droid":
		m := mustJSON(s.ConfigPaths[0])
		if arr, ok := m["customModels"].([]any); ok {
			var models []string
			for _, e := range arr {
				if em, ok := e.(map[string]any); ok {
					if bu, _ := em["baseUrl"].(string); isOurBase(bu, ourBase) {
						if mid, _ := em["model"].(string); mid != "" {
							models = append(models, mid)
						}
					}
				}
			}
			if len(models) > 0 {
				return true, models
			}
		}
	case "cline":
		m := mustJSON(s.ConfigPaths[0])
		if base, _ := m["openAiBaseUrl"].(string); isOurBase(base, ourBase) {
			mid, _ := m["openAiModelId"].(string)
			return true, nonEmpty(mid)
		}
	case "kilo":
		m := mustJSON(s.ConfigPaths[0])
		oc := asMapRO(m, "openai-compatible")
		if base, _ := oc["baseUrl"].(string); isOurBase(base, ourBase) {
			mid, _ := oc["model"].(string)
			return true, nonEmpty(mid)
		}
	case "openclaw":
		m := mustJSON(s.ConfigPaths[0])
		prov := asMapRO(asMapRO(m, "providers"), "enowx")
		if base, _ := prov["baseURL"].(string); isOurBase(base, ourBase) {
			return true, providerModels(prov)
		}
	case "codex":
		// TOML — do a lightweight text scan for our provider block.
		if txt, ok := readText(expand(s.ConfigPaths[0])); ok {
			if strings.Contains(txt, "[model_providers.enowx]") && strings.Contains(strings.ToLower(txt), "localhost") {
				return true, nil
			}
		}
	case "hermes":
		if txt, ok := readText(expand(s.ConfigPaths[0])); ok {
			if isOurBase(txt, ourBase) {
				return true, nil
			}
		}
	}
	return false, nil
}

// --- small read helpers ---

func mustJSON(path string) map[string]any {
	m, _ := readJSON(expand(path))
	return m
}

func asMapRO(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return map[string]any{}
}

func providerModels(prov map[string]any) []string {
	var out []string
	if mm, ok := prov["models"].(map[string]any); ok {
		for k := range mm {
			out = append(out, k)
		}
	}
	if arr, ok := prov["models"].([]any); ok {
		for _, e := range arr {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func nonEmpty(s string) []string {
	if s == "" {
		return nil
	}
	return []string{s}
}
