package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"

	goredis "strucureo-gateway/internal/redis"
)

const (
	// outboundGroup is the gateway's consumer group on outbound:<tenant>. It has to
	// stay distinct from the daemon's "agent" group on inbound:<tenant>.
	outboundGroup = "gateway"

	outboundBlock    = 5 * time.Second
	outboundBatch    = 10
	outboundMaxTries = 3
	outboundIdleWait = 2 * time.Second
)

var nonDigits = regexp.MustCompile(`\D`)

// SenderPool runs one goroutine per tenant, draining outbound:<tenant> and
// delivering each entry over that tenant's WhatsApp connection.
//
// Nothing used to read that stream. /messages/send wrote it and answered
// {"status":"queued"}, and every agent reply and escalation notice stopped there.
type SenderPool struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc

	ctx       context.Context
	rdb       *goredis.Client
	clientMgr *ClientManager
}

func NewSenderPool(ctx context.Context, rdb *goredis.Client, clientMgr *ClientManager) *SenderPool {
	return &SenderPool{
		cancels:   make(map[string]context.CancelFunc),
		ctx:       ctx,
		rdb:       rdb,
		clientMgr: clientMgr,
	}
}

// Start launches the outbound worker for a tenant. It is idempotent, so calling
// it again after a later pairing or reconnect costs nothing.
func (p *SenderPool) Start(tenantID string) {
	p.mu.Lock()
	if _, running := p.cancels[tenantID]; running || p.ctx.Err() != nil {
		p.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(p.ctx)
	p.cancels[tenantID] = cancel
	p.mu.Unlock()

	log.Printf("Outbound sender started for tenant %s", tenantID)

	go func() {
		// This goroutine is ours, not whatsmeow's, so nothing else recovers it and an
		// unrecovered panic here would take the whole gateway down.
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC in outbound sender for tenant %s: %v", tenantID, r)
			}
		}()
		defer p.forget(tenantID)
		p.run(ctx, tenantID)
	}()
}

// Stop halts the worker for a tenant, if one is running.
func (p *SenderPool) Stop(tenantID string) {
	p.mu.Lock()
	cancel, ok := p.cancels[tenantID]
	delete(p.cancels, tenantID)
	p.mu.Unlock()

	if ok {
		cancel()
		log.Printf("Outbound sender stopped for tenant %s", tenantID)
	}
}

func (p *SenderPool) forget(tenantID string) {
	p.mu.Lock()
	delete(p.cancels, tenantID)
	p.mu.Unlock()
}

// StartAll launches a worker for every tenant with persisted WhatsApp state,
// reusing ClientManager's database enumeration rather than adding a second
// discovery mechanism.
func (p *SenderPool) StartAll(ctx context.Context) error {
	tenants, err := p.clientMgr.ListTenants(ctx)
	if err != nil {
		return err
	}
	for _, tenantID := range tenants {
		p.Start(tenantID)
	}
	return nil
}

func (p *SenderPool) run(ctx context.Context, tenantID string) {
	stream := "outbound:" + tenantID
	consumer := "gateway-" + tenantID

	// MkStream so the group exists before the daemon's first write; BUSYGROUP just
	// means an earlier run already created it.
	if err := p.rdb.Raw().XGroupCreateMkStream(ctx, stream, outboundGroup, "0").Err(); err != nil &&
		!strings.Contains(err.Error(), "BUSYGROUP") {
		log.Printf("Outbound sender for %s: create group: %v", tenantID, err)
		return
	}

	// "0" replays this consumer's pending list — entries a previous process read but
	// never acked. Once that backlog drains, follow the live tail with ">".
	cursor := "0"

	for ctx.Err() == nil {
		res, err := p.rdb.Raw().XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    outboundGroup,
			Consumer: consumer,
			Streams:  []string{stream, cursor},
			Count:    outboundBatch,
			Block:    outboundBlock,
		}).Result()

		if err == redis.Nil {
			// Block elapsed with nothing new.
			cursor = ">"
			continue
		}
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("Outbound sender for %s: read: %v", tenantID, err)
			if !sleepCtx(ctx, time.Second) {
				return
			}
			continue
		}

		var read, deferred int
		for _, s := range res {
			for _, msg := range s.Messages {
				read++
				if !p.deliver(ctx, tenantID, stream, msg) {
					deferred++
				}
			}
		}

		switch {
		case deferred > 0:
			// The tenant is not logged in. Those entries stay in the pending list, so
			// re-read from "0" to pick them up again once the socket is back — and wait
			// rather than spinning on a session that is still down.
			cursor = "0"
			if !sleepCtx(ctx, outboundIdleWait) {
				return
			}
		case cursor == "0" && read == 0:
			// Backlog drained (XREADGROUP with an explicit ID ignores BLOCK, so this
			// returned immediately).
			cursor = ">"
		}
	}
}

// deliver sends one stream entry. It returns false when the entry was left in the
// pending list for a later attempt, and true once the entry has been acked —
// whether it went out, was malformed, or is permanently undeliverable.
func (p *SenderPool) deliver(ctx context.Context, tenantID, stream string, msg redis.XMessage) bool {
	to, _ := msg.Values["to"].(string)
	body, _ := msg.Values["body"].(string)

	if to == "" || body == "" {
		log.Printf("Outbound %s: dropping malformed entry %s", tenantID, msg.ID)
		p.ack(stream, msg.ID)
		return true
	}

	jid, err := parseRecipient(to)
	if err != nil {
		log.Printf("Outbound %s: dropping entry %s: %v", tenantID, msg.ID, err)
		p.ack(stream, msg.ID)
		return true
	}

	client := p.clientMgr.GetClient(tenantID)
	if client == nil || !client.IsLoggedIn() {
		// Not a delivery failure — the session simply is not up yet. Leaving the entry
		// pending is what makes a reply survive a gateway restart mid-conversation.
		return false
	}

	var lastErr error
	for attempt := 1; attempt <= outboundMaxTries; attempt++ {
		if _, lastErr = client.SendMessage(ctx, jid, &waE2E.Message{Conversation: &body}); lastErr == nil {
			log.Printf("Delivered outbound %s to %s for tenant %s", msg.ID, jid, tenantID)
			p.ack(stream, msg.ID)
			return true
		}
		if attempt < outboundMaxTries && !sleepCtx(ctx, time.Duration(attempt)*time.Second) {
			return false
		}
	}

	// Ack regardless: one undeliverable recipient must not wedge the tenant's whole
	// stream. Say so loudly, because the daemon already read 200 from
	// /messages/send and believes this was delivered.
	log.Printf("Outbound %s: giving up on %s after %d attempts: %v",
		tenantID, msg.ID, outboundMaxTries, lastErr)
	p.publishFailure(tenantID, to, lastErr)
	p.ack(stream, msg.ID)
	return true
}

// ack uses its own short-lived context: a shutdown landing mid-send must not lose
// the acknowledgement of a message that did go out.
func (p *SenderPool) ack(stream, id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := p.rdb.Raw().XAck(ctx, stream, outboundGroup, id).Err(); err != nil {
		log.Printf("Outbound: ack %s on %s failed: %v", id, stream, err)
	}
}

// publishFailure tells the SSE stream that a queued reply never made it, since
// the HTTP caller was answered "queued" long before this point.
func (p *SenderPool) publishFailure(tenantID, to string, cause error) {
	msg := "unknown error"
	if cause != nil {
		msg = cause.Error()
	}

	payload, err := json.Marshal(map[string]string{
		"type":      "send_failed",
		"status":    "send_failed",
		"tenant_id": tenantID,
		"to":        to,
		"error":     msg,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	p.rdb.Raw().Publish(ctx, "strucureo:events:"+tenantID, string(payload))
}

// parseRecipient turns an outbound "to" value into a JID. types.ParseJID on a
// bare MSISDN reads it as a *server* — "919344275731" yields
// {User:"", Server:"919344275731"} — so a number without an @ has to be
// assembled explicitly.
func parseRecipient(to string) (types.JID, error) {
	to = strings.TrimSpace(to)

	if strings.Contains(to, "@") {
		jid, err := types.ParseJID(to)
		if err != nil {
			return types.EmptyJID, fmt.Errorf("parse jid %q: %w", to, err)
		}
		return jid.ToNonAD(), nil
	}

	digits := nonDigits.ReplaceAllString(to, "")
	if len(digits) < 7 {
		return types.EmptyJID, fmt.Errorf("recipient %q is not a usable phone number", to)
	}
	return types.NewJID(digits, types.DefaultUserServer), nil
}

// sleepCtx waits for d, returning false when the context was cancelled first.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
