package mitm

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// serveConfig is written by the parent and read by the elevated child, so the
// privileged proxy has everything it needs without long argv.
type serveConfig struct {
	Dir        string                       `json:"dir"`
	GatewayURL string                       `json:"gateway_url"`
	APIKey     string                       `json:"api_key"`
	Hosts      []string                     `json:"hosts"`
	Aliases    map[string]map[string]string `json:"aliases"`
}

func (m *Manager) serveConfigPath() string { return filepath.Join(m.dir, "serve.json") }
func (m *Manager) pidPath() string         { return filepath.Join(m.dir, ".mitm.pid") }
func (m *Manager) stopPath() string        { return filepath.Join(m.dir, ".stop") }

// StartElevated launches the privileged proxy child with an admin prompt. The
// child binds :443, installs the CA + hosts entries, and serves the proxy. It
// runs until Manager.Stop() (which drops a stop-file the child polls).
func (m *Manager) StartElevated(hosts []string) error {
	ca, err := m.ensureCA()
	if err != nil {
		return err
	}
	cfg := serveConfig{
		Dir: m.dir, GatewayURL: m.gatewayURL, APIKey: m.apiKeyFn(),
		Hosts: hosts, Aliases: m.aliases,
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(m.serveConfigPath(), b, 0o600); err != nil {
		return err
	}
	_ = os.Remove(m.stopPath()) // clear any stale stop signal
	_ = ca

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// Elevate the child via the OS's native prompt. The child detaches and keeps
	// running; we return once it's up (or the prompt is cancelled).
	return spawnElevated(exe, []string{"__mitm-serve", m.dir})
}

// StopElevated signals the elevated child to exit (via a stop-file it polls) and
// removes the hosts entries (best-effort, may itself prompt if not elevated).
func (m *Manager) StopElevated() {
	_ = os.WriteFile(m.stopPath(), []byte("1"), 0o600)
	// Give the child a moment to clean up its own hosts entries + exit.
}

// elevatedRunning reports whether the privileged child is alive (pid file + live
// process).
func (m *Manager) elevatedRunning() bool {
	b, err := os.ReadFile(m.pidPath())
	if err != nil {
		return false
	}
	var pid int
	if _, err := fmt.Sscanf(strings.TrimSpace(string(b)), "%d", &pid); err != nil || pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// Signal 0 probes liveness without affecting the process (unix). On Windows
	// FindProcess already fails for dead pids.
	if runtime.GOOS == "windows" {
		return true
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

// RunElevatedServe is the entrypoint of the privileged child (os.Args:
// [__mitm-serve <dir> [trust-only]]). It reads serve.json, installs the CA (and,
// unless trust-only, the hosts + :443 proxy), serving until the stop-file appears.
func RunElevatedServe(args []string) {
	if len(args) < 1 {
		os.Exit(2)
	}
	dir := args[0]
	trustOnly := len(args) > 1 && args[1] == "trust-only"
	if trustOnly {
		// Just install the CA into the trust store as root, then exit.
		if ca, err := LoadOrCreateCA(dir); err == nil {
			if err := ca.InstallCA(); err != nil {
				fmt.Fprintln(os.Stderr, "mitm: trust:", err)
				os.Exit(1)
			}
		}
		return
	}
	raw, err := os.ReadFile(filepath.Join(dir, "serve.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "mitm: read config:", err)
		os.Exit(1)
	}
	var cfg serveConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		os.Exit(1)
	}

	ca, err := LoadOrCreateCA(cfg.Dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "mitm: ca:", err)
		os.Exit(1)
	}
	// We're root here — install trust + hosts directly (no nested prompt).
	_ = ca.InstallCA()
	if len(cfg.Hosts) > 0 {
		_ = EnableHosts(cfg.Hosts)
	}

	resolve := func(tool, ideModel string) string { return resolveFromAliases(cfg.Aliases[tool], ideModel) }
	srv := NewServer(ca, cfg.GatewayURL, cfg.APIKey, resolve)
	if err := srv.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "mitm:", err)
		os.Exit(1)
	}
	_ = os.WriteFile(filepath.Join(dir, ".mitm.pid"), []byte(fmt.Sprintf("%d", os.Getpid())), 0o644)

	// Clean up on exit (signal or stop-file).
	cleanup := func() {
		srv.Stop()
		_ = DisableHosts()
		_ = os.Remove(filepath.Join(dir, ".mitm.pid"))
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	stopFile := filepath.Join(dir, ".stop")
	for {
		select {
		case <-sig:
			cleanup()
			return
		case <-time.After(time.Second):
			if _, err := os.Stat(stopFile); err == nil {
				cleanup()
				_ = os.Remove(stopFile)
				return
			}
		}
	}
}

// resolveFromAliases mirrors Manager.resolveModel for the standalone child.
func resolveFromAliases(am map[string]string, ideModel string) string {
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
	if v, ok := am["*"]; ok {
		return v
	}
	return ""
}

// spawnElevated launches exe with args via the OS elevation prompt, detached so
// it keeps running after the prompt returns.
func spawnElevated(exe string, args []string) error {
	switch runtime.GOOS {
	case "darwin":
		return spawnDarwin(exe, args)
	case "windows":
		return spawnWindowsElevated(exe, args)
	default:
		return spawnLinuxElevated(exe, args)
	}
}

// spawnElevatedWait runs exe+args elevated and waits for it to finish (used for
// quick one-shot privileged tasks like trust-only install, so errors surface).
func spawnElevatedWait(exe string, args []string) error {
	switch runtime.GOOS {
	case "darwin":
		parts := append([]string{exe}, args...)
		quoted := make([]string, len(parts))
		for i, p := range parts {
			quoted[i] = shellQuote(p)
		}
		esc := strings.ReplaceAll(strings.Join(quoted, " "), `\`, `\\`)
		esc = strings.ReplaceAll(esc, `"`, `\"`)
		script := fmt.Sprintf(`do shell script "%s" with administrator privileges`, esc)
		out, err := exec.Command("osascript", "-e", script).CombinedOutput()
		if err != nil {
			return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
		}
		return nil
	case "windows":
		return spawnWindowsElevatedWait(exe, args)
	default:
		full := append([]string{exe}, args...)
		if _, err := exec.LookPath("pkexec"); err == nil {
			out, err := exec.Command("pkexec", full...).CombinedOutput()
			if err != nil {
				return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
			}
			return nil
		}
		cmd := exec.Command("sudo", full...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		return cmd.Run()
	}
}

func spawnWindowsElevatedWait(exe string, args []string) error {
	q := make([]string, len(args))
	for i, a := range args {
		q[i] = "'" + strings.ReplaceAll(a, "'", "''") + "'"
	}
	ps := fmt.Sprintf("Start-Process -FilePath '%s' -ArgumentList %s -Verb RunAs -WindowStyle Hidden -Wait",
		strings.ReplaceAll(exe, "'", "''"), strings.Join(q, ","))
	out, err := exec.Command("powershell", "-NoProfile", "-Command", ps).CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func spawnDarwin(exe string, args []string) error {
	parts := append([]string{exe}, args...)
	quoted := make([]string, len(parts))
	for i, p := range parts {
		quoted[i] = shellQuote(p)
	}
	// Background the child (& disown) so osascript returns immediately.
	shellCmd := strings.Join(quoted, " ") + " >/dev/null 2>&1 &"
	esc := strings.ReplaceAll(shellCmd, `\`, `\\`)
	esc = strings.ReplaceAll(esc, `"`, `\"`)
	script := fmt.Sprintf(`do shell script "%s" with administrator privileges`, esc)
	out, err := exec.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func spawnWindowsElevated(exe string, args []string) error {
	q := make([]string, len(args))
	for i, a := range args {
		q[i] = "'" + strings.ReplaceAll(a, "'", "''") + "'"
	}
	ps := fmt.Sprintf("Start-Process -FilePath '%s' -ArgumentList %s -Verb RunAs -WindowStyle Hidden",
		strings.ReplaceAll(exe, "'", "''"), strings.Join(q, ","))
	out, err := exec.Command("powershell", "-NoProfile", "-Command", ps).CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevation failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func spawnLinuxElevated(exe string, args []string) error {
	full := append([]string{exe}, args...)
	if _, err := exec.LookPath("pkexec"); err == nil {
		cmd := exec.Command("pkexec", full...)
		return cmd.Start() // detached
	}
	cmd := exec.Command("sudo", full...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Start()
}
