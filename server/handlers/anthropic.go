package handlers

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/enowdev/enowx/core/convert"
	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/server/sse"
	"github.com/enowdev/enowx/store"
)

// Anthropic serves the Messages API at /anthropic/v1/messages. Inbound is
// decoded into the single model.Request; the reply is encoded as Anthropic SSE.
type Anthropic struct {
	proxy    *proxy.Proxy
	route    func(string) string
	logs     store.LogStore
	keys     store.KeyStore
	resolver *proxy.AliasResolver
}

func NewAnthropic(p *proxy.Proxy, route func(string) string, logs store.LogStore, keys store.KeyStore) *Anthropic {
	return &Anthropic{proxy: p, route: route, logs: logs, keys: keys}
}

// SetAliasResolver enables alias resolution on incoming model ids.
func (h *Anthropic) SetAliasResolver(r *proxy.AliasResolver) { h.resolver = r }

func (h *Anthropic) Messages(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read body")
		return
	}
	req, err := convert.Inbound(model.APIAnthropic, body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	orig := req.Model
	if h.resolver != nil {
		req.Model = h.resolver.Resolve(r.Context(), req.Model)
	}
	providerName := h.route(req.Model)
	if _, bare := proxy.SplitModel(req.Model); bare != req.Model {
		req.Model = bare
	}
	if req.Model != orig {
		req.Raw = proxy.RewriteBody(req.Raw, orig, req.Model)
	}
	stream, err := h.proxy.Forward(r.Context(), providerName, req)
	if err != nil {
		h.log(providerName, req.Model, "error", start, model.Usage{})
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	us := wrapUsage(stream)
	sse.WriteAnthropic(w, us, req.Model)
	h.log(providerName, req.Model, "success", start, us.usage)
	chargeKey(r, h.keys, us.usage)
}

func (h *Anthropic) log(provider, modelID, status string, start time.Time, usage model.Usage) {
	if h.logs == nil {
		return
	}
	_ = h.logs.Insert(context.Background(), store.RequestLog{
		Provider:  provider,
		Model:     modelID,
		Status:    status,
		InTokens:  usage.PromptTokens,
		OutTokens: usage.CompletionTokens,
		LatencyMS: time.Since(start).Milliseconds(),
	})
}
