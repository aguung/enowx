// Package server is the single net/http listener that multiplexes /v1, /api, and
// the SPA by path. It is the only place that knows about HTTP.
package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/plugins"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/core/suno"
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
	Aliases    store.AliasStore
	ApiTest    store.ApiTestStore
	Tunnel     *tunnel.Manager
	Plugins    *plugins.Manager
	Sync       *syncpkg.Manager
	Doer       transport.Doer
	Settings   handlers.SettingsInfo
}

func New(addr string, d Deps) *Server {
	r := chi.NewRouter()
	v1 := handlers.NewV1(d.Proxy, d.Route, d.Logs, d.Keys)
	anthropic := handlers.NewAnthropic(d.Proxy, d.Route, d.Logs, d.Keys)
	if d.Aliases != nil {
		resolver := proxy.NewAliasResolver(d.Aliases.Map, 30*time.Second)
		v1.SetAliasResolver(resolver)
		anthropic.SetAliasResolver(resolver)
	}
	providers := handlers.NewProviders(d.Registry)
	accounts := handlers.NewAccounts(d.Accounts)
	requests := handlers.NewRequests(d.Logs)
	keys := handlers.NewKeys(d.Keys)
	settings := handlers.NewSettings(d.Settings)
	dbg := handlers.NewDebug(d.Settings.Version, d.Settings.Started)
	docs := handlers.NewDocs(d.Settings.Version)
	kiro := handlers.NewKiro(d.Doer, d.Accounts)
	codex := handlers.NewCodex(d.Doer, d.Accounts)
	antigravity := handlers.NewAntigravity(d.Doer, d.Accounts)
	leonardoAcc := handlers.NewLeonardo(d.Accounts, d.Doer)
	local := handlers.NewLocal(d.Accounts)
	usage := handlers.NewUsage(d.Registry, d.Accounts)
	models := handlers.NewModels(d.Registry, d.Accounts, d.Sync)
	aliases := handlers.NewAliases(d.Aliases)
	apitest := handlers.NewApiTest(d.ApiTest)
	warmup := handlers.NewWarmup(d.Proxy, d.Registry, d.Accounts, d.Warmups, d.Logs)
	apply := handlers.NewApply(d.Accounts)
	// Auto-warm newly-added accounts (credit check + test request) before pool.
	accounts.SetWarmer(warmup)
	kiro.SetWarmer(warmup)
	codex.SetWarmer(warmup)
	antigravity.SetWarmer(warmup)
	leonardoAcc.SetWarmer(warmup)
	local.SetWarmer(warmup)
	dash := middleware.NewDashboard(d.SettingsKV)
	term := handlers.NewTerminal(dash)
	files := handlers.NewFiles(dash)
	agent := handlers.NewAgent(dash, d.Doer)
	pluginsH := handlers.NewPlugins(dash, d.Plugins)
	market := handlers.NewMarket(dash, d.Sync, d.Plugins)
	music := handlers.NewMusic(d.Music)
	sunoMusic := handlers.NewSuno(d.Accounts, d.Proxy, suno.New(d.Doer))
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
		r.Post("/v1/images/generations", v1.Images)
		r.Post("/anthropic/v1/messages", anthropic.Messages)
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/providers", providers.List)
		r.Get("/accounts", accounts.List)
		r.Post("/accounts", accounts.Add)
		r.Patch("/accounts/{id}/status", accounts.SetStatus)
		r.Patch("/accounts/{id}/disabled", accounts.SetDisabled)
		r.Get("/accounts/{id}/usage", usage.Get)
		r.Get("/accounts/{id}/models", models.Get)
		r.Get("/models", models.All)
		r.Get("/model-aliases", aliases.List)
		r.Post("/model-aliases", aliases.Set)
		r.Delete("/model-aliases/{alias}", aliases.Delete)

		r.Get("/apitest", apitest.All)
		r.Post("/apitest/collections", apitest.AddCollection)
		r.Patch("/apitest/collections/{id}", apitest.RenameCollection)
		r.Delete("/apitest/collections/{id}", apitest.DeleteCollection)
		r.Post("/apitest/requests", apitest.SaveRequest)
		r.Delete("/apitest/requests/{id}", apitest.DeleteRequest)
		r.Post("/apitest/environments", apitest.SaveEnvironment)
		r.Delete("/apitest/environments/{id}", apitest.DeleteEnvironment)
		r.Post("/apitest/environments/{id}/activate", apitest.ActivateEnvironment)
		r.Post("/apitest/history", apitest.AddHistory)
		r.Delete("/apitest/history", apitest.ClearHistory)
		r.Post("/accounts/{id}/warmup", warmup.Run)
		r.Post("/accounts/{id}/test-model", warmup.TestModel)
		r.Post("/accounts/{id}/apply", apply.Apply)
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

		r.Post("/accounts/codex/oauth/start", codex.OAuthStart)
		r.Post("/accounts/codex/oauth/exchange", codex.OAuthExchange)
		r.Post("/accounts/codex/manual", codex.Manual)

		r.Post("/accounts/antigravity/oauth/start", antigravity.OAuthStart)
		r.Post("/accounts/antigravity/oauth/exchange", antigravity.OAuthExchange)
		r.Post("/accounts/antigravity/manual", antigravity.Manual)

		r.Post("/accounts/leonardo/cookie", leonardoAcc.FromCookie)
		r.Post("/accounts/leonardo/browser/start", leonardoAcc.BrowserStart)
		r.Post("/accounts/leonardo/browser/poll", leonardoAcc.BrowserPoll)
		r.Post("/accounts/leonardo/browser/cancel", leonardoAcc.BrowserCancel)

		r.Get("/local-sources", local.Scan)
		r.Post("/local-sources/import", local.Import)

		r.Get("/files", files.List)
		r.Get("/files/read", files.Read)
		r.Get("/files/raw", files.Raw)

		r.Post("/agent/fs/read", agent.FSRead)
		r.Post("/agent/fs/list", agent.FSList)
		r.Post("/agent/fs/write", agent.FSWrite)
		r.Post("/agent/fs/edit", agent.FSEdit)
		r.Post("/agent/exec", agent.Exec)
		r.Post("/agent/http", agent.HTTP)

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
		r.Post("/profile/avatar", syncH.UploadAvatar)
		r.Post("/profile/banner", syncH.UploadBanner)
		r.Post("/upload/image", syncH.UploadImage)
		r.Get("/users/{id}/profile", syncH.PublicProfile)
		r.Get("/users/by-name/{name}", syncH.UserByName)
		r.Get("/users/mention", syncH.MentionUsers)
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

		r.Get("/marketplace/listings", syncH.MarketplaceList)
		r.Get("/marketplace/listings/{id}", syncH.MarketplaceGet)
		r.Post("/marketplace/listings", syncH.MarketplaceCreate)
		r.Patch("/marketplace/listings/{id}", syncH.MarketplaceUpdate)
		r.Delete("/marketplace/listings/{id}", syncH.MarketplaceDelete)
		r.Get("/marketplace/rekber/fee", syncH.RekberFee)
		r.Get("/marketplace/rekber/threads", syncH.RekberThreads)
		r.Post("/marketplace/rekber/threads", syncH.RekberCreate)
		r.Get("/marketplace/rekber/threads/{id}", syncH.RekberGetThread)
		r.Post("/marketplace/rekber/threads/{id}/messages", syncH.RekberSend)
		r.Post("/marketplace/rekber/threads/{id}/{action}", syncH.RekberAction)
		r.Get("/marketplace/official", syncH.OfficialList)
		r.Post("/marketplace/orders", syncH.OrderCreate)
		r.Get("/marketplace/orders", syncH.OrdersList)
		r.Get("/marketplace/orders/{id}", syncH.OrderGet)
		r.Get("/marketplace/admin/vip/balance", syncH.VIPBalance)
		r.Get("/marketplace/admin/vip/catalog", syncH.VIPCatalog)
		r.Get("/marketplace/admin/vip/products", syncH.VIPProducts)
		r.Post("/marketplace/admin/vip/products", syncH.VIPProductUpsert)
		r.Patch("/marketplace/admin/vip/products/{id}", syncH.VIPProductToggle)
		r.Delete("/marketplace/admin/vip/products/{id}", syncH.VIPProductDelete)

		r.Get("/shop", syncH.Shop)
		r.Post("/shop/buy", syncH.ShopBuy)
		r.Post("/shop/equip", syncH.ShopEquip)
		r.Get("/admin/flags", syncH.AdminFlags)
		r.Post("/admin/flags/{id}/review", syncH.AdminReviewFlag)
		r.Get("/admin/log", syncH.AdminLog)
		r.Get("/admin/stats", syncH.AdminStats)
		r.Get("/admin/users", syncH.AdminUsers)
		r.Get("/admin/models", syncH.AdminModels)
		r.Post("/admin/models", syncH.AdminUpsertModel)
		r.Patch("/admin/models/{id}", syncH.AdminUpdateModel)
		r.Delete("/admin/models/{id}", syncH.AdminDeleteModel)
		r.Post("/admin/users/{id}/{action}", syncH.AdminUserAction)
		r.Get("/chat/messages", syncH.ChatList)
		r.Post("/chat/messages", syncH.ChatSend)
		r.Post("/chat/share-music", syncH.ChatShareMusic)
		r.Patch("/chat/messages/{id}", syncH.ChatEdit)
		r.Delete("/chat/messages/{id}", syncH.ChatDelete)
		r.Post("/chat/messages/{id}/reactions", syncH.ChatReact)
		r.Get("/chat/stream", syncH.ChatStream)
		r.Get("/search", syncH.Search)
		r.Get("/notifications", syncH.Notifications)
		r.Post("/notifications/read", syncH.NotificationsRead)

		r.Get("/tunnel/status", tun.Status)
		r.Post("/tunnel/enable", tun.Enable)
		r.Post("/tunnel/disable", tun.Disable)
		r.Post("/tunnel/login", tun.Login)
		r.Post("/tunnel/named", tun.Named)

		r.Get("/music/search", music.Search)
		r.Get("/music/stream", music.Stream)
		r.Get("/music/suno/key", sunoMusic.GetKey)
		r.Post("/music/generate", sunoMusic.Generate)
		r.Get("/music/generate/status", sunoMusic.Status)
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

	// Plugin management (dashboard-gated).
	r.Route("/api/plugins", func(r chi.Router) {
		r.Get("/", pluginsH.List)
		r.Post("/", pluginsH.Create)
		r.Post("/{id}/start", pluginsH.Start)
		r.Post("/{id}/stop", pluginsH.Stop)
		r.Post("/{id}/reveal", pluginsH.Reveal)
		r.Get("/{id}/icon", pluginsH.Icon)
		r.Post("/{id}/icon", pluginsH.UploadIcon)
		r.Get("/{id}/logs", pluginsH.Logs)
		r.Delete("/{id}", pluginsH.Delete)
	})
	// Plugin marketplace (publish/browse/install) + admin scan settings.
	r.Route("/api/market", func(r chi.Router) {
		r.Post("/publish", market.Publish)
		r.Get("/plugins", market.List)
		r.Post("/install/{id}", market.Install)
	})
	r.Get("/api/admin/plugin-scan", market.GetScanSettings)
	r.Put("/api/admin/plugin-scan", market.SaveScanSettings)
	r.Get("/api/admin/plugin-reviews", market.Reviews)
	r.Get("/api/admin/plugin-reviews/{id}", market.ReviewDetail)
	r.Get("/api/admin/marketplace", market.AdminPlugins)
	r.Get("/api/admin/marketplace/{id}/source", market.PluginSource)
	r.Post("/api/admin/marketplace/{id}/{action}", market.SetStatus)
	r.Delete("/api/admin/marketplace/{id}", market.Takedown)

	// Plugin UIs, reverse-proxied to their sidecar (gated in the handler).
	r.Handle("/plugins/*", pluginsH.PluginProxy())

	// WebOS SPA on the same port (everything not matched above).
	r.Handle("/*", spaHandler())

	return &Server{addr: addr, mux: r}
}

func (s *Server) ListenAndServe() error {
	return http.ListenAndServe(s.addr, s.mux)
}
