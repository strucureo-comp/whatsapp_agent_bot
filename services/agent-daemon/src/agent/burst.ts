/**
 * Burst coalescing — multiple messages in a short window result in one agent turn.
 * Uses Redis to track pending messages per conversation.
 */

import Redis from "ioredis";
import { getLogger } from "@/lib/logger.js";

export class BurstCoalescer {
  private redis: Redis;
  private debounceMs: number;

  constructor(redis: Redis, debounceMs: number = 2500) {
    this.redis = redis;
    this.debounceMs = debounceMs;
  }

  /**
   * Add a message to the coalescer.
   * Returns true if this message should trigger an agent turn (after debounce).
   */
  async addMessage(
    tenantId: string,
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<{ shouldProcess: boolean; messages: Array<{ message_id: string; content: string }> }> {
    const log = getLogger();
    const key = `burst:${tenantId}:${conversationId}`;
    const lockKey = `burst:lock:${tenantId}:${conversationId}`;

    // Add message to pending list
    await this.redis.hset(key, messageId, content);
    await this.redis.pexpire(key, this.debounceMs * 2);

    // Try to acquire lock for processing
    const acquired = await this.redis.set(lockKey, "1", "PX", this.debounceMs, "NX");

    if (acquired) {
      // Wait for debounce period
      await new Promise((resolve) => setTimeout(resolve, this.debounceMs));

      // Collect all pending messages
      const pending = await this.redis.hgetall(key);
      const messages = Object.entries(pending).map(([id, content]) => ({
        message_id: id,
        content,
      }));

      // Clear pending messages
      await this.redis.del(key);
      await this.redis.del(lockKey);

      log.debug(
        { tenantId, conversationId, messageCount: messages.length },
        "Burst coalescer: processing batch",
      );

      return { shouldProcess: true, messages };
    }

    // Another instance is handling the debounce
    return { shouldProcess: false, messages: [] };
  }
}
