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
	"github.com/enowdev/enowx/core/transport"
)

// variant captures what differs between the global (.ai) and China (.cn)
// CodeBuddy upstreams: provider name, base host, and the X-Domain header value.
type variant struct {
	name   string
	base   string // e.g. "https://www.codebuddy.ai"
	domain string // X-Domain header value
}

var (
	variantGlobal = variant{name: "codebuddy", base: "https://www.codebuddy.ai", domain: "www.codebuddy.ai"}
	// CodeBuddy CN routes through Tencent's copilot host.
	variantCN = variant{name: "codebuddy-cn", base: "https://copilot.tencent.com", domain: "www.codebuddy.cn"}
)

type Provider struct {
	ids  identifiers
	v    variant
	doer transport.Doer
}

// New is the global CodeBuddy (.ai) provider.
func New(doer transport.Doer) *Provider { return &Provider{v: variantGlobal, doer: doer} }

// NewCN is the CodeBuddy CN (China) provider — same wire format, different host.
func NewCN(doer transport.Doer) *Provider { return &Provider{v: variantCN, doer: doer} }

func (p *Provider) Name() string        { return p.v.name }
func (p *Provider) Caps() provider.Caps { return provider.Caps{Chat: true, Images: true} }

func (p *Provider) BuildRequest(req *model.Request, acc provider.Account) (*http.Request, error) {
	r, err := http.NewRequest(http.MethodPost, p.v.base+"/v2/chat/completions", bytes.NewReader(convert.OpenAIBody(req)))
	if err != nil {
		return nil, err
	}
	p.ids.apply(r.Header, p.v.domain, "Bearer "+strings.TrimSpace(acc.Cred("api_key")))
	return r, nil
}

func (p *Provider) ParseResponse(resp *http.Response, req *model.Request) (model.Stream, error) {
	return oaistream.Parse(resp, req.Stream)
}
