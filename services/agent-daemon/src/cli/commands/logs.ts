import inquirer from "inquirer";
import { getPool } from "@/db/pool.js";
import { startNotificationListener } from "@/db/notifications.js";
import { getLogger } from "@/lib/logger.js";

/**
 * Live log tailing via Postgres LISTEN/NOTIFY.
 * Excludes is_test conversations by default.
 */
export async function logsCommand() {
  const pool = getPool();
  const log = getLogger();

  const { tenantId } = await inquirer.prompt([
    {
      type: "input",
      name: "tenantId",
      message: "Tenant ID (leave empty for all):",
      default: "",
    },
  ]);

  const { excludeTest } = await inquirer.prompt([
    {
      type: "confirm",
      name: "excludeTest",
      message: "Exclude test conversations?",
      default: true,
    },
  ]);

  console.log("\nListening for new messages... (Ctrl+C to stop)\n");

  // Set up notification listener
  const client = await pool.connect();
  startNotificationListener(client);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nStopping log tail...");
    client.release();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}
