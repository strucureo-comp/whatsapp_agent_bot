package session

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"

	"strucureo-gateway/internal/config"
	"strucureo-gateway/internal/redis"
)

const (
	MaxConcurrentPending = 10
	reaperInterval       = 60 * time.Second
	pairingExpiry        = 5 * time.Minute
	qrExpiry             = 20 * time.Second
)

type Status int

const (
	StatusDisconnected Status = iota
	StatusWaitingForQR
	StatusWaitingForPairingCode
	StatusConnected
)

func (s Status) String() string {
	switch s {
	case StatusDisconnected:
		return "disconnected"
	case StatusWaitingForQR:
		return "waiting_for_qr"
	case StatusWaitingForPairingCode:
		return "waiting_for_pairing_code"
	case StatusConnected:
		return "connected"
	default:
		return "unknown"
	}
}

type Session struct {
	TenantID     string
	Client       *whatsmeow.Client
	Status       Status
	QR           string
	PairingCode  string
	ExpiresAt    time.Time
	LastQueuedAt time.Time
	ConnectedAt  time.Time
	// JID is the linked WhatsApp account, set once pairing succeeds.
	JID string
	// PairingInFlight is true only while a /pair-code request is being served.
	// Waiting for the user to type the code is not "in flight" — that would stop
	// them from asking for a fresh code after the first one scrolled away.
	PairingInFlight bool
	// ProxyAddress is the per-tenant SOCKS5/HTTP proxy for outbound connections.
	ProxyAddress string
	// LastSendAt tracks the last outbound message time for rate limiting.
	LastSendAt time.Time
	// SendCount tracks messages sent in the current rate window.
	SendCount int
}

func (s *Session) IsPendingPairing() bool {
	return s.Status == StatusWaitingForQR || s.Status == StatusWaitingForPairingCode
}

func (s *Session) PendingSince() time.Time {
	if s.Status == StatusWaitingForQR {
		return s.LastQueuedAt
	}
	if s.Status == StatusWaitingForPairingCode {
		return s.ExpiresAt.Add(-pairingExpiry)
	}
	return time.Time{}
}

// CanSend checks if the session can send a message based on rate limits.
// Returns true if allowed, false if rate limited.
func (s *Session) CanSend(maxRate int) bool {
	now := time.Now()
	if now.Sub(s.LastSendAt) >= time.Second {
		// Reset rate window
		s.SendCount = 0
		s.LastSendAt = now
	}
	return s.SendCount < maxRate
}

// RecordSend increments the send counter.
func (s *Session) RecordSend() {
	s.SendCount++
	s.LastSendAt = time.Now()
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session // tenantID -> Session
	rdb      *redis.Client
	cfg      *config.Config
}

func NewManager(rdb *redis.Client, cfg *config.Config) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		rdb:      rdb,
		cfg:      cfg,
	}
}

// RestoreAll is now handled by ClientManager.RestoreAll
func (m *Manager) RestoreAll(ctx context.Context) error {
	return nil
}

// GetOrCreate returns an existing session or creates a new one
func (m *Manager) GetOrCreate(tenantID string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[tenantID]; ok {
		return s
	}

	s := &Session{
		TenantID: tenantID,
		Status:   StatusDisconnected,
	}
	m.sessions[tenantID] = s
	return s
}

func (m *Manager) Get(tenantID string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[tenantID]
}

func (m *Manager) Remove(tenantID string) {
	m.mu.Lock()
	var stale *whatsmeow.Client
	if s, ok := m.sessions[tenantID]; ok {
		stale = s.Client
		delete(m.sessions, tenantID)
	}
	m.mu.Unlock()

	// Outside the lock — see reapExpired.
	if stale != nil {
		stale.Disconnect()
	}
}

func (m *Manager) PendingCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, s := range m.sessions {
		if s.IsPendingPairing() {
			count++
		}
	}
	return count
}

// SetProxyAddress sets a per-tenant proxy address for outbound connections.
func (m *Manager) SetProxyAddress(tenantID, proxyAddress string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.ProxyAddress = proxyAddress
		log.Printf("Proxy set for tenant %s: %s", tenantID, proxyAddress)
	}
}

// GetProxyAddress returns the proxy address for a tenant.
func (m *Manager) GetProxyAddress(tenantID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.sessions[tenantID]; ok {
		return s.ProxyAddress
	}
	return m.cfg.ProxyAddress
}

// CheckSendRate checks if a tenant can send a message (rate limit).
// Returns true if allowed, false if rate limited.
func (m *Manager) CheckSendRate(tenantID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		return s.CanSend(m.cfg.MaxSendRate)
	}
	return true
}

// RecordSend records a message send for rate limiting.
func (m *Manager) RecordSend(tenantID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.RecordSend()
	}
}

// SetSessionClient sets the whatsmeow client on a session.
func (m *Manager) SetSessionClient(tenantID string, client *whatsmeow.Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.Client = client
	}
}

// SetSessionStatus updates the session status and expiry.
func (m *Manager) SetSessionStatus(tenantID string, status Status, expiresAt time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.Status = status
		s.ExpiresAt = expiresAt
	}
}

// SetPairingCode stores the pairing code on the session.
func (m *Manager) SetPairingCode(tenantID, code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.PairingCode = code
	}
}

// GetPairingCode returns the pairing code for a session.
func (m *Manager) GetPairingCode(tenantID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.sessions[tenantID]; ok {
		return s.PairingCode
	}
	return ""
}

// SetJID records the linked WhatsApp account for a session.
func (m *Manager) SetJID(tenantID, jid string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.JID = jid
	}
}

// Snapshot returns a copy of a session's state, safe to read without the lock.
// Reading the struct fields directly from an HTTP handler races with whatsmeow's
// event goroutine, which writes them.
func (m *Manager) Snapshot(tenantID string) (Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[tenantID]
	if !ok {
		return Session{}, false
	}
	return *s, true
}

// BeginPairing claims the pairing slot for a tenant, returning false if a
// /pair-code request for the same tenant is already being served. It guards
// against duplicate concurrent attempts without blocking a user who simply wants
// a fresh code.
func (m *Manager) BeginPairing(tenantID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[tenantID]
	if !ok {
		return false
	}
	if s.PairingInFlight {
		return false
	}
	s.PairingInFlight = true
	return true
}

// EndPairing releases the pairing slot claimed by BeginPairing.
func (m *Manager) EndPairing(tenantID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[tenantID]; ok {
		s.PairingInFlight = false
	}
}

// StartReaper periodically disconnects expired pending sessions
func (m *Manager) StartReaper(ctx context.Context) {
	// This goroutine sits outside whatsmeow's recover, so a panic here would take
	// the gateway down leaving nothing behind that explains why.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in session reaper: %v", r)
		}
	}()

	ticker := time.NewTicker(reaperInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.reapExpired()
		}
	}
}

func (m *Manager) reapExpired() {
	m.mu.Lock()
	now := time.Now()
	var stale []*whatsmeow.Client
	for tenantID, s := range m.sessions {
		if s.IsPendingPairing() && !s.ExpiresAt.IsZero() && now.After(s.ExpiresAt) {
			log.Printf("Reaping expired session for tenant %s", tenantID)
			if s.Client != nil {
				stale = append(stale, s.Client)
			}
			delete(m.sessions, tenantID)
		}
	}
	m.mu.Unlock()

	// Disconnect outside the lock: Disconnect pushes an *events.Disconnected
	// through whatsmeow's dispatcher, and that handler wants this same mutex.
	for _, c := range stale {
		c.Disconnect()
	}
}

// EventHandler wraps whatsmeow event handling with tenant context
type EventHandler struct {
	tenantID string
	rdb      *redis.Client
	sessMgr  *Manager
}

func NewEventHandler(tenantID string, rdb *redis.Client, sessMgr *Manager) *EventHandler {
	return &EventHandler{
		tenantID: tenantID,
		rdb:      rdb,
		sessMgr:  sessMgr,
	}
}

func (h *EventHandler) HandleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		h.onMessage(v)
	case *events.LoggedOut:
		h.onLoggedOut()
	case *events.Connected:
		h.onConnected()
	case *events.QR:
		h.onQR(v)
	case *events.Disconnected:
		h.onDisconnected()
	case *events.PairSuccess:
		h.onPairSuccess(v)
	}
}

func (h *EventHandler) onMessage(msg *events.Message) {
	if msg.Info.IsFromMe {
		return
	}

	content := extractText(msg)
	if content == "" {
		return
	}

	// Security policy: file BYTES never reach the agent — only captions and
	// file names do (voice notes arrive as a static placeholder). Those are
	// still untrusted text, so they flow through the daemon's input guard
	// like any chat message. Cap length so a 4KB caption can't smuggle a
	// payload past review or blow the context window.
	if len(content) > 2000 {
		content = content[:2000]
	}

	// Strip the device suffix so the JID is stable across the sender's devices —
	// this is the key the daemon threads conversations on and the one
	// HasInboundMessage matches outbound sends against.
	sender := msg.Info.Sender.ToNonAD()

	// AddressingMode is a named string type. go-redis's arg writer has a case for
	// string but no reflection fallback, so passing it unconverted fails the whole
	// command with "can't marshal types.AddressingMode" — which, with the error
	// discarded, silently dropped every inbound message.
	if err := h.rdb.XADD(context.Background(), h.tenantID, map[string]interface{}{
		"message_id":      msg.Info.ID,
		"from_jid":        sender.String(),
		"phone":           sender.User,
		"pushname":        msg.Info.PushName,
		"content":         content,
		"timestamp":       msg.Info.Timestamp.Unix(),
		"addressing_mode": string(msg.Info.AddressingMode),
	}).Err(); err != nil {
		log.Printf("Failed to queue inbound message for tenant %s (%s): %v", h.tenantID, msg.Info.ID, err)
		return
	}

	// Record the sender so a reply to them passes the unsolicited-outbound check in
	// HasInboundMessage without depending on how far back the stream is scanned.
	if err := h.rdb.RememberSender(context.Background(), h.tenantID, sender.User).Err(); err != nil {
		log.Printf("Failed to record sender %s for tenant %s: %v", sender.User, h.tenantID, err)
	}
}

// mutate applies fn to the tenant's session under the manager lock, and returns
// false when no such session exists. The lock is released before the caller
// publishes, so a slow Redis round trip never blocks the HTTP handlers.
func (h *EventHandler) mutate(fn func(*Session)) bool {
	h.sessMgr.mu.Lock()
	defer h.sessMgr.mu.Unlock()

	s, ok := h.sessMgr.sessions[h.tenantID]
	if !ok {
		return false
	}
	fn(s)
	return true
}

func (h *EventHandler) onLoggedOut() {
	h.mutate(func(s *Session) {
		s.Status = StatusDisconnected
		s.Client = nil
		s.PairingCode = ""
		s.PairingInFlight = false
	})
	h.publishEvent(map[string]string{
		"type":   "logged_out",
		"status": "disconnected",
	})
	log.Printf("Session logged out for tenant %s", h.tenantID)
}

func (h *EventHandler) onConnected() {
	h.mutate(func(s *Session) {
		s.Status = StatusConnected
		s.ConnectedAt = time.Now()
		s.ExpiresAt = time.Time{} // clear pairing expiry
	})
	h.publishEvent(map[string]string{
		"type":   "connected",
		"status": "connected",
	})
	log.Printf("Session connected for tenant %s", h.tenantID)
}

func (h *EventHandler) onDisconnected() {
	h.mutate(func(s *Session) {
		// A disconnect while pairing is still in progress is a transport blip, not
		// the end of the attempt — leave the pending status alone so the reaper
		// still owns the expiry.
		if !s.IsPendingPairing() {
			s.Status = StatusDisconnected
		}
	})
	h.publishEvent(map[string]string{
		"type":   "disconnected",
		"status": "disconnected",
	})
	log.Printf("Session disconnected for tenant %s", h.tenantID)
}

func (h *EventHandler) onPairSuccess(evt *events.PairSuccess) {
	h.mutate(func(s *Session) {
		s.Status = StatusConnected
		s.ConnectedAt = time.Now()
		s.ExpiresAt = time.Time{}
		s.PairingCode = ""
		s.PairingInFlight = false
		s.JID = evt.ID.String()
	})
	h.publishEvent(map[string]string{
		"type":   "pair_success",
		"status": "connected",
		"jid":    evt.ID.String(),
	})
	log.Printf("Pairing successful for tenant %s: %s", h.tenantID, evt.ID)
}

func (h *EventHandler) onQR(qr *events.QR) {
	var qrCode string
	if len(qr.Codes) > 0 {
		qrCode = qr.Codes[0]
	}

	h.mutate(func(s *Session) {
		if qrCode != "" {
			s.QR = qrCode
		}
		s.LastQueuedAt = time.Now()
		// Only claim the QR flow when nothing has asked for a pairing code. A QR
		// also arrives on the phone-code path (it is the same pair-device IQ), and
		// overwriting the status there would drop the code the caller is waiting on
		// and hand the session a 20s expiry the reaper would act on.
		if s.Status != StatusWaitingForPairingCode {
			s.Status = StatusWaitingForQR
			s.ExpiresAt = time.Now().Add(qrExpiry)
		}
	})
	h.publishEvent(map[string]string{
		"type":   "qr",
		"status": "waiting_for_qr",
		"qr":     qrCode,
	})
}

// publishEvent sends a JSON event to the Redis Pub/Sub channel for this tenant.
func (h *EventHandler) publishEvent(data map[string]string) {
	data["tenant_id"] = h.tenantID
	data["timestamp"] = time.Now().UTC().Format(time.RFC3339)

	payload, err := json.Marshal(data)
	if err != nil {
		log.Printf("Failed to marshal event for tenant %s: %v", h.tenantID, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	h.rdb.Raw().Publish(ctx, "strucureo:events:"+h.tenantID, string(payload))
}

// extractText recursively unwraps message content
func extractText(msg *events.Message) string {
	m := msg.Message
	// Unwrap ephemeral / view-once / document-with-caption layers. WhatsApp
	// wraps most media this way — without unwrapping, voice notes and
	// disappearing messages arrive as empty content and are silently dropped.
	for i := 0; i < 5; i++ {
		if m.GetEphemeralMessage() != nil && m.GetEphemeralMessage().GetMessage() != nil {
			m = m.GetEphemeralMessage().GetMessage()
			continue
		}
		if m.GetViewOnceMessage() != nil && m.GetViewOnceMessage().GetMessage() != nil {
			m = m.GetViewOnceMessage().GetMessage()
			continue
		}
		if m.GetViewOnceMessageV2() != nil && m.GetViewOnceMessageV2().GetMessage() != nil {
			m = m.GetViewOnceMessageV2().GetMessage()
			continue
		}
		if m.GetDocumentWithCaptionMessage() != nil && m.GetDocumentWithCaptionMessage().GetMessage() != nil {
			m = m.GetDocumentWithCaptionMessage().GetMessage()
			continue
		}
		break
	}
	if m.GetConversation() != "" {
		return m.GetConversation()
	}
	if m.GetExtendedTextMessage() != nil {
		return m.GetExtendedTextMessage().GetText()
	}
	if m.GetImageMessage() != nil {
		return m.GetImageMessage().GetCaption()
	}
	if m.GetVideoMessage() != nil {
		return m.GetVideoMessage().GetCaption()
	}
	if m.GetDocumentMessage() != nil {
		if c := m.GetDocumentMessage().GetCaption(); c != "" {
			return c
		}
		if f := m.GetDocumentMessage().GetFileName(); f != "" {
			return "[document: " + f + "]"
		}
		return "[document]"
	}
	if m.GetAudioMessage() != nil {
		if m.GetAudioMessage().GetPTT() {
			return "[voice message]"
		}
		return "[audio message]"
	}
	if m.GetStickerMessage() != nil {
		return "[sticker]"
	}
	if m.GetContactMessage() != nil {
		return "[contact: " + m.GetContactMessage().GetDisplayName() + "]"
	}
	if m.GetLocationMessage() != nil {
		return "[location]"
	}
	return ""
}
