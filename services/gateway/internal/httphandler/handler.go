package httphandler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow"

	"strucureo-gateway/internal/config"
	goredis "strucureo-gateway/internal/redis"
	"strucureo-gateway/internal/session"
)

// pairingWindow is how long a phone pairing code stays valid. It matches the
// reaper's pairingExpiry in the session package, which owns the cleanup.
const pairingWindow = 5 * time.Minute

func NewRouter(sessMgr *session.Manager, clientMgr *session.ClientManager, senders *session.SenderPool, rdb *goredis.Client, cfg *config.Config) http.Handler {
	mux := http.NewServeMux()

	h := &handlers{sessMgr: sessMgr, clientMgr: clientMgr, senders: senders, rdb: rdb, cfg: cfg}

	mux.HandleFunc("/health", h.health)
	mux.HandleFunc("/provision", h.provision)
	mux.HandleFunc("/pair", h.pair)
	mux.HandleFunc("/pair-code", h.pairCode)
	mux.HandleFunc("/qr", h.qr)
	mux.HandleFunc("/disconnect", h.disconnect)
	mux.HandleFunc("/messages/send", h.sendMessage)
	mux.HandleFunc("/events", h.events)
	mux.HandleFunc("/proxy/set", h.setProxy)
	mux.HandleFunc("/rate/status", h.rateStatus)

	// withRecover wraps outside withAuth so a panic in the auth middleware itself is
	// caught too. It must never replace withAuth — /health is the only unauthenticated
	// route, and that exemption lives inside withAuth.
	return withRecover(withAuth(withCORS(mux), cfg))
}

type handlers struct {
	sessMgr   *session.Manager
	clientMgr *session.ClientManager
	senders   *session.SenderPool
	rdb       *goredis.Client
	cfg       *config.Config
}

func (h *handlers) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// writeJSON emits a JSON body with the given status code.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

// writeJSONError emits {"error":"..."} with the message properly escaped.
// Interpolating an error into a JSON literal breaks the body as soon as the error
// text contains a quote, which whatsmeow's do.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *handlers) provision(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID string `json:"tenant_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TenantID == "" {
		http.Error(w, `{"error":"tenant_id required"}`, http.StatusBadRequest)
		return
	}

	if h.sessMgr.PendingCount() >= session.MaxConcurrentPending {
		http.Error(w, `{"error":"too many pending sessions"}`, http.StatusTooManyRequests)
		return
	}

	h.sessMgr.GetOrCreate(req.TenantID)
	if sess, ok := h.sessMgr.Snapshot(req.TenantID); ok && sess.PairingInFlight {
		http.Error(w, `{"error":"pairing already in progress"}`, http.StatusConflict)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":    "pending_pairing",
		"tenant_id": req.TenantID,
	})
}

func (h *handlers) pair(w http.ResponseWriter, r *http.Request) {
	// QR-based pairing
	h.qr(w, r)
}

func (h *handlers) pairCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID string `json:"tenant_id"`
		Phone    string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TenantID == "" || req.Phone == "" {
		http.Error(w, `{"error":"tenant_id and phone required"}`, http.StatusBadRequest)
		return
	}

	if h.sessMgr.PendingCount() >= session.MaxConcurrentPending {
		http.Error(w, `{"error":"too many pending sessions"}`, http.StatusTooManyRequests)
		return
	}

	h.sessMgr.GetOrCreate(req.TenantID)

	// Reject only genuinely concurrent attempts. Asking again because the first
	// code scrolled off the screen is legitimate and gets a fresh code — the old
	// check rejected that for a full five minutes.
	if !h.sessMgr.BeginPairing(req.TenantID) {
		http.Error(w, `{"error":"pairing already in progress"}`, http.StatusConflict)
		return
	}
	defer h.sessMgr.EndPairing(req.TenantID)

	client, alreadyPaired, err := h.clientMgr.ConnectClient(r.Context(), req.TenantID)
	if err != nil {
		h.sessMgr.SetSessionStatus(req.TenantID, session.StatusDisconnected, time.Time{})
		writeJSONError(w, http.StatusInternalServerError, "failed to connect client: "+err.Error())
		return
	}

	h.sessMgr.SetSessionClient(req.TenantID, client)

	// A device that already holds credentials never receives a pair-device IQ, so
	// there is nothing for PairPhone to do — report the live state instead. Wiping
	// and re-pairing is an explicit POST /disconnect {"wipe":true}.
	if alreadyPaired {
		var jid string
		if client.Store.ID != nil {
			jid = client.Store.ID.String()
		}

		h.sessMgr.SetSessionStatus(req.TenantID, session.StatusConnected, time.Time{})
		h.sessMgr.SetJID(req.TenantID, jid)
		h.publishSessionEvent(req.TenantID, map[string]string{
			"type":   "connected",
			"status": "connected",
			"jid":    jid,
		})
		h.senders.Start(req.TenantID)

		log.Printf("Tenant %s is already paired as %s — skipping PairPhone", req.TenantID, jid)

		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "already_paired",
			"tenant_id": req.TenantID,
			"jid":       jid,
			"connected": client.IsConnected(),
		})
		return
	}

	log.Printf("Client connected for tenant %s, awaiting PairPhone", req.TenantID)

	expiresAt := time.Now().Add(pairingWindow)
	h.sessMgr.SetSessionStatus(req.TenantID, session.StatusWaitingForPairingCode, expiresAt)

	// PairPhone strips non-digits from the phone itself, and the server validates
	// the display name as "Browser (OS)" — a friendlier string gets a 400.
	code, err := client.PairPhone(
		r.Context(),
		req.Phone,
		true,                       // show push notification
		whatsmeow.PairClientChrome, // client type (any is accepted)
		"Chrome (Linux)",
	)
	if err != nil {
		h.sessMgr.SetSessionStatus(req.TenantID, session.StatusDisconnected, time.Time{})
		writeJSONError(w, http.StatusInternalServerError, "pair phone failed: "+err.Error())
		return
	}

	h.sessMgr.SetPairingCode(req.TenantID, code)
	h.senders.Start(req.TenantID)

	h.publishSessionEvent(req.TenantID, map[string]string{
		"type":         "pairing_code",
		"status":       "waiting_for_pairing_code",
		"pairing_code": code,
	})

	log.Printf("Pairing code for tenant %s: %s", req.TenantID, code)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "pairing_code_sent",
		"tenant_id":    req.TenantID,
		"pairing_code": code,
		"expires_at":   expiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *handlers) qr(w http.ResponseWriter, r *http.Request) {
	tenantID := r.URL.Query().Get("channel_id")
	if tenantID == "" {
		tenantID = r.URL.Query().Get("tenant_id")
	}
	if tenantID == "" {
		http.Error(w, `{"error":"tenant_id required"}`, http.StatusBadRequest)
		return
	}

	sess, ok := h.sessMgr.Snapshot(tenantID)
	if !ok {
		http.Error(w, `{"error":"session not found"}`, http.StatusNotFound)
		return
	}

	// The REPL points users at this route for the pairing code, so return it here
	// rather than only on the /pair-code response the caller may have lost.
	resp := map[string]any{
		"tenant_id":    tenantID,
		"status":       sess.Status.String(),
		"qr":           sess.QR,
		"pairing_code": sess.PairingCode,
		"jid":          sess.JID,
	}
	if !sess.ExpiresAt.IsZero() {
		resp["expires_at"] = sess.ExpiresAt.UTC().Format(time.RFC3339)
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *handlers) disconnect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID string `json:"tenant_id"`
		Wipe     bool   `json:"wipe"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TenantID == "" {
		http.Error(w, `{"error":"tenant_id required"}`, http.StatusBadRequest)
		return
	}

	h.senders.Stop(req.TenantID)
	h.sessMgr.Remove(req.TenantID)

	// A plain disconnect drops the socket but keeps the stored device, so the next
	// boot logs straight back in. Wiping deletes the credentials and the per-tenant
	// database — that is what pairing a different number requires, and it cannot be
	// undone.
	if req.Wipe {
		if err := h.clientMgr.DeleteSession(r.Context(), req.TenantID); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "wipe failed: "+err.Error())
			return
		}
		h.publishSessionEvent(req.TenantID, map[string]string{
			"type":   "logged_out",
			"status": "disconnected",
		})
		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "wiped",
			"tenant_id": req.TenantID,
		})
		return
	}

	h.clientMgr.DisconnectClient(req.TenantID)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "disconnected",
		"tenant_id": req.TenantID,
	})
}

// publishSessionEvent sends a JSON event to the Redis Pub/Sub channel for a tenant.
func (h *handlers) publishSessionEvent(tenantID string, data map[string]string) {
	data["tenant_id"] = tenantID
	data["timestamp"] = time.Now().UTC().Format(time.RFC3339)

	payload, err := json.Marshal(data)
	if err != nil {
		return
	}

	ctx := context.Background()
	h.rdb.Raw().Publish(ctx, "strucureo:events:"+tenantID, string(payload))
}

func (h *handlers) sendMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID         string `json:"tenant_id"`
		To               string `json:"to"`
		Body             string `json:"body"`
		AllowUnsolicited bool   `json:"allow_unsolicited"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.TenantID == "" || req.To == "" || req.Body == "" {
		writeJSONError(w, http.StatusBadRequest, "tenant_id, to and body are required")
		return
	}

	// Unsolicited outbound policy: WhatsApp treats a first-contact message from an
	// unverified number as spam, so require a prior inbound from this recipient.
	// Internal escalation alerts set allow_unsolicited (still Bearer-authed +
	// rate-limited) because staff numbers never message the bot first.
	if !req.AllowUnsolicited {
		exists, err := h.rdb.HasInboundMessage(r.Context(), req.TenantID, req.To)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "inbound lookup failed: "+err.Error())
			return
		}
		if !exists {
			writeJSONError(w, http.StatusForbidden,
				"unsolicited outbound not allowed: no prior inbound from this recipient")
			return
		}
	} else {
		log.Printf("Allowing unsolicited internal message for tenant %s to %s", req.TenantID, req.To)
	}

	if !h.sessMgr.CheckSendRate(req.TenantID) {
		writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	// The reply is handed to outbound:<tenant>, which the SenderPool drains. A
	// discarded error here is how "queued" used to be reported for a message Redis
	// never accepted.
	id, err := h.rdb.Raw().XAdd(r.Context(), &redis.XAddArgs{
		Stream: "outbound:" + req.TenantID,
		Values: map[string]interface{}{
			"to":   req.To,
			"body": req.Body,
		},
	}).Result()
	if err != nil {
		log.Printf("Failed to queue outbound message for tenant %s: %v", req.TenantID, err)
		writeJSONError(w, http.StatusInternalServerError, "failed to queue message: "+err.Error())
		return
	}

	// A tenant paired before this process booted has no worker yet; Start is
	// idempotent, so claiming one here costs nothing.
	h.senders.Start(req.TenantID)

	h.sessMgr.RecordSend(req.TenantID)

	writeJSON(w, http.StatusOK, map[string]string{
		"status":     "queued",
		"message_id": id,
	})
}

func (h *handlers) setProxy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID string `json:"tenant_id"`
		Proxy    string `json:"proxy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TenantID == "" {
		writeJSONError(w, http.StatusBadRequest, "tenant_id required")
		return
	}

	// SetProxyAddress is a no-op when no session exists, so make sure one does —
	// otherwise setting a proxy before pairing silently did nothing.
	h.sessMgr.GetOrCreate(req.TenantID)
	h.sessMgr.SetProxyAddress(req.TenantID, req.Proxy)

	writeJSON(w, http.StatusOK, map[string]string{
		"status":    "proxy_set",
		"tenant_id": req.TenantID,
		"proxy":     req.Proxy,
	})
}

func (h *handlers) rateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := r.URL.Query().Get("tenant_id")
	if tenantID == "" {
		writeJSONError(w, http.StatusBadRequest, "tenant_id required")
		return
	}

	canSend := h.sessMgr.CheckSendRate(tenantID)
	proxyAddr := h.sessMgr.GetProxyAddress(tenantID)

	writeJSON(w, http.StatusOK, map[string]any{
		"tenant_id": tenantID,
		"can_send":  canSend,
		"max_rate":  h.cfg.MaxSendRate,
		"proxy":     proxyAddr,
	})
}

func (h *handlers) events(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	tenantID := r.URL.Query().Get("tenant_id")
	if tenantID == "" {
		http.Error(w, `{"error":"tenant_id required"}`, http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Subscribe to session events for this tenant
	pubsub := h.rdb.Raw().Subscribe(ctx, "strucureo:events:"+tenantID)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			// Forward event to SSE client
			fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
			flusher.Flush()
		}
	}
}

// Middleware

// withRecover turns a handler panic into a logged 500. net/http already recovers
// per connection, but it does so silently and simply drops the socket — which
// reaches the client as an unexplained "fetch failed", indistinguishable from the
// gateway being down.
func withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("PANIC handling %s %s: %v", r.Method, r.URL.Path, rec)
				// Best effort: if the handler already wrote a header this is a no-op
				// beyond a "superfluous WriteHeader" line in the log.
				writeJSONError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func withAuth(next http.Handler, cfg *config.Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(auth, "Bearer ")
		if token != cfg.Secret {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}
