// Package codebuddy is an OpenAI-on-the-wire upstream with its own endpoint and
// CLI-identifying headers. The request body passes through unchanged; only the
// envelope (URL, headers, auth) is provider-specific.
package codebuddy

import (
	"bytes"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/core/convert"
	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/oaistream"
)

const endpoint = "https://www.codebuddy.ai/v2/chat/completions"

type Provider struct{ ids identifiers }

func New() *Provider { return &Provider{} }

func (p *Provider) Name() string        { return "codebuddy" }
func (p *Provider) Caps() provider.Caps { return provider.Caps{Chat: true} }

func (p *Provider) BuildRequest(req *model.Request, acc provider.Account) (*http.Request, error) {
	r, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(convert.OpenAIBody(req)))
	if err != nil {
		return nil, err
	}
	p.ids.apply(r.Header, "Bearer "+strings.TrimSpace(acc.Cred("api_key")))
	return r, nil
}

func (p *Provider) ParseResponse(resp *http.Response, req *model.Request) (model.Stream, error) {
	return oaistream.Parse(resp, req.Stream)
}
