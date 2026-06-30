package handlers

import "net/http"

// Docs serves a structured, machine-readable catalog of every HTTP endpoint so
// the Docs app can render it and future plugins can discover the API.
//
// MANDATORY: when you add or change an endpoint, update this catalog (see
// AGENTS.md "Document every endpoint").
type Docs struct{ version string }

func NewDocs(version string) *Docs { return &Docs{version: version} }

type docParam struct {
	Name string `json:"name"`
	In   string `json:"in"` // path | query | body
	Desc string `json:"desc"`
}

type docEndpoint struct {
	Method string     `json:"method"`
	Path   string     `json:"path"`
	Desc   string     `json:"desc"`
	Params []docParam `json:"params,omitempty"`
}

type docGroup struct {
	Name      string        `json:"name"`
	Desc      string        `json:"desc"`
	Endpoints []docEndpoint `json:"endpoints"`
}

func (h *Docs) Get(w http.ResponseWriter, _ *http.Request) {
	writeData(w, map[string]any{
		"version": h.version,
		"overview": map[string]any{
			"name":           "enowx",
			"summary":        "OpenAI-compatible LLM proxy gateway. One binary, one port, headless-first.",
			"base_url":       "http://localhost:1430",
			"openai_base":    "/v1",
			"anthropic_base": "/anthropic",
			"auth":           "When at least one gateway API key exists, send Authorization: Bearer <key> to /v1 and /anthropic. With no keys, the gateway is open (localhost).",
			"envelope":       "Management /api responses are wrapped as {\"data\": ...} on success or {\"error\": \"...\"} on failure.",
		},
		"plugins": map[string]any{
			"summary":   "Plugins extend enowx via the documented HTTP API. A plugin discovers capabilities from GET /api/docs and calls the listed endpoints. A plugin marketplace (upload/install) is planned; this catalog is the contract plugins build against.",
			"discovery": "GET /api/docs returns this catalog; treat method+path as the stable interface.",
		},
		"shortcuts": map[string]any{
			"summary": "Hold Ctrl or Alt (left or right) — a hint appears; while held, press a key to switch instantly. Release to dismiss. On macOS this uses Ctrl (not Cmd), so it won't fight Cmd-based browser shortcuts.",
			"groups":  shortcutGroups,
		},
		"groups": groups,
	})
}

type shortcut struct {
	Keys string `json:"keys"`
	Desc string `json:"desc"`
}

type shortcutGroup struct {
	Name  string     `json:"name"`
	Items []shortcut `json:"items"`
}

var shortcutGroups = []shortcutGroup{
	{
		Name: "Center views",
		Items: []shortcut{
			{Keys: "Ctrl/Alt + 1", Desc: "Widget board"},
			{Keys: "Ctrl/Alt + 2", Desc: "Terminal"},
			{Keys: "Ctrl/Alt + 3", Desc: "Apps drawer"},
			{Keys: "Ctrl/Alt + 4", Desc: "Docs"},
		},
	},
	{
		Name: "Open apps",
		Items: []shortcut{
			{Keys: "Ctrl/Alt + P", Desc: "Providers"},
			{Keys: "Ctrl/Alt + A", Desc: "Accounts"},
			{Keys: "Ctrl/Alt + S", Desc: "Statistics"},
			{Keys: "Ctrl/Alt + G", Desc: "Settings"},
			{Keys: "Ctrl/Alt + F", Desc: "Files"},
			{Keys: "Ctrl/Alt + R", Desc: "Requests"},
			{Keys: "Ctrl/Alt + W", Desc: "Warmup Logs"},
			{Keys: "Ctrl/Alt + K", Desc: "API Keys"},
			{Keys: "Ctrl/Alt + M", Desc: "Music"},
			{Keys: "Ctrl/Alt + T", Desc: "Tunnel"},
			{Keys: "Ctrl/Alt + C", Desc: "Profile"},
		},
	},
}

var groups = []docGroup{
	{
		Name: "Inference",
		Desc: "OpenAI- and Anthropic-compatible inference, routed to a provider by model id.",
		Endpoints: []docEndpoint{
			{Method: "POST", Path: "/v1/chat/completions", Desc: "OpenAI chat completions (streaming or JSON). Model id like 'codebuddy/...' or 'kiro/...' selects the provider.", Params: []docParam{{Name: "model", In: "body", Desc: "model id"}, {Name: "messages", In: "body", Desc: "chat messages"}, {Name: "stream", In: "body", Desc: "stream SSE"}}},
			{Method: "POST", Path: "/anthropic/v1/messages", Desc: "Anthropic Messages API; decoded to the internal request and streamed back as Anthropic SSE."},
			{Method: "GET", Path: "/health", Desc: "Liveness check; returns {\"status\":\"ok\"}."},
		},
	},
	{
		Name: "Providers",
		Desc: "Registered upstream providers and their display metadata.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/providers", Desc: "List registered providers (name, label, icon, caps)."},
		},
	},
	{
		Name: "Accounts",
		Desc: "The credential pool: per-provider accounts used to serve requests.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/accounts", Desc: "List accounts (never returns secret values).", Params: []docParam{{Name: "provider", In: "query", Desc: "filter by provider (optional)"}}},
			{Method: "POST", Path: "/api/accounts", Desc: "Add an account.", Params: []docParam{{Name: "provider", In: "body", Desc: "provider name"}, {Name: "label", In: "body", Desc: "display label"}, {Name: "secret", In: "body", Desc: "single-token credential"}, {Name: "creds", In: "body", Desc: "multi-field credentials"}}},
			{Method: "PATCH", Path: "/api/accounts/{id}/status", Desc: "Set upstream status.", Params: []docParam{{Name: "id", In: "path", Desc: "account id"}, {Name: "status", In: "body", Desc: "active|exhausted|banned"}}},
			{Method: "PATCH", Path: "/api/accounts/{id}/disabled", Desc: "Enable/disable an account (skipped by the pool while disabled).", Params: []docParam{{Name: "id", In: "path", Desc: "account id"}, {Name: "disabled", In: "body", Desc: "true to disable"}}},
			{Method: "GET", Path: "/api/accounts/{id}/usage", Desc: "Credit/quota usage when the provider supports it.", Params: []docParam{{Name: "id", In: "path", Desc: "account id"}}},
			{Method: "POST", Path: "/api/accounts/{id}/warmup", Desc: "Send a real probe request, update status, fetch credit; records a warmup log.", Params: []docParam{{Name: "id", In: "path", Desc: "account id"}}},
			{Method: "DELETE", Path: "/api/accounts/{id}", Desc: "Delete an account.", Params: []docParam{{Name: "id", In: "path", Desc: "account id"}}},
		},
	},
	{
		Name: "Kiro account flows",
		Desc: "Provider-specific ways to add a Kiro account.",
		Endpoints: []docEndpoint{
			{Method: "POST", Path: "/api/accounts/kiro/manual", Desc: "Add by pasting the kiro-auth-token.json contents.", Params: []docParam{{Name: "json", In: "body", Desc: "auth JSON"}, {Name: "label", In: "body", Desc: "optional"}}},
			{Method: "POST", Path: "/api/accounts/kiro/refresh", Desc: "Add by refresh token.", Params: []docParam{{Name: "refresh_token", In: "body", Desc: "token"}, {Name: "region", In: "body", Desc: "sso region"}}},
			{Method: "POST", Path: "/api/accounts/kiro/aws/start", Desc: "Start AWS device-code login; returns a user code + verification URL.", Params: []docParam{{Name: "region", In: "body", Desc: "sso region"}}},
			{Method: "GET", Path: "/api/accounts/kiro/aws/poll", Desc: "Poll the AWS device login; saves the account when approved.", Params: []docParam{{Name: "session", In: "query", Desc: "session id"}}},
			{Method: "POST", Path: "/api/accounts/kiro/oauth/start", Desc: "Start Google/social OAuth; returns an authorize URL."},
			{Method: "POST", Path: "/api/accounts/kiro/oauth/exchange", Desc: "Exchange the redirect code for tokens.", Params: []docParam{{Name: "session", In: "body", Desc: "session id"}, {Name: "code", In: "body", Desc: "auth code"}}},
		},
	},
	{
		Name: "Local credentials",
		Desc: "Import accounts from credentials installed tools wrote to disk (loopback only).",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/local-sources", Desc: "Scan for detectable local credential files."},
			{Method: "POST", Path: "/api/local-sources/import", Desc: "Import a detected source as an account.", Params: []docParam{{Name: "provider", In: "body", Desc: "provider"}, {Name: "target", In: "body", Desc: "source label"}}},
		},
	},
	{
		Name: "API keys",
		Desc: "Gateway keys that protect /v1 and /anthropic.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/keys", Desc: "List gateway keys (re-viewable, with limits + usage)."},
			{Method: "POST", Path: "/api/keys", Desc: "Create a gateway key with optional limits.", Params: []docParam{{Name: "label", In: "body", Desc: "optional"}, {Name: "token_limit", In: "body", Desc: "total tokens allowed; 0 = unlimited"}, {Name: "max_concurrent", In: "body", Desc: "simultaneous requests; 0 = unlimited"}, {Name: "expires_in_days", In: "body", Desc: "expiry in days; 0 = never"}}},
			{Method: "DELETE", Path: "/api/keys/{id}", Desc: "Delete a gateway key.", Params: []docParam{{Name: "id", In: "path", Desc: "key id"}}},
		},
	},
	{
		Name: "Requests & stats",
		Desc: "Served request history and usage statistics.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/requests", Desc: "Recent request log rows.", Params: []docParam{{Name: "limit", In: "query", Desc: "max rows"}}},
			{Method: "DELETE", Path: "/api/requests", Desc: "Clear all request logs."},
			{Method: "GET", Path: "/api/requests/summary", Desc: "Today's totals (requests, ok, errors, tokens, avg latency)."},
			{Method: "GET", Path: "/api/requests/series", Desc: "Time-bucketed series.", Params: []docParam{{Name: "range", In: "query", Desc: "daily|7d|30d|all"}}},
			{Method: "GET", Path: "/api/requests/top-models", Desc: "Top models today.", Params: []docParam{{Name: "limit", In: "query", Desc: "max models"}}},
		},
	},
	{
		Name: "Warmup logs",
		Desc: "History of account warmup probes.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/warmup-logs", Desc: "Recent warmup entries (request, response, usage).", Params: []docParam{{Name: "limit", In: "query", Desc: "max rows"}}},
			{Method: "DELETE", Path: "/api/warmup-logs", Desc: "Clear all warmup logs."},
		},
	},
	{
		Name: "Cloud sync",
		Desc: "Two-way sync of local data to the enowxlabs cloud, gated by Discord login. Pilot data type: playlists. The enowx client talks to the cloud server; these endpoints drive it.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/sync/status", Desc: "Sync state: configured, enabled, server URL, and cached user (identity/plan)."},
			{Method: "POST", Path: "/api/sync/login", Desc: "Begin Discord login; returns an authorize URL to open + a state to poll.", Params: []docParam{{Name: "server_url", In: "body", Desc: "cloud base URL (optional if already set)"}}},
			{Method: "GET", Path: "/api/sync/login/poll", Desc: "Poll for login completion; stores the sync token when done.", Params: []docParam{{Name: "state", In: "query", Desc: "state from login"}}},
			{Method: "POST", Path: "/api/sync/logout", Desc: "Drop the sync token and disable sync."},
			{Method: "POST", Path: "/api/sync/now", Desc: "Run a one-off reconcile; returns counts pushed/pulled."},
		},
	},
	{
		Name: "Dashboard auth",
		Desc: "Optional dashboard password. Localhost is trusted without login; remote access (e.g. via a tunnel) needs a session. The terminal and file browser require this when reached remotely.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/auth/status", Desc: "Whether a password is set, the request is from localhost, logged in, and authorized."},
			{Method: "POST", Path: "/api/auth/setup", Desc: "Set the dashboard password the first time (trusted caller only).", Params: []docParam{{Name: "password", In: "body", Desc: "min 6 chars"}}},
			{Method: "POST", Path: "/api/auth/login", Desc: "Exchange the password for a session cookie.", Params: []docParam{{Name: "password", In: "body", Desc: "dashboard password"}}},
			{Method: "POST", Path: "/api/auth/logout", Desc: "Clear the current session."},
			{Method: "POST", Path: "/api/auth/change", Desc: "Change the password (requires current).", Params: []docParam{{Name: "current", In: "body", Desc: "current password"}, {Name: "new", In: "body", Desc: "new password (min 6)"}}},
		},
	},
	{
		Name: "Tunnel",
		Desc: "Expose the gateway to the public internet via Cloudflare Tunnel. Enabling requires at least one API key (an unauthenticated public gateway would let anyone spend your accounts).",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/tunnel/status", Desc: "Tunnel state: enabled, mode (quick|named), public url, hostname, logged_in, and binary download progress."},
			{Method: "POST", Path: "/api/tunnel/enable", Desc: "Start a quick tunnel (random trycloudflare.com URL, no account). Downloads cloudflared on first use."},
			{Method: "POST", Path: "/api/tunnel/disable", Desc: "Stop the tunnel."},
			{Method: "POST", Path: "/api/tunnel/login", Desc: "SSE: run cloudflared browser login; streams progress + the authorization URL, then 'done' when the cert is saved."},
			{Method: "POST", Path: "/api/tunnel/named", Desc: "Create/route/run a named tunnel on your own hostname (requires prior login).", Params: []docParam{{Name: "hostname", In: "body", Desc: "e.g. enowx.example.com"}}},
		},
	},
	{
		Name: "Music",
		Desc: "Search YouTube Music for songs and proxy the chosen track's audio for playback.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/music/search", Desc: "Search songs; returns {id, title, artist, album, duration, thumbnail}.", Params: []docParam{{Name: "q", In: "query", Desc: "search query"}}},
			{Method: "GET", Path: "/api/music/stream", Desc: "Proxy the best audio-only stream for a video id; forwards Range for seeking.", Params: []docParam{{Name: "id", In: "query", Desc: "video id from search"}}},
			{Method: "GET", Path: "/api/music/discover", Desc: "A shuffled 'for you' feed: biased toward your most-played artists, padded with seed genres. Cold-start uses genres only."},
			{Method: "GET", Path: "/api/music/history", Desc: "Recently played distinct tracks.", Params: []docParam{{Name: "limit", In: "query", Desc: "max tracks"}}},
			{Method: "POST", Path: "/api/music/history", Desc: "Record a play (feeds Discover).", Params: []docParam{{Name: "id", In: "body", Desc: "video id"}, {Name: "title", In: "body", Desc: "title"}, {Name: "artist", In: "body", Desc: "artist"}, {Name: "album", In: "body", Desc: "album"}}},
			{Method: "DELETE", Path: "/api/music/history", Desc: "Clear all play history."},
			{Method: "GET", Path: "/api/music/playlists", Desc: "List local playlists (id, name, share_code, track count)."},
			{Method: "POST", Path: "/api/music/playlists", Desc: "Create a local playlist.", Params: []docParam{{Name: "name", In: "body", Desc: "playlist name"}, {Name: "description", In: "body", Desc: "optional"}}},
			{Method: "GET", Path: "/api/music/playlists/{id}", Desc: "Get a playlist with its tracks.", Params: []docParam{{Name: "id", In: "path", Desc: "playlist id"}}},
			{Method: "DELETE", Path: "/api/music/playlists/{id}", Desc: "Delete a playlist and its tracks.", Params: []docParam{{Name: "id", In: "path", Desc: "playlist id"}}},
			{Method: "POST", Path: "/api/music/playlists/{id}/tracks", Desc: "Add a track to a playlist.", Params: []docParam{{Name: "id", In: "path", Desc: "playlist id"}, {Name: "id", In: "body", Desc: "video id"}, {Name: "title", In: "body", Desc: "title"}, {Name: "artist", In: "body", Desc: "artist"}}},
			{Method: "DELETE", Path: "/api/music/playlists/{id}/tracks/{videoId}", Desc: "Remove a track from a playlist.", Params: []docParam{{Name: "id", In: "path", Desc: "playlist id"}, {Name: "videoId", In: "path", Desc: "video id"}}},
			{Method: "GET", Path: "/api/music/playlists/{id}/export", Desc: "Export a playlist as a portable JSON document (share/plugin contract).", Params: []docParam{{Name: "id", In: "path", Desc: "playlist id"}}},
			{Method: "POST", Path: "/api/music/playlists/import", Desc: "Import a playlist from an exported JSON document.", Params: []docParam{{Name: "name", In: "body", Desc: "playlist name"}, {Name: "tracks", In: "body", Desc: "array of tracks"}}},
		},
	},
	{
		Name: "System",
		Desc: "Gateway info, process debug, and local tools (loopback only where noted).",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/settings", Desc: "Version, host, port, runtime dir, uptime."},
			{Method: "GET", Path: "/api/debug", Desc: "Process CPU/RSS + Go runtime + build info."},
			{Method: "GET", Path: "/api/files", Desc: "List a directory (loopback only).", Params: []docParam{{Name: "path", In: "query", Desc: "directory (defaults to home)"}}},
			{Method: "GET", Path: "/api/files/read", Desc: "Read a text file, capped (loopback only).", Params: []docParam{{Name: "path", In: "query", Desc: "file path"}}},
			{Method: "GET", Path: "/api/files/raw", Desc: "Stream raw file bytes, e.g. for images (loopback only).", Params: []docParam{{Name: "path", In: "query", Desc: "file path"}}},
			{Method: "GET", Path: "/api/terminal", Desc: "WebSocket PTY shell (loopback only)."},
			{Method: "GET", Path: "/api/docs", Desc: "This endpoint catalog (machine-readable)."},
		},
	},
}
