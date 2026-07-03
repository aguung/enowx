package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/enowdev/enowx/config"
	"github.com/enowdev/enowx/core/plugins"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/antigravity"
	"github.com/enowdev/enowx/core/provider/codebuddy"
	"github.com/enowdev/enowx/core/provider/custommgr"
	"github.com/enowdev/enowx/core/provider/codex"
	leonardoprovider "github.com/enowdev/enowx/core/provider/leonardo"
	sunoprovider "github.com/enowdev/enowx/core/provider/suno"
	"github.com/enowdev/enowx/core/provider/kiro"
	"github.com/enowdev/enowx/core/proxy"
	syncpkg "github.com/enowdev/enowx/core/sync"
	"github.com/enowdev/enowx/core/transport"
	"github.com/enowdev/enowx/core/tunnel"
	"github.com/enowdev/enowx/server"
	"github.com/enowdev/enowx/server/handlers"
	"github.com/enowdev/enowx/store/sqlite"
)

var version = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "-v", "--version":
			fmt.Printf("enx %s\n", version)
			return
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	db, err := sqlite.Open(cfg.DBPath())
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer db.Close()

	doer := transport.NewStandard(5 * time.Minute)
	saveCreds := func(id int64, creds map[string]string) {
		if err := db.Accounts().UpdateCreds(context.Background(), id, creds); err != nil {
			log.Printf("kiro: persist creds for account %d: %v", id, err)
		}
	}

	reg := provider.NewRegistry()
	reg.Register(codebuddy.New(doer))
	reg.Register(codebuddy.NewCN(doer))
	reg.Register(kiro.New(doer, saveCreds))
	reg.Register(codex.New(doer, saveCreds))
	reg.Register(antigravity.New(doer, saveCreds))
	reg.Register(sunoprovider.New(doer))
	reg.Register(leonardoprovider.New(doer))

	px := proxy.New(reg, pool.New(db.Accounts()), doer)
	tun := tunnel.New(cfg.RuntimeDir, cfg.Port)
	pluginMgr := plugins.New(cfg.PluginsDir(), cfg.Port)
	syncMgr := syncpkg.New(db.Settings(), db.Music(), db.Logs())

	// User-defined (custom) providers: register the stored ones live, then keep
	// the registry/prefix/catalog in sync on change.
	customMgr := custommgr.New(reg, db.CustomProviders(), custommgr.Catalog{
		Add:    handlers.AddCatalogEntry,
		Remove: handlers.RemoveCatalogEntry,
	})
	if err := customMgr.LoadAll(context.Background()); err != nil {
		log.Printf("custom providers: load: %v", err)
	}

	// Full cloud sync: let the sync manager snapshot/apply accounts, gateway
	// keys, aliases, and custom providers (custom providers register live).
	syncMgr.SetFullSync(db.Accounts(), db.Keys(), db.Aliases(), db.CustomProviders(),
		customMgr.RegisterOne, customMgr.UnregisterOne)
	// Maintain the live channel (pull side) and the automatic push side. Both
	// are no-ops until logged in; auto-push also obeys the global toggle.
	go syncMgr.RunLive(context.Background(), nil)
	go syncMgr.RunAuto(context.Background(), nil)

	srv := server.New(cfg.Addr(), server.Deps{
		Proxy:      px,
		Route:      routeModel,
		Registry:   reg,
		Accounts:   db.Accounts(),
		Logs:       db.Logs(),
		Keys:       db.Keys(),
		Warmups:    db.Warmups(),
		Music:      db.Music(),
		SettingsKV: db.Settings(),
		Aliases:    db.Aliases(),
		ApiTest:    db.ApiTest(),
		Tunnel:     tun,
		Plugins:    pluginMgr,
		Sync:       syncMgr,
		CustomProv: customMgr,
		Filters:    db.Filters(),
		Doer:       doer,
		Settings: handlers.SettingsInfo{
			Version:    version,
			Host:       cfg.Host,
			Port:       cfg.Port,
			RuntimeDir: cfg.RuntimeDir,
			Started:    time.Now(),
		},
	})

	log.Printf("enx %s listening on %s", version, cfg.Addr())
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
