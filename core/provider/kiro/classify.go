package kiro

import "github.com/enowdev/enowx/core/provider"

func (p *Provider) Classify(status int, _ []byte) provider.Outcome {
	switch {
	case status < 400:
		return provider.OutcomeOK
	case status == 401 || status == 403:
		return provider.OutcomeDead
	case status == 429:
		return provider.OutcomeExhausted
	case status >= 500:
		return provider.OutcomeTransient
	default:
		return provider.OutcomeOK
	}
}
