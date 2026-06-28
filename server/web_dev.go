//go:build dev

package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
)

// In dev everything is one port: the Go server handles /api and /v1, and
// proxies all other paths to the Vite dev server (HMR websocket included).
// Vite's address comes from ENOWX_VITE_URL (default http://127.0.0.1:5174).
func spaHandler() http.Handler {
	target := os.Getenv("ENOWX_VITE_URL")
	if target == "" {
		target = "http://127.0.0.1:5174"
	}
	u, err := url.Parse(target)
	if err != nil {
		panic("invalid ENOWX_VITE_URL: " + err.Error())
	}
	return httputil.NewSingleHostReverseProxy(u)
}
