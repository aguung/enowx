// Package suno registers Suno as a pool provider. Suno does music generation
// (not chat), so it only advertises the Music capability; the actual generation
// runs through the /api/music/* endpoints using a pooled account's api_key.
package suno

import (
	"fmt"
	"net/http"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/provider"
)

type Provider struct{}

func New() *Provider { return &Provider{} }

func (p *Provider) Name() string        { return "suno" }
func (p *Provider) Caps() provider.Caps { return provider.Caps{Music: true} }

// Suno is not a chat/completions upstream — it's driven by the music handlers.
func (p *Provider) BuildRequest(*model.Request, provider.Account) (*http.Request, error) {
	return nil, fmt.Errorf("suno does not support chat completions")
}

func (p *Provider) ParseResponse(*http.Response, *model.Request) (model.Stream, error) {
	return nil, fmt.Errorf("suno does not support chat completions")
}

func (p *Provider) Classify(status int, _ []byte) provider.Outcome {
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return provider.OutcomeDead
	}
	if status == http.StatusTooManyRequests {
		return provider.OutcomeExhausted
	}
	return provider.OutcomeTransient
}
