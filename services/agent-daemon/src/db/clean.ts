import pg from "pg";
import { Redis } from "ioredis";
import { getEnv } from "@/config/env.js";
import { getPool, closePool } from "./pool.js";

/**
 * Clean all testing sessions, whatsmeow databases, and test chat data.
 * Leaves tenant configurations intact for production readiness.
 */
export async function cleanTestingData(): Promise<void> {
  const env = getEnv();
  const pool = getPool();

  console.log("🧹 Starting production database cleanup...");

  try {
    // 1. Drop any whatsmeow_* databases
    const dbsRes = await pool.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'whatsmeow_%'"
    );
    for (const row of dbsRes.rows) {
      const dbName = row.datname;
      console.log(`Dropping test session database: ${dbName}`);
      await pool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [dbName]
      );
      await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    }

    // 2. Clear testing tables
    const ws = await pool.query("DELETE FROM whatsapp_sessions");
    const msg = await pool.query("DELETE FROM messages");
    const esc = await pool.query("DELETE FROM escalations");
    const tkt = await pool.query("DELETE FROM tickets");
    const aud = await pool.query("DELETE FROM audit_log");
    const conv = await pool.query("DELETE FROM conversations");

    console.log("✅ PostgreSQL tables cleaned:", {
      whatsmeow_dbs_dropped: dbsRes.rows.length,
      whatsapp_sessions: ws.rowCount,
      messages: msg.rowCount,
      conversations: conv.rowCount,
      escalations: esc.rowCount,
      tickets: tkt.rowCount,
      audit_log: aud.rowCount,
    });
  } catch (err) {
    console.error("❌ Postgres cleanup error:", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await closePool();
  }

  // 3. Redis flush
  try {
    const redis = new Redis(env.REDIS_URL);
    const flushRes = await redis.flushdb();
    console.log("✅ Redis database flushed:", flushRes);
    redis.disconnect();
  } catch (err) {
    console.error("❌ Redis cleanup error:", err instanceof Error ? err.message : String(err));
  }

  console.log("🚀 All testing database sessions and queues cleared for production.");
}

cleanTestingData().catch((err) => {
  console.error(err);
  process.exit(1);
});
