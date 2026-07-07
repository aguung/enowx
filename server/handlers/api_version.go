package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/core/updater"
	"github.com/enowdev/enowx/server/middleware"
)

const githubRepo = "enowdev/enowx"

// Version serves the running version + the latest GitHub release, so the UI can
// show a changelog and an "update available" badge.
type Version struct {
	current string
	doer    transport.Doer
	dash    *middleware.Dashboard

	mu       sync.Mutex
	cached   *releaseInfo
	cachedAt time.Time
}

func NewVersion(current string, doer transport.Doer, dash *middleware.Dashboard) *Version {
	return &Version{current: current, doer: doer, dash: dash}
}

type releaseInfo struct {
	Tag         string `json:"tag"`
	Notes       string `json:"notes"`
	PublishedAt string `json:"published_at"`
	AssetURL    string `json:"asset_url"`
	AssetSHA    string `json:"asset_sha_url"`
}

// Get returns { current, latest, update_available, notes, published_at, asset_url }.
// ?fresh=1 bypasses the cache (the manual "Check now" button).
func (h *Version) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("fresh") == "1" {
		h.mu.Lock()
		h.cached = nil
		h.mu.Unlock()
	}
	rel, err := h.latest(r.Context())
	out := map[string]any{"current": h.current, "update_available": false}
	if err != nil || rel == nil {
		// GitHub unreachable (offline / rate-limited): report current only.
		writeData(w, out)
		return
	}
	out["latest"] = rel.Tag
	out["notes"] = rel.Notes
	out["published_at"] = rel.PublishedAt
	out["asset_url"] = rel.AssetURL
	out["update_available"] = h.current != "dev" && semverNewer(rel.Tag, h.current)
	writeData(w, out)
}

// Update performs the self-update: download the latest asset, verify, hand off to
// a detached updater that swaps the binary + restarts. Dashboard-gated; refuses
// on dev builds.
func (h *Version) Update(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	if h.current == "dev" {
		writeAPIErr(w, http.StatusBadRequest, "development builds don't self-update")
		return
	}
	rel, err := h.latest(r.Context())
	if err != nil || rel == nil || rel.AssetURL == "" {
		writeAPIErr(w, http.StatusBadGateway, "couldn't resolve the update download")
		return
	}
	if !semverNewer(rel.Tag, h.current) {
		writeAPIErr(w, http.StatusBadRequest, "already up to date")
		return
	}
	res, err := updater.Apply(h.doer, rel.AssetURL, rel.AssetSHA)
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"started": true, "migrated_to": res.MigratedTo, "note": res.Note})
	// Exit shortly so the detached updater can replace the binary + restart.
	updater.ExitSoon()
}

// latest fetches (and ~30-min caches) the newest release for THIS platform.
func (h *Version) latest(ctx context.Context) (*releaseInfo, error) {
	h.mu.Lock()
	if h.cached != nil && time.Since(h.cachedAt) < 30*time.Minute {
		c := h.cached
		h.mu.Unlock()
		return c, nil
	}
	h.mu.Unlock()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+githubRepo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := h.doer.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("github %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var gr struct {
		TagName     string `json:"tag_name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		Assets      []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(body, &gr); err != nil {
		return nil, err
	}
	asset := fmt.Sprintf("enx-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		asset += ".exe"
	}
	rel := &releaseInfo{Tag: gr.TagName, Notes: gr.Body, PublishedAt: gr.PublishedAt}
	for _, a := range gr.Assets {
		if a.Name == asset {
			rel.AssetURL = a.BrowserDownloadURL
		}
		if a.Name == asset+".sha256" {
			rel.AssetSHA = a.BrowserDownloadURL
		}
	}
	h.mu.Lock()
	h.cached, h.cachedAt = rel, time.Now()
	h.mu.Unlock()
	return rel, nil
}

// semverNewer reports whether tag a is a strictly newer version than b. A leading
// "v" is ignored; non-numeric parts compare conservatively (return false).
func semverNewer(a, b string) bool {
	pa, pb := parseSemver(a), parseSemver(b)
	for i := range 3 {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parseSemver(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	// Drop any pre-release/build suffix.
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	var out [3]int
	for i, p := range strings.SplitN(v, ".", 3) {
		if i > 2 {
			break
		}
		out[i], _ = strconv.Atoi(p)
	}
	return out
}
