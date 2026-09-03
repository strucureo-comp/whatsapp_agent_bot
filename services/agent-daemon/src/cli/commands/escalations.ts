import inquirer from "inquirer";
import { getPool } from "@/db/pool.js";

/**
 * List open escalations for a tenant.
 */
export async function escalationsList() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const { tenantId } = await inquirer.prompt([
      {
        type: "input",
        name: "tenantId",
        message: "Tenant ID:",
      },
    ]);

    const result = await client.query(
      `SELECT e.*, c.customer_number, c.customer_jid
       FROM escalations e
       JOIN conversations c ON e.conversation_id = c.id
       WHERE e.tenant_id = $1 AND e.status = 'open'
       ORDER BY e.created_at DESC`,
      [tenantId],
    );

    if (result.rows.length === 0) {
      console.log("No open escalations.");
      return;
    }

    console.log(`\nOpen escalations for ${tenantId}:\n`);
    for (const row of result.rows) {
      console.log(`  ID: ${row.id}`);
      console.log(`  Customer: ${row.customer_number}`);
      console.log(`  Reason: ${row.reason}`);
      console.log(`  Created: ${row.created_at}`);
      console.log();
    }
  } finally {
    client.release();
  }
}

/**
 * Resolve an escalation, handing control back to the bot.
 */
export async function escalationsResolve() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const { escalationId } = await inquirer.prompt([
      {
        type: "input",
        name: "escalationId",
        message: "Escalation ID to resolve:",
      },
    ]);

    // Get escalation details
    const escResult = await client.query(
      "SELECT * FROM escalations WHERE id = $1",
      [escalationId],
    );

    if (escResult.rows.length === 0) {
      console.log("Escalation not found.");
      return;
    }

    const escalation = escResult.rows[0];

    // Resolve escalation
    await client.query(
      "UPDATE escalations SET status = 'resolved', resolved_at = NOW() WHERE id = $1",
      [escalationId],
    );

    // Set conversation back to active
    await client.query(
      "UPDATE conversations SET status = 'active' WHERE id = $1",
      [escalation.conversation_id],
    );

    console.log(`Escalation ${escalationId} resolved. Conversation back to bot.`);
  } finally {
    client.release();
  }
}
