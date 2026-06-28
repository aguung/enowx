package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/enowdev/enowx/config"
	"github.com/enowdev/enowx/core/pool"
	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/provider/codebuddy"
	"github.com/enowdev/enowx/core/provider/kiro"
	"github.com/enowdev/enowx/core/proxy"
	"github.com/enowdev/enowx/core/transport"
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
	reg.Register(codebuddy.New())
	reg.Register(kiro.New(doer, saveCreds))

	px := proxy.New(reg, pool.New(db.Accounts()), doer)

	srv := server.New(cfg.Addr(), server.Deps{
		Proxy:    px,
		Route:    routeModel,
		Registry: reg,
		Accounts: db.Accounts(),
		Logs:     db.Logs(),
		Keys:     db.Keys(),
		Doer:     doer,
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
