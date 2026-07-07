package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"

	"github.com/enowdev/enowx/server/middleware"
)

// defaultShell picks the user's interactive shell per OS.
func defaultShell() string {
	if runtime.GOOS == "windows" {
		if ps, err := exec.LookPath("powershell.exe"); err == nil {
			return ps
		}
		return "cmd.exe"
	}
	if sh := os.Getenv("SHELL"); sh != "" {
		return sh
	}
	return "/bin/bash"
}

// scrollbackBytes caps the replay buffer kept per session. Enough to restore a
// screenful-plus of history on reconnect without growing unbounded for a
// long-lived shell that prints a lot.
const scrollbackBytes = 256 * 1024

// termIdleTimeout kills a session whose WebSocket has been detached this long,
// so a closed tab (or a browser that never comes back) doesn't leak a shell
// forever. A refresh reattaches well within this window.
const termIdleTimeout = 30 * time.Minute

// termSession is a live PTY that outlives any single WebSocket. The frontend
// reconnects to it by id after a refresh; on reattach we replay the scrollback
// so the user sees their session as they left it.
type termSession struct {
	id   string
	ptmx *os.File
	cmd  *exec.Cmd

	mu        sync.Mutex
	scroll    []byte          // ring-ish buffer, trimmed to scrollbackBytes
	subscribe chan []byte     // live output to the current WS (nil when detached)
	idleTimer *time.Timer     // fires termIdleTimeout after detach
	onEvict   func(id string) // remove from the registry when killed
	done      chan struct{}   // closed when the PTY/process is torn down
}

func (s *termSession) appendScroll(p []byte) {
	s.mu.Lock()
	s.scroll = append(s.scroll, p...)
	if len(s.scroll) > scrollbackBytes {
		s.scroll = s.scroll[len(s.scroll)-scrollbackBytes:]
	}
	s.mu.Unlock()
}

// kill tears down the PTY and process. Safe to call once.
func (s *termSession) kill() {
	select {
	case <-s.done:
		return
	default:
	}
	close(s.done)
	_ = s.ptmx.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		_, _ = s.cmd.Process.Wait()
	}
	if s.onEvict != nil {
		s.onEvict(s.id)
	}
}

// Terminal serves real PTY shells over WebSockets, keyed by a client-supplied
// session id so a shell persists across page refreshes. Access is gated by the
// dashboard guard: free from localhost, session-authenticated from remote — a
// shell reachable from the network without auth would be a takeover risk.
type Terminal struct {
	dash     *middleware.Dashboard
	mu       sync.Mutex
	sessions map[string]*termSession
}

func NewTerminal(dash *middleware.Dashboard) *Terminal {
	return &Terminal{dash: dash, sessions: map[string]*termSession{}}
}

type termMsg struct {
	Type string `json:"type"`           // "input" | "resize"
	Data string `json:"data,omitempty"` // input bytes
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

// getOrCreate returns the session for id, starting a fresh PTY if none exists.
// If profile is a valid terminal-profile slug, the shell is spawned under that
// profile's isolated HOME so it uses separate tool credentials.
func (h *Terminal) getOrCreate(id, profile string) (*termSession, bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if s, ok := h.sessions[id]; ok {
		return s, false, nil
	}
	cmd := exec.Command(defaultShell())
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	// Terminal profile: override HOME (+ CLAUDE_CONFIG_DIR, which Claude Code needs
	// since it otherwise keeps its login in the macOS Keychain) so this shell's
	// tools log in independently. Symlinks are re-ensured so the profile self-heals.
	if profile != "" {
		if pdir := profileHome(profile); pdir != "" {
			ensureLinks(pdir)
			cmd.Env = setEnv(cmd.Env, "HOME", pdir)
			cmd.Env = setEnv(cmd.Env, "CLAUDE_CONFIG_DIR", filepath.Join(pdir, ".claude"))
			cmd.Env = setEnv(cmd.Env, "ENOWX_TERM_PROFILE", profile)
			cmd.Dir = pdir
		}
	}
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, false, err
	}
	s := &termSession{
		id:      id,
		ptmx:    ptmx,
		cmd:     cmd,
		done:    make(chan struct{}),
		onEvict: h.evict,
	}
	h.sessions[id] = s

	// One reader goroutine per session for its whole life: it fans PTY output to
	// the scrollback buffer and (when attached) to the live subscriber.
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				s.appendScroll(chunk)
				s.mu.Lock()
				sub := s.subscribe
				s.mu.Unlock()
				if sub != nil {
					select {
					case sub <- chunk:
					default: // slow/absent consumer — output is still in scrollback
					}
				}
			}
			if err != nil {
				s.kill() // shell exited
				return
			}
		}
	}()
	return s, true, nil
}

func (h *Terminal) evict(id string) {
	h.mu.Lock()
	delete(h.sessions, id)
	h.mu.Unlock()
}

func (h *Terminal) WS(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		http.Error(w, "terminal requires the dashboard login when accessed remotely", http.StatusForbidden)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		id = "default"
	}

	// Same-origin only (default when OriginPatterns is unset): the library rejects
	// a WebSocket whose Origin host differs from the request Host. This blocks
	// cross-site WebSocket hijacking — a malicious page can't open the localhost
	// shell — while the app's own UI (localhost or the tunnel host) still works
	// because its Origin matches the Host.
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	s, created, err := h.getOrCreate(id, r.URL.Query().Get("profile"))
	if err != nil {
		c.Close(websocket.StatusInternalError, "pty start failed")
		return
	}

	// Only one WebSocket may stream a session at a time. If another tab/refresh is
	// still attached, take over: the previous stream will end when its own read
	// loop sees the subscription channel swapped out.
	sub := make(chan []byte, 64)
	s.mu.Lock()
	if s.idleTimer != nil {
		s.idleTimer.Stop()
		s.idleTimer = nil
	}
	s.subscribe = sub
	scroll := make([]byte, len(s.scroll))
	copy(scroll, s.scroll)
	s.mu.Unlock()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// On reattach, replay scrollback so the user sees the session as they left it.
	// On a freshly created session there's nothing to replay.
	if !created && len(scroll) > 0 {
		_ = c.Write(ctx, websocket.MessageBinary, scroll)
	}

	// Detach (not kill) when this WebSocket goes away, and arm the idle timer so
	// an abandoned session is eventually reclaimed.
	defer func() {
		s.mu.Lock()
		// Only clear if we're still the active subscriber (a newer attach may have
		// replaced us already).
		if s.subscribe == sub {
			s.subscribe = nil
			s.idleTimer = time.AfterFunc(termIdleTimeout, s.kill)
		}
		s.mu.Unlock()
	}()

	// PTY -> client: drain the subscription channel.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.done:
				cancel()
				return
			case chunk, ok := <-sub:
				if !ok {
					cancel()
					return
				}
				if err := c.Write(ctx, websocket.MessageBinary, chunk); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	// client -> PTY (control + input).
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			s.ptmx.Write(data)
			continue
		}
		var m termMsg
		if json.Unmarshal(data, &m) != nil {
			s.ptmx.Write(data)
			continue
		}
		switch m.Type {
		case "resize":
			_ = pty.Setsize(s.ptmx, &pty.Winsize{Cols: m.Cols, Rows: m.Rows})
		case "input":
			s.ptmx.Write([]byte(m.Data))
		default:
			s.ptmx.Write(data)
		}
	}
}
