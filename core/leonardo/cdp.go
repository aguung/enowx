package leonardo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/coder/websocket"
)

// ErrNotReady means the browser tab isn't logged in yet (keep polling).
var ErrNotReady = fmt.Errorf("leonardo session not ready")

// startURL is where the login browser opens. Leonardo access is provisioned
// through Canva Business, so we begin on the Canva feature page; the user
// continues into app.leonardo.ai (Canva SSO), and we read the session there.
const startURL = "https://www.canva.com/business/features/leonardo-ai/"

// Session is a launched Chrome instance driven over the DevTools Protocol.
type Session struct {
	cmd  *exec.Cmd
	dir  string
	port int
}

// findChrome returns the path to an installed Chrome/Chromium/Edge, if any.
func findChrome() (string, bool) {
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		}
	case "linux":
		candidates = []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"}
	case "windows":
		pf := os.Getenv("ProgramFiles")
		pfx := os.Getenv("ProgramFiles(x86)")
		candidates = []string{
			pf + `\Google\Chrome\Application\chrome.exe`,
			pfx + `\Google\Chrome\Application\chrome.exe`,
			pf + `\Microsoft\Edge\Application\msedge.exe`,
			pfx + `\Microsoft\Edge\Application\msedge.exe`,
		}
	}
	for _, c := range candidates {
		if strings.ContainsAny(c, `/\`) {
			if _, err := os.Stat(c); err == nil {
				return c, true
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p, true
		}
	}
	return "", false
}

// LaunchChrome opens a visible browser at app.leonardo.ai with a debug port + a
// throwaway profile, so the user can log in and we can read the session over CDP.
func LaunchChrome() (*Session, error) {
	bin, ok := findChrome()
	if !ok {
		return nil, fmt.Errorf("no Chrome/Chromium/Edge found — use the Manual tab instead")
	}
	port, err := freePort()
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "enowx-leo-*")
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(bin,
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--user-data-dir="+dir,
		"--no-first-run",
		"--no-default-browser-check",
		"--new-window",
		startURL,
	)
	if err := cmd.Start(); err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("launch browser: %w", err)
	}
	return &Session{cmd: cmd, dir: dir, port: port}, nil
}

// EvalGetSession reads the Leonardo session by evaluating a same-origin fetch to
// /api/auth/get-session inside the logged-in tab (so it passes the bot check).
// Returns ErrNotReady until the user has logged in.
func (s *Session) EvalGetSession(ctx context.Context) (*SessionCreds, error) {
	wsURL, err := s.leonardoTargetWS(ctx)
	if err == errNoLeonardoTab {
		return nil, ErrNotReady // still on Canva / logging in
	}
	if err != nil {
		return nil, err
	}
	// Hit the absolute URL so it works regardless of the tab's current path.
	raw, err := s.eval(ctx, wsURL, `fetch('https://app.leonardo.ai/api/auth/get-session',{credentials:'include'}).then(r=>r.text()).catch(e=>'ERR:'+e)`)
	if err != nil {
		return nil, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || strings.HasPrefix(raw, "ERR:") ||
		strings.Contains(raw, "Vercel Security Checkpoint") || strings.Contains(raw, "<!DOCTYPE html>") {
		return nil, ErrNotReady
	}
	var payload struct {
		Session struct {
			AccessToken string `json:"accessToken"`
			CognitoSub  string `json:"cognitoSub"`
		} `json:"session"`
		User struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return nil, ErrNotReady
	}
	token := strings.TrimSpace(payload.Session.AccessToken)
	if token == "" {
		return nil, ErrNotReady
	}
	sub, email := payload.Session.CognitoSub, payload.User.Email
	if sub == "" || email == "" {
		js, je := JWTFields(token)
		if sub == "" {
			sub = js
		}
		if email == "" {
			email = je
		}
	}
	return &SessionCreds{AccessToken: token, CognitoSub: strings.TrimSpace(sub), Email: strings.TrimSpace(email)}, nil
}

// Close kills the browser and removes the temp profile.
func (s *Session) Close() {
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		_, _ = s.cmd.Process.Wait()
	}
	if s.dir != "" {
		_ = os.RemoveAll(s.dir)
	}
}

// errNoLeonardoTab means the debug endpoint is up but no leonardo.ai tab exists
// yet (the user is still on Canva / signing in).
var errNoLeonardoTab = fmt.Errorf("no leonardo tab yet")

// leonardoTargetWS finds the debugger WebSocket URL of the leonardo.ai tab. It
// returns errNoLeonardoTab if the browser is reachable but no such tab is open.
func (s *Session) leonardoTargetWS(ctx context.Context) (string, error) {
	type target struct {
		Type  string `json:"type"`
		URL   string `json:"url"`
		WSURL string `json:"webSocketDebuggerUrl"`
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json", s.port), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("browser debug endpoint not reachable")
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var targets []target
	if json.Unmarshal(raw, &targets) != nil {
		return "", errNoLeonardoTab
	}
	for _, t := range targets {
		if t.Type == "page" && strings.Contains(t.URL, "leonardo.ai") && t.WSURL != "" {
			return t.WSURL, nil
		}
	}
	return "", errNoLeonardoTab
}

// eval runs a JS expression in the page via Runtime.evaluate and returns the
// string result value.
func (s *Session) eval(ctx context.Context, wsURL, expr string) (string, error) {
	c, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		return "", fmt.Errorf("cdp dial: %w", err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	c.SetReadLimit(32 * 1024 * 1024)

	cmd := map[string]any{
		"id":     1,
		"method": "Runtime.evaluate",
		"params": map[string]any{
			"expression":    expr,
			"awaitPromise":  true,
			"returnByValue": true,
		},
	}
	body, _ := json.Marshal(cmd)
	if err := c.Write(ctx, websocket.MessageText, body); err != nil {
		return "", err
	}
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return "", err
		}
		var msg struct {
			ID     int `json:"id"`
			Result struct {
				Result struct {
					Value json.RawMessage `json:"value"`
				} `json:"result"`
			} `json:"result"`
		}
		if json.Unmarshal(data, &msg) != nil || msg.ID != 1 {
			continue // event or other id
		}
		var s string
		if json.Unmarshal(msg.Result.Result.Value, &s) == nil {
			return s, nil
		}
		return string(msg.Result.Result.Value), nil
	}
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
