package redis

import (
	"context"
	"encoding"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type Client struct {
	rdb *redis.Client
}

func NewClient(url string) *Client {
	opts, err := redis.ParseURL(url)
	if err != nil {
		opts = &redis.Options{Addr: "127.0.0.1:6379"}
	}
	return &Client{rdb: redis.NewClient(opts)}
}

func (c *Client) Ping(ctx context.Context) *redis.StatusCmd {
	return c.rdb.Ping(ctx)
}

func (c *Client) Raw() *redis.Client {
	return c.rdb
}

// XADD publishes an inbound message to a Redis Stream.
//
// Values pass through normalizeValues first: go-redis's arg writer has a case for
// string but no reflection fallback, so a *named* string type (whatsmeow's
// types.AddressingMode, for one) fails the entire command with
// "redis: can't marshal ...". Callers get a usable command instead of a silent drop.
func (c *Client) XADD(ctx context.Context, tenantID string, values map[string]interface{}) *redis.StringCmd {
	return c.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: "inbound:" + tenantID,
		Values: normalizeValues(values),
	})
}

// normalizeValues converts values go-redis cannot marshal into ones it can,
// leaving the types it handles natively untouched.
func normalizeValues(values map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(values))
	for k, v := range values {
		out[k] = normalizeValue(v)
	}
	return out
}

func normalizeValue(v interface{}) interface{} {
	switch v.(type) {
	case nil, string, []byte, int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64, float32, float64, bool,
		time.Time, time.Duration, encoding.BinaryMarshaler:
		return v
	}

	// Anything else that is a named version of a supported kind is converted rather
	// than rejected at write time.
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.String:
		return rv.String()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return rv.Uint()
	case reflect.Float32, reflect.Float64:
		return rv.Float()
	case reflect.Bool:
		return rv.Bool()
	default:
		return fmt.Sprint(v)
	}
}

// XREADGROUP reads outbound messages for a consumer group. block is honoured —
// it used to be hardcoded to 0, which blocks forever and ignores the caller's
// shutdown budget entirely.
func (c *Client) XREADGROUP(ctx context.Context, tenantID, group, consumer string, count int64, block time.Duration) *redis.XStreamSliceCmd {
	return c.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{"outbound:" + tenantID, ">"},
		Count:    count,
		Block:    block,
	})
}

// XACK acknowledges a message
func (c *Client) XACK(ctx context.Context, tenantID, group, id string) *redis.IntCmd {
	return c.rdb.XAck(ctx, "outbound:"+tenantID, group, id)
}

// Publish sends a config reload notification
func (c *Client) Publish(ctx context.Context, tenantID string) *redis.IntCmd {
	return c.rdb.Publish(ctx, "strucureo:config:reload", tenantID)
}

// sendersKey holds the set of numbers that have messaged a tenant. A set is what
// makes the unsolicited-outbound check O(1) and unbounded in history; the old
// 100-entry stream scan silently started refusing replies to anyone whose message
// had scrolled past entry 100.
func sendersKey(tenantID string) string {
	return "senders:" + tenantID
}

// RememberSender records that a number has messaged this tenant, which is what
// authorizes a later reply to it.
func (c *Client) RememberSender(ctx context.Context, tenantID, jid string) *redis.IntCmd {
	return c.rdb.SAdd(ctx, sendersKey(tenantID), normalizeMSISDN(jid))
}

// normalizeMSISDN reduces a JID or phone number to bare digits, so the stored
// from_jid "919344275731@s.whatsapp.net" matches an outbound "to" of
// "+919344275731" — the mismatch that made every staff escalation 403.
func normalizeMSISDN(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '@'); i >= 0 {
		s = s[:i]
	}
	// Strip a device/agent suffix such as ":12" left by a non-normalized JID.
	if i := strings.IndexByte(s, ':'); i >= 0 {
		s = s[:i]
	}
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// HasInboundMessage reports whether a recipient has ever messaged this tenant.
// Used for unsolicited outbound enforcement: only allow replies to known senders.
func (c *Client) HasInboundMessage(ctx context.Context, tenantID, recipient string) (bool, error) {
	number := normalizeMSISDN(recipient)
	if number == "" {
		return false, nil
	}

	ok, err := c.rdb.SIsMember(ctx, sendersKey(tenantID), number).Result()
	if err != nil && err != redis.Nil {
		return false, err
	}
	if ok {
		return true, nil
	}

	// Fall back to the stream for conversations that predate the set, newest first
	// so an active chat is found in the first few entries.
	entries, err := c.rdb.XRevRangeN(ctx, "inbound:"+tenantID, "+", "-", 500).Result()
	if err != nil {
		if err == redis.Nil {
			return false, nil
		}
		return false, err
	}

	for _, msg := range entries {
		from, _ := msg.Values["from_jid"].(string)
		if from == "" {
			from, _ = msg.Values["phone"].(string)
		}
		if normalizeMSISDN(from) == number {
			// Backfill so the next check is a set lookup.
			c.rdb.SAdd(ctx, sendersKey(tenantID), number)
			return true, nil
		}
	}

	return false, nil
}
