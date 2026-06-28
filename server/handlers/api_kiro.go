package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/provider/kiro"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/store"
)

// Kiro handles the provider-specific add flows: manual paste, refresh token,
// AWS device-code, and social OAuth.
type Kiro struct {
	doer  transport.Doer
	store store.AccountStore

	mu    sync.Mutex
	aws   map[string]*awsSession
	oauth map[string]*oauthSession
	seq   int64
}

type awsSession struct {
	client     *kiro.AWSClient
	deviceCode string
	region     string
	created    time.Time
}

type oauthSession struct {
	verifier string
	created  time.Time
}

func NewKiro(doer transport.Doer, s store.AccountStore) *Kiro {
	return &Kiro{doer: doer, store: s, aws: map[string]*awsSession{}, oauth: map[string]*oauthSession{}}
}

func (h *Kiro) id() string {
	h.seq++
	return time.Now().Format("150405") + "-" + itoa(h.seq)
}

func (h *Kiro) save(w http.ResponseWriter, r *http.Request, label string, creds map[string]string) {
	if len(creds) == 0 || creds["access_token"] == "" {
		writeAPIErr(w, http.StatusBadRequest, "missing access token in credentials")
		return
	}
	id, err := h.store.Add(r.Context(), store.Account{
		Provider: "kiro",
		Label:    nz(label, creds["email"]),
		Creds:    creds,
		Status:   "active",
	})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"id": id})
}

// POST /api/accounts/kiro/manual  { "json": "<pasted auth json>", "label": "" }
func (h *Kiro) Manual(w http.ResponseWriter, r *http.Request) {
	var in struct{ JSON, Label string }
	readJSON(r, &in)
	creds, err := kiro.ParseManualJSON(in.JSON)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	h.save(w, r, in.Label, creds)
}

// POST /api/accounts/kiro/refresh  { "refresh_token": "", "region": "", "label": "" }
func (h *Kiro) Refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
		Region       string `json:"region"`
		Label        string `json:"label"`
	}
	readJSON(r, &in)
	if in.RefreshToken == "" {
		writeAPIErr(w, http.StatusBadRequest, "refresh_token is required")
		return
	}
	creds := map[string]string{
		"refresh_token": in.RefreshToken,
		"sso_region":    nz(in.Region, "us-east-1"),
		"auth_method":   "social",
	}
	// The provider's auth manager will exchange this on first use; persist as-is
	// but require it to be usable — mark access_token empty is fine for refresh.
	id, err := h.store.Add(r.Context(), store.Account{Provider: "kiro", Label: in.Label, Creds: creds, Status: "active"})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"id": id})
}

// POST /api/accounts/kiro/aws/start  { "region": "" }
func (h *Kiro) AWSStart(w http.ResponseWriter, r *http.Request) {
	var in struct{ Region string }
	readJSON(r, &in)
	client, dev, err := kiro.StartAWSDevice(h.doer, in.Region)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.mu.Lock()
	sid := h.id()
	h.aws[sid] = &awsSession{client: client, deviceCode: dev.DeviceCode, region: nz(in.Region, "us-east-1"), created: time.Now()}
	h.mu.Unlock()
	writeData(w, map[string]any{
		"session":                   sid,
		"user_code":                 dev.UserCode,
		"verification_uri":          dev.VerificationURI,
		"verification_uri_complete": dev.VerificationURIComplete,
		"interval":                  dev.Interval,
		"expires_in":                dev.ExpiresIn,
	})
}

// GET /api/accounts/kiro/aws/poll?session=  -> {status: pending|done, id?}
func (h *Kiro) AWSPoll(w http.ResponseWriter, r *http.Request) {
	sid := r.URL.Query().Get("session")
	h.mu.Lock()
	s := h.aws[sid]
	h.mu.Unlock()
	if s == nil {
		writeAPIErr(w, http.StatusNotFound, "unknown session")
		return
	}
	creds, pending, err := kiro.PollAWSDevice(h.doer, s.client, s.deviceCode, s.region)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if pending {
		writeData(w, map[string]any{"status": "pending"})
		return
	}
	h.mu.Lock()
	delete(h.aws, sid)
	h.mu.Unlock()
	id, err := h.store.Add(r.Context(), store.Account{Provider: "kiro", Label: creds["email"], Creds: creds, Status: "active"})
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"status": "done", "id": id})
}

// POST /api/accounts/kiro/oauth/start -> {session, authorize_url}
func (h *Kiro) OAuthStart(w http.ResponseWriter, _ *http.Request) {
	flow, err := kiro.StartOAuth()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.mu.Lock()
	sid := h.id()
	h.oauth[sid] = &oauthSession{verifier: flow.CodeVerifier, created: time.Now()}
	h.mu.Unlock()
	writeData(w, map[string]any{"session": sid, "authorize_url": flow.AuthorizeURL})
}

// POST /api/accounts/kiro/oauth/exchange  { "session": "", "code": "" }
func (h *Kiro) OAuthExchange(w http.ResponseWriter, r *http.Request) {
	var in struct{ Session, Code string }
	readJSON(r, &in)
	h.mu.Lock()
	s := h.oauth[in.Session]
	h.mu.Unlock()
	if s == nil {
		writeAPIErr(w, http.StatusNotFound, "unknown session")
		return
	}
	creds, err := kiro.ExchangeOAuth(h.doer, in.Code, s.verifier)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.mu.Lock()
	delete(h.oauth, in.Session)
	h.mu.Unlock()
	h.save(w, r, "", creds)
}

func nz(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func readJSON(r *http.Request, v any) {
	body, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(body, v)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
