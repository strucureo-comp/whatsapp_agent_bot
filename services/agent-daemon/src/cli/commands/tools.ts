import inquirer from "inquirer";
import { withTenant } from "@/db/with-tenant.js";
import { getPool } from "@/db/pool.js";
import { createTool, getTools, deleteTool, upsertTool } from "@/repos/tool.js";
import { validateEndpoint, SsrfError } from "@/tools/ssrf.js";

export async function toolsAdd() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Select tenant
    const tenants = await client.query("SELECT id, name FROM tenants ORDER BY name");
    if (tenants.rows.length === 0) {
      console.log("No tenants found.");
      return;
    }

    const { tenantId } = await inquirer.prompt([
      {
        type: "list",
        name: "tenantId",
        message: "Select tenant:",
        choices: tenants.rows.map((t: any) => ({ name: t.name, value: t.id })),
      },
    ]);

    const answers = await inquirer.prompt([
      { type: "input", name: "name", message: "Tool name:" },
      { type: "input", name: "description", message: "Description:" },
      { type: "input", name: "endpoint", message: "Endpoint URL (HTTPS):" },
      {
        type: "list",
        name: "permission",
        message: "Permission:",
        choices: ["read", "write"],
      },
      {
        type: "number",
        name: "timeout_ms",
        message: "Timeout (ms):",
        default: 8000,
      },
    ]);

    // Validate endpoint for SSRF
    try {
      await validateEndpoint(answers.endpoint);
    } catch (err) {
      if (err instanceof SsrfError) {
        console.error(`\n❌ SSRF validation failed: ${err.message}`);
        return;
      }
      throw err;
    }

    // Build input schema
    const { schemaJson } = await inquirer.prompt([
      {
        type: "input",
        name: "schemaJson",
        message: "Input schema (JSON):",
        default: '{"type":"object","properties":{},"required":[]}',
      },
    ]);

    let inputSchema: Record<string, unknown>;
    try {
      inputSchema = JSON.parse(schemaJson);
    } catch {
      console.error("❌ Invalid JSON schema");
      return;
    }

    await upsertTool(client, tenantId, {
      name: answers.name,
      description: answers.description,
      input_schema: inputSchema,
      endpoint: answers.endpoint,
      permission: answers.permission,
      timeout_ms: answers.timeout_ms,
      enabled: true,
    });

    console.log(`\n✅ Tool "${answers.name}" registered for tenant`);
  } finally {
    client.release();
  }
}

export async function toolsList() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Select tenant
    const tenants = await client.query("SELECT id, name FROM tenants ORDER BY name");
    if (tenants.rows.length === 0) {
      console.log("No tenants found.");
      return;
    }

    const { tenantId } = await inquirer.prompt([
      {
        type: "list",
        name: "tenantId",
        message: "Select tenant:",
        choices: tenants.rows.map((t: any) => ({ name: t.name, value: t.id })),
      },
    ]);

    const tools = await getTools(client, tenantId);
    if (tools.length === 0) {
      console.log("No tools registered.");
      return;
    }

    console.log("\nTools:");
    for (const t of tools) {
      console.log(`  ${t.name} [${t.permission}] — ${t.description.slice(0, 60)}`);
      console.log(`    Endpoint: ${t.endpoint}`);
    }
  } finally {
    client.release();
  }
}

export async function toolsRemove() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const tenants = await client.query("SELECT id, name FROM tenants ORDER BY name");
    if (tenants.rows.length === 0) {
      console.log("No tenants found.");
      return;
    }

    const { tenantId } = await inquirer.prompt([
      {
        type: "list",
        name: "tenantId",
        message: "Select tenant:",
        choices: tenants.rows.map((t: any) => ({ name: t.name, value: t.id })),
      },
    ]);

    const tools = await getTools(client, tenantId);
    if (tools.length === 0) {
      console.log("No tools to remove.");
      return;
    }

    const { toolId } = await inquirer.prompt([
      {
        type: "list",
        name: "toolId",
        message: "Select tool to remove:",
        choices: tools.map((t) => ({ name: `${t.name} [${t.permission}]`, value: t.id })),
      },
    ]);

    await deleteTool(client, tenantId, toolId);
    console.log("\n✅ Tool removed");
  } finally {
    client.release();
  }
}
