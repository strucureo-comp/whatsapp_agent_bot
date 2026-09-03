import pg from "pg";
import { getEnv } from "@/config/env.js";

const { Pool } = pg;

let _pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!_pool) {
    const env = getEnv();
    const poolSize = parseInt(process.env.AGENT_POOL_SIZE || "20", 10);
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: poolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
