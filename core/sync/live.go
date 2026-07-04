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
		started := time.Now()
		if err := m.liveOnce(ctx, onChange); err != nil && ctx.Err() == nil {
			log.Printf("[sync] live disconnected: %v", err)
		}
		// A connection that survived a while was healthy — restart the backoff
		// ladder so a one-off drop reconnects in ~1s, not 30s.
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
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
	dctx, dcancel := context.WithTimeout(ctx, 15*time.Second)
	c, _, err := websocket.Dial(dctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + m.get(ctx, keyToken)}},
	})
	dcancel()
	if err != nil {
		return err
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	log.Printf("[sync] live connected (%s)", wsURL)

	// connCtx scopes the sync worker below to this connection's lifetime so
	// reconnects don't accumulate workers.
	connCtx, connCancel := context.WithCancel(ctx)
	defer connCancel()

	// Reconciliation runs on its own goroutine so a slow Sync (it can take tens
	// of seconds) never blocks the read loop. If it did, sync_changed arriving
	// as often as a Sync takes would starve the loop forever and every live
	// event (chat, comments, …) would queue up minutes behind — which is
	// exactly the "nothing is realtime" bug this replaced. requestSync
	// coalesces: one Sync in flight, at most one queued.
	syncReq := make(chan struct{}, 1)
	requestSync := func() {
		select {
		case syncReq <- struct{}{}:
		default: // one already queued — it will pick up our change too
		}
	}
	go func() {
		for {
			select {
			case <-connCtx.Done():
				return
			case <-syncReq:
				if _, _, err := m.Sync(connCtx); err == nil && onChange != nil {
					onChange()
				}
			}
		}
	}()

	// On (re)connect, reconcile once to catch anything missed while offline.
	requestSync()

	for {
		// The server pings every 30s. If nothing arrives for 75s the connection
		// is silently dead (NAT/proxy drop without FIN) — without this deadline
		// Read blocks forever and realtime stays broken until process restart.
		rctx, rcancel := context.WithTimeout(ctx, 75*time.Second)
		_, data, err := c.Read(rctx)
		rcancel()
		if err != nil {
			return err
		}
		var ev liveEvent
		if json.Unmarshal(data, &ev) != nil {
			continue
		}
		switch ev.Event {
		case "sync_changed":
			requestSync()
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
