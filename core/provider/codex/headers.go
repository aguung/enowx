package codex

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
)

const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"

// setCodexHeaders sets the Codex-CLI-style identity headers upstream expects.
func setCodexHeaders(h http.Header, token, accountID, session string) {
	h.Set("Authorization", "Bearer "+token)
	h.Set("Content-Type", "application/json")
	h.Set("Accept", "text/event-stream")
	h.Set("OpenAI-Beta", "responses_websockets=2026-02-06")
	h.Set("originator", "codex_cli_rs")
	h.Set("session_id", session)
	h.Set("User-Agent", userAgent)
	if accountID != "" {
		h.Set("chatgpt-account-id", accountID)
	}
}

func newSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "default"
	}
	return hex.EncodeToString(b)
}

// reverseKey namespaces the sanitized→original tool-name map on the request ctx.
type reverseKey struct{}

func withReverseNames(ctx context.Context, m map[string]string) context.Context {
	return context.WithValue(ctx, reverseKey{}, m)
}

func reverseNamesFrom(ctx context.Context) map[string]string {
	if ctx == nil {
		return nil
	}
	if m, ok := ctx.Value(reverseKey{}).(map[string]string); ok {
		return m
	}
	return nil
}

func itoa(i int) string { return strconv.Itoa(i) }
