// Package sync mirrors local enowx state to the enowxlabs cloud server using
// the item/LWW protocol (see ~/V2/SYNC.md). It is the client half: it snapshots
// local data into sync items, pushes the locally-newer ones, pulls the
// server-newer ones, and applies them back. The pilot data type is playlists.
package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/enowdev/enowx/store"
)

// DefaultServerURL is the built-in enowx cloud endpoint. Users don't configure
// this; it's fixed (swap to the production URL when ready). An override can
// still be stored via SetServer for development.
const DefaultServerURL = "https://api-dev.enowxlabs.com"

// settings keys (in the gateway's settings KV)
const (
	keyServerURL = "sync_server_url"
	keyToken     = "sync_token"
	keyEnabled   = "sync_enabled"
	keyCursor    = "sync_cursor" // last pull watermark (unix millis)
	keyUser      = "sync_user"   // cached /me JSON (identity + plan)
)

// Manager owns the client-side sync state and the HTTP calls to enowxlabs.
type Manager struct {
	settings store.SettingsStore
	music    store.MusicStore
	http     *http.Client
}

func New(settings store.SettingsStore, music store.MusicStore) *Manager {
	return &Manager{settings: settings, music: music, http: &http.Client{Timeout: 30 * time.Second}}
}

func (m *Manager) get(ctx context.Context, key string) string {
	v, _ := m.settings.Get(ctx, key)
	return v
}

// Configured reports whether a token is set (the server URL is built-in).
func (m *Manager) Configured(ctx context.Context) bool {
	return m.get(ctx, keyToken) != ""
}

func (m *Manager) Enabled(ctx context.Context) bool {
	return m.get(ctx, keyEnabled) == "1" && m.Configured(ctx)
}

// SetServer stores the cloud base URL (e.g. https://labs.enowxlabs.com).
func (m *Manager) SetServer(ctx context.Context, url string) error {
	return m.settings.Set(ctx, keyServerURL, strings.TrimRight(url, "/"))
}

// SetToken stores the sync token issued after Discord login (and caches /me).
func (m *Manager) SetToken(ctx context.Context, token, userJSON string) error {
	if err := m.settings.Set(ctx, keyToken, token); err != nil {
		return err
	}
	if userJSON != "" {
		_ = m.settings.Set(ctx, keyUser, userJSON)
	}
	return m.settings.Set(ctx, keyEnabled, "1")
}

func (m *Manager) Logout(ctx context.Context) error {
	_ = m.settings.Set(ctx, keyToken, "")
	_ = m.settings.Set(ctx, keyUser, "")
	return m.settings.Set(ctx, keyEnabled, "0")
}

// ServerURL returns the configured override or the built-in default.
func (m *Manager) ServerURL(ctx context.Context) string {
	if v := m.get(ctx, keyServerURL); v != "" {
		return v
	}
	return DefaultServerURL
}
func (m *Manager) UserJSON(ctx context.Context) string { return m.get(ctx, keyUser) }

// --- Discord login (device-code style against enowxlabs) ---

// LoginStart asks the server for a Discord authorize URL. The caller opens it;
// the user authorizes; then LoginPoll retrieves the token.
func (m *Manager) LoginStart(ctx context.Context, serverURL string) (authorizeURL, state string, err error) {
	if serverURL != "" {
		if err := m.SetServer(ctx, serverURL); err != nil {
			return "", "", err
		}
	}
	if m.ServerURL(ctx) == "" {
		return "", "", fmt.Errorf("sync server URL not set")
	}
	var resp struct {
		AuthorizeURL string `json:"authorize_url"`
		State        string `json:"state"`
	}
	// /auth is public (no token yet).
	if err := m.callNoAuth(ctx, http.MethodPost, "/auth/discord/start", nil, &resp); err != nil {
		return "", "", err
	}
	return resp.AuthorizeURL, resp.State, nil
}

// LoginPoll checks whether the browser flow finished; on success it stores the
// token and returns the cached user JSON.
func (m *Manager) LoginPoll(ctx context.Context, state string) (done bool, userJSON string, err error) {
	var resp struct {
		Status    string          `json:"status"`
		SyncToken string          `json:"sync_token"`
		User      json.RawMessage `json:"user"`
	}
	if err := m.callNoAuth(ctx, http.MethodGet, "/auth/discord/poll?state="+state, nil, &resp); err != nil {
		return false, "", err
	}
	if resp.Status != "done" {
		return false, "", nil
	}
	if err := m.SetToken(ctx, resp.SyncToken, string(resp.User)); err != nil {
		return true, "", err
	}
	return true, string(resp.User), nil
}

// Me refreshes identity + roles + plan from the server and caches it.
func (m *Manager) Me(ctx context.Context) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodGet, "/me", nil, &raw); err != nil {
		return "", err
	}
	_ = m.settings.Set(ctx, keyUser, string(raw))
	return string(raw), nil
}

// --- protocol types (must match the enowxlabs server) ---

type item struct {
	ItemID    string `json:"id"`
	Type      string `json:"type"`
	Version   int64  `json:"version"`
	UpdatedAt int64  `json:"updated_at"`
	Deleted   bool   `json:"deleted"`
	Encrypted bool   `json:"encrypted"`
	Payload   string `json:"payload,omitempty"`
	Nonce     string `json:"nonce,omitempty"`
}

type manifestEntry struct {
	ItemID    string `json:"id"`
	Type      string `json:"type"`
	Version   int64  `json:"version"`
	UpdatedAt int64  `json:"updated_at"`
	Deleted   bool   `json:"deleted"`
}

const typePlaylist = "playlist"

func playlistItemID(shareCode string) string { return typePlaylist + ":" + shareCode }

// Sync runs one full reconcile: push locally-newer items, pull server-newer
// ones, apply them. Returns the number pushed and pulled.
func (m *Manager) Sync(ctx context.Context) (pushed, pulled int, err error) {
	if !m.Configured(ctx) {
		return 0, 0, fmt.Errorf("sync not configured")
	}

	// Local snapshot keyed by item id.
	local, err := m.localPlaylistItems(ctx)
	if err != nil {
		return 0, 0, err
	}

	// Server manifest keyed by item id.
	var man struct {
		Items []manifestEntry `json:"items"`
		Now   int64           `json:"now"`
	}
	if err := m.call(ctx, http.MethodGet, "/sync/manifest", nil, &man); err != nil {
		return 0, 0, err
	}
	remote := map[string]manifestEntry{}
	for _, e := range man.Items {
		remote[e.ItemID] = e
	}

	// Push: local items the server lacks or that are strictly newer locally.
	var toPush []item
	for id, li := range local {
		re, ok := remote[id]
		if !ok || li.UpdatedAt > re.UpdatedAt {
			toPush = append(toPush, li)
		}
	}
	if len(toPush) > 0 {
		var resp struct {
			Accepted []string `json:"accepted"`
		}
		if err := m.call(ctx, http.MethodPost, "/sync/push", map[string]any{"items": toPush}, &resp); err != nil {
			return 0, 0, err
		}
		pushed = len(resp.Accepted)
	}

	// Pull: server items newer than our cursor, apply the ones that win locally.
	cursor := m.cursor(ctx)
	var pull struct {
		Items []item `json:"items"`
		Now   int64  `json:"now"`
	}
	if err := m.call(ctx, http.MethodGet, "/sync/pull?since="+fmt.Sprint(cursor), nil, &pull); err != nil {
		return pushed, 0, err
	}
	for _, ri := range pull.Items {
		if ri.Type != typePlaylist {
			continue // other types handled elsewhere (settings, encrypted creds…)
		}
		li, have := local[ri.ItemID]
		if have && li.UpdatedAt >= ri.UpdatedAt {
			continue // local is newer or equal — keep it
		}
		sp, perr := decodePlaylist(ri)
		if perr != nil {
			continue
		}
		if err := m.music.ApplySyncedPlaylist(ctx, sp); err != nil {
			return pushed, pulled, err
		}
		pulled++
	}

	// Advance cursor to the server's clock at manifest time.
	if pull.Now > 0 {
		_ = m.settings.Set(ctx, keyCursor, fmt.Sprint(pull.Now))
	}
	return pushed, pulled, nil
}

func (m *Manager) cursor(ctx context.Context) int64 {
	var c int64
	fmt.Sscan(m.get(ctx, keyCursor), &c)
	return c
}

// localPlaylistItems snapshots local playlists as sync items keyed by item id.
func (m *Manager) localPlaylistItems(ctx context.Context) (map[string]item, error) {
	pls, err := m.music.PlaylistsForSync(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]item{}
	for _, p := range pls {
		if p.ShareCode == "" {
			continue // can't address it without a stable id
		}
		payload, _ := json.Marshal(p)
		out[playlistItemID(p.ShareCode)] = item{
			ItemID:    playlistItemID(p.ShareCode),
			Type:      typePlaylist,
			Version:   p.Version,
			UpdatedAt: p.UpdatedAt,
			Deleted:   p.Deleted,
			Payload:   string(payload),
		}
	}
	return out, nil
}

func decodePlaylist(ri item) (store.SyncedPlaylist, error) {
	var sp store.SyncedPlaylist
	if err := json.Unmarshal([]byte(ri.Payload), &sp); err != nil {
		return store.SyncedPlaylist{}, err
	}
	// Trust the item's metadata as authoritative.
	sp.UpdatedAt, sp.Version, sp.Deleted = ri.UpdatedAt, ri.Version, ri.Deleted
	return sp, nil
}

// call performs an authenticated JSON request against the sync server.
func (m *Manager) call(ctx context.Context, method, path string, body any, out any) error {
	return m.do(ctx, method, path, body, out, true)
}

// callNoAuth is for the public OAuth endpoints (no token yet).
func (m *Manager) callNoAuth(ctx context.Context, method, path string, body any, out any) error {
	return m.do(ctx, method, path, body, out, false)
}

func (m *Manager) do(ctx context.Context, method, path string, body any, out any, auth bool) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, m.ServerURL(ctx)+path, rdr)
	if err != nil {
		return err
	}
	if auth {
		req.Header.Set("Authorization", "Bearer "+m.get(ctx, keyToken))
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := m.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("sync unauthorized (token invalid or revoked)")
	}
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("sync %s %s failed (%d): %s", method, path, resp.StatusCode, string(b))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
