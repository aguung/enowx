//go:build !dev

package server

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:webdist
var webFiles embed.FS

func spaHandler() http.Handler {
	sub, _ := fs.Sub(webFiles, "webdist")
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(sub, trimSlash(r.URL.Path)); err != nil && r.URL.Path != "/" {
			r.URL.Path = "/"
		}
		// Long-cache the hashed/static assets (provider icons, plugin-kit, /assets)
		// so the browser doesn't re-fetch them on every render/scroll.
		if p := r.URL.Path; strings.HasPrefix(p, "/providers/") || strings.HasPrefix(p, "/assets/") || strings.HasPrefix(p, "/plugin-kit/") {
			w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func trimSlash(p string) string {
	if len(p) > 0 && p[0] == '/' {
		p = p[1:]
	}
	if p == "" {
		return "index.html"
	}
	return p
}
