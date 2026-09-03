import { readFileSync, writeFileSync } from "node:fs";
import inquirer from "inquirer";
import { parse, stringify } from "yaml";
import { withTenant } from "@/db/with-tenant.js";
import { getPool } from "@/db/pool.js";
import { listTenants, upsertTenantConfig } from "@/repos/tenant.js";

export async function configLoad() {
  const { filePath, tenantId } = await inquirer.prompt([
    { type: "input", name: "filePath", message: "YAML config file path:" },
  ]);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    console.error(`❌ Cannot read file: ${filePath}`);
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = parse(raw);
  } catch (err) {
    console.error(`❌ Invalid YAML: ${err}`);
    return;
  }

  if (!config.tenant_id) {
    console.error("❌ Config must include 'tenant_id'");
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await upsertTenantConfig(client, config.tenant_id as string, {
      name: config.name as string,
      persona_prompt: config.persona_prompt as string,
      llm_model: config.llm_model as string,
      staff_whatsapp: config.staff_whatsapp as string,
      google_calendar_id: config.google_calendar_id as string,
      max_monthly_spend_cents: config.max_monthly_spend_cents as number,
      reply_max_tokens: config.reply_max_tokens as number,
      debounce_ms: config.debounce_ms as number,
    });
    console.log(`\n✅ Config loaded for tenant ${config.tenant_id}`);
  } finally {
    client.release();
  }
}

export async function configShow() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const tenants = await listTenants(client);
    if (tenants.length === 0) {
      console.log("No tenants found.");
      return;
    }

    const { tenantId } = await inquirer.prompt([
      {
        type: "list",
        name: "tenantId",
        message: "Select tenant:",
        choices: tenants.map((t) => ({
          name: t.name,
          value: t.id,
        })),
      },
    ]);

    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) return;

    const yaml = stringify({
      tenant_id: tenant.id,
      name: tenant.name,
      persona_prompt: tenant.persona_prompt,
      llm_provider: tenant.llm_provider,
      llm_model: tenant.llm_model,
      staff_whatsapp: tenant.staff_whatsapp,
      google_calendar_id: tenant.google_calendar_id,
      max_monthly_spend_cents: tenant.max_monthly_spend_cents,
      reply_max_tokens: tenant.reply_max_tokens,
      debounce_ms: tenant.debounce_ms,
    });

    console.log("\n" + yaml);
  } finally {
    client.release();
  }
}
