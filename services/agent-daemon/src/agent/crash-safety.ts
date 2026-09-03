/**
 * Crash safety — ensure exactly one reply after a mid-turn crash.
 * Uses Redis to track in-progress turns and detect orphaned processing.
 */

import Redis from "ioredis";
import { getLogger } from "@/lib/logger.js";
import { randomUUID } from "node:crypto";

export class CrashSafety {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Acquire a processing lock for a conversation.
   * Returns a token if acquired, null if already locked.
   */
  async acquireLock(
    tenantId: string,
    conversationId: string,
  ): Promise<string | null> {
    const key = `crash:lock:${tenantId}:${conversationId}`;
    const token = randomUUID();

    const acquired = await this.redis.set(key, token, "PX", 120_000, "NX");
    return acquired ? token : null;
  }

  /**
   * Release a processing lock.
   */
  async releaseLock(
    tenantId: string,
    conversationId: string,
    token: string,
  ): Promise<void> {
    const key = `crash:lock:${tenantId}:${conversationId}`;

    // Only release if we still own it
    const current = await this.redis.get(key);
    if (current === token) {
      await this.redis.del(key);
    }
  }

  /**
   * Check if a conversation has an orphaned lock (crash detected).
   */
  async hasOrphanedLock(
    tenantId: string,
    conversationId: string,
  ): Promise<boolean> {
    const key = `crash:lock:${tenantId}:${conversationId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Force release an orphaned lock.
   */
  async forceReleaseLock(
    tenantId: string,
    conversationId: string,
  ): Promise<void> {
    const key = `crash:lock:${tenantId}:${conversationId}`;
    await this.redis.del(key);
    getLogger().warn(
      { tenantId, conversationId },
      "Force released orphaned crash lock",
    );
  }
}
