import { randomUUID } from "node:crypto";
import { getEnv } from "@/config/env.js";
import { getLogger } from "@/lib/logger.js";
import type { InboundMessage, AgentReply } from "./handle-message.js";

/**
 * Per-conversation lock using Redis SET NX PX.
 * Prevents concurrent processing of messages from the same conversation.
 */
export async function acquireConversationLock(
  redis: {
    set: (
      key: string,
      value: string,
      ...args: Array<string | number>
    ) => Promise<string | null>;
  },
  conversationId: string,
): Promise<string | null> {
  const token = randomUUID();
  // ioredis: SET key value PX <ms> NX — args must be separate, not "NX PX" as one.
  const result = await redis.set(
    `lock:conv:${conversationId}`,
    token,
    "PX",
    60000,
    "NX",
  );
  return result ? token : null;
}

export async function releaseConversationLock(
  redis: { eval: (script: string, numKeys: number, ...args: string[]) => Promise<unknown> },
  conversationId: string,
  token: string,
): Promise<void> {
  // Lua script for atomic check-and-delete.
  // ioredis style: EVAL script numkeys key [key ...] arg [arg ...].
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, `lock:conv:${conversationId}`, token);
}

/**
 * Debounce wrapper — waits `debounceMs` after the last message before processing.
 * Accumulates messages during the debounce window.
 */
export class Debouncer {
  private pending: Map<string, { timer: ReturnType<typeof setTimeout>; messages: InboundMessage[] }> = new Map();

  constructor(
    private debounceMs: number,
    private handler: (conversationId: string, messages: InboundMessage[]) => Promise<AgentReply>,
  ) {}

  addMessage(conversationId: string, message: InboundMessage): void {
    const existing = this.pending.get(conversationId);
    if (existing) {
      existing.messages.push(message);
      clearTimeout(existing.timer);
    } else {
      this.pending.set(conversationId, { timer: null!, messages: [message] });
    }

    const entry = this.pending.get(conversationId)!;
    entry.timer = setTimeout(async () => {
      this.pending.delete(conversationId);
      const msgs = entry.messages;
      try {
        await this.handler(conversationId, msgs);
      } catch (err) {
        getLogger().error({ conversationId, err }, "Debounced handler error");
      }
    }, this.debounceMs);
  }

  flush(conversationId: string): void {
    const entry = this.pending.get(conversationId);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(conversationId);
    }
  }
}
