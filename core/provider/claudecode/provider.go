// Package claudecode speaks Anthropic's Claude Code subscription backend. It
// signs the Anthropic Messages API with a refreshing OAuth token (the same login
// the Claude Code CLI/app uses) instead of an API key, so a user's Claude
// subscription can be served through the gateway like any other provider.
package claudecode

import (
	"bytes"
	"net/http"
	"sync"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/transport"
)

const messagesEndpoint = "https://api.anthropic.com/v1/messages"

// anthropicBeta advertises the Claude Code + OAuth capability set the backend
// expects from a subscription client.
const anthropicBeta = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"

// CredSaver persists refreshed credentials for an account.
type CredSaver func(id int64, creds map[string]string)

type Provider struct {
	doer transport.Doer
	save CredSaver

	mu       sync.Mutex
	managers map[int64]*authManager
}

func New(doer transport.Doer, save CredSaver) *Provider {
	return &Provider{doer: doer, save: save, managers: map[int64]*authManager{}}
}

func (p *Provider) Name() string        { return "claudecode" }
func (p *Provider) Caps() provider.Caps { return provider.Caps{Chat: true} }

func (p *Provider) manager(acc provider.Account) *authManager {
	p.mu.Lock()
	defer p.mu.Unlock()
	if am, ok := p.managers[acc.ID]; ok {
		return am
	}
	am := newAuthManager(p.doer, p.save, acc)
	p.managers[acc.ID] = am
	return am
}

// Email reports the account's email — the cached creds value if present, else a
// live profile lookup with a fresh token. Implements provider.EmailReporter so
// the account gets labelled by email (backfills accounts added before email was
// resolved at OAuth time).
func (p *Provider) Email(acc provider.Account) string {
	if e := acc.Cred("email"); e != "" {
		return e
	}
	am := p.manager(acc)
	token, err := am.token()
	if err != nil {
		return ""
	}
	return fetchClaudeEmail(p.doer, token)
}

func (p *Provider) BuildRequest(req *model.Request, acc provider.Account) (*http.Request, error) {
	am := p.manager(acc)
	token, err := am.token()
	if err != nil {
		return nil, err
	}
	r, err := http.NewRequest(http.MethodPost, messagesEndpoint, bytes.NewReader(anthropicBody(req)))
	if err != nil {
		return nil, err
	}
	// OAuth (subscription) auth — a Bearer token, NOT an x-api-key. The beta +
	// version headers tell the backend this is a Claude Code client.
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("anthropic-version", "2023-06-01")
	r.Header.Set("anthropic-beta", anthropicBeta)
	return r, nil
}

func (p *Provider) ParseResponse(resp *http.Response, req *model.Request) (model.Stream, error) {
	return parseAnthropic(resp, req.Stream)
}

func (p *Provider) Classify(status int, body []byte) provider.Outcome {
	switch {
	case status < 400:
		return provider.OutcomeOK
	case status == 401 || status == 403:
		return provider.OutcomeDead
	case status == 429 || bytes.Contains(body, []byte("rate_limit")) || bytes.Contains(body, []byte("quota")):
		return provider.OutcomeExhausted
	case status >= 500:
		return provider.OutcomeTransient
	default:
		return provider.OutcomeOK
	}
}
