import { fileURLToPath } from "node:url";
import { getEnv } from "./config/env.js";
import { getLogger } from "./lib/logger.js";
import { getPool, closePool } from "./db/pool.js";
import { gatewayHealth } from "./lib/gateway.js";

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const env = getEnv();
  const log = getLogger();
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "daemon") {
    await startDaemon(log);
  } else {
    const { runRepl } = await import("./cli/index.js");
    await runRepl();
  }
}

async function startDaemon(log: ReturnType<typeof getLogger>) {
  log.info("Strucureo daemon starting...");

  // 1. Initialize Postgres pool
  const pool = getPool();
  try {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT NOW() as time");
      log.info({ dbTime: result.rows[0].time }, "Postgres connected");
    } finally {
      client.release();
    }
  } catch (err) {
    log.fatal({ err }, "Failed to connect to Postgres");
    process.exit(1);
  }

  // 2. Verify gateway health
  const health = await gatewayHealth();
  if (health.ok) {
    log.info("Gateway connected");
  } else {
    // Not fatal: the gateway may still be starting, and inbound consumption does
    // not depend on it. The message now names the actual transport cause instead
    // of undici's generic "fetch failed".
    log.warn({ err: health.error }, "Gateway unreachable — will retry connections on demand");
  }

  // 3. Start inbound stream consumer
  const { startInboundConsumer } = await import("./agent/consumer.js");
  const consumerPromise = startInboundConsumer();

  log.info("Daemon ready. Listening for inbound messages.");

  // Keep process alive — consumer runs in background
  await consumerPromise;
}

// Graceful shutdown
process.on("SIGINT", async () => {
  const log = getLogger();
  log.info("SIGINT received, shutting down...");
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  const log = getLogger();
  log.info("SIGTERM received, shutting down...");
  await closePool();
  process.exit(0);
});

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
