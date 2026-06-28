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
		"groups": groups,
	})
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
			{Method: "GET", Path: "/api/keys", Desc: "List gateway keys (re-viewable)."},
			{Method: "POST", Path: "/api/keys", Desc: "Create a gateway key.", Params: []docParam{{Name: "label", In: "body", Desc: "optional"}}},
			{Method: "DELETE", Path: "/api/keys/{id}", Desc: "Delete a gateway key.", Params: []docParam{{Name: "id", In: "path", Desc: "key id"}}},
		},
	},
	{
		Name: "Requests & stats",
		Desc: "Served request history and usage statistics.",
		Endpoints: []docEndpoint{
			{Method: "GET", Path: "/api/requests", Desc: "Recent request log rows.", Params: []docParam{{Name: "limit", In: "query", Desc: "max rows"}}},
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
