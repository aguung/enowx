// Package openaicompat is a generic OpenAI-compatible upstream: it forwards the
// request body as-is to {BaseURL}/chat/completions and streams the reply back.
package openaicompat

import (
	"bytes"
	"net/http"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/oaistream"
)

type Provider struct {
	name    string
	baseURL string
}

func New(name, baseURL string) *Provider {
	return &Provider{name: name, baseURL: baseURL}
}

func (p *Provider) Name() string        { return p.name }
func (p *Provider) Caps() provider.Caps { return provider.Caps{Chat: true} }

func (p *Provider) BuildRequest(req *model.Request, acc provider.Account) (*http.Request, error) {
	r, err := http.NewRequest(http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(req.Raw))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+acc.Cred("api_key"))
	return r, nil
}

func (p *Provider) ParseResponse(resp *http.Response, req *model.Request) (model.Stream, error) {
	return oaistream.Parse(resp, req.Stream)
}
