import { config } from "dotenv";
config({ path: "../../.env" });
import { getPool } from "./db";
import { getOverviewStats } from "./queries";

async function run() {
  try {
    console.log("Testing getOverviewStats...");
    const stats = await getOverviewStats("test-uid-123");
    console.log("Stats:", stats);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

run();
