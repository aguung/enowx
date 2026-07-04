package handlers

import (
	"io"
	"net/http"
	"strings"

	syncpkg "github.com/enowdev/enowx/core/sync"
	"github.com/enowdev/enowx/server/middleware"
)

// OTP forwards /api/otp/* to the cloud's /otp/* API (which proxies the branded
// Warpize SMS service). Dashboard-gated; requires the user to be logged in to
// the cloud (the sync token carries identity). The cloud holds the secret
// partner key and the user's Warpize key.
type OTP struct {
	dash *middleware.Dashboard
	sync *syncpkg.Manager
}

func NewOTP(dash *middleware.Dashboard, sm *syncpkg.Manager) *OTP {
	return &OTP{dash: dash, sync: sm}
}

// Proxy is a catch-all: it maps the request path under /api/otp to /otp on the
// cloud, forwards method + body + query, and relays the upstream status + body
// (wrapped in {data:...} so the frontend api client unwraps it like other calls).
func (h *OTP) Proxy(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	// /api/otp/<rest>  ->  /otp/<rest>
	rest := strings.TrimPrefix(r.URL.Path, "/api/otp")
	path := "/otp" + rest
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(io.LimitReader(r.Body, 1<<20))
	}
	status, raw, err := h.sync.OTPProxy(r.Context(), r.Method, path, body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, "OTP service unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// Wrap so the frontend's api client (which reads .data) gets the payload;
	// on an upstream error the body is the raw error JSON/text.
	if len(raw) > 0 && (raw[0] == '{' || raw[0] == '[') {
		_, _ = w.Write([]byte(`{"data":`))
		_, _ = w.Write(raw)
		_, _ = w.Write([]byte(`}`))
	} else {
		_, _ = w.Write(raw)
	}
}
