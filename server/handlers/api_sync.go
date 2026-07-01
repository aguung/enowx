package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	syncpkg "github.com/enowdev/enowx/core/sync"
)

// Sync exposes the cloud-sync controls to the local UI. The actual protocol
// talks to the enowxlabs server; this just drives it.
type Sync struct{ mgr *syncpkg.Manager }

func NewSync(mgr *syncpkg.Manager) *Sync { return &Sync{mgr: mgr} }

func (h *Sync) Status(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Refresh the cached identity from /me when logged in, so the client always
	// gets the complete, current shape (top_role, entitlements, etc.) rather than
	// the trimmed user DTO stashed at login. Falls back to the cache on failure.
	if h.mgr.Configured(ctx) {
		_, _ = h.mgr.Me(ctx)
	}
	var user any
	if u := h.mgr.UserJSON(ctx); u != "" {
		_ = json.Unmarshal([]byte(u), &user)
	}
	writeData(w, map[string]any{
		"configured": h.mgr.Configured(ctx),
		"enabled":    h.mgr.Enabled(ctx),
		"auto":       h.mgr.AutoEnabled(ctx),
		"server_url": h.mgr.ServerURL(ctx),
		"user":       user,
	})
}

// SetAuto flips the global automatic-sync toggle.
func (h *Sync) SetAuto(w http.ResponseWriter, r *http.Request) {
	var body struct {
		On bool `json:"on"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.mgr.SetAuto(r.Context(), body.On); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"auto": h.mgr.AutoEnabled(r.Context())})
}

// LoginStart returns the Discord authorize URL + state to poll.
func (h *Sync) LoginStart(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ServerURL string `json:"server_url"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	url, state, err := h.mgr.LoginStart(r.Context(), body.ServerURL)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeData(w, map[string]any{"authorize_url": url, "state": state})
}

// LoginPoll checks whether the browser flow completed.
func (h *Sync) LoginPoll(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	done, userJSON, err := h.mgr.LoginPoll(r.Context(), state)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var user any
	if userJSON != "" {
		_ = json.Unmarshal([]byte(userJSON), &user)
	}
	writeData(w, map[string]any{"done": done, "user": user})
}

func (h *Sync) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.mgr.Logout(r.Context()); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

// UpdateProfile edits the signed-in user's profile on the cloud server.
func (h *Sync) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	userJSON, err := h.mgr.UpdateProfile(r.Context(), body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var user any
	if userJSON != "" {
		_ = json.Unmarshal([]byte(userJSON), &user)
	}
	writeData(w, map[string]any{"user": user})
}

// PublicProfile fetches another user's public profile by id.
func (h *Sync) PublicProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	profileJSON, err := h.mgr.PublicProfile(r.Context(), id)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var profile any
	if profileJSON != "" {
		_ = json.Unmarshal([]byte(profileJSON), &profile)
	}
	writeData(w, profile)
}

// UploadAvatar / UploadBanner proxy a multipart image upload to the cloud.
func (h *Sync) UploadAvatar(w http.ResponseWriter, r *http.Request) { h.uploadMedia(w, r, "/me/avatar") }
func (h *Sync) UploadBanner(w http.ResponseWriter, r *http.Request) { h.uploadMedia(w, r, "/me/banner") }

func (h *Sync) uploadMedia(w http.ResponseWriter, r *http.Request, path string) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 20<<20))
	out, err := h.mgr.UploadMedia(r.Context(), path, r.Header.Get("Content-Type"), body)
	proxyJSON(w, out, err)
}

// UserPosts proxies a user's posts (profile page).
func (h *Sync) UserPosts(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.UserPosts(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, out, err)
}

// PostsList proxies the community feed.
func (h *Sync) PostsList(w http.ResponseWriter, r *http.Request) {
	q := ""
	if raw := r.URL.RawQuery; raw != "" {
		q = "?" + raw
	}
	out, err := h.mgr.PostsList(r.Context(), q)
	proxyJSON(w, out, err)
}

// PostCreate proxies creating a post.
func (h *Sync) PostCreate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	out, err := h.mgr.PostCreate(r.Context(), body)
	proxyJSON(w, out, err)
}

// PostEdit proxies editing a post.
func (h *Sync) PostEdit(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	out, err := h.mgr.PostAction(r.Context(), http.MethodPatch, chi.URLParam(r, "id"), "", body)
	proxyJSON(w, out, err)
}

// PostDelete proxies deleting a post.
func (h *Sync) PostDelete(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.PostAction(r.Context(), http.MethodDelete, chi.URLParam(r, "id"), "", nil)
	proxyJSON(w, out, err)
}

// PostUpvote proxies toggling a post upvote.
func (h *Sync) PostUpvote(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.PostAction(r.Context(), http.MethodPost, chi.URLParam(r, "id"), "/upvote", nil)
	proxyJSON(w, out, err)
}

// PostReact proxies toggling a post reaction.
func (h *Sync) PostReact(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	out, err := h.mgr.PostAction(r.Context(), http.MethodPost, chi.URLParam(r, "id"), "/reactions", body)
	proxyJSON(w, out, err)
}

// proxyJSON writes a proxied JSON string (or an error) as the API envelope.
func proxyJSON(w http.ResponseWriter, raw string, err error) {
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// PostComments proxies a post's comment list.
func (h *Sync) PostComments(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.PostComments(r.Context(), chi.URLParam(r, "id"))
	proxyJSON(w, out, err)
}

// CommentAdd proxies adding a comment.
func (h *Sync) CommentAdd(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	out, err := h.mgr.CommentAdd(r.Context(), chi.URLParam(r, "id"), body)
	proxyJSON(w, out, err)
}

// CommentEdit proxies editing a comment.
func (h *Sync) CommentEdit(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	out, err := h.mgr.CommentAction(r.Context(), http.MethodPatch, chi.URLParam(r, "id"), "", body)
	proxyJSON(w, out, err)
}

// CommentDelete proxies deleting a comment.
func (h *Sync) CommentDelete(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.CommentAction(r.Context(), http.MethodDelete, chi.URLParam(r, "id"), "", nil)
	proxyJSON(w, out, err)
}

// CommentReact proxies toggling a comment reaction.
func (h *Sync) CommentReact(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	out, err := h.mgr.CommentAction(r.Context(), http.MethodPost, chi.URLParam(r, "id"), "/reactions", body)
	proxyJSON(w, out, err)
}

// Search proxies the community search.
func (h *Sync) Search(w http.ResponseWriter, r *http.Request) {
	q := ""
	if raw := r.URL.RawQuery; raw != "" {
		q = "?" + raw
	}
	out, err := h.mgr.Search(r.Context(), q)
	proxyJSON(w, out, err)
}

// Notifications proxies the user's notifications.
func (h *Sync) Notifications(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.Notifications(r.Context())
	proxyJSON(w, out, err)
}

// NotificationsRead proxies marking notifications read.
func (h *Sync) NotificationsRead(w http.ResponseWriter, r *http.Request) {
	out, err := h.mgr.NotificationsRead(r.Context())
	proxyJSON(w, out, err)
}

// AdminFlags proxies the moderator duplicate-account review queue.
func (h *Sync) AdminFlags(w http.ResponseWriter, r *http.Request) {
	raw, err := h.mgr.AdminFlags(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// AdminReviewFlag proxies dismissing a flagged link.
func (h *Sync) AdminReviewFlag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	raw, err := h.mgr.AdminReviewFlag(r.Context(), id)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// Shop proxies the cosmetics catalog + owned/equipped/balance.
func (h *Sync) Shop(w http.ResponseWriter, r *http.Request) {
	raw, err := h.mgr.Shop(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ShopBuy proxies buying a cosmetic with Kleos.
func (h *Sync) ShopBuy(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	raw, err := h.mgr.ShopBuy(r.Context(), body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ShopEquip proxies equipping a cosmetic.
func (h *Sync) ShopEquip(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	raw, err := h.mgr.ShopEquip(r.Context(), body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ChatList proxies a page of community chat messages.
func (h *Sync) ChatList(w http.ResponseWriter, r *http.Request) {
	query := ""
	if before := r.URL.Query().Get("before"); before != "" {
		query = "?before=" + before
	}
	raw, err := h.mgr.ChatList(r.Context(), query)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ChatSend proxies sending a community chat message.
func (h *Sync) ChatSend(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	raw, err := h.mgr.ChatSend(r.Context(), body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ChatEdit proxies editing the caller's own chat message.
func (h *Sync) ChatEdit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	raw, err := h.mgr.ChatEdit(r.Context(), id, body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ChatDelete proxies deleting the caller's own chat message.
func (h *Sync) ChatDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	raw, err := h.mgr.ChatDelete(r.Context(), id)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ChatReact proxies toggling an emoji reaction on a chat message.
func (h *Sync) ChatReact(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	raw, err := h.mgr.ChatReact(r.Context(), id, body)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var out any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	writeData(w, out)
}

// ChatStream is a Server-Sent Events stream relaying live cloud events (chat
// messages, announcements) to the browser.
func (h *Sync) ChatStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch, cancel := h.mgr.Subscribe()
	defer cancel()

	// Initial comment so the client knows the stream is open.
	_, _ = w.Write([]byte(": connected\n\n"))
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(ev)
			_, _ = w.Write([]byte("data: "))
			_, _ = w.Write(b)
			_, _ = w.Write([]byte("\n\n"))
			flusher.Flush()
		}
	}
}

// Now runs a one-off reconcile.
func (h *Sync) Now(w http.ResponseWriter, r *http.Request) {
	pushed, pulled, err := h.mgr.Sync(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeData(w, map[string]any{"pushed": pushed, "pulled": pulled})
}
