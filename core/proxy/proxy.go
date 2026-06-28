// Package proxy is the request lifecycle: pick an account, forward via the
// provider through the transport, classify the result, return a normalized
// stream. It owns no HTTP server and no wire formats.
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/oaistream"
	"github.com/enowdev/enowx/core/transport"
)

type Proxy struct {
	reg  *provider.Registry
	pool *pool.Pool
	doer transport.Doer
}

func New(reg *provider.Registry, p *pool.Pool, d transport.Doer) *Proxy {
	return &Proxy{reg: reg, pool: p, doer: d}
}

// Forward runs one request against the named provider and returns a stream.
func (p *Proxy) Forward(ctx context.Context, providerName string, req *model.Request) (model.Stream, error) {
	prov, err := p.reg.Get(providerName)
	if err != nil {
		return nil, err
	}
	acc, err := p.pool.Pick(ctx, providerName)
	if err != nil {
		return nil, err
	}

	hreq, err := prov.BuildRequest(req, acc)
	if err != nil {
		return nil, err
	}
	hreq = hreq.WithContext(ctx)

	resp, err := p.doer.Do(hreq)
	if err != nil {
		return nil, fmt.Errorf("upstream: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, p.handleErr(ctx, prov, acc, resp)
	}
	return prov.ParseResponse(resp, req)
}

// ProbeResult captures what a warmup probe sent and got back.
type ProbeResult struct {
	Outcome  provider.Outcome
	Status   int          // HTTP status (0 if the request never completed)
	Response string       // a short reply sample, or the error body
	Usage    *model.Usage // tokens/credit parsed from the reply, if present
	Err      error
}

// Probe runs one request against a SPECIFIC account (not the pool) and returns
// the classified outcome plus a response/error summary — used by warmup to
// verify an account is alive. It drains a small amount of the success stream.
func (p *Proxy) Probe(ctx context.Context, providerName string, acc provider.Account, req *model.Request) ProbeResult {
	prov, err := p.reg.Get(providerName)
	if err != nil {
		return ProbeResult{Outcome: provider.OutcomeDead, Err: err}
	}
	hreq, err := prov.BuildRequest(req, acc)
	if err != nil {
		return ProbeResult{Outcome: provider.OutcomeDead, Err: err}
	}
	resp, err := p.doer.Do(hreq.WithContext(ctx))
	if err != nil {
		return ProbeResult{Outcome: provider.OutcomeTransient, Err: fmt.Errorf("upstream: %w", err), Response: err.Error()}
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return ProbeResult{
			Outcome:  prov.Classify(resp.StatusCode, body),
			Status:   resp.StatusCode,
			Response: truncate(body, 1000),
			Err:      fmt.Errorf("upstream %d", resp.StatusCode),
		}
	}
	// Read the raw 200 body: some upstreams (e.g. codebuddy) return an
	// application-level error as JSON with HTTP 200, so we must inspect it rather
	// than rely on extracting display text from the stream.
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	trimmed := bytes.TrimSpace(body)

	if isAppError(trimmed) {
		return ProbeResult{
			Outcome:  provider.OutcomeDead,
			Status:   resp.StatusCode,
			Response: truncate(trimmed, 1000),
			Err:      fmt.Errorf("upstream rejected request"),
		}
	}
	if len(trimmed) == 0 {
		return ProbeResult{Outcome: provider.OutcomeTransient, Status: resp.StatusCode, Response: "empty response", Err: fmt.Errorf("empty response")}
	}
	// Anything else with HTTP 200 and a non-error body is a live account.
	return ProbeResult{
		Outcome:  provider.OutcomeOK,
		Status:   resp.StatusCode,
		Response: truncate(trimmed, 1000),
		Usage:    oaistream.UsageFromBody(trimmed),
	}
}

// isAppError reports whether a 200 body is actually an error envelope (a bare
// JSON object carrying error/code/msg, e.g. {"code":11101,"msg":"...failed"}),
// as opposed to SSE data lines.
func isAppError(body []byte) bool {
	if !bytes.HasPrefix(body, []byte("{")) {
		return false // SSE streams start with "data:" / "event:", not "{"
	}
	var obj struct {
		Error   any    `json:"error"`
		Code    any    `json:"code"`
		Msg     string `json:"msg"`
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &obj) != nil {
		return false
	}
	if obj.Error != nil {
		return true
	}
	// A numeric non-zero code with a message is an error envelope.
	if code, ok := obj.Code.(float64); ok && code != 0 {
		return true
	}
	return false
}

func (p *Proxy) handleErr(ctx context.Context, prov provider.Provider, acc provider.Account, resp *http.Response) error {
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	out := prov.Classify(resp.StatusCode, body)
	p.pool.React(ctx, acc.ID, out)
	return fmt.Errorf("upstream %d: %s", resp.StatusCode, truncate(body, 300))
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n])
	}
	return string(b)
}
