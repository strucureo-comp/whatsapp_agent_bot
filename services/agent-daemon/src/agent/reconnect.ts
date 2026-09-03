import Redis from "ioredis";
import { getLogger } from "@/lib/logger.js";

/**
 * Reconnect storm handling — when gateway reconnects with N live sessions,
 * ensure all recover without overwhelming the system.
 */

export interface ReconnectOptions {
  maxConcurrentReconnects: number;
  backoffMs: number;
  maxBackoffMs: number;
}

const DEFAULT_OPTIONS: ReconnectOptions = {
  maxConcurrentReconnects: 5,
  backoffMs: 1000,
  maxBackoffMs: 30000,
};

export class ReconnectHandler {
  private redis: Redis;
  private options: ReconnectOptions;

  constructor(redis: Redis, options?: Partial<ReconnectOptions>) {
    this.redis = redis;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Handle a reconnect event from the gateway.
   * Uses exponential backoff to avoid overwhelming the system.
   */
  async handleReconnect(
    tenantId: string,
    sessionId: string,
  ): Promise<{ success: boolean; delayMs: number }> {
    const log = getLogger();
    const key = `reconnect:${tenantId}:${sessionId}`;
    const attemptsKey = `reconnect:attempts:${tenantId}:${sessionId}`;

    // Get current attempt count
    const attempts = parseInt((await this.redis.get(attemptsKey)) ?? "0");

    // Calculate delay with exponential backoff
    const delayMs = Math.min(
      this.options.backoffMs * Math.pow(2, attempts),
      this.options.maxBackoffMs,
    );

    // Check concurrent reconnect limit
    const activeKey = `reconnect:active`;
    const activeCount = parseInt((await this.redis.get(activeKey)) ?? "0");

    if (activeCount >= this.options.maxConcurrentReconnects) {
      log.warn(
        { tenantId, sessionId, activeCount },
        "Reconnect storm: too many concurrent reconnects",
      );
      return { success: false, delayMs };
    }

    // Increment active count
    await this.redis.incr(activeKey);
    await this.redis.pexpire(activeKey, delayMs + 5000);

    // Store reconnect state
    await this.redis.set(key, JSON.stringify({
      tenantId,
      sessionId,
      attempts: attempts + 1,
      lastAttempt: Date.now(),
    }), "PX", delayMs + 10000);

    // Increment attempts
    await this.redis.set(attemptsKey, (attempts + 1).toString(), "PX", 300000);

    log.info(
      { tenantId, sessionId, attempts: attempts + 1, delayMs },
      "Reconnect: scheduled",
    );

    return { success: true, delayMs };
  }

  /**
   * Mark a reconnect as complete.
   */
  async completeReconnect(
    tenantId: string,
    sessionId: string,
  ): Promise<void> {
    const key = `reconnect:${tenantId}:${sessionId}`;
    const attemptsKey = `reconnect:attempts:${tenantId}:${sessionId}`;

    await this.redis.del(key);
    await this.redis.del(attemptsKey);
    await this.redis.decr("reconnect:active");

    getLogger().info(
      { tenantId, sessionId },
      "Reconnect: completed",
    );
  }
}
