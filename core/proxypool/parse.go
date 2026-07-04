// Package proxypool manages a pool of outbound proxies: parsing user input in
// any common format, storing them, and routing upstream requests through them.
package proxypool

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Proxy is one parsed proxy endpoint. Scheme is normalized lowercase
// (http/https/socks5/socks5h); Host/Port are required; User/Pass optional.
type Proxy struct {
	Scheme string
	Host   string
	Port   int
	User   string
	Pass   string
}

// URL renders the proxy as a dial URL (scheme://user:pass@host:port).
func (p Proxy) URL() string {
	u := &url.URL{Scheme: p.Scheme, Host: net.JoinHostPort(p.Host, strconv.Itoa(p.Port))}
	if p.User != "" {
		u.User = url.UserPassword(p.User, p.Pass)
	}
	return u.String()
}

// Label is a short human-readable identity (host:port) for the pool UI.
func (p Proxy) Label() string { return net.JoinHostPort(p.Host, strconv.Itoa(p.Port)) }

var validScheme = map[string]bool{"http": true, "https": true, "socks5": true, "socks5h": true}

// Parse accepts a single proxy in any of these forms and normalizes it:
//   - scheme://[user:pass@]host:port        (http/https/socks5/socks5h)
//   - host:port:user:pass                    (colon-delimited, common w/ vendors)
//   - user:pass@host:port
//   - host:port                              (no auth)
//   - ip:port                                (no auth)
//
// A bare host:port defaults to the http scheme. Returns an error if it can't be
// understood or the port is invalid.
func Parse(raw string) (Proxy, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return Proxy{}, fmt.Errorf("empty proxy")
	}

	// 1) scheme://… — let net/url do the work.
	if i := strings.Index(s, "://"); i >= 0 {
		scheme := strings.ToLower(s[:i])
		if !validScheme[scheme] {
			return Proxy{}, fmt.Errorf("unsupported scheme %q", scheme)
		}
		u, err := url.Parse(s)
		if err != nil {
			return Proxy{}, fmt.Errorf("invalid proxy url: %w", err)
		}
		port, err := portNum(u.Port())
		if err != nil {
			return Proxy{}, err
		}
		p := Proxy{Scheme: scheme, Host: u.Hostname(), Port: port}
		if u.User != nil {
			p.User = u.User.Username()
			p.Pass, _ = u.User.Password()
		}
		if p.Host == "" {
			return Proxy{}, fmt.Errorf("missing host")
		}
		return p, nil
	}

	// 2) user:pass@host:port — split on the last '@'.
	user, pass := "", ""
	if at := strings.LastIndex(s, "@"); at >= 0 {
		cred := s[:at]
		s = s[at+1:]
		if c := strings.SplitN(cred, ":", 2); len(c) == 2 {
			user, pass = c[0], c[1]
		} else {
			user = cred
		}
	}

	// 3) colon-delimited. Remaining `s` is host:port or host:port:user:pass.
	parts := strings.Split(s, ":")
	switch len(parts) {
	case 2: // host:port
		port, err := portNum(parts[1])
		if err != nil {
			return Proxy{}, err
		}
		return Proxy{Scheme: "http", Host: parts[0], Port: port, User: user, Pass: pass}, nil
	case 4: // host:port:user:pass (only when no @-form supplied the creds)
		if user != "" {
			return Proxy{}, fmt.Errorf("credentials given twice")
		}
		port, err := portNum(parts[1])
		if err != nil {
			return Proxy{}, err
		}
		return Proxy{Scheme: "http", Host: parts[0], Port: port, User: parts[2], Pass: parts[3]}, nil
	default:
		return Proxy{}, fmt.Errorf("unrecognized proxy format: %q", raw)
	}
}

// ParseBulk parses newline- (or comma/whitespace-) separated proxies, returning
// the valid ones and a slice of "<line>: <error>" strings for the rest.
func ParseBulk(text string) (ok []Proxy, bad []string) {
	for _, line := range strings.FieldsFunc(text, func(r rune) bool {
		return r == '\n' || r == '\r' || r == ',' || r == ' ' || r == '\t'
	}) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		p, err := Parse(line)
		if err != nil {
			bad = append(bad, line+": "+err.Error())
			continue
		}
		ok = append(ok, p)
	}
	return ok, bad
}

func portNum(s string) (int, error) {
	if s == "" {
		return 0, fmt.Errorf("missing port")
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 || n > 65535 {
		return 0, fmt.Errorf("invalid port %q", s)
	}
	return n, nil
}
