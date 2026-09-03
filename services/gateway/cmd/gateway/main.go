package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"strucureo-gateway/internal/config"
	"strucureo-gateway/internal/httphandler"
	"strucureo-gateway/internal/redis"
	"strucureo-gateway/internal/session"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	cfg := config.Load()

	// Initialize Redis. A blip here used to be log.Fatalf, so the gateway refused to
	// boot at all whenever Redis came up a moment later than it did — and the daemon
	// reported that as an unexplained "fetch failed".
	rdb := redis.NewClient(cfg.RedisURL)
	if err := waitForRedis(ctx, rdb); err != nil {
		log.Printf("⚠️  Redis not reachable yet (%v) — continuing; stream operations will retry", err)
	} else {
		log.Println("✅ Connected to Redis")
	}

	// Initialize session manager
	sessMgr := session.NewManager(rdb, cfg)

	// Initialize client manager (per-tenant whatsmeow clients)
	clientMgr := session.NewClientManager(cfg.DBURL, rdb, sessMgr)

	// Restore all existing sessions on boot
	if err := clientMgr.RestoreAll(ctx); err != nil {
		log.Printf("⚠️  Session restore failed: %v", err)
	}

	// Drain outbound:<tenant> and deliver over WhatsApp. Without this, every agent
	// reply and escalation notice was written to Redis and never read.
	senders := session.NewSenderPool(ctx, rdb, clientMgr)
	if err := senders.StartAll(ctx); err != nil {
		log.Printf("⚠️  Outbound sender startup failed: %v", err)
	}

	// Start pending-session reaper
	go sessMgr.StartReaper(ctx)

	// Build HTTP router
	mux := httphandler.NewRouter(sessMgr, clientMgr, senders, rdb, cfg)

	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{Addr: addr, Handler: mux}

	go func() {
		log.Printf("🚀 Gateway listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			// Name the address: "address already in use" is otherwise indistinguishable
			// from any other startup failure.
			log.Fatalf("listen on %s: %s", addr, err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")
	srv.Shutdown(context.Background())
}

// waitForRedis retries the ping briefly so a slow-starting Redis does not stop the
// gateway from serving /health and pairing requests.
func waitForRedis(ctx context.Context, rdb *redis.Client) error {
	const attempts = 5

	var err error
	for i := 1; i <= attempts; i++ {
		if err = rdb.Ping(ctx).Err(); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if i < attempts {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(i) * time.Second):
			}
		}
	}
	return err
}
