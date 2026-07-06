// Go 1.23+ rejects X.509 certificates with a negative serial number at parse
// time. Some upstreams we proxy to (notably Antigravity's Google cloudcode host)
// still serve such certs, which surfaced as "tls: failed to parse certificate
// from server: x509: negative serial number" and broke those chats. Restore the
// pre-1.23 lenient parsing for this binary. (Serial-number sign isn't a security
// property — chain verification is unaffected.)
//go:debug x509negativeserial=1

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/enowdev/enowx/config"
	"github.com/enowdev/enowx/core/daemon"
	"github.com/enowdev/enowx/core/plugins"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/antigravity"
	"github.com/enowdev/enowx/core/provider/codebuddy"
	"github.com/enowdev/enowx/core/provider/commandcode"
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
	// The detached daemon child (ENOWX_DAEMON=1) always runs the server.
	if daemon.IsDaemon() {
		runServer()
		return
	}

	cmd := ""
	var rest []string
	if len(os.Args) > 1 {
		cmd = os.Args[1]
		rest = os.Args[2:] // safe: len(os.Args) >= 2 here
	}
	switch cmd {
	case "", "start":
		startCmd(rest) // handles --daemon; otherwise runs in foreground
	case "stop":
		stopCmd()
	case "restart":
		restartCmd(rest)
	case "status":
		statusCmd()
	case "doctor":
		doctorCmd()
	case "update":
		updateCmd(rest)
	case "tunnel":
		tunnelCmd(rest)
	case "skill":
		skillCmd(rest)
	case "version", "-v", "--version":
		versionCmd()
	case "help", "-h", "--help":
		printHelp()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", cmd)
		printHelp()
		os.Exit(1)
	}
}

// runServer boots and runs the HTTP server (foreground or as the daemon child).
func runServer() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	db, err := sqlite.Open(cfg.DBPath())
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer db.Close()

	// Base transport, wrapped so upstream requests can be routed through the
	// proxy pool (per the proxy_* settings + per-provider whitelist). Requests
	// not tagged with a provider, or when routing is off, go direct.
	doer := transport.Doer(transport.NewProxyDoer(transport.NewStandard(5*time.Minute), db.Proxies(), db.Settings()))
	saveCreds := func(id int64, creds map[string]string) {
		if err := db.Accounts().UpdateCreds(context.Background(), id, creds); err != nil {
			log.Printf("kiro: persist creds for account %d: %v", id, err)
		}
	}

	reg := provider.NewRegistry()
	reg.Register(codebuddy.New(doer))
	reg.Register(codebuddy.NewCN(doer))
	reg.Register(commandcode.New(doer))
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
	syncMgr.SetFullSync(db.Accounts(), db.Keys(), db.Aliases(), db.Combos(), db.CustomProviders(), db.Proxies(),
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
		Combos:     db.Combos(),
		ApiTest:    db.ApiTest(),
		Tunnel:     tun,
		Plugins:    pluginMgr,
		Sync:       syncMgr,
		CustomProv: customMgr,
		Filters:    db.Filters(),
		Proxies:    db.Proxies(),
		Doer:       doer,
		Settings: handlers.SettingsInfo{
			Version:    version,
			Host:       cfg.Host,
			Port:       cfg.Port,
			RuntimeDir: cfg.RuntimeDir,
			Started:    time.Now(),
		},
	})

	// Return freed heap to the OS periodically so RSS tracks real usage after a
	// spike (e.g. warming a large pool) instead of holding the peak reservation.
	go func() {
		t := time.NewTicker(2 * time.Minute)
		defer t.Stop()
		for range t.C {
			debug.FreeOSMemory()
		}
	}()

	// Record our PID so `enx status/stop` can find this instance, and clean up
	// (PID file + DB) on a clean shutdown signal.
	daemon.WritePID(cfg.RuntimeDir)
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		daemon.RemovePID(cfg.RuntimeDir)
		_ = db.Close()
		os.Exit(0)
	}()

	log.Printf("enx %s listening on %s", version, cfg.Addr())
	if err := srv.ListenAndServe(); err != nil {
		daemon.RemovePID(cfg.RuntimeDir)
		log.Fatalf("serve: %v", err)
	}
}
