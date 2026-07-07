package mitm

import (
	"encoding/json"
	"errors"
	"time"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Manager owns the MITM lifecycle: the CA, the proxy server, the hosts-file
// state, and the per-tool model mappings. It's the single entrypoint the HTTP
// handlers call.
type Manager struct {
	dir        string
	gatewayURL string
	apiKeyFn   func() string // resolves the gateway API key lazily

	mu       sync.Mutex
	ca       *CA
	aliases  map[string]map[string]string // tool -> ideModel -> gatewayModel
	enabled  map[string]bool              // tool -> DNS enabled
}

// New creates a Manager rooted at dir (e.g. ~/.enowx/mitm). apiKeyFn returns the
// gateway API key to inject.
func New(dir, gatewayURL string, apiKeyFn func() string) *Manager {
	m := &Manager{
		dir: dir, gatewayURL: gatewayURL, apiKeyFn: apiKeyFn,
		aliases: map[string]map[string]string{}, enabled: map[string]bool{},
	}
	m.load()
	return m
}

// ensureCA loads/creates the CA on first use.
func (m *Manager) ensureCA() (*CA, error) {
	if m.ca != nil {
		return m.ca, nil
	}
	ca, err := LoadOrCreateCA(m.dir)
	if err != nil {
		return nil, err
	}
	m.ca = ca
	return ca, nil
}

// resolveModel maps an IDE model name to a gateway model via the tool's aliases:
// exact match, then a case-insensitive substring match, else "" (passthrough).
func (m *Manager) resolveModel(tool, ideModel string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	am := m.aliases[tool]
	if am == nil {
		return ""
	}
	if v, ok := am[ideModel]; ok && v != "" {
		return v
	}
	low := strings.ToLower(ideModel)
	for k, v := range am {
		if v != "" && strings.Contains(low, strings.ToLower(k)) {
			return v
		}
	}
	// A single-entry map with a "*" wildcard maps everything.
	if v, ok := am["*"]; ok {
		return v
	}
	return ""
}

// Status is the current MITM state for the UI.
type Status struct {
	Trusted    bool                        `json:"trusted"`
	Running    bool                        `json:"running"`
	CACertPath string                      `json:"ca_cert_path"`
	Tools      []ToolStatus                `json:"tools"`
}

// ToolStatus is per-tool state.
type ToolStatus struct {
	Tool
	DNSEnabled bool              `json:"dns_enabled"`
	Aliases    map[string]string `json:"aliases"`
}

// Status reports the current state.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Status{Running: m.elevatedRunning()}
	if m.ca != nil {
		st.Trusted = m.ca.Trusted()
		st.CACertPath = m.ca.CertPath()
	} else if ca, err := LoadOrCreateCA(m.dir); err == nil {
		m.ca = ca
		st.Trusted = ca.Trusted()
		st.CACertPath = ca.CertPath()
	}
	for _, t := range tools {
		st.Tools = append(st.Tools, ToolStatus{Tool: t, DNSEnabled: m.enabled[t.Key], Aliases: m.aliases[t.Key]})
	}
	return st
}

// InstallTrust installs the CA into the trust store. It runs the privileged child
// in trust-only mode (one admin prompt), so `security add-trusted-cert` executes
// in a real root context — nesting it under osascript fails on macOS with
// "SecTrustSettings: no user interaction possible".
func (m *Manager) InstallTrust() error {
	if _, err := m.ensureCA(); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return spawnElevatedWait(exe, []string{"__mitm-serve", m.dir, "trust-only"})
}

// Start brings up the proxy. It launches a privileged child (via an admin
// prompt) that binds :443, installs the CA, and applies the hosts entries for
// every currently-enabled tool — so the user never has to restart enx as root.
func (m *Manager) Start() error {
	m.mu.Lock()
	hosts := m.enabledHosts()
	m.mu.Unlock()
	if m.elevatedRunning() {
		return nil // already up
	}
	return m.StartElevated(hosts)
}

// Stop signals the privileged child to exit and clean up the hosts entries.
func (m *Manager) Stop() {
	m.mu.Lock()
	m.StopElevated()
	for k := range m.enabled {
		m.enabled[k] = false
	}
	m.save()
	m.mu.Unlock()
}

// enabledHosts returns the hosts of every enabled tool (caller holds the lock).
func (m *Manager) enabledHosts() []string {
	var hosts []string
	for _, t := range tools {
		if m.enabled[t.Key] {
			hosts = append(hosts, t.Hosts...)
		}
	}
	return hosts
}

// EnableTool toggles a tool's intercept. Enabling (re)starts the privileged child
// with the updated host set; disabling the last tool stops it.
func (m *Manager) EnableTool(key string, on bool) error {
	if _, ok := ToolByKey(key); !ok {
		return errUnknownTool
	}
	m.mu.Lock()
	m.enabled[key] = on
	hosts := m.enabledHosts()
	m.save()
	m.mu.Unlock()

	if len(hosts) == 0 {
		m.StopElevated()
		return nil
	}
	// (Re)launch the child with the new host set. If it's already running we stop
	// it first so the new hosts take effect.
	if m.elevatedRunning() {
		m.StopElevated()
		waitForStop(m)
	}
	return m.StartElevated(hosts)
}

// waitForStop briefly waits for the elevated child to exit after a stop signal.
func waitForStop(m *Manager) {
	for i := 0; i < 30; i++ {
		if !m.elevatedRunning() {
			return
		}
		sleep100ms()
	}
}

// SetAliases replaces a tool's model map.
func (m *Manager) SetAliases(key string, aliases map[string]string) error {
	if _, ok := ToolByKey(key); !ok {
		return errUnknownTool
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.aliases[key] = aliases
	m.save()
	return nil
}

// --- persistence ---

type persisted struct {
	Aliases map[string]map[string]string `json:"aliases"`
	Enabled map[string]bool              `json:"enabled"`
}

func (m *Manager) statePath() string { return filepath.Join(m.dir, "state.json") }

func (m *Manager) load() {
	b, err := os.ReadFile(m.statePath())
	if err != nil {
		return
	}
	var p persisted
	if json.Unmarshal(b, &p) != nil {
		return
	}
	if p.Aliases != nil {
		m.aliases = p.Aliases
	}
	if p.Enabled != nil {
		m.enabled = p.Enabled
	}
}

func (m *Manager) save() {
	_ = os.MkdirAll(m.dir, 0o700)
	b, _ := json.MarshalIndent(persisted{Aliases: m.aliases, Enabled: m.enabled}, "", "  ")
	_ = os.WriteFile(m.statePath(), b, 0o600)
}

var errUnknownTool = errors.New("unknown tool")

func sleep100ms() { time.Sleep(100 * time.Millisecond) }
