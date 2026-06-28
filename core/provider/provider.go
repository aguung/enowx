// Package provider defines the upstream boundary. Each upstream is one small impl
// of Provider; the proxy and pool never see provider-specific quirks.
package provider

import (
	"net/http"

	"github.com/enowdev/enowx/core/model"
)

// Account is the credential a provider needs to build a request. Secret is the
// common single-token case; Creds carries the multi-field sets some upstreams
// need (e.g. token + refresh + region + profile).
type Account struct {
	ID     int64
	Secret string
	Creds  map[string]string
}

// Cred returns a named credential, falling back to Secret for "api_key"/"token".
func (a Account) Cred(key string) string {
	if a.Creds != nil {
		if v, ok := a.Creds[key]; ok {
			return v
		}
	}
	if a.Secret != "" && (key == "api_key" || key == "token") {
		return a.Secret
	}
	return ""
}

type Caps struct {
	Chat   bool
	Images bool
}

// Outcome classifies an upstream failure so the pool can react.
type Outcome int

const (
	OutcomeOK        Outcome = iota
	OutcomeTransient         // retry / rotate
	OutcomeExhausted         // this account is out of quota
	OutcomeDead              // key invalid → ban account
)

type Provider interface {
	Name() string
	Caps() Caps
	BuildRequest(*model.Request, Account) (*http.Request, error)
	ParseResponse(*http.Response, *model.Request) (model.Stream, error)
	Classify(status int, body []byte) Outcome
}
