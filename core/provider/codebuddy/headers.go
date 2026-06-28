package codebuddy

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
)

const (
	clientVersion = "2.52.0"
	userAgent     = "CLI/" + clientVersion + " CodeBuddy/" + clientVersion
)

// identifiers builds the per-request CLI envelope the upstream expects.
type identifiers struct{}

func (identifiers) apply(h http.Header, auth string) {
	conv := uuid.NewString()
	reqID := strings.ReplaceAll(uuid.NewString(), "-", "")

	h.Set("Accept", "application/json")
	h.Set("Content-Type", "application/json")
	h.Set("X-Requested-With", "XMLHttpRequest")
	h.Set("X-Conversation-ID", conv)
	h.Set("X-Conversation-Request-ID", reqID)
	h.Set("X-Conversation-Message-ID", reqID)
	h.Set("X-Request-ID", reqID)
	h.Set("X-Agent-Intent", "craft")
	h.Set("X-Ide-Type", "CLI")
	h.Set("X-Ide-Name", "CLI")
	h.Set("X-Ide-Version", clientVersion)
	h.Set("X-Domain", "www.codebuddy.ai")
	h.Set("X-Product", "SaaS")
	h.Set("User-Agent", userAgent)
	h.Set("Authorization", auth)
}
