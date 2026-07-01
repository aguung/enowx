// Package codex speaks OpenAI's ChatGPT-subscription Codex backend. It translates
// the normalized request into the Responses API shape, signs it with a refreshing
// OAuth token, and decodes the Responses SSE stream back into normalized events.
package codex

import (
	"bytes"
	"net/http"
	"sync"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/transport"
)

const endpoint = "https://chatgpt.com/backend-api/codex/responses"

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

func (p *Provider) Name() string        { return "codex" }
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

func (p *Provider) BuildRequest(req *model.Request, acc provider.Account) (*http.Request, error) {
	am := p.manager(acc)
	token, err := am.token()
	if err != nil {
		return nil, err
	}
	body, reverse := buildResponsesBody(req)
	r, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	setCodexHeaders(r.Header, token, am.accountID(), newSessionID())
	// Stash the sanitized→original tool-name map so ParseResponse can restore
	// the caller's original tool names in emitted tool-call deltas.
	if len(reverse) > 0 {
		r = r.WithContext(withReverseNames(r.Context(), reverse))
	}
	return r, nil
}

func (p *Provider) ParseResponse(resp *http.Response, req *model.Request) (model.Stream, error) {
	return newCodexStream(resp, reverseNamesFrom(resp.Request.Context())), nil
}

// Classify maps an upstream status to a pool outcome.
func (p *Provider) Classify(status int, _ []byte) provider.Outcome {
	switch {
	case status == http.StatusUnauthorized, status == http.StatusForbidden:
		return provider.OutcomeDead
	case status == http.StatusTooManyRequests:
		return provider.OutcomeExhausted
	case status >= 500:
		return provider.OutcomeTransient
	default:
		return provider.OutcomeTransient
	}
}

// Models returns the (hardcoded) Codex model catalog. Codex has no live /models
// endpoint, so the list is static — surfaced with the cx/ prefix by the caller.
func (p *Provider) Models(_ provider.Account) ([]provider.Model, error) {
	return catalog(), nil
}

// Email returns the account's email if it was captured at add time.
func (p *Provider) Email(acc provider.Account) string {
	if e := acc.Cred("email"); e != "" {
		return e
	}
	return emailFromJWT(acc.Cred("id_token"))
}
