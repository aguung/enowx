package handlers

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kkdai/youtube/v2"

	"github.com/enowdev/enowx/store"
)

// Music powers the Music app: it searches YouTube Music for songs and proxies
// the chosen track's audio stream so the browser can play it.
//
// Why a backend proxy: the resolved googlevideo URLs are CORS-blocked and
// often signature-ciphered, so a browser <audio> tag cannot fetch them
// directly. We resolve the playable URL here and stream the bytes through,
// forwarding Range headers so the player can seek.
type Music struct {
	yt    youtube.Client
	http  *http.Client
	store store.MusicStore
	mu    sync.Mutex
	cache map[string]urlEntry // videoID -> resolved audio URL (short-lived)
}

type urlEntry struct {
	url string
	exp time.Time
}

// streamUA is a browser User-Agent. googlevideo (and YouTube's APIs) reject the
// default Go HTTP client UA with 403, so every outbound request presents this.
const streamUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

// uaTransport tags every request with the browser User-Agent.
type uaTransport struct{ base http.RoundTripper }

func (t uaTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Header.Get("User-Agent") == "" {
		r.Header.Set("User-Agent", streamUA)
	}
	return t.base.RoundTrip(r)
}

func NewMusic(s store.MusicStore) *Music {
	uaClient := &http.Client{Timeout: 30 * time.Second, Transport: uaTransport{http.DefaultTransport}}
	return &Music{
		http:  uaClient,
		yt:    youtube.Client{HTTPClient: uaClient},
		store: s,
		cache: map[string]urlEntry{},
	}
}

type musicTrack struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Album     string `json:"album"`
	Duration  string `json:"duration"`
	Thumbnail string `json:"thumbnail"`
}

// innerTube is YouTube Music's private API. Public song search works without
// any auth cookies (logged_in: 0); we send the standard WEB_REMIX context.
const innerTubeSearch = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false"

// songsParam restricts results to the "Songs" tab so we only get playable tracks.
const songsParam = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"

func (h *Music) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeData(w, []musicTrack{})
		return
	}
	tracks, err := h.searchSongs(r.Context(), q)
	if err != nil {
		writeAPIErr(w, http.StatusBadGateway, "search failed: "+err.Error())
		return
	}
	writeData(w, tracks)
}

// searchSongs runs an unauthenticated YouTube Music song search and returns the
// parsed tracks. Reused by both Search and Discover.
func (h *Music) searchSongs(ctx context.Context, query string) ([]musicTrack, error) {
	body, _ := json.Marshal(map[string]any{
		"query":  query,
		"params": songsParam,
		"context": map[string]any{
			"client": map[string]any{
				"clientName":    "WEB_REMIX",
				"clientVersion": "1.20240101.00.00",
				"hl":            "en",
				"gl":            "US",
			},
		},
	})

	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, innerTubeSearch, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://music.youtube.com")

	resp, err := h.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	return parseSongResults(parsed), nil
}

// parseSongResults walks the InnerTube response for musicResponsiveListItem
// renderers (one per song row) and extracts the fields we need.
func parseSongResults(root any) []musicTrack {
	out := []musicTrack{}
	seen := map[string]bool{}
	var walk func(any)
	walk = func(n any) {
		switch v := n.(type) {
		case map[string]any:
			if item, ok := v["musicResponsiveListItemRenderer"].(map[string]any); ok {
				if t, ok := songFromRenderer(item); ok && !seen[t.ID] {
					seen[t.ID] = true
					out = append(out, t)
				}
			}
			for _, child := range v {
				walk(child)
			}
		case []any:
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(root)
	return out
}

func songFromRenderer(item map[string]any) (musicTrack, bool) {
	id := firstVideoID(item)
	if id == "" {
		return musicTrack{}, false
	}
	t := musicTrack{ID: id, Thumbnail: lastThumbnail(item)}

	cols, _ := item["flexColumns"].([]any)
	if len(cols) > 0 {
		t.Title = flexText(cols[0])
	}
	if len(cols) > 1 {
		// Subtitle runs look like: Artist • Album • 3:45 (separators are " • ").
		parts := splitRuns(flexText(cols[1]))
		switch len(parts) {
		case 0:
		case 1:
			t.Artist = parts[0]
		default:
			t.Artist = parts[0]
			t.Album = parts[1]
			if last := parts[len(parts)-1]; looksLikeDuration(last) {
				t.Duration = last
				if len(parts) == 2 {
					t.Album = ""
				}
			}
		}
	}
	if t.Title == "" {
		return musicTrack{}, false
	}
	return t, true
}

// flexText pulls the joined run text out of a flex column renderer.
func flexText(col any) string {
	m, ok := col.(map[string]any)
	if !ok {
		return ""
	}
	r, ok := m["musicResponsiveListItemFlexColumnRenderer"].(map[string]any)
	if !ok {
		return ""
	}
	text, ok := r["text"].(map[string]any)
	if !ok {
		return ""
	}
	runs, ok := text["runs"].([]any)
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, run := range runs {
		if rm, ok := run.(map[string]any); ok {
			if s, ok := rm["text"].(string); ok {
				b.WriteString(s)
			}
		}
	}
	return b.String()
}

func splitRuns(s string) []string {
	parts := strings.Split(s, "•")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func looksLikeDuration(s string) bool {
	if !strings.Contains(s, ":") {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && c != ':' {
			return false
		}
	}
	return true
}

// firstVideoID returns the nearest videoId in the subtree.
func firstVideoID(n any) string {
	var found string
	var walk func(any)
	walk = func(n any) {
		if found != "" {
			return
		}
		switch v := n.(type) {
		case map[string]any:
			if id, ok := v["videoId"].(string); ok && id != "" {
				found = id
				return
			}
			for _, c := range v {
				walk(c)
			}
		case []any:
			for _, c := range v {
				walk(c)
			}
		}
	}
	walk(n)
	return found
}

// lastThumbnail returns the highest-resolution thumbnail URL in the subtree.
func lastThumbnail(n any) string {
	var found string
	var walk func(any)
	walk = func(n any) {
		switch v := n.(type) {
		case map[string]any:
			if thumbs, ok := v["thumbnails"].([]any); ok && len(thumbs) > 0 {
				if last, ok := thumbs[len(thumbs)-1].(map[string]any); ok {
					if u, ok := last["url"].(string); ok && u != "" {
						found = u
					}
				}
			}
			for _, c := range v {
				walk(c)
			}
		case []any:
			for _, c := range v {
				walk(c)
			}
		}
	}
	walk(n)
	return found
}

// Stream resolves the best audio-only format for a video and proxies its bytes,
// forwarding Range so the <audio> element can seek.
func (h *Music) Stream(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}

	streamURL, err := h.resolve(id)
	if err != nil {
		http.Error(w, "resolve failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, streamURL, nil)
	if err != nil {
		http.Error(w, "bad upstream url", http.StatusBadGateway)
		return
	}
	// googlevideo 403s requests without a browser-like User-Agent (the default
	// Go-http-client UA gets rejected), so present one.
	req.Header.Set("User-Agent", streamUA)
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}

	resp, err := h.http.Do(req)
	if err != nil {
		http.Error(w, "upstream fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Forward the headers that matter for seeking/streaming audio.
	for _, k := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if v := resp.Header.Get(k); v != "" {
			w.Header().Set(k, v)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "audio/mp4")
	}
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// resolve returns a playable audio URL for the video, caching it briefly since
// resolving (which decodes the signature cipher) is the slow part.
func (h *Music) resolve(id string) (string, error) {
	h.mu.Lock()
	if e, ok := h.cache[id]; ok && time.Now().Before(e.exp) {
		h.mu.Unlock()
		return e.url, nil
	}
	h.mu.Unlock()

	v, err := h.yt.GetVideo(id)
	if err != nil {
		return "", err
	}
	formats := v.Formats.WithAudioChannels().Type("audio")
	if len(formats) == 0 {
		formats = v.Formats.WithAudioChannels()
	}
	if len(formats) == 0 {
		return "", errNoAudio
	}
	formats.Sort() // best first
	best := formats[0]

	url, err := h.yt.GetStreamURL(v, &best)
	if err != nil {
		return "", err
	}
	h.mu.Lock()
	h.cache[id] = urlEntry{url: url, exp: time.Now().Add(20 * time.Minute)}
	h.mu.Unlock()
	return url, nil
}

var errNoAudio = errString("no audio stream available")

type errString string

func (e errString) Error() string { return string(e) }

// ---- Discover / "for you" feed (local history, no cookies) ----

// seedQueries are genre/mood searches used to fill the Discover feed when the
// user has little or no play history.
var seedQueries = []string{
	"top hits", "pop", "lo-fi", "hip hop", "rock", "jazz", "edm",
	"indie", "r&b", "acoustic", "chill", "classical", "k-pop", "metal",
}

// Discover returns a shuffled "for you" feed. With play history it biases
// toward the user's most-played artists; otherwise it samples seed genres.
// Results are shuffled so opening the app shows something fresh each time.
func (h *Music) Discover(w http.ResponseWriter, r *http.Request) {
	queries := h.discoverQueries(r.Context())

	// Run all the seed searches in parallel — they're independent network calls,
	// so doing them concurrently turns N round-trips into roughly one.
	results := make([][]musicTrack, len(queries))
	var wg sync.WaitGroup
	for i, q := range queries {
		wg.Add(1)
		go func(i int, q string) {
			defer wg.Done()
			if tracks, err := h.searchSongs(r.Context(), q); err == nil {
				results[i] = tracks
			}
		}(i, q)
	}
	wg.Wait()

	// Merge keeping query order (top artists first), a few per query, deduped.
	seen := map[string]bool{}
	out := []musicTrack{}
	for _, tracks := range results {
		n := 0
		for _, t := range tracks {
			if seen[t.ID] {
				continue
			}
			seen[t.ID] = true
			out = append(out, t)
			if n++; n >= 6 {
				break
			}
		}
		if len(out) >= 40 {
			break
		}
	}
	rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	writeData(w, out)
}

// discoverQueries picks the searches that seed the feed: top artists first
// (weighted by play count), padded with random seed genres.
func (h *Music) discoverQueries(ctx context.Context) []string {
	var queries []string
	if artists, err := h.store.TopArtists(ctx, 6); err == nil {
		for _, a := range artists {
			queries = append(queries, a.Artist+" songs")
		}
	}
	// Pad with a couple of random genres for discovery.
	seeds := append([]string(nil), seedQueries...)
	rand.Shuffle(len(seeds), func(i, j int) { seeds[i], seeds[j] = seeds[j], seeds[i] })
	want := 4
	if len(queries) == 0 {
		want = 6 // cold start: all genres
	}
	for i := 0; i < want && i < len(seeds); i++ {
		queries = append(queries, seeds[i])
	}
	return queries
}

// ---- Play history ----

type historyTrack struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Album  string `json:"album"`
}

func (h *Music) RecordPlay(w http.ResponseWriter, r *http.Request) {
	var t historyTrack
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil || strings.TrimSpace(t.ID) == "" {
		writeAPIErr(w, http.StatusBadRequest, "id is required")
		return
	}
	if err := h.store.RecordPlay(r.Context(), store.PlayEvent{
		VideoID: t.ID, Title: t.Title, Artist: t.Artist, Album: t.Album,
	}); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Music) RecentPlays(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	tracks, err := h.store.RecentPlays(r.Context(), limit)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, tracks)
}

func (h *Music) ClearHistory(w http.ResponseWriter, r *http.Request) {
	if err := h.store.ClearHistory(r.Context()); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

// ---- Playlists (local) ----

func (h *Music) ListPlaylists(w http.ResponseWriter, r *http.Request) {
	pls, err := h.store.ListPlaylists(r.Context())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pls == nil {
		pls = []store.Playlist{}
	}
	writeData(w, pls)
}

func (h *Music) GetPlaylist(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	p, err := h.store.GetPlaylist(r.Context(), id)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if p == nil {
		writeAPIErr(w, http.StatusNotFound, "playlist not found")
		return
	}
	writeData(w, p)
}

type newPlaylist struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (h *Music) CreatePlaylist(w http.ResponseWriter, r *http.Request) {
	var in newPlaylist
	_ = json.NewDecoder(r.Body).Decode(&in)
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		writeAPIErr(w, http.StatusBadRequest, "name is required")
		return
	}
	id, err := h.store.CreatePlaylist(r.Context(), in.Name, strings.TrimSpace(in.Description), newShareCode())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"id": id})
}

func (h *Music) DeletePlaylist(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.store.DeletePlaylist(r.Context(), id); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Music) AddTrack(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var t store.MusicTrack
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil || strings.TrimSpace(t.VideoID) == "" {
		writeAPIErr(w, http.StatusBadRequest, "track id is required")
		return
	}
	if err := h.store.AddTrack(r.Context(), id, t); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

func (h *Music) RemoveTrack(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	videoID := chi.URLParam(r, "videoId")
	if videoID == "" {
		writeAPIErr(w, http.StatusBadRequest, "video id is required")
		return
	}
	if err := h.store.RemoveTrack(r.Context(), id, videoID); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"ok": true})
}

// ---- Export / import (portable + plugin contract) ----

// playlistExport is the portable shape a playlist serializes to. A plugin or a
// remote backend consumes this exact structure to share/import playlists.
type playlistExport struct {
	Version     int                `json:"version"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	ShareCode   string             `json:"share_code"`
	Tracks      []store.MusicTrack `json:"tracks"`
}

func (h *Music) ExportPlaylist(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	p, err := h.store.GetPlaylist(r.Context(), id)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if p == nil {
		writeAPIErr(w, http.StatusNotFound, "playlist not found")
		return
	}
	writeData(w, playlistExport{
		Version:     1,
		Name:        p.Name,
		Description: p.Description,
		ShareCode:   p.ShareCode,
		Tracks:      p.Tracks,
	})
}

func (h *Music) ImportPlaylist(w http.ResponseWriter, r *http.Request) {
	var in playlistExport
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "invalid import payload")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		in.Name = "Imported playlist"
	}
	id, err := h.store.CreatePlaylist(r.Context(), in.Name, strings.TrimSpace(in.Description), newShareCode())
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, t := range in.Tracks {
		if strings.TrimSpace(t.VideoID) == "" {
			continue
		}
		_ = h.store.AddTrack(r.Context(), id, t)
	}
	writeData(w, map[string]any{"id": id})
}

// newShareCode returns a short random code used to address a playlist for
// sharing (e.g. via a future central backend / plugin).
func newShareCode() string {
	b := make([]byte, 6)
	if _, err := cryptorand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(b)
}
