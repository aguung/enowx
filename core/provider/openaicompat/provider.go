// Package openaicompat is a generic OpenAI-compatible upstream: it forwards the
// request body as-is to {BaseURL}/chat/completions and streams the reply back.
package openaicompat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

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

// Models fetches the account's available models from the upstream's /models
// endpoint (OpenAI-compatible), so the UI shows exactly what the key can access.
func (p *Provider) Models(acc provider.Account) ([]provider.Model, error) {
	r, err := http.NewRequest(http.MethodGet, p.baseURL+"/models", nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("Authorization", "Bearer "+acc.Cred("api_key"))
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(r)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("models: upstream %d", resp.StatusCode)
	}
	var out struct {
		Data []struct {
			ID      string `json:"id"`
			OwnedBy string `json:"owned_by"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	models := make([]provider.Model, 0, len(out.Data))
	for _, m := range out.Data {
		models = append(models, provider.Model{ID: m.ID, Name: m.ID, Type: "chat", OwnedBy: m.OwnedBy})
	}
	return models, nil
}
