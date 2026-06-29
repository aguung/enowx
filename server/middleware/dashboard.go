package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/enowdev/enowx/store"
)

const (
	passwordKey   = "dashboard_password_hash"
	sessionCookie = "enx_session"
	sessionTTL    = 30 * 24 * time.Hour
)

// Dashboard guards the management dashboard (UI + loopback-only tools like the
// terminal and file browser) with an optional password.
//
// Policy: localhost is always trusted (local-first — no login needed). A remote
// request (e.g. through a public tunnel) must carry a valid session cookie, and
// a session can only exist once a password has been set. So remote access to
// the shell/files is impossible until the user sets a password and logs in.
type Dashboard struct {
	settings store.SettingsStore
	mu       sync.Mutex
	sessions map[string]time.Time // token -> expiry (cache of the persisted set)
	loaded   bool
}

func NewDashboard(settings store.SettingsStore) *Dashboard {
	return &Dashboard{settings: settings, sessions: map[string]time.Time{}}
}

const sessionsKey = "dashboard_sessions"

// loadLocked hydrates the session cache from the store once (sessions survive
// restarts — they're persisted as JSON in the settings KV).
func (d *Dashboard) loadLocked() {
	if d.loaded {
		return
	}
	d.loaded = true
	raw, _ := d.settings.Get(context.Background(), sessionsKey)
	if raw == "" {
		return
	}
	var stored map[string]int64 // token -> unix expiry
	if json.Unmarshal([]byte(raw), &stored) != nil {
		return
	}
	now := time.Now()
	for tok, exp := range stored {
		t := time.Unix(exp, 0)
		if t.After(now) {
			d.sessions[tok] = t
		}
	}
}

// persistLocked writes the current (non-expired) sessions back to the store.
func (d *Dashboard) persistLocked() {
	out := make(map[string]int64, len(d.sessions))
	for tok, exp := range d.sessions {
		out[tok] = exp.Unix()
	}
	b, _ := json.Marshal(out)
	_ = d.settings.Set(context.Background(), sessionsKey, string(b))
}

// HasPassword reports whether a dashboard password has been set.
func (d *Dashboard) HasPassword(ctx context.Context) bool {
	h, _ := d.settings.Get(ctx, passwordKey)
	return h != ""
}

// SetPassword stores a bcrypt hash of the password.
func (d *Dashboard) SetPassword(ctx context.Context, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return d.settings.Set(ctx, passwordKey, string(hash))
}

// CheckPassword verifies a password against the stored hash.
func (d *Dashboard) CheckPassword(ctx context.Context, password string) bool {
	h, _ := d.settings.Get(ctx, passwordKey)
	if h == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(h), []byte(password)) == nil
}

// CreateSession mints a session token (call after a successful login). The
// session is persisted so it survives a restart.
func (d *Dashboard) CreateSession() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	d.mu.Lock()
	d.loadLocked()
	d.sessions[token] = time.Now().Add(sessionTTL)
	d.persistLocked()
	d.mu.Unlock()
	return token
}

func (d *Dashboard) validSession(token string) bool {
	if token == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.loadLocked()
	exp, ok := d.sessions[token]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(d.sessions, token)
		d.persistLocked()
		return false
	}
	return true
}

func (d *Dashboard) revoke(token string) {
	d.mu.Lock()
	d.loadLocked()
	delete(d.sessions, token)
	d.persistLocked()
	d.mu.Unlock()
}

// SetCookie writes the session cookie. Secure is set when the request arrived
// over TLS (e.g. through the tunnel).
func (d *Dashboard) SetCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isTLS(r),
		MaxAge:   int(sessionTTL.Seconds()),
	})
}

// ClearCookie + revoke (logout).
func (d *Dashboard) ClearCookie(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		d.revoke(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
}

// Authorized reports whether the request may access the dashboard + its
// loopback tools: trusted if it comes from localhost, or carries a valid
// session. Used both by the middleware and directly by the terminal/files
// handlers (which previously checked loopback only).
func (d *Dashboard) Authorized(r *http.Request) bool {
	if IsLoopback(r) {
		return true
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	return d.validSession(c.Value)
}

// LoggedIn reports whether the request carries a valid session (ignores
// loopback). Used by the auth status endpoint.
func (d *Dashboard) LoggedIn(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	return d.validSession(c.Value)
}

func isTLS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return r.Header.Get("X-Forwarded-Proto") == "https"
}

// IsLoopback reports whether the request originates from localhost (by Host).
func IsLoopback(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(r.Host); err == nil {
		host = h
	}
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return len(host) >= 4 && host[:4] == "127." || host == "[::1]"
}
