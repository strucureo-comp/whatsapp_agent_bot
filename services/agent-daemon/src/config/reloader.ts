import Redis from "ioredis";
import { getPool } from "@/db/pool.js";
import { getLogger } from "@/lib/logger.js";

/**
 * Config hot reload via Redis pub/sub.
 * The daemon subscribes to 'strucureo:config:reload' and invalidates its cache.
 */

const RELOAD_CHANNEL = "strucureo:config:reload";

export class ConfigReloader {
  private redis: Redis;
  private cache = new Map<string, { persona: string; tools: unknown[]; updatedAt: Date }>();
  private log = getLogger();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async start(): Promise<void> {
    await this.redis.subscribe(RELOAD_CHANNEL, (err) => {
      if (err) {
        this.log.error({ err }, "Failed to subscribe to config reload channel");
      } else {
        this.log.info("Subscribed to config reload channel");
      }
    });

    this.redis.on("message", (channel, message) => {
      if (channel === RELOAD_CHANNEL) {
        const tenantId = message.trim();
        this.log.info({ tenantId }, "Config reload requested");
        this.invalidate(tenantId);
      }
    });
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.log.debug({ tenantId }, "Config cache invalidated");
  }

  get(tenantId: string): { persona: string; tools: unknown[]; updatedAt: Date } | undefined {
    return this.cache.get(tenantId);
  }

  set(tenantId: string, persona: string, tools: unknown[]): void {
    this.cache.set(tenantId, { persona, tools, updatedAt: new Date() });
  }
}

/**
 * Publish a config reload event.
 */
export async function publishConfigReload(redis: Redis, tenantId: string): Promise<void> {
  await redis.publish(RELOAD_CHANNEL, tenantId);
}
