package handlers

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/provider/codex"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/store"
)

// Codex handles the provider-specific add flows: social OAuth (paste callback
// URL) and manual auth.json paste.
type Codex struct {
	doer   transport.Doer
	store  store.AccountStore
	warmer Warmer

	mu    sync.Mutex
	oauth map[string]*codexOAuthSession
	seq   int64
}

type codexOAuthSession struct {
	verifier string
	created  time.Time
}

func NewCodex(doer transport.Doer, s store.AccountStore) *Codex {
	return &Codex{doer: doer, store: s, oauth: map[string]*codexOAuthSession{}}
}

// SetWarmer enables automatic warmup of newly-added codex accounts.
func (h *Codex) SetWarmer(w Warmer) { h.warmer = w }

func (h *Codex) id() string {
	h.seq++
	return time.Now().Format("150405") + "-" + itoa(h.seq)
}

func (h *Codex) save(w http.ResponseWriter, r *http.Request, label string, creds map[string]string) {
	if creds["access_token"] == "" {
		writeAPIErr(w, http.StatusBadRequest, "missing access token in credentials")
		return
	}
	id, err := h.store.Add(r.Context(), store.Account{
		Provider: "codex",
		Label:    nz(label, creds["email"]),
		Creds:    creds,
		Status:   "active",
	})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := map[string]any{"id": id}
	if warm := autoWarm(r.Context(), h.warmer, h.store, id); warm != nil {
		out["warmup"] = warm
	}
	writeData(w, out)
}

// POST /api/accounts/codex/oauth/start -> {session, authorize_url}
func (h *Codex) OAuthStart(w http.ResponseWriter, _ *http.Request) {
	flow, err := codex.StartOAuth()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.mu.Lock()
	sid := h.id()
	h.oauth[sid] = &codexOAuthSession{verifier: flow.CodeVerifier, created: time.Now()}
	h.mu.Unlock()
	writeData(w, map[string]any{"session": sid, "authorize_url": flow.AuthorizeURL})
}

// POST /api/accounts/codex/oauth/exchange { session, code }
// code may be a raw code OR the full callback URL — we extract the code param.
func (h *Codex) OAuthExchange(w http.ResponseWriter, r *http.Request) {
	var in struct{ Session, Code string }
	readJSON(r, &in)
	h.mu.Lock()
	s := h.oauth[in.Session]
	h.mu.Unlock()
	if s == nil {
		writeAPIErr(w, http.StatusNotFound, "unknown session")
		return
	}
	code := extractCode(in.Code)
	if code == "" {
		writeAPIErr(w, http.StatusBadRequest, "no auth code found in the pasted value")
		return
	}
	creds, err := codex.ExchangeOAuth(h.doer, code, s.verifier)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.mu.Lock()
	delete(h.oauth, in.Session)
	h.mu.Unlock()
	h.save(w, r, "", creds)
}

// POST /api/accounts/codex/manual { json, label }
func (h *Codex) Manual(w http.ResponseWriter, r *http.Request) {
	var in struct{ JSON, Label string }
	readJSON(r, &in)
	creds, err := codex.ParseManualJSON(in.JSON)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	h.save(w, r, in.Label, creds)
}

// extractCode pulls the auth code from a raw code or a full callback URL.
func extractCode(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if strings.Contains(v, "code=") || strings.HasPrefix(v, "http") {
		if u, err := url.Parse(v); err == nil {
			if c := u.Query().Get("code"); c != "" {
				return c
			}
		}
	}
	return v
}
