package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/enowdev/enowx/server/middleware"
)

// TermProfiles manages named "terminal profiles" — each is its own HOME dir so a
// terminal opened under it uses separate tool credentials (Claude Code, gcloud,
// aws, gh, git, …), while shared config (shell rc, MCP, Claude settings) is
// symlinked in from the real home. The multi-ness is credentials-only.
//
// It manages directories + symlinks on the host, so it is gated by the same
// dashboard guard as the terminal/file browser.
type TermProfiles struct {
	dash *middleware.Dashboard
	mu   sync.Mutex
}

func NewTermProfiles(dash *middleware.Dashboard) *TermProfiles {
	return &TermProfiles{dash: dash}
}

type termProfile struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Color     string `json:"color,omitempty"`
	CreatedAt string `json:"created_at"`
}

var slugRe = regexp.MustCompile(`^[a-z0-9-]+$`)

// sharedPaths are symlinked from the real home into each profile so shell/PATH,
// git, and Claude settings + MCP stay identical across profiles. Credentials
// (e.g. .claude/.credentials.json, .aws/, .config/gcloud) are deliberately NOT
// here, so each profile logs in separately.
var sharedPaths = []string{
	// Shell rc (so PATH/prompt/aliases are identical). These commonly `source`
	// tool env files under $HOME, so we share those too (below) to avoid errors.
	".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile",
	// Tool env files that rc scripts source by $HOME-relative path (rust, nvm, …).
	".cargo", ".rustup", ".nvm", ".bun", ".deno", ".sdkman", ".asdf",
	// Locally-installed binaries + their payloads. Many tools install here and
	// detect themselves relative to $HOME (e.g. Claude Code native install at
	// ~/.local/bin/claude → ~/.local/share/claude), so a profile without these
	// reports "command missing or broken". State (.local/state) is NOT shared.
	".local/bin", ".local/share",
	// macOS login keychain. Its path is $HOME-relative, so a profile without it
	// gets "A keychain cannot be found to store ..." and tools (incl. Claude Code)
	// fail/log out. Share the real keychain — Claude Code's own login stays in a
	// file per profile (via CLAUDE_CONFIG_DIR), so this doesn't leak that login.
	"Library/Keychains",
	// Config that's identity/settings, not a login secret.
	".gitconfig",
	".claude.json", // MCP servers + non-secret state
	".claude/settings.json", ".claude/settings.local.json", ".claude/CLAUDE.md",
	".claude/plugins", ".claude/skills", ".claude/commands",
}

// setEnv replaces (or appends) KEY=value in an environment slice so an override
// wins over any inherited value.
func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	out := env[:0:0]
	for _, e := range env {
		if !strings.HasPrefix(e, prefix) {
			out = append(out, e)
		}
	}
	return append(out, prefix+value)
}

// profilesRoot is where all profile homes + the registry live.
func profilesRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".enowx", "term-profiles"), nil
}

// profileHome returns the validated home dir for a slug, or "" if invalid /
// nonexistent. Guards against path escape.
func profileHome(slug string) string {
	if !slugRe.MatchString(slug) {
		return ""
	}
	root, err := profilesRoot()
	if err != nil {
		return ""
	}
	dir := filepath.Join(root, slug)
	// Confirm the resolved path stays under the root.
	if rel, err := filepath.Rel(root, dir); err != nil || strings.HasPrefix(rel, "..") {
		return ""
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return ""
	}
	return dir
}

func (h *TermProfiles) registryPath() (string, error) {
	root, err := profilesRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "profiles.json"), nil
}

func (h *TermProfiles) load() ([]termProfile, error) {
	p, err := h.registryPath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return []termProfile{}, nil
	}
	if err != nil {
		return nil, err
	}
	var reg struct {
		Profiles []termProfile `json:"profiles"`
	}
	if err := json.Unmarshal(b, &reg); err != nil {
		return []termProfile{}, nil
	}
	return reg.Profiles, nil
}

func (h *TermProfiles) save(list []termProfile) error {
	root, err := profilesRoot()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	p := filepath.Join(root, "profiles.json")
	b, _ := json.MarshalIndent(map[string]any{"profiles": list}, "", "  ")
	return os.WriteFile(p, b, 0o600)
}

// writableDirs are per-profile directories that must exist as REAL dirs (not
// symlinks) because the tool writes into them at runtime. Claude Code creates a
// shell snapshot / session state on startup and errors ("Bun could not find a
// file") if these are missing, so we pre-create them per profile.
var writableDirs = []string{
	".claude/shell-snapshots", ".claude/sessions", ".claude/session-env",
	".claude/cache", ".claude/projects", ".claude/todos", ".claude/statsig",
	".config", ".cache", ".local/state",
}

// ensureLinks (re)creates the shared symlinks + per-profile writable dirs inside
// a profile home so it self-heals. Idempotent: existing entries are left alone.
func ensureLinks(profileDir string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	for _, rel := range sharedPaths {
		src := filepath.Join(home, rel)
		if _, err := os.Lstat(src); err != nil {
			continue // nothing to share for this path
		}
		dst := filepath.Join(profileDir, rel)
		if _, err := os.Lstat(dst); err == nil {
			continue // already present (link or real) — leave it
		}
		_ = os.MkdirAll(filepath.Dir(dst), 0o755)
		_ = os.Symlink(src, dst)
	}
	// Real, writable per-profile dirs (must exist before the tool starts).
	for _, rel := range writableDirs {
		_ = os.MkdirAll(filepath.Join(profileDir, rel), 0o755)
	}
}

// List returns all profiles.
func (h *TermProfiles) List(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	list, err := h.load()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, map[string]any{"profiles": list})
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := nonSlug.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	return strings.Trim(s, "-")
}

// Create makes a new profile home + shared symlinks.
func (h *TermProfiles) Create(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	var in struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAPIErr(w, http.StatusBadRequest, "bad body")
		return
	}
	slug := slugify(in.Name)
	if slug == "" || !slugRe.MatchString(slug) {
		writeAPIErr(w, http.StatusBadRequest, "invalid name")
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	list, err := h.load()
	if err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, p := range list {
		if p.Slug == slug {
			writeAPIErr(w, http.StatusConflict, "a profile with that name already exists")
			return
		}
	}
	root, _ := profilesRoot()
	dir := filepath.Join(root, slug)
	if err := os.MkdirAll(filepath.Join(dir, ".claude"), 0o755); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ensureLinks(dir)

	p := termProfile{Slug: slug, Name: strings.TrimSpace(in.Name), Color: in.Color, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	list = append(list, p)
	if err := h.save(list); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeData(w, p)
}

// Delete removes a profile's registry entry + its home dir. Guards the real home.
func (h *TermProfiles) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.dash.Authorized(r) {
		writeAPIErr(w, http.StatusForbidden, "requires the dashboard login when accessed remotely")
		return
	}
	slug := strings.TrimPrefix(r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:], "")
	dir := profileHome(slug)
	if dir == "" {
		writeAPIErr(w, http.StatusBadRequest, "unknown profile")
		return
	}
	home, _ := os.UserHomeDir()
	if dir == home || dir == "" || dir == "/" { // paranoia: never nuke the real home
		writeAPIErr(w, http.StatusBadRequest, "refusing to delete")
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if err := os.RemoveAll(dir); err != nil {
		writeAPIErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	list, _ := h.load()
	out := make([]termProfile, 0, len(list))
	for _, p := range list {
		if p.Slug != slug {
			out = append(out, p)
		}
	}
	_ = h.save(out)
	writeData(w, map[string]any{"ok": true})
}
