package plugins

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Handler serves a plugin's UI under /plugins/<id>/. For a running sidecar it
// reverse-proxies to the plugin's local port; for a static plugin it serves the
// folder from disk.
func (m *Manager) Handler() http.Handler {
	rp := &reverseProxies{m: m, cache: map[int]*httputil.ReverseProxy{}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, rest := splitPluginPath(r.URL.Path)
		if id == "" || !idRe.MatchString(id) {
			http.NotFound(w, r)
			return
		}
		man, err := m.Get(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		// Gate serving the plugin (premium-only): blocks static plugins (which
		// never call Start) and the UI of any plugin for non-entitled users.
		if err := m.authorized(); err != nil {
			http.Error(w, err.Error(), http.StatusPaymentRequired)
			return
		}

		if man.Runtime == "static" {
			// Serve the plugin folder; default to the manifest UI at the root.
			if rest == "" || rest == "/" {
				rest = "/" + man.UI
			}
			fs := http.StripPrefix("/plugins/"+id, http.FileServer(http.Dir(filepath.Join(m.dir, id))))
			fs.ServeHTTP(w, withPath(w, r, "/plugins/"+id+rest))
			return
		}

		port := m.port(id)
		if port == 0 {
			http.Error(w, "plugin is not running", http.StatusBadGateway)
			return
		}
		// Strip the /plugins/<id> prefix so the plugin sees "/..." paths.
		r2 := withPath(w, r, rest)
		if r2.URL.Path == "" {
			r2.URL.Path = "/"
		}
		rp.for_(port).ServeHTTP(w, r2)
	})
}

type reverseProxies struct {
	m     *Manager
	mu    sync.Mutex
	cache map[int]*httputil.ReverseProxy
}

func (rp *reverseProxies) for_(port int) *httputil.ReverseProxy {
	rp.mu.Lock()
	defer rp.mu.Unlock()
	if p := rp.cache[port]; p != nil {
		return p
	}
	target, _ := url.Parse("http://127.0.0.1:" + strconv.Itoa(port))
	p := httputil.NewSingleHostReverseProxy(target)
	rp.cache[port] = p
	return p
}

// splitPluginPath turns "/plugins/<id>/rest" into (id, "/rest").
func splitPluginPath(p string) (id, rest string) {
	p = strings.TrimPrefix(p, "/plugins/")
	if i := strings.IndexByte(p, '/'); i >= 0 {
		return p[:i], p[i:]
	}
	return p, ""
}

// withPath returns a shallow clone of the request with a rewritten URL path.
func withPath(_ http.ResponseWriter, r *http.Request, path string) *http.Request {
	r2 := r.Clone(r.Context())
	r2.URL.Path = path
	return r2
}
