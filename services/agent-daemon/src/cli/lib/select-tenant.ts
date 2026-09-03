import inquirer from "inquirer";
import { getPool } from "@/db/pool.js";
import { listTenants } from "@/repos/tenant.js";
import { getActiveTenantId } from "../active-tenant.js";

/**
 * Return the active tenant id, prompting only when ambiguous.
 *
 * If `tenant use` has been run this session the stored id is returned
 * immediately. Otherwise the user picks from a list.
 *
 * Returns null when there are no tenants to choose from.
 */
export async function selectTenant(
  message = "Select tenant:",
): Promise<string | null> {
  const active = getActiveTenantId();
  if (active) return active;

  const pool = getPool();
  const client = await pool.connect();
  try {
    const tenants = await listTenants(client);
    if (tenants.length === 0) {
      console.log("No tenants found. Run 'tenant create' first.");
      return null;
    }

    // Only one tenant — use it automatically
    if (tenants.length === 1) {
      return tenants[0].id;
    }

    const { tenantId } = await inquirer.prompt([
      {
        type: "list",
        name: "tenantId",
        message,
        choices: tenants.map((t) => ({
          name: `${t.name} (${t.status})`,
          value: t.id,
        })),
      },
    ]);

    return tenantId as string;
  } finally {
    client.release();
  }
}
