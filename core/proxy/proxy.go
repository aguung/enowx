// Package proxy is the request lifecycle: pick an account, forward via the
// provider through the transport, classify the result, return a normalized
// stream. It owns no HTTP server and no wire formats.
package proxy

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/enowdev/enowx/core/model"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
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
