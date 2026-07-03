package sync

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// liveEvent mirrors the server's /live frame.
type liveEvent struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// RunLive maintains the persistent /live WebSocket to the server, reconnecting
// with backoff. On `sync_changed` it runs a Sync; on `role_changed` it refreshes
// /me; on `revoked` it logs out. onChange is called after any state change so
// the UI can refresh. It returns when ctx is cancelled.
func (m *Manager) RunLive(ctx context.Context, onChange func()) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		if !m.Enabled(ctx) {
			// Not logged in / disabled — wait and re-check.
			if !sleep(ctx, 5*time.Second) {
				return
			}
			continue
		}
		if err := m.liveOnce(ctx, onChange); err != nil && ctx.Err() == nil {
			log.Printf("[sync] live disconnected: %v", err)
		}
		// Reconnect with capped backoff; reset on a clean run is handled by
		// liveOnce blocking while healthy.
		if !sleep(ctx, backoff) {
			return
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (m *Manager) liveOnce(ctx context.Context, onChange func()) error {
	wsURL := toWS(m.ServerURL(ctx)) + "/live"
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + m.get(ctx, keyToken)}},
	})
	if err != nil {
		return err
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	// On (re)connect, reconcile once to catch anything missed while offline.
	if _, _, err := m.Sync(ctx); err == nil && onChange != nil {
		onChange()
	}

	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return err
		}
		var ev liveEvent
		if json.Unmarshal(data, &ev) != nil {
			continue
		}
		switch ev.Event {
		case "sync_changed":
			if _, _, err := m.Sync(ctx); err == nil && onChange != nil {
				onChange()
			}
		case "role_changed":
			if _, err := m.Me(ctx); err == nil && onChange != nil {
				onChange()
			}
		case "revoked":
			_ = m.Logout(ctx)
			if onChange != nil {
				onChange()
			}
			return nil // drop the connection; RunLive will idle until re-login
		case "chat_message", "message_edited", "message_deleted", "reaction_changed",
			"post_created", "post_edited", "post_deleted", "post_upvote_changed", "post_reaction_changed",
			"comment_added", "comment_edited", "comment_deleted", "comment_reaction_changed",
			"listing_created", "listing_updated", "listing_deleted",
			"order_updated", "order_delivered",
			"plugin_published",
			"notification":
			// Relay community chat + post + marketplace/plugin events to UI (SSE).
			m.publish(ev)
		case "announcement":
			m.publish(ev)
		case "ping", "ready":
			// keepalive / hello — nothing to do
		}
	}
}

func toWS(httpURL string) string {
	if strings.HasPrefix(httpURL, "https://") {
		return "wss://" + strings.TrimPrefix(httpURL, "https://")
	}
	if strings.HasPrefix(httpURL, "http://") {
		return "ws://" + strings.TrimPrefix(httpURL, "http://")
	}
	return httpURL
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
