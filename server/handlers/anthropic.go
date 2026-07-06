package handlers

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/enowdev/enowx/core/convert"
	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/server/sse"
	"github.com/enowdev/enowx/store"
)

// Anthropic serves the Messages API at /anthropic/v1/messages. Inbound is
// decoded into the single model.Request; the reply is encoded as Anthropic SSE.
type Anthropic struct {
	proxy      *proxy.Proxy
	route      func(string) string
	logs       store.LogStore
	keys       store.KeyStore
	resolver   *proxy.AliasResolver
	combos     *proxy.ComboResolver
	comboStore store.ComboStore
}

func NewAnthropic(p *proxy.Proxy, route func(string) string, logs store.LogStore, keys store.KeyStore) *Anthropic {
	return &Anthropic{proxy: p, route: route, logs: logs, keys: keys}
}

// SetAliasResolver enables alias resolution on incoming model ids.
func (h *Anthropic) SetAliasResolver(r *proxy.AliasResolver) { h.resolver = r }

// SetCombos enables combo resolution (virtual multi-target models) on incoming
// model ids.
func (h *Anthropic) SetCombos(r *proxy.ComboResolver, s store.ComboStore) {
	h.combos, h.comboStore = r, s
}

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
	if h.combos != nil {
		if combo, ok := h.combos.Lookup(r.Context(), req.Model); ok {
			h.serveCombo(w, r, req, combo, start)
			return
		}
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
	ctx, trace := transport.WithTrace(r.Context())
	stream, err := h.proxy.Forward(ctx, providerName, req)
	if err != nil {
		h.log(providerName, req.Model, "error", start, model.Usage{}, trace)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	us := wrapUsage(stream)
	sse.WriteAnthropic(w, us, req.Model)
	h.log(providerName, req.Model, "success", start, us.usage, trace)
	chargeKey(r, h.keys, us.usage)
}

// serveCombo dispatches a request whose model id matched a combo definition:
// picks a start index per the combo's strategy, walks the target chain via
// ForwardChain, and logs/serves like a direct request would.
func (h *Anthropic) serveCombo(w http.ResponseWriter, r *http.Request, req *model.Request, combo store.ModelCombo, start time.Time) {
	startIdx := 0
	if combo.Strategy == store.ComboRoundRobin && h.comboStore != nil {
		startIdx, _ = h.comboStore.NextIndex(r.Context(), combo.ID, len(combo.Targets))
	}
	ctx, trace := transport.WithTrace(r.Context())
	stream, served, err := h.proxy.ForwardChain(ctx, h.route, combo.Targets, startIdx, req)
	if err != nil {
		h.log("combo", req.Model, "error", start, model.Usage{}, trace)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	us := wrapUsage(stream)
	sse.WriteAnthropic(w, us, served)
	h.log(h.route(served), served, "success", start, us.usage, trace)
	chargeKey(r, h.keys, us.usage)
}

func (h *Anthropic) log(provider, modelID, status string, start time.Time, usage model.Usage, trace *transport.Trace) {
	if h.logs == nil {
		return
	}
	l := store.RequestLog{
		Provider:  provider,
		Model:     modelID,
		Status:    status,
		InTokens:  usage.PromptTokens,
		OutTokens: usage.CompletionTokens,
		LatencyMS: time.Since(start).Milliseconds(),
	}
	if trace != nil {
		l.ProxyUsed = trace.Proxy
		l.AccountLabel = trace.Account
	}
	_ = h.logs.Insert(context.Background(), l)
}
