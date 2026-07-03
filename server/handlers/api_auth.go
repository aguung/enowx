package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/server/middleware"
)

// Auth handles dashboard password setup, login, and logout. The dashboard
// password gates remote access to the UI and the loopback tools (terminal,
// files). Localhost stays trusted without logging in.
type Auth struct{ dash *middleware.Dashboard }

func NewAuth(dash *middleware.Dashboard) *Auth { return &Auth{dash: dash} }

// Status tells the UI whether a password is set and whether this request is
// already authorized (so it can show setup, login, or the desktop).
func (h *Auth) Status(w http.ResponseWriter, r *http.Request) {
	writeData(w, map[string]any{
		"password_set": h.dash.HasPassword(r.Context()),
		"loopback":     middleware.TrustedLocal(r),
		"logged_in":    h.dash.LoggedIn(r),
		"authorized":   h.dash.Authorized(r),
	})
}

// Setup sets the dashboard password the first time. Allowed from anywhere as long
// as no password exists yet, so a headless/remote instance (e.g. a VPS reached
// only through a tunnel) can be set up without local browser access. The
// HasPassword guard still prevents overwriting an already-configured gateway.
func (h *Auth) Setup(w http.ResponseWriter, r *http.Request) {
	if h.dash.HasPassword(r.Context()) {
		writeAPIErr(w, http.StatusConflict, "password already set")
		return
	}
	pw := decodePassword(r)
	if len(pw) < 6 {
		writeAPIErr(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}
	if err := h.dash.SetPassword(r.Context(), pw); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Log the setter in immediately.
	token := h.dash.CreateSession()
	h.dash.SetCookie(w, r, token)
	writeData(w, map[string]any{"ok": true})
}

// Login exchanges the password for a session cookie.
func (h *Auth) Login(w http.ResponseWriter, r *http.Request) {
	if !h.dash.HasPassword(r.Context()) {
		writeAPIErr(w, http.StatusBadRequest, "no password set yet")
		return
	}
	pw := decodePassword(r)
	if !h.dash.CheckPassword(r.Context(), pw) {
		writeAPIErr(w, http.StatusUnauthorized, "incorrect password")
		return
	}
	token := h.dash.CreateSession()
	h.dash.SetCookie(w, r, token)
	writeData(w, map[string]any{"ok": true})
}

// Logout clears the session.
func (h *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	h.dash.ClearCookie(w, r)
	writeData(w, map[string]any{"ok": true})
}

// Change updates the password. Requires being authorized and knowing the
// current password.
func (h *Auth) Change(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "not authorized")
		return
	}
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if h.dash.HasPassword(r.Context()) && !h.dash.CheckPassword(r.Context(), body.Current) {
		writeAPIErr(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}
	if len(strings.TrimSpace(body.New)) < 6 {
		writeAPIErr(w, http.StatusBadRequest, "new password must be at least 6 characters")
		return
	}
	if err := h.dash.SetPassword(r.Context(), body.New); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func decodePassword(r *http.Request) string {
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	return strings.TrimSpace(body.Password)
}
