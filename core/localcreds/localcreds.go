// Package localcreds scans well-known local files that installed IDEs/CLIs write
// their credentials to, so accounts can be imported without manual pasting. It
// is pure: it only reads files and normalizes them to a credential map.
package localcreds

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Source is one known credential file for a provider.
type Source struct {
	Provider string // registered provider name (e.g. "kiro")
	Target   string // human label for where it came from (e.g. "Kiro Desktop")
	rel      []string
	parse    func(raw map[string]any) map[string]string
}

// Found is a detected, importable credential.
type Found struct {
	Provider string            `json:"provider"`
	Target   string            `json:"target"`
	Path     string            `json:"path"`
	Creds    map[string]string `json:"-"`
}

func home() string {
	h, _ := os.UserHomeDir()
	return h
}

func (s Source) path() string { return filepath.Join(append([]string{home()}, s.rel...)...) }

// Scan returns every source whose file exists and parses to usable creds.
func Scan() []Found {
	var out []Found
	for _, s := range sources {
		p := s.path()
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var raw map[string]any
		if json.Unmarshal(b, &raw) != nil {
			continue
		}
		creds := s.parse(raw)
		if len(creds) == 0 || creds["access_token"] == "" && creds["refresh_token"] == "" {
			continue
		}
		out = append(out, Found{Provider: s.Provider, Target: s.Target, Path: p, Creds: creds})
	}
	// Claude Code needs OS-aware detection (keychain on macOS, file elsewhere).
	if f := scanClaudeCode(); f != nil {
		out = append(out, *f)
	}
	return out
}

// Get reads one specific source by provider+target.
func Get(provider, target string) (*Found, bool) {
	for _, f := range Scan() {
		if f.Provider == provider && f.Target == target {
			return &f, true
		}
	}
	return nil, false
}
