// Package convert turns inbound wire formats (OpenAI, Anthropic) into the single
// internal model.Request. Outbound normalization to a provider's native shape
// lives in that provider (most pass through model.Request.Raw; only formats that
// differ, like CodeWhisperer, re-encode from the structured fields).
package convert

import (
	"fmt"

	"github.com/enowdev/enowx/core/model"
)

// Inbound decodes a raw request body of the given wire API into a model.Request.
func Inbound(api model.API, body []byte) (*model.Request, error) {
	switch api {
	case model.APIOpenAIChat:
		return fromOpenAIChat(body)
	case model.APIAnthropic:
		return fromAnthropic(body)
	default:
		return nil, fmt.Errorf("unsupported inbound api %q", api)
	}
}
