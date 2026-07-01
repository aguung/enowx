// Package server is the single net/http listener that multiplexes /v1, /api, and
// the SPA by path. It is the only place that knows about HTTP.
package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/proxy"
	syncpkg "github.com/enowdev/enowx/core/sync"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/core/tunnel"
	"github.com/enowdev/enowx/server/handlers"
	"github.com/enowdev/enowx/server/middleware"
	"github.com/enowdev/enowx/store"
)

type Server struct {
	addr string
	mux  *chi.Mux
}

type Deps struct {
	Proxy      *proxy.Proxy
	Route      func(modelID string) string
	Registry   *provider.Registry
	Accounts   store.AccountStore
	Logs       store.LogStore
	Keys       store.KeyStore
	Warmups    store.WarmupStore
	Music      store.MusicStore
	SettingsKV store.SettingsStore
	Tunnel     *tunnel.Manager
	Sync       *syncpkg.Manager
	Doer       transport.Doer
	Settings   handlers.SettingsInfo
}

func New(addr string, d Deps) *Server {
	r := chi.NewRouter()
	v1 := handlers.NewV1(d.Proxy, d.Route, d.Logs, d.Keys)
	anthropic := handlers.NewAnthropic(d.Proxy, d.Route, d.Logs, d.Keys)
	providers := handlers.NewProviders(d.Registry)
	accounts := handlers.NewAccounts(d.Accounts)
	requests := handlers.NewRequests(d.Logs)
	keys := handlers.NewKeys(d.Keys)
	settings := handlers.NewSettings(d.Settings)
	dbg := handlers.NewDebug(d.Settings.Version, d.Settings.Started)
	docs := handlers.NewDocs(d.Settings.Version)
	kiro := handlers.NewKiro(d.Doer, d.Accounts)
	local := handlers.NewLocal(d.Accounts)
	usage := handlers.NewUsage(d.Registry, d.Accounts)
	warmup := handlers.NewWarmup(d.Proxy, d.Registry, d.Accounts, d.Warmups, d.Logs)
	dash := middleware.NewDashboard(d.SettingsKV)
	term := handlers.NewTerminal(dash)
	files := handlers.NewFiles(dash)
	music := handlers.NewMusic(d.Music)
	tun := handlers.NewTunnel(d.Tunnel, d.Keys)
	syncH := handlers.NewSync(d.Sync)
	authH := handlers.NewAuth(dash)
	auth := middleware.NewAuth(d.Keys)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Proxy endpoints, guarded by the optional API key.
	r.Group(func(r chi.Router) {
		r.Use(auth.Handler)
		r.Post("/v1/chat/completions", v1.ChatCompletions)
		r.Post("/anthropic/v1/messages", anthropic.Messages)
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/providers", providers.List)
		r.Get("/accounts", accounts.List)
		r.Post("/accounts", accounts.Add)
		r.Patch("/accounts/{id}/status", accounts.SetStatus)
		r.Patch("/accounts/{id}/disabled", accounts.SetDisabled)
		r.Get("/accounts/{id}/usage", usage.Get)
		r.Post("/accounts/{id}/warmup", warmup.Run)
		r.Get("/warmup-logs", warmup.List)
		r.Delete("/warmup-logs", warmup.Clear)
		r.Delete("/accounts/{id}", accounts.Delete)
		r.Get("/requests", requests.List)
		r.Delete("/requests", requests.Clear)
		r.Get("/requests/summary", requests.Summary)
		r.Get("/requests/series", requests.Series)
		r.Get("/requests/top-models", requests.TopModels)
		r.Get("/keys", keys.List)
		r.Post("/keys", keys.Add)
		r.Delete("/keys/{id}", keys.Delete)
		r.Get("/settings", settings.Get)
		r.Get("/debug", dbg.Get)
		r.Get("/docs", docs.Get)

		r.Post("/accounts/kiro/manual", kiro.Manual)
		r.Post("/accounts/kiro/refresh", kiro.Refresh)
		r.Post("/accounts/kiro/aws/start", kiro.AWSStart)
		r.Get("/accounts/kiro/aws/poll", kiro.AWSPoll)
		r.Post("/accounts/kiro/oauth/start", kiro.OAuthStart)
		r.Post("/accounts/kiro/oauth/exchange", kiro.OAuthExchange)

		r.Get("/local-sources", local.Scan)
		r.Post("/local-sources/import", local.Import)

		r.Get("/files", files.List)
		r.Get("/files/read", files.Read)
		r.Get("/files/raw", files.Raw)

		r.Get("/auth/status", authH.Status)
		r.Post("/auth/setup", authH.Setup)
		r.Post("/auth/login", authH.Login)
		r.Post("/auth/logout", authH.Logout)
		r.Post("/auth/change", authH.Change)

		r.Get("/sync/status", syncH.Status)
		r.Post("/sync/login", syncH.LoginStart)
		r.Get("/sync/login/poll", syncH.LoginPoll)
		r.Post("/sync/logout", syncH.Logout)
		r.Post("/sync/now", syncH.Now)
		r.Post("/sync/auto", syncH.SetAuto)
		r.Patch("/profile", syncH.UpdateProfile)
		r.Get("/users/{id}/profile", syncH.PublicProfile)
		r.Get("/users/{id}/posts", syncH.UserPosts)
		r.Get("/posts", syncH.PostsList)
		r.Post("/posts", syncH.PostCreate)
		r.Patch("/posts/{id}", syncH.PostEdit)
		r.Delete("/posts/{id}", syncH.PostDelete)
		r.Post("/posts/{id}/upvote", syncH.PostUpvote)
		r.Post("/posts/{id}/reactions", syncH.PostReact)
		r.Get("/posts/{id}/comments", syncH.PostComments)
		r.Post("/posts/{id}/comments", syncH.CommentAdd)
		r.Patch("/comments/{id}", syncH.CommentEdit)
		r.Delete("/comments/{id}", syncH.CommentDelete)
		r.Post("/comments/{id}/reactions", syncH.CommentReact)

		r.Get("/shop", syncH.Shop)
		r.Post("/shop/buy", syncH.ShopBuy)
		r.Post("/shop/equip", syncH.ShopEquip)
		r.Get("/admin/flags", syncH.AdminFlags)
		r.Post("/admin/flags/{id}/review", syncH.AdminReviewFlag)
		r.Get("/chat/messages", syncH.ChatList)
		r.Post("/chat/messages", syncH.ChatSend)
		r.Patch("/chat/messages/{id}", syncH.ChatEdit)
		r.Delete("/chat/messages/{id}", syncH.ChatDelete)
		r.Post("/chat/messages/{id}/reactions", syncH.ChatReact)
		r.Get("/chat/stream", syncH.ChatStream)

		r.Get("/tunnel/status", tun.Status)
		r.Post("/tunnel/enable", tun.Enable)
		r.Post("/tunnel/disable", tun.Disable)
		r.Post("/tunnel/login", tun.Login)
		r.Post("/tunnel/named", tun.Named)

		r.Get("/music/search", music.Search)
		r.Get("/music/stream", music.Stream)
		r.Get("/music/discover", music.Discover)
		r.Get("/music/history", music.RecentPlays)
		r.Post("/music/history", music.RecordPlay)
		r.Delete("/music/history", music.ClearHistory)
		r.Get("/music/playlists", music.ListPlaylists)
		r.Post("/music/playlists", music.CreatePlaylist)
		r.Post("/music/playlists/import", music.ImportPlaylist)
		r.Get("/music/playlists/{id}", music.GetPlaylist)
		r.Delete("/music/playlists/{id}", music.DeletePlaylist)
		r.Get("/music/playlists/{id}/export", music.ExportPlaylist)
		r.Post("/music/playlists/{id}/tracks", music.AddTrack)
		r.Delete("/music/playlists/{id}/tracks/{videoId}", music.RemoveTrack)
	})

	// Real PTY shell over WebSocket — loopback-only (guarded in the handler).
	r.Get("/api/terminal", term.WS)

	// WebOS SPA on the same port (everything not matched above).
	r.Handle("/*", spaHandler())

	return &Server{addr: addr, mux: r}
}

func (s *Server) ListenAndServe() error {
	return http.ListenAndServe(s.addr, s.mux)
}
