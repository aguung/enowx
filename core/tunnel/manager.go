package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// Mode is how the tunnel is exposed.
type Mode string

const (
	ModeQuick Mode = "quick" // random trycloudflare.com URL, no account
	ModeNamed Mode = "named" // user's own domain via cloudflared login
)

// State is the persisted + reported tunnel state.
type State struct {
	Enabled   bool   `json:"enabled"`
	Mode      Mode   `json:"mode"`
	URL       string `json:"url"`      // public URL once connected
	Hostname  string `json:"hostname"` // named mode target hostname
	LoggedIn  bool   `json:"logged_in"`
	UpdatedAt string `json:"updated_at"`
}

// Manager owns the cloudflared subprocess and tunnel state.
type Manager struct {
	dir       string // runtime dir (state + binary live here)
	localPort int
	http      *http.Client

	dlOnce sync.Mutex // serializes binary download
	dl     downloadState

	mu      sync.Mutex
	state   State
	cmd     *exec.Cmd
	running bool
}

func New(runtimeDir string, localPort int) *Manager {
	m := &Manager{
		dir:       runtimeDir,
		localPort: localPort,
		http:      &http.Client{Timeout: 5 * time.Minute},
	}
	m.state = m.loadState()
	return m
}

func (m *Manager) statePath() string { return filepath.Join(m.dir, "tunnel.json") }

func (m *Manager) loadState() State {
	var s State
	if b, err := os.ReadFile(m.statePath()); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	s.Enabled = false // never auto-resume on load; user re-enables
	return s
}

func (m *Manager) saveStateLocked() {
	m.state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if b, err := json.MarshalIndent(m.state, "", "  "); err == nil {
		_ = os.WriteFile(m.statePath(), b, 0o600)
	}
}

// Downloading reports binary download progress for the status API.
func (m *Manager) Downloading() (bool, int) { return m.dl.get() }

// Status returns a snapshot of the current state.
func (m *Manager) Status() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.state
	s.Enabled = m.running
	return s
}

// EnableQuick starts a quick tunnel and blocks until the public URL appears (or
// it times out). The cloudflared process keeps running after this returns.
func (m *Manager) EnableQuick() (State, error) {
	m.stop() // tear down anything already running

	urlCh := make(chan string, 1)
	cmd, err := m.runProc(
		[]string{"tunnel", "--url", fmt.Sprintf("http://127.0.0.1:%d", m.localPort), "--no-autoupdate", "--retries", "99"},
		func(line string) {
			if u := scrape(reQuickURL, line); u != "" {
				select {
				case urlCh <- u:
				default:
				}
			}
		},
	)
	if err != nil {
		return State{}, err
	}

	var u string
	select {
	case u = <-urlCh:
	case <-withTimeout(90 * time.Second):
		killCmd(cmd)
		return State{}, fmt.Errorf("quick tunnel timed out waiting for a public URL")
	}

	// The URL is printed before its DNS has propagated at the Cloudflare edge,
	// so returning immediately gives the user a link that briefly fails with
	// DNS_PROBE_POSSIBLE. Give the edge a moment to come up (best-effort): if it
	// confirms reachable we return right away; if not, we still return the URL
	// (the tunnel is live — DNS just needs a few more seconds for the client).
	m.waitReachable(u, 25*time.Second)

	m.mu.Lock()
	m.cmd = cmd
	m.running = true
	m.state = State{Enabled: true, Mode: ModeQuick, URL: u, LoggedIn: m.state.LoggedIn}
	m.saveStateLocked()
	s := m.state
	m.mu.Unlock()
	return s, nil
}

// publicResolver dials Cloudflare/Google DNS directly so we bypass the OS
// resolver's negative cache. cloudflared prints the URL before its edge DNS has
// propagated; if anything queries it too early the OS caches an NXDOMAIN that
// lingers — so we must resolve via a public server, not the OS.
var publicResolver = &net.Resolver{
	PreferGo: true,
	Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		d := net.Dialer{Timeout: 3 * time.Second}
		return d.DialContext(ctx, "udp", "1.1.1.1:53")
	},
}

// waitReachable polls the public URL until it answers (DNS propagated + tunnel
// live) or the deadline passes. Returns true if it confirmed reachability. DNS
// is checked via a public resolver to avoid the OS negative cache.
func (m *Manager) waitReachable(rawurl string, timeout time.Duration) bool {
	host := rawurl
	if u, err := url.Parse(rawurl); err == nil {
		host = u.Hostname()
	}

	// HTTP client whose dialer resolves via the public resolver too, so the
	// probe doesn't get poisoned by the OS cache either.
	client := &http.Client{
		Timeout: 6 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				h, port, _ := net.SplitHostPort(addr)
				ips, err := publicResolver.LookupHost(ctx, h)
				if err != nil || len(ips) == 0 {
					return nil, fmt.Errorf("resolve %s: %w", h, err)
				}
				d := net.Dialer{Timeout: 5 * time.Second}
				return d.DialContext(ctx, network, net.JoinHostPort(ips[0], port))
			},
		},
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		// First confirm DNS resolves at all (cheap, bypasses OS cache).
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		ips, derr := publicResolver.LookupHost(ctx, host)
		cancel()
		if derr == nil && len(ips) > 0 {
			resp, err := client.Get(rawurl + "/health")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode < 500 {
					return true
				}
			}
		}
		time.Sleep(2 * time.Second)
	}
	return false
}

// Login runs `cloudflared tunnel login`, streaming progress via onLine. It
// surfaces the browser authorization URL (onAuthURL) and resolves once the cert
// is saved (or times out).
func (m *Manager) Login(onLine func(string), onAuthURL func(string)) error {
	done := make(chan error, 1)
	var cmd *exec.Cmd
	var err error
	cmd, err = m.runProc([]string{"tunnel", "login"}, func(line string) {
		if onLine != nil {
			onLine(line)
		}
		if u := scrape(reLoginURL, line); u != "" && onAuthURL != nil {
			onAuthURL(u)
		}
	})
	if err != nil {
		return err
	}
	go func() { done <- cmd.Wait() }()

	select {
	case e := <-done:
		if e != nil {
			return fmt.Errorf("login failed: %w", e)
		}
		m.mu.Lock()
		m.state.LoggedIn = true
		m.saveStateLocked()
		m.mu.Unlock()
		return nil
	case <-withTimeout(5 * time.Minute):
		killCmd(cmd)
		return fmt.Errorf("login timed out (browser authorization not completed)")
	}
}

// EnableNamed creates/reuses a named tunnel, routes the hostname to it, and runs
// it. Requires a prior successful Login. Blocks until connected or times out.
func (m *Manager) EnableNamed(hostname string) (State, error) {
	if hostname == "" {
		return State{}, fmt.Errorf("hostname is required")
	}
	m.stop()

	const name = "enowx"
	// create (ignore "already exists") then route DNS to the hostname.
	_ = m.runOnce([]string{"tunnel", "create", name}, 60*time.Second)
	if out, err := m.runOnceOut([]string{"tunnel", "route", "dns", "-f", name, hostname}, 60*time.Second); err != nil {
		return State{}, fmt.Errorf("route dns: %w (%s)", err, out)
	}

	// run the named tunnel, mapping the hostname to the local gateway.
	connected := make(chan struct{}, 1)
	cmd, err := m.runProc(
		[]string{"tunnel", "run", "--url", fmt.Sprintf("http://127.0.0.1:%d", m.localPort), "--no-autoupdate", name},
		func(line string) {
			if scrape(reRegistered, line) != "" {
				select {
				case connected <- struct{}{}:
				default:
				}
			}
		},
	)
	if err != nil {
		return State{}, err
	}

	select {
	case <-connected:
		url := "https://" + hostname
		m.mu.Lock()
		m.cmd = cmd
		m.running = true
		m.state = State{Enabled: true, Mode: ModeNamed, URL: url, Hostname: hostname, LoggedIn: true}
		m.saveStateLocked()
		s := m.state
		m.mu.Unlock()
		return s, nil
	case <-withTimeout(90 * time.Second):
		killCmd(cmd)
		return State{}, fmt.Errorf("named tunnel timed out connecting")
	}
}

// Disable stops the tunnel and clears the running state.
func (m *Manager) Disable() {
	m.stop()
	m.mu.Lock()
	m.state.Enabled = false
	m.state.URL = ""
	m.saveStateLocked()
	m.mu.Unlock()
}

func (m *Manager) stop() {
	m.mu.Lock()
	cmd := m.cmd
	m.cmd = nil
	m.running = false
	m.mu.Unlock()
	killCmd(cmd)
}

// runOnce runs a short cloudflared command to completion, ignoring output.
func (m *Manager) runOnce(args []string, d time.Duration) error {
	_, err := m.runOnceOut(args, d)
	return err
}

// runOnceOut runs a short cloudflared command and returns combined output.
func (m *Manager) runOnceOut(args []string, d time.Duration) (string, error) {
	bin, err := m.ensureBinary()
	if err != nil {
		return "", err
	}
	cmd := exec.Command(bin, args...)
	hideWindow(cmd)
	type res struct {
		out []byte
		err error
	}
	ch := make(chan res, 1)
	go func() {
		out, e := cmd.CombinedOutput()
		ch <- res{out, e}
	}()
	select {
	case r := <-ch:
		return string(r.out), r.err
	case <-withTimeout(d):
		killCmd(cmd)
		return "", fmt.Errorf("command timed out: cloudflared %v", args)
	}
}
