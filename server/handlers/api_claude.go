package handlers

import (
	"net/http"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/provider/claudecode"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/store"
)

// Claude handles adding Claude (Claude Code subscription) accounts via OAuth
// login (authorize in the browser, paste the code back) — the same manual-code
// flow Claude Code itself uses — plus a manual token fallback.
type Claude struct {
	doer   transport.Doer
	store  store.AccountStore
	warmer Warmer

	mu    sync.Mutex
	oauth map[string]*claudeOAuth
	seq   int64
}

type claudeOAuth struct {
	verifier string
	state    string
	created  time.Time
}

func NewClaude(doer transport.Doer, s store.AccountStore) *Claude {
	return &Claude{doer: doer, store: s, oauth: map[string]*claudeOAuth{}}
}

// SetWarmer enables automatic warmup of newly-added Claude accounts.
func (h *Claude) SetWarmer(w Warmer) { h.warmer = w }

func (h *Claude) id() string {
	h.seq++
	return time.Now().Format("150405") + "-" + itoa(h.seq)
}

// POST /api/accounts/claude/oauth/start -> {session, authorize_url}
func (h *Claude) OAuthStart(w http.ResponseWriter, _ *http.Request) {
	flow, err := claudecode.StartOAuth()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.mu.Lock()
	sid := h.id()
	h.oauth[sid] = &claudeOAuth{verifier: flow.CodeVerifier, state: flow.State, created: time.Now()}
	h.mu.Unlock()
	writeData(w, map[string]any{"session": sid, "authorize_url": flow.AuthorizeURL})
}

// POST /api/accounts/claude/oauth/exchange  { session, code, label }
func (h *Claude) OAuthExchange(w http.ResponseWriter, r *http.Request) {
	var in struct{ Session, Code, Label string }
	readJSON(r, &in)
	h.mu.Lock()
	s := h.oauth[in.Session]
	h.mu.Unlock()
	if s == nil {
		writeAPIErr(w, http.StatusNotFound, "unknown session")
		return
	}
	creds, err := claudecode.ExchangeOAuth(h.doer, in.Code, s.verifier, s.state)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.mu.Lock()
	delete(h.oauth, in.Session)
	h.mu.Unlock()
	h.save(w, r, in.Label, creds)
}

func (h *Claude) save(w http.ResponseWriter, r *http.Request, label string, creds map[string]string) {
	if creds["access_token"] == "" {
		writeAPIErr(w, http.StatusBadRequest, "missing access token")
		return
	}
	acc := store.Account{
		Provider: "claudecode",
		Label:    nz(label, "Claude"),
		Creds:    creds,
		Status:   "active",
	}
	id, err := h.store.Add(r.Context(), acc)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if h.warmer != nil {
		acc.ID = id
		go h.warmer.WarmAccount(r.Context(), &acc)
	}
	writeData(w, map[string]any{"id": id})
}
