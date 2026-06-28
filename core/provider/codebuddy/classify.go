package codebuddy

import (
	"bytes"

	"github.com/enowdev/enowx/core/provider"
)

func (p *Provider) Classify(status int, body []byte) provider.Outcome {
	switch {
	case status < 400:
		return provider.OutcomeOK
	case status == 401 || status == 403:
		return provider.OutcomeDead
	case status == 429 || bytes.Contains(body, []byte("insufficient")):
		return provider.OutcomeExhausted
	case status >= 500:
		return provider.OutcomeTransient
	default:
		return provider.OutcomeOK
	}
}
