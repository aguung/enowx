package proxy

import (
	"context"
	"fmt"

	"github.com/enowdev/enowx/core/model"
)

// cloneMessages deep-copies a message slice down to each Part slice, so a
// Forward call that mutates Parts in place (the content-sanitize path in
// proxy.go) cannot corrupt another attempt's or the caller's data.
func cloneMessages(msgs []model.Message) []model.Message {
	out := make([]model.Message, len(msgs))
	for i, m := range msgs {
		out[i] = m
		out[i].Parts = append([]model.Part(nil), m.Parts...)
	}
	return out
}

// ForwardChain tries each target in order, starting at startIdx and wrapping,
// stopping at the first success. It calls the existing Forward once per
// target — no new definition of "this target failed" is introduced; a target
// is skipped exactly when Forward already returns an error for it today
// (accounts exhausted/dead, upstream error, etc). Returns the model id that
// actually served the request, for logging.
func (p *Proxy) ForwardChain(ctx context.Context, route func(string) string, targets []string, startIdx int, req *model.Request) (model.Stream, string, error) {
	if len(targets) == 0 {
		return nil, "", fmt.Errorf("combo has no targets")
	}
	var lastErr error
	origModel := req.Model
	for i := 0; i < len(targets); i++ {
		t := targets[(startIdx+i)%len(targets)]
		providerName := route(t)
		_, bare := SplitModel(t)
		attempt := *req
		attempt.Model = bare
		attempt.Messages = cloneMessages(req.Messages)
		attempt.Raw = RewriteBody(req.Raw, origModel, bare)
		stream, err := p.Forward(ctx, providerName, &attempt)
		if err == nil {
			return stream, t, nil
		}
		lastErr = err
	}
	return nil, "", lastErr
}
