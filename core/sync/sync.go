// Package sync mirrors local enowx state to the enowxlabs cloud server using
// the item/LWW protocol (see ~/V2/SYNC.md). It is the client half: it snapshots
// local data into sync items, pushes the locally-newer ones, pulls the
// server-newer ones, and applies them back. The pilot data type is playlists.
package sync

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	stdsync "sync"
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
	keyEnabled   = "sync_enabled" // logged in (token present, not revoked)
	keyAuto      = "sync_auto"    // user's global automatic-sync toggle
	keyCursor    = "sync_cursor"  // last pull watermark (unix millis)
	keyUser      = "sync_user"    // cached /me JSON (identity + plan)
	keyDevice    = "sync_device"  // stable per-device id (for usage watermark)
)

// Manager owns the client-side sync state and the HTTP calls to enowxlabs.
type Manager struct {
	settings store.SettingsStore
	music    store.MusicStore
	logs     store.LogStore
	http     *http.Client

	subsMu stdsync.Mutex
	subs   map[int]chan LiveEvent
	nextID int
}

// LiveEvent is a cloud event relayed to UI subscribers (e.g. chat messages).
type LiveEvent struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

func New(settings store.SettingsStore, music store.MusicStore, logs store.LogStore) *Manager {
	return &Manager{
		settings: settings, music: music, logs: logs,
		http: &http.Client{Timeout: 30 * time.Second},
		subs: map[int]chan LiveEvent{},
	}
}

// Subscribe registers a channel that receives relayed cloud live events until
// the returned cancel func is called.
func (m *Manager) Subscribe() (<-chan LiveEvent, func()) {
	ch := make(chan LiveEvent, 16)
	m.subsMu.Lock()
	id := m.nextID
	m.nextID++
	m.subs[id] = ch
	m.subsMu.Unlock()
	return ch, func() {
		m.subsMu.Lock()
		delete(m.subs, id)
		close(ch)
		m.subsMu.Unlock()
	}
}

// publish fans a live event out to all subscribers (non-blocking).
func (m *Manager) publish(ev liveEvent) {
	out := LiveEvent{Event: ev.Event, Data: ev.Data}
	m.subsMu.Lock()
	for _, ch := range m.subs {
		select {
		case ch <- out:
		default: // drop if a slow subscriber is full
		}
	}
	m.subsMu.Unlock()
}

// deviceID returns a stable id for this device, generating one on first use.
// Used so the cloud usage-watermark advances per device, not globally.
func (m *Manager) deviceID(ctx context.Context) string {
	if id := m.get(ctx, keyDevice); id != "" {
		return id
	}
	id := randHex(8)
	_ = m.settings.Set(ctx, keyDevice, id)
	return id
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

// AutoEnabled reports the user's global automatic-sync toggle. Defaults to on
// (only an explicit "0" turns it off), and requires being logged in.
func (m *Manager) AutoEnabled(ctx context.Context) bool {
	return m.get(ctx, keyAuto) != "0" && m.Enabled(ctx)
}

// SetAuto flips the global automatic-sync toggle.
func (m *Manager) SetAuto(ctx context.Context, on bool) error {
	v := "1"
	if !on {
		v = "0"
	}
	return m.settings.Set(ctx, keyAuto, v)
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

// ServerURL returns the built-in default, overridable only via the
// ENOWX_SYNC_SERVER env var (for development). A previously-persisted value is
// intentionally ignored so the endpoint can't get stuck on a stale URL.
func (m *Manager) ServerURL(_ context.Context) string {
	if v := os.Getenv("ENOWX_SYNC_SERVER"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return DefaultServerURL
}
func (m *Manager) UserJSON(ctx context.Context) string { return m.get(ctx, keyUser) }

// --- Discord login (device-code style against enowxlabs) ---

// LoginStart asks the server for a Discord authorize URL. The caller opens it;
// the user authorizes; then LoginPoll retrieves the token. The server URL is
// built in (see ServerURL); the argument is ignored.
func (m *Manager) LoginStart(ctx context.Context, _ string) (authorizeURL, state string, err error) {
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

// UpdateProfile edits the user's own profile fields on the server, refreshes the
// cached /me, and returns the updated user JSON.
func (m *Manager) UpdateProfile(ctx context.Context, body json.RawMessage) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPatch, "/me/profile", body, &raw); err != nil {
		return "", err
	}
	// Refresh the cached identity so the UI reflects the edit immediately.
	if me, err := m.Me(ctx); err == nil {
		return me, nil
	}
	return string(raw), nil
}

// PublicProfile fetches another user's public profile by id.
func (m *Manager) PublicProfile(ctx context.Context, id string) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodGet, "/users/"+id+"/profile", nil, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// AdminFlags fetches the moderator duplicate-account review queue.
func (m *Manager) AdminFlags(ctx context.Context) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodGet, "/admin/flags", nil, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// AdminReviewFlag dismisses a flagged link.
func (m *Manager) AdminReviewFlag(ctx context.Context, id string) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPost, "/admin/flags/"+id+"/review", nil, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// Shop fetches the cosmetics catalog + the user's owned/equipped/balance.
func (m *Manager) Shop(ctx context.Context) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodGet, "/shop", nil, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ShopBuy spends Kleos to buy a cosmetic.
func (m *Manager) ShopBuy(ctx context.Context, body json.RawMessage) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPost, "/shop/buy", body, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ShopEquip equips/unequips a cosmetic.
func (m *Manager) ShopEquip(ctx context.Context, body json.RawMessage) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPost, "/shop/equip", body, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ChatList fetches a page of community chat messages (path includes any query).
func (m *Manager) ChatList(ctx context.Context, query string) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodGet, "/chat/messages"+query, nil, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ChatSend posts a community chat message.
func (m *Manager) ChatSend(ctx context.Context, body json.RawMessage) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPost, "/chat/messages", body, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ChatEdit edits the caller's own chat message.
func (m *Manager) ChatEdit(ctx context.Context, id string, body json.RawMessage) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPatch, "/chat/messages/"+id, body, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ChatDelete deletes the caller's own chat message.
func (m *Manager) ChatDelete(ctx context.Context, id string) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodDelete, "/chat/messages/"+id, nil, &raw); err != nil {
		return "", err
	}
	return string(raw), nil
}

// ChatReact toggles an emoji reaction on a chat message.
func (m *Manager) ChatReact(ctx context.Context, id string, body json.RawMessage) (string, error) {
	var raw json.RawMessage
	if err := m.call(ctx, http.MethodPost, "/chat/messages/"+id+"/reactions", body, &raw); err != nil {
		return "", err
	}
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

// reportUsage tells the server this device's cumulative successful output-token
// count, so the server can credit Kleos for the delta (idempotent). Best effort
// — failures are non-fatal and just retried on the next cycle.
func (m *Manager) reportUsage(ctx context.Context) {
	if m.logs == nil || !m.Configured(ctx) {
		return
	}
	total, err := m.logs.TotalOutTokens(ctx)
	if err != nil {
		return
	}
	_ = m.call(ctx, http.MethodPost, "/usage/report", map[string]any{
		"out_tokens": total,
		"device_id":  m.deviceID(ctx),
	}, nil)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
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
