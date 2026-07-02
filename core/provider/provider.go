// Package provider defines the upstream boundary. Each upstream is one small impl
// of Provider; the proxy and pool never see provider-specific quirks.
package provider

import (
	"net/http"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/transport"
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
	Music  bool
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

// Usage is an account's credit/quota snapshot. Limit==0 means "no quota data".
type Usage struct {
	Limit     float64 `json:"limit"`
	Used      float64 `json:"used"`
	Remaining float64 `json:"remaining"`
	Plan      string  `json:"plan,omitempty"`
	Message   string  `json:"message,omitempty"`
	// Windows is an optional list of named rate-limit windows (e.g. Codex's 5h
	// + weekly). When present the UI shows a bar per window instead of credit.
	Windows []UsageWindow `json:"windows,omitempty"`
}

// UsageWindow is one rate-limit window as a used-percentage plus reset time.
type UsageWindow struct {
	Label       string  `json:"label"`               // e.g. "5h", "Weekly"
	UsedPercent float64 `json:"used_percent"`        // 0..100
	ResetInSecs int64   `json:"reset_in_secs,omitempty"`
}

// UsageReporter is an optional capability: providers that can report an
// account's credit/quota implement it. The server type-asserts for it.
type UsageReporter interface {
	Usage(acc Account) (*Usage, error)
}

// EmailReporter is an optional capability: providers that can resolve an
// account's email from its credentials implement it, so token-added accounts can
// be labelled by email.
type EmailReporter interface {
	Email(acc Account) string
}

// ImageRequest is a normalized text-to-image request.
type ImageRequest struct {
	Model          string
	Prompt         string
	Size           string
	Quality        string
	ResponseFormat string // "b64_json" | "url"
	N              int
}

// ImageData is one generated image (either a URL or base64 data).
type ImageData struct {
	URL     string `json:"url,omitempty"`
	B64JSON string `json:"b64_json,omitempty"`
}

// ImageResult is the outcome of an image generation.
type ImageResult struct {
	Images []ImageData
	Credit float64
}

// ImageGenerator is an optional capability: providers that can generate images
// implement it. The provider runs its own request via the passed doer.
type ImageGenerator interface {
	GenerateImage(doer transport.Doer, acc Account, req ImageRequest) (*ImageResult, error)
}

// Model is one model a provider account can access.
type Model struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`               // chat | image
	OwnedBy string `json:"owned_by,omitempty"`
}

// ModelFetcher is an optional capability: providers whose upstream exposes a
// /models endpoint implement it, so the model list is fetched live using the
// account's credentials. Providers WITHOUT this fall back to the cloud DB
// catalog (managed from the admin panel).
type ModelFetcher interface {
	Models(acc Account) ([]Model, error)
}
