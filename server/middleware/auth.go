// Package middleware holds HTTP middleware for the gateway.
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/enowdev/enowx/store"
)

// APIKeyAuth protects a handler only when at least one gateway key exists. With
// no keys configured the gateway stays open (local-first); once a key is added
// every protected request must carry a matching Authorization: Bearer token.
func APIKeyAuth(keys store.KeyStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			n, err := keys.Count(r.Context())
			if err == nil && n > 0 {
				if !authorized(r.Context(), keys, r.Header.Get("Authorization")) {
					unauthorized(w)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func authorized(ctx context.Context, keys store.KeyStore, header string) bool {
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" {
		return false
	}
	ok, err := keys.Valid(ctx, token)
	return err == nil && ok
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":{"message":"invalid or missing API key"}}`))
}
