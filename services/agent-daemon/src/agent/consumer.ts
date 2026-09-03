import { getLogger } from "@/lib/logger.js";
import { getEnv } from "@/config/env.js";
import { getPool } from "@/db/pool.js";
import { getOrCreateConversation } from "@/repos/conversation.js";
import { handleMessage } from "@/agent/handle-message.js";
import { sendText } from "@/channel/index.js";
import { acquireConversationLock, releaseConversationLock } from "@/agent/concurrency.js";
import Redis from "ioredis";

interface RawInbound {
  streamId: string;
  message_id: string;
  from_jid: string;
  pushname: string;
  content: string;
  timestamp: number;
  addressing_mode: string;
}

interface PendingBatch {
  messages: RawInbound[];
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Inbound stream consumer — reads from Redis Streams and processes messages.
 * - Burst coalescing: rapid messages from the same sender are batched into one turn.
 * - Exactly-once intent: only XACK after successful handle + send. Failures and
 *   lock contention leave entries pending for XAUTOCLAIM retry.
 */
export async function startInboundConsumer() {
  const log = getLogger();
  const env = getEnv();
  const redis = new Redis(env.REDIS_URL);
  const pool = getPool();

  log.info("Inbound consumer started");

  // Discover active tenants and subscribe to their streams
  const client = await pool.connect();
  let tenantIds: string[];
  try {
    const result = await client.query("SELECT id FROM tenants");
    tenantIds = result.rows.map((r) => r.id);
  } finally {
    client.release();
  }

  if (tenantIds.length === 0) {
    log.warn("No tenants found — consumer idle");
  } else {
    log.info({ tenantCount: tenantIds.length }, "Subscribed to tenant streams");
  }

  // Start a consumer loop for each tenant
  const running = new Set<string>();
  const startTenant = (tenantId: string) => {
    if (running.has(tenantId)) return;
    running.add(tenantId);
    void consumeTenant(redis, pool, tenantId, log);
  };
  tenantIds.forEach(startTenant);

  // Periodically refresh tenant list (new tenants may be added)
  const refreshInterval = setInterval(async () => {
    const c = await pool.connect();
    try {
      const result = await c.query("SELECT id FROM tenants");
      const currentIds: string[] = result.rows.map((r) => r.id);
      for (const id of currentIds) {
        if (!running.has(id)) {
          log.info({ tenantId: id }, "New tenant detected, starting consumer");
          startTenant(id);
        }
      }
    } catch (err) {
      log.warn({ err }, "Tenant refresh failed");
    } finally {
      c.release();
    }
  }, 30_000);

  // Keep alive until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      clearInterval(refreshInterval);
      resolve();
    });
    process.on("SIGTERM", () => {
      clearInterval(refreshInterval);
      resolve();
    });
  });

  // Cleanup
  redis.disconnect();
}

async function getDebounceMs(
  pool: ReturnType<typeof getPool>,
  tenantId: string,
): Promise<number> {
  try {
    const c = await pool.connect();
    try {
      const r = await c.query("SELECT debounce_ms FROM tenants WHERE id = $1", [tenantId]);
      const v = r.rows[0]?.debounce_ms;
      const n = typeof v === "number" ? v : parseInt(String(v ?? "2500"), 10);
      return Number.isFinite(n) && n >= 0 ? n : 2500;
    } finally {
      c.release();
    }
  } catch {
    return 2500;
  }
}

async function consumeTenant(
  redis: Redis,
  pool: ReturnType<typeof getPool>,
  tenantId: string,
  log: ReturnType<typeof getLogger>,
) {
  const env = getEnv();
  // Dedicated blocking connection so BLOCK doesn't stall lock/ack commands.
  const reader = new Redis(env.REDIS_URL);
  const consumerName = `consumer-${tenantId.slice(0, 8)}`;
  const groupName = "agent";
  const streamKey = `inbound:${tenantId}`;
  const batches = new Map<string, PendingBatch>();

  // Ensure consumer group exists
  try {
    await reader.xgroup("CREATE", streamKey, groupName, "0", "MKSTREAM");
  } catch {
    // Group already exists — that's fine
  }

  log.debug({ tenantId, consumer: consumerName }, "Consumer loop started");

  // Recover entries left pending by a dead consumer (crash safety).
  const recoverPending = async () => {
    try {
      // XAUTOCLAIM idle >60s, up to 10 at a time. Use the writer so a
      // BLOCKed reader never delays recovery.
      const res = (await redis.xautoclaim(
        streamKey,
        groupName,
        consumerName,
        60_000,
        "0-0",
        "COUNT",
        10,
      )) as unknown as [string, Array<[string, Record<string, string>]>];
      const claimed = res?.[1] ?? [];
      for (const [id, rawFields] of claimed) {
        const parsed = parseStreamMessage(id, toFieldMap(rawFields));
        if (!parsed.content) {
          await redis.xack(streamKey, groupName, id);
          continue;
        }
        bufferMessage(parsed);
      }
    } catch (err) {
      log.debug({ tenantId, err }, "Pending recovery sweep failed");
    }
  };
  const recoverTimer = setInterval(() => void recoverPending(), 30_000);

  const bufferMessage = (msg: RawInbound) => {
    const key = msg.from_jid || "unknown";
    let batch = batches.get(key);
    if (!batch) {
      batch = { messages: [], timer: null };
      batches.set(key, batch);
    }
    batch.messages.push(msg);
    if (batch.timer) clearTimeout(batch.timer);
    // Debounce is per-tenant; fetch once per batch flush to avoid a DB hit per message.
    batch.timer = setTimeout(() => {
      void (async () => {
        batches.delete(key);
        const toProcess = batch.messages;
        batch.messages = [];
        await processBatch(tenantId, toProcess, redis, pool, streamKey, groupName);
      })();
    }, 2500);
    // Refresh the delay with the tenant's configured value (fire-and-forget).
    void getDebounceMs(pool, tenantId).then((ms) => {
      const current = batches.get(key);
      if (current && current.timer && ms !== 2500) {
        clearTimeout(current.timer);
        current.timer = setTimeout(() => {
          batches.delete(key);
          const toProcess = current.messages;
          current.messages = [];
          void processBatch(tenantId, toProcess, redis, pool, streamKey, groupName);
        }, ms);
      }
    });
  };

  try {
    while (true) {
      let results: Array<[string, Array<[string, Record<string, string>]>]> | null = null;
      try {
        results = (await reader.xreadgroup(
          "GROUP",
          groupName,
          consumerName,
          "COUNT",
          10,
          "BLOCK",
          5000,
          "STREAMS",
          streamKey,
          ">",
        )) as unknown as typeof results;
      } catch (err) {
        log.error({ tenantId, err }, "Consumer loop error, retrying in 5s");
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [id, rawFields] of messages) {
          try {
            const parsed = parseStreamMessage(id, toFieldMap(rawFields));
            if (!parsed.content || !parsed.from_jid) {
              // Malformed — ack to avoid poison-pill loop.
              log.warn({ tenantId, messageId: id }, "Acking malformed inbound entry");
              await redis.xack(streamKey, groupName, id);
              continue;
            }
            bufferMessage(parsed);
          } catch (err) {
            log.error({ tenantId, messageId: id, err }, "Failed to buffer message");
            // Do NOT ack — leave pending for retry via XAUTOCLAIM.
          }
        }
      }
    }
  } finally {
    clearInterval(recoverTimer);
    reader.disconnect();
  }
}

/**
 * Idle session window: a conversation quiet longer than this gets a fresh
 * turn with no history (old context stops leaking into new topics).
 * Storage keeps everything — this only scopes the model's context.
 */
const SESSION_WINDOW_MS = 120_000;

async function processBatch(
  tenantId: string,
  batch: RawInbound[],
  redis: Redis,
  pool: ReturnType<typeof getPool>,
  streamKey: string,
  groupName: string,
) {
  const log = getLogger();
  if (batch.length === 0) return;
  const fromJid = batch[0].from_jid;

  // Short-lived client: do not hold a pool slot across the LLM call.
  const lookup = await pool.connect();
  let conversationId: string;
  try {
    // First sender pushname wins for the display name; manual renames in the
    // dashboard are preserved because empty pushnames never overwrite.
    const pushname = batch.map((m) => m.pushname).find((n) => n) ?? "";
    const conversation = await getOrCreateConversation(
      lookup,
      tenantId,
      fromJid,
      fromJid,
      false,
      pushname,
    );
    conversationId = conversation.id;
  } catch (err) {
    log.error({ tenantId, err }, "Failed to resolve conversation, leaving pending");
    return;
  } finally {
    lookup.release();
  }

  // Acquire per-conversation lock — on contention leave pending for retry.
  let lockToken: string | null = null;
  try {
    lockToken = await acquireConversationLock(redis, conversationId);
  } catch (err) {
    log.warn({ tenantId, conversationId, err }, "Lock acquire failed, leaving pending");
    return;
  }
  if (!lockToken) {
    log.debug({ tenantId, conversationId }, "Lock contention, leaving pending for reclaim");
    return;
  }

  try {
    const batchMsgs = batch.map((m) => ({
      message_id: m.message_id,
      content: m.content,
      timestamp: m.timestamp,
    }));
    const sentTimes = batchMsgs
      .map((m) => (typeof m.timestamp === "number" && m.timestamp > 0 ? m.timestamp * 1000 : 0))
      .filter((t) => t > 0);

    // Fresh session when the last completed turn is older than the window.
    // Missing stamp = brand-new conversation (history is empty anyway).
    let freshSession = false;
    try {
      const last = await redis.get(`sess:${conversationId}`);
      freshSession = last !== null && Date.now() - Number(last) > SESSION_WINDOW_MS;
    } catch (err) {
      log.warn({ tenantId, conversationId, err }, "Session stamp read failed, assuming active");
    }

    const reply = await handleMessage(tenantId, conversationId, batchMsgs, {
      nowMs: sentTimes.length > 0 ? Math.max(...sentTimes) : undefined,
      freshSession,
    });

    // Stamp every completed turn (replied or human-skipped) so idle time
    // is measured from real activity.
    try {
      await redis.set(`sess:${conversationId}`, String(Date.now()), "PX", 86_400_000);
    } catch (err) {
      log.warn({ tenantId, conversationId, err }, "Session stamp write failed");
    }
    // skipped = human/escalated mode: inbound saved, nothing to send.
    // Empty replies are never sent either (gateway 400s them into a poison loop).
    if (!reply.skipped && reply.content.trim()) {
      await sendText(tenantId, fromJid, reply.content);
    } else if (!reply.content.trim()) {
      log.warn({ tenantId, conversationId }, "Empty reply suppressed, entry acked");
    }
    // Only ack after successful handle + send — this is the exactly-once intent.
    // Use the non-blocking connection: reader may be parked in XREADGROUP BLOCK.
    for (const m of batch) {
      try {
        await redis.xack(streamKey, groupName, m.streamId);
      } catch (err) {
        log.warn({ tenantId, messageId: m.streamId, err }, "XACK failed after send");
      }
    }
  } catch (err) {
    log.error({ tenantId, conversationId, err }, "Batch processing failed, leaving pending");
    // No ack — pending entries will be reclaimed via XAUTOCLAIM.
  } finally {
    try {
      await releaseConversationLock(redis, conversationId, lockToken);
    } catch (err) {
      log.warn({ tenantId, conversationId, err }, "Lock release failed");
    }
  }
}

/**
 * ioredis returns stream fields as a flat array
 * ["k1","v1","k2","v2",...], not an object. Normalize both shapes —
 * treating the array as an object yields all-undefined and every inbound
 * was being acked as "malformed" (inbound never worked).
 */
function toFieldMap(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) {
      out[String(raw[i])] = raw[i + 1] == null ? "" : String(raw[i + 1]);
    }
    return out;
  }
  return ((raw ?? {}) as Record<string, string>);
}

function parseStreamMessage(id: string, fields: Record<string, string>): RawInbound {
  return {
    streamId: id,
    message_id: fields.message_id || id,
    from_jid: fields.from_jid || fields.phone || "",
    pushname: fields.pushname || "",
    content: fields.content || "",
    timestamp: parseInt(fields.timestamp || "0", 10),
    addressing_mode: fields.addressing_mode || "pn",
  };
}
