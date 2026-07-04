package proxypool

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"

	xproxy "golang.org/x/net/proxy"
)

// RoundTripper builds an http.RoundTripper that routes every request through the
// given proxy. http/https proxies use the standard Transport.Proxy; socks5/
// socks5h use an x/net dialer. The returned transport carries sane timeouts.
func RoundTripper(p Proxy) (http.RoundTripper, error) {
	switch p.Scheme {
	case "http", "https":
		u, err := url.Parse(p.URL())
		if err != nil {
			return nil, err
		}
		return &http.Transport{
			Proxy:                 http.ProxyURL(u),
			ForceAttemptHTTP2:     true,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			IdleConnTimeout:       90 * time.Second,
		}, nil
	case "socks5", "socks5h":
		var auth *xproxy.Auth
		if p.User != "" {
			auth = &xproxy.Auth{User: p.User, Password: p.Pass}
		}
		addr := net.JoinHostPort(p.Host, fmt.Sprint(p.Port))
		dialer, err := xproxy.SOCKS5("tcp", addr, auth, xproxy.Direct)
		if err != nil {
			return nil, err
		}
		ctxDialer, ok := dialer.(xproxy.ContextDialer)
		if !ok {
			return nil, fmt.Errorf("socks5 dialer has no context support")
		}
		return &http.Transport{
			DialContext:           ctxDialer.DialContext,
			ForceAttemptHTTP2:     true,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			IdleConnTimeout:       90 * time.Second,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", p.Scheme)
	}
}

// HTTPClient wraps RoundTripper in an http.Client with an overall timeout, for
// health checks. Streaming callers should use RoundTripper directly (no timeout
// on the whole response).
func HTTPClient(p Proxy, timeout time.Duration) (*http.Client, error) {
	rt, err := RoundTripper(p)
	if err != nil {
		return nil, err
	}
	return &http.Client{Transport: rt, Timeout: timeout}, nil
}
