import inquirer from "inquirer";
import { withTenant } from "@/db/with-tenant.js";
import { getPool } from "@/db/pool.js";
import {
  createTenant,
  listTenants,
  updateTenantStatus,
} from "@/repos/tenant.js";
import { setActiveTenantId } from "../active-tenant.js";

export async function tenantCreate() {
  const { name, persona, staffWhatsapp } = await inquirer.prompt([
    { type: "input", name: "name", message: "Tenant name:" },
    {
      type: "input",
      name: "persona",
      message: "Persona prompt (or leave empty for default):",
      default: "",
    },
    {
      type: "input",
      name: "staffWhatsapp",
      message: "Staff WhatsApp number (optional):",
      default: "",
    },
  ]);

  const pool = getPool();
  const client = await pool.connect();
  try {
    const tenant = await createTenant(client, {
      name,
      persona_prompt: persona || undefined,
      staff_whatsapp: staffWhatsapp || undefined,
    });
    console.log(`\n✅ Created tenant: ${tenant.name} (${tenant.id})`);
  } finally {
    client.release();
  }
}

export async function tenantList() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const tenants = await listTenants(client);
    if (tenants.length === 0) {
      console.log("No tenants found.");
      return;
    }
    console.log("\nTenants:");
    for (const t of tenants) {
      const status = t.status === "active" ? "🟢" : "⏸️";
      console.log(`  ${status} ${t.name} (${t.id.slice(0, 8)}…)`);
    }
  } finally {
    client.release();
  }
}

export async function tenantUse() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const tenants = await listTenants(client);
    if (tenants.length === 0) {
      console.log("No tenants found. Run 'tenant create' first.");
      return;
    }

    const { tenantId } = await inquirer.prompt([
      {
        type: "list",
        name: "tenantId",
        message: "Select tenant:",
        choices: tenants.map((t) => ({
          name: `${t.name} (${t.status})`,
          value: t.id,
        })),
      },
    ]);

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Action:",
        choices: ["pause", "resume"],
      },
    ]);

    const status = action === "pause" ? "paused" : "active";
    await updateTenantStatus(client, tenantId, status);
    if (status === "active") {
      setActiveTenantId(tenantId);
    }
    console.log(`\n✅ Tenant ${status}`);
  } finally {
    client.release();
  }
}
