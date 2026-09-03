package session

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"

	"strucureo-gateway/internal/redis"
)

const dbPrefix = "whatsmeow_"

const (
	// pairConnectTimeout is how long to wait for WhatsApp to send the pair-device
	// IQ that surfaces as *events.QR on a fresh, unregistered device.
	pairConnectTimeout = 30 * time.Second

	// reconnectTimeout is how long to wait for *events.Connected when the device
	// already has stored credentials — that is a login, not a pairing, so it does
	// not need the longer pairing budget.
	reconnectTimeout = 15 * time.Second
)

// ClientManager manages per-tenant whatsmeow clients backed by PostgreSQL databases.
type ClientManager struct {
	mu      sync.Mutex
	clients map[string]*whatsmeow.Client
	dbURL   string // base DSN without dbname
	rdb     *redis.Client
	sessMgr *Manager
}

func NewClientManager(dbURL string, rdb *redis.Client, sessMgr *Manager) *ClientManager {
	return &ClientManager{
		clients: make(map[string]*whatsmeow.Client),
		dbURL:   dbURL,
		rdb:     rdb,
		sessMgr: sessMgr,
	}
}

// baseDSN returns a DSN for connecting to the "postgres" maintenance database.
// Strips the database name from the URI and adds sslmode=disable for local dev.
func (cm *ClientManager) baseDSN() string {
	// URI format: postgresql://user:pass@host:port/dbname?sslmode=...
	// We need to replace dbname with "postgres"
	dsn := cm.dbURL
	if strings.Contains(dsn, "?") {
		parts := strings.SplitN(dsn, "?", 2)
		base := parts[0]
		params := parts[1]
		// Replace the database name (last path segment) with "postgres"
		slashIdx := strings.LastIndex(base, "/")
		if slashIdx >= 0 {
			base = base[:slashIdx+1] + "postgres"
		}
		// Ensure sslmode=disable
		if !strings.Contains(params, "sslmode=") {
			params += "&sslmode=disable"
		} else {
			params = strings.Replace(params, "sslmode=require", "sslmode=disable", 1)
			params = strings.Replace(params, "sslmode=prefer", "sslmode=disable", 1)
		}
		dsn = base + "?" + params
	} else {
		// No query params
		slashIdx := strings.LastIndex(dsn, "/")
		if slashIdx >= 0 {
			dsn = dsn[:slashIdx+1] + "postgres"
		}
		dsn += "?sslmode=disable"
	}
	return dsn
}

// getOrCreateDB ensures a per-tenant database exists and returns its DSN.
func (cm *ClientManager) getOrCreateDB(ctx context.Context, tenantID string) (string, error) {
	dbName := dbPrefix + tenantID

	// Connect to the maintenance database to create the tenant DB
	maintDSN := cm.baseDSN()
	maintDB, err := sql.Open("postgres", maintDSN)
	if err != nil {
		return "", fmt.Errorf("open maintenance db: %w", err)
	}
	defer maintDB.Close()

	if err := maintDB.PingContext(ctx); err != nil {
		return "", fmt.Errorf("ping maintenance db: %w", err)
	}

	// Check if DB exists
	var exists bool
	err = maintDB.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)", dbName,
	).Scan(&exists)
	if err != nil {
		return "", fmt.Errorf("check db exists: %w", err)
	}

	if !exists {
		// CREATE DATABASE cannot run inside a transaction
		_, err = maintDB.ExecContext(ctx, fmt.Sprintf(`CREATE DATABASE "%s"`, dbName))
		if err != nil {
			return "", fmt.Errorf("create db %s: %w", dbName, err)
		}
		log.Printf("Created whatsmeow database: %s", dbName)
	}

	// Return DSN pointing to the per-tenant database (URI format)
	dsn := cm.dbURL
	// Replace the database name in the URI
	slashIdx := strings.LastIndex(dsn, "/")
	if slashIdx >= 0 {
		beforeSlash := dsn[:slashIdx+1]
		afterDB := ""
		if qIdx := strings.Index(dsn[slashIdx+1:], "?"); qIdx >= 0 {
			afterDB = dsn[slashIdx+1+qIdx:]
		}
		dsn = beforeSlash + dbName + afterDB
	}
	// Ensure sslmode=disable
	if strings.Contains(dsn, "?") {
		if !strings.Contains(dsn, "sslmode=") {
			dsn += "&sslmode=disable"
		} else {
			dsn = strings.Replace(dsn, "sslmode=require", "sslmode=disable", 1)
			dsn = strings.Replace(dsn, "sslmode=prefer", "sslmode=disable", 1)
		}
	} else {
		dsn += "?sslmode=disable"
	}
	return dsn, nil
}

// getOrCreateClient returns an existing whatsmeow client or creates a new one.
func (cm *ClientManager) getOrCreateClient(ctx context.Context, tenantID string) (*whatsmeow.Client, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if c, ok := cm.clients[tenantID]; ok {
		return c, nil
	}

	tenantDSN, err := cm.getOrCreateDB(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	dbLog := waLog.Stdout("DB:"+tenantID, "WARN", true)
	container, err := sqlstore.New(ctx, "postgres", tenantDSN, dbLog)
	if err != nil {
		return nil, fmt.Errorf("open sqlstore for %s: %w", tenantID, err)
	}

	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, fmt.Errorf("get device for %s: %w", tenantID, err)
	}

	clientLog := waLog.Stdout("WA:"+tenantID, "WARN", true)
	client := whatsmeow.NewClient(device, clientLog)

	// Give the tenant a Manager session before any event can fire. Without this a
	// tenant restored on boot has a live client but no session record, so /qr
	// answers "session not found" and the event handlers' mutate() calls are no-ops.
	cm.sessMgr.GetOrCreate(tenantID)

	// Register event handler
	evtHandler := NewEventHandler(tenantID, cm.rdb, cm.sessMgr)
	client.AddEventHandler(evtHandler.HandleEvent)

	cm.clients[tenantID] = client
	return client, nil
}

// RemoveClient removes a client from the cache (does not disconnect).
func (cm *ClientManager) RemoveClient(tenantID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	delete(cm.clients, tenantID)
}

// ListTenants enumerates the tenants that have a persisted whatsmeow database.
// This is the one place that knows how tenants are discovered; the restorer and
// the outbound sender both read from it.
func (cm *ClientManager) ListTenants(ctx context.Context) ([]string, error) {
	maintDB, err := sql.Open("postgres", cm.baseDSN())
	if err != nil {
		return nil, fmt.Errorf("open maintenance db: %w", err)
	}
	defer maintDB.Close()

	rows, err := maintDB.QueryContext(ctx,
		"SELECT datname FROM pg_database WHERE datname LIKE $1", dbPrefix+"%",
	)
	if err != nil {
		return nil, fmt.Errorf("list whatsmeow databases: %w", err)
	}
	defer rows.Close()

	var tenants []string
	for rows.Next() {
		var dbName string
		if err := rows.Scan(&dbName); err != nil {
			continue
		}
		if tenantID := strings.TrimPrefix(dbName, dbPrefix); tenantID != "" {
			tenants = append(tenants, tenantID)
		}
	}
	return tenants, rows.Err()
}

// RestoreAll attempts to reconnect all stored sessions on boot.
func (cm *ClientManager) RestoreAll(ctx context.Context) error {
	tenants, err := cm.ListTenants(ctx)
	if err != nil {
		return err
	}

	var restored int
	for _, tenantID := range tenants {
		client, err := cm.getOrCreateClient(ctx, tenantID)
		if err != nil {
			log.Printf("Failed to restore session for tenant %s: %v", tenantID, err)
			continue
		}

		// Only attempt reconnect if already paired
		if client.Store.ID == nil {
			log.Printf("Tenant %s: no stored credentials, skipping reconnect", tenantID)
			continue
		}

		// Connect in background. This goroutine is ours, not whatsmeow's, so it
		// sits outside dispatchEvent's recover — an unrecovered panic here would
		// take the whole gateway down with it.
		go func(tid string, c *whatsmeow.Client) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC restoring tenant %s: %v", tid, r)
				}
			}()
			if err := c.Connect(); err != nil {
				log.Printf("Failed to reconnect tenant %s: %v", tid, err)
				return
			}
			log.Printf("Reconnected tenant %s as %s", tid, c.Store.ID)
		}(tenantID, client)

		restored++
	}

	if restored > 0 {
		log.Printf("Restoring %d WhatsApp session(s)...", restored)
	}
	return nil
}

// ConnectClient connects a whatsmeow client to WhatsApp and waits until the
// connection is usable.
//
// The second return value reports whether the device already has stored
// credentials. That distinction matters: WhatsApp only sends the pair-device IQ
// behind *events.QR for an *unregistered* device, so a paired client never emits
// a QR — it logs straight in and emits *events.Connected. Waiting on QR alone is
// why an already-paired tenant burned the full timeout on every attempt.
func (cm *ClientManager) ConnectClient(ctx context.Context, tenantID string) (*whatsmeow.Client, bool, error) {
	client, err := cm.getOrCreateClient(ctx, tenantID)
	if err != nil {
		return nil, false, err
	}

	alreadyPaired := client.Store.ID != nil

	if client.IsConnected() {
		return client, alreadyPaired, nil
	}

	// Buffered by one and written to without blocking: the QR rotates every ~20s
	// so this handler fires repeatedly, and close() on the second call would panic.
	ready := make(chan struct{}, 1)

	// Scope the handler to this call. AddEventHandler hands back an id that has to
	// be released — otherwise the closure, and the channel it captured, outlive
	// the call and intercept the *next* connection's events.
	handlerID := client.AddEventHandler(func(evt any) {
		// whatsmeow's dispatchEvent recovers panics, but that recover also abandons
		// the rest of the handler chain. Keeping a fault in here local means it
		// degrades to a timeout instead of silently breaking session bookkeeping.
		defer func() { _ = recover() }()

		switch evt.(type) {
		case *events.QR, *events.PairSuccess, *events.Connected:
			select {
			case ready <- struct{}{}:
			default:
			}
		}
	})
	defer client.RemoveEventHandler(handlerID)

	if err := client.Connect(); err != nil {
		return nil, alreadyPaired, fmt.Errorf("connect: %w", err)
	}

	wait := pairConnectTimeout
	if alreadyPaired {
		wait = reconnectTimeout
	}

	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-ready:
		return client, alreadyPaired, nil
	case <-timer.C:
		return nil, alreadyPaired, fmt.Errorf("timeout after %s waiting for connection (paired=%t)", wait, alreadyPaired)
	case <-ctx.Done():
		return nil, alreadyPaired, ctx.Err()
	}
}

// GetClient returns the cached client for a tenant, or nil when none is loaded.
func (cm *ClientManager) GetClient(tenantID string) *whatsmeow.Client {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	return cm.clients[tenantID]
}

// EnsureClient loads (but does not connect) the client for a tenant.
func (cm *ClientManager) EnsureClient(ctx context.Context, tenantID string) (*whatsmeow.Client, error) {
	return cm.getOrCreateClient(ctx, tenantID)
}

// DisconnectClient disconnects a whatsmeow client.
func (cm *ClientManager) DisconnectClient(tenantID string) {
	cm.mu.Lock()
	c, ok := cm.clients[tenantID]
	cm.mu.Unlock()

	if ok && c != nil {
		c.Disconnect()
	}
}

// DeleteSession removes the persisted session data for a tenant.
func (cm *ClientManager) DeleteSession(ctx context.Context, tenantID string) error {
	cm.mu.Lock()
	c, ok := cm.clients[tenantID]
	if ok {
		delete(cm.clients, tenantID)
	}
	cm.mu.Unlock()

	if ok && c != nil {
		c.Disconnect()

		// Store.Delete needs a device id and returns ErrDeviceIDMustBeSet without one.
		// Returning on that error aborted the wipe before the DROP DATABASE below,
		// which left an unpaired tenant permanently unwipeable. The database is the
		// real source of truth here, so log and carry on.
		if c.Store.ID != nil {
			if err := c.Store.Delete(ctx); err != nil {
				log.Printf("Warning: delete store for tenant %s: %v", tenantID, err)
			}
		}
	}

	// Drop the per-tenant database
	dbName := dbPrefix + tenantID
	maintDSN := cm.baseDSN()
	maintDB, err := sql.Open("postgres", maintDSN)
	if err != nil {
		return fmt.Errorf("open maintenance db for drop: %w", err)
	}
	defer maintDB.Close()

	// Terminate existing connections to the database
	_, err = maintDB.ExecContext(ctx,
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, dbName,
	)
	if err != nil {
		log.Printf("Warning: could not terminate connections to %s: %v", dbName, err)
	}

	_, err = maintDB.ExecContext(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS "%s"`, dbName))
	if err != nil {
		return fmt.Errorf("drop db %s: %w", dbName, err)
	}

	log.Printf("Deleted whatsmeow database: %s", dbName)
	return nil
}
