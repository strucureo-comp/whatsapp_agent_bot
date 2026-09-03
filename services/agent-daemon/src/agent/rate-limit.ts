import Redis from "ioredis";
import { getEnv } from "@/config/env.js";
import { getLogger } from "@/lib/logger.js";

/**
 * Redis sliding-window rate limiter per customer number.
 * Uses sorted sets for precise sliding window counting.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Remove old entries
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count current entries
  const count = await redis.zcard(key);

  if (count >= limit) {
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const retryAfterMs =
      oldest.length >= 2
        ? parseInt(oldest[1]) + windowMs - now
        : windowMs;

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, retryAfterMs),
    };
  }

  // Add current request
  await redis.zadd(key, now.toString(), `${now}-${Math.random()}`);
  await redis.pexpire(key, windowMs);

  return {
    allowed: true,
    remaining: limit - count - 1,
  };
}

/**
 * Per-tenant spend cap enforcement.
 * Checks if the tenant has exceeded their monthly spend limit.
 */
export async function checkSpendCap(
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: { max_monthly_spend_cents: number }[] }> },
  tenantId: string,
): Promise<{ allowed: boolean; spendCents: number; capCents: number }> {
  const result = await pool.query(
    "SELECT max_monthly_spend_cents FROM tenants WHERE id = $1",
    [tenantId],
  );

  const cap = result.rows[0]?.max_monthly_spend_cents ?? 10000;

  // Sum usage_json from messages this month
  const spendResult = await pool.query(
    `SELECT COALESCE(SUM(
      (usage_json->>'input_tokens')::int * 2 +
      (usage_json->>'output_tokens')::int * 10
    ), 0) as total_cents
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE c.tenant_id = $1
       AND m.created_at >= date_trunc('month', now())
       AND m.role = 'assistant'`,
    [tenantId],
  );

  const spendCents = spendResult.rows[0]?.total_cents ?? 0;

  return {
    allowed: spendCents < cap,
    spendCents,
    capCents: cap,
  };
}
