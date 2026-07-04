// Package commandcode speaks CommandCode's CLI backend (/alpha/generate). The
// upstream takes an Anthropic-ish request wrapped in a CLI envelope and streams
// AI-SDK-v5 NDJSON events back, which we decode into normalized events. Auth is
// a plain API key (starts with user_...) sent as a bearer token.
package commandcode

import (
	"bytes"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/transport"
)

const endpoint = "https://api.commandcode.ai/alpha/generate"

// CLI-identifying headers the upstream expects (mirrors the CommandCode CLI).
const (
	cliVersion = "0.25.7"
	cliEnv     = "cli"
)

type Provider struct{ doer transport.Doer }

func New(doer transport.Doer) *Provider { return &Provider{doer: doer} }

func (p *Provider) Name() string        { return "commandcode" }
func (p *Provider) Caps() provider.Caps { return provider.Caps{Chat: true} }

func (p *Provider) BuildRequest(req *model.Request, acc provider.Account) (*http.Request, error) {
	body := buildBody(req)
	r, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+strings.TrimSpace(acc.Cred("api_key")))
	r.Header.Set("x-command-code-version", cliVersion)
	r.Header.Set("x-cli-environment", cliEnv)
	return r, nil
}

func (p *Provider) ParseResponse(resp *http.Response, _ *model.Request) (model.Stream, error) {
	return newStream(resp), nil
}

// Classify maps an upstream status to a pool outcome.
func (p *Provider) Classify(status int, body []byte) provider.Outcome {
	switch {
	case status < 400:
		return provider.OutcomeOK
	case status == http.StatusUnauthorized, status == http.StatusForbidden:
		return provider.OutcomeDead
	case status == http.StatusTooManyRequests,
		bytes.Contains(body, []byte("insufficient")),
		bytes.Contains(body, []byte("quota")):
		return provider.OutcomeExhausted
	case status >= 500:
		return provider.OutcomeTransient
	default:
		return provider.OutcomeTransient
	}
}

// Models returns the static CommandCode catalog. The upstream has no live
// /models endpoint, so the list is hardcoded and surfaced with the cc/ prefix.
func (p *Provider) Models(_ provider.Account) ([]provider.Model, error) {
	return catalog(), nil
}
