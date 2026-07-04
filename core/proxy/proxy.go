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
	"strings"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/oaistream"
	"github.com/enowdev/enowx/core/sanitize"
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

// maxRotations caps how many accounts a single request will try before giving up.
const maxRotations = 4

// Forward runs one request against the named provider and returns a stream,
// rotating to the next account when one is dead/exhausted.
func (p *Proxy) Forward(ctx context.Context, providerName string, req *model.Request) (model.Stream, error) {
	prov, err := p.reg.Get(providerName)
	if err != nil {
		return nil, err
	}
	ctx = transport.WithProvider(ctx, providerName)
	// Content filters: rewrite blocked words before sending, restore them in the
	// reply. No-op when no rules are configured.
	deobfuscate := false
	if sanitize.Active() {
		for i := range req.Messages {
			for j := range req.Messages[i].Parts {
				if t := req.Messages[i].Parts[j].Text; t != "" {
					req.Messages[i].Parts[j].Text = sanitize.Obfuscate(t)
				}
			}
		}
		req.Raw = nil // force re-encode from the filtered messages (drop passthrough)
		deobfuscate = true
	}
	tried := map[int64]bool{}
	var lastErr error
	for i := 0; i < maxRotations; i++ {
		acc, err := p.pool.PickExcept(ctx, providerName, tried)
		if err != nil {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, err
		}
		tried[acc.ID] = true

		hreq, err := prov.BuildRequest(req, acc)
		if err != nil {
			return nil, err
		}
		hreq = hreq.WithContext(ctx)

		resp, err := p.doer.Do(hreq)
		if err != nil {
			lastErr = fmt.Errorf("upstream: %w", err)
			continue
		}
		if resp.StatusCode >= 400 {
			out, herr := p.handleErr(ctx, prov, acc, resp)
			lastErr = herr
			// Rotate on account-level failures (dead/exhausted); return others.
			if out == provider.OutcomeDead || out == provider.OutcomeExhausted {
				continue
			}
			return nil, herr
		}
		stream, err := prov.ParseResponse(resp, req)
		if err != nil || !deobfuscate || stream == nil {
			return stream, err
		}
		return &deobfuscateStream{inner: stream}, nil
	}
	return nil, lastErr
}

// deobfuscateStream restores filtered words in the streamed reply text.
type deobfuscateStream struct{ inner model.Stream }

func (s *deobfuscateStream) Recv() (model.Event, error) {
	ev, err := s.inner.Recv()
	if ev.Text != "" {
		ev.Text = sanitize.Deobfuscate(ev.Text)
	}
	if ev.Reasoning != "" {
		ev.Reasoning = sanitize.Deobfuscate(ev.Reasoning)
	}
	return ev, err
}

func (s *deobfuscateStream) Close() error { return s.inner.Close() }

// GenerateImage runs a text-to-image request against the named provider (which
// must implement ImageGenerator), rotating accounts on account-level failures.
func (p *Proxy) GenerateImage(ctx context.Context, providerName string, req provider.ImageRequest) (*provider.ImageResult, error) {
	prov, err := p.reg.Get(providerName)
	if err != nil {
		return nil, err
	}
	ctx = transport.WithProvider(ctx, providerName)
	gen, ok := prov.(provider.ImageGenerator)
	if !ok {
		return nil, fmt.Errorf("provider %s does not support image generation", providerName)
	}
	tried := map[int64]bool{}
	var lastErr error
	for i := 0; i < maxRotations; i++ {
		acc, err := p.pool.PickExcept(ctx, providerName, tried)
		if err != nil {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, err
		}
		tried[acc.ID] = true
		res, gerr := gen.GenerateImage(p.doer, acc, req)
		if gerr == nil {
			return res, nil
		}
		lastErr = gerr
		if !p.reactErr(ctx, prov, acc.ID, gerr) {
			return nil, gerr // not an account-level failure → don't rotate
		}
	}
	return nil, lastErr
}

// GenerateMusic runs a text-to-music request against the named provider (which
// must implement MusicGenerator), rotating accounts on account-level failures.
func (p *Proxy) GenerateMusic(ctx context.Context, providerName string, req provider.MusicRequest) (*provider.MusicResult, error) {
	prov, err := p.reg.Get(providerName)
	if err != nil {
		return nil, err
	}
	ctx = transport.WithProvider(ctx, providerName)
	gen, ok := prov.(provider.MusicGenerator)
	if !ok {
		return nil, fmt.Errorf("provider %s does not support music generation", providerName)
	}
	tried := map[int64]bool{}
	var lastErr error
	for i := 0; i < maxRotations; i++ {
		acc, err := p.pool.PickExcept(ctx, providerName, tried)
		if err != nil {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, err
		}
		tried[acc.ID] = true
		res, gerr := gen.GenerateMusic(p.doer, acc, req)
		if gerr == nil {
			return res, nil
		}
		lastErr = gerr
		if !p.reactErr(ctx, prov, acc.ID, gerr) {
			return nil, gerr
		}
	}
	return nil, lastErr
}

// reactErr classifies an error string returned by a generator (image/music) and
// marks the account exhausted/dead when it looks like an account-level failure,
// returning true if the caller should rotate to another account.
func (p *Proxy) reactErr(ctx context.Context, prov provider.Provider, id int64, err error) bool {
	status := statusFromErr(err)
	out := prov.Classify(status, []byte(err.Error()))
	if out == provider.OutcomeDead || out == provider.OutcomeExhausted {
		p.pool.React(ctx, id, out)
		return true
	}
	return false
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
	ctx = transport.WithProvider(ctx, providerName)
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

func (p *Proxy) handleErr(ctx context.Context, prov provider.Provider, acc provider.Account, resp *http.Response) (provider.Outcome, error) {
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	out := prov.Classify(resp.StatusCode, body)
	p.pool.React(ctx, acc.ID, out)
	return out, fmt.Errorf("upstream %d: %s", resp.StatusCode, truncate(body, 300))
}

// statusFromErr extracts an HTTP status code embedded in a generator's error
// string (e.g. "suno generate 429: ...", "insufficient" → 429).
func statusFromErr(err error) int {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "insufficient"), strings.Contains(s, "429"), strings.Contains(s, "exhaust"), strings.Contains(s, "quota"):
		return http.StatusTooManyRequests
	case strings.Contains(s, "401"), strings.Contains(s, "403"), strings.Contains(s, "unauthorized"), strings.Contains(s, "invalid api key"):
		return http.StatusUnauthorized
	}
	return http.StatusInternalServerError
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n])
	}
	return string(b)
}
