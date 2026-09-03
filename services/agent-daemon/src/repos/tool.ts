import type pg from "pg";
import { makeSecretRedactor } from "@/lib/logger.js";

export interface TenantTool {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  endpoint: string;
  auth_config: Record<string, unknown> | null;
  permission: "read" | "write";
  timeout_ms: number;
  rate_limit_per_min: number | null;
  enabled: boolean;
  created_at: Date;
}

/**
 * Redaction proxy for auth_config — prevents secrets from reaching logs.
 */
export function redactAuthConfig(authConfig: Record<string, unknown> | null) {
  if (!authConfig) return null;
  return new Proxy(authConfig, {
    get(target, prop) {
      if (prop === "toJSON") return () => "[REDACTED_AUTH_CONFIG]";
      if (prop === Symbol.for("nodejs.util.inspect.custom"))
        return () => "[REDACTED_AUTH_CONFIG]";
      return Reflect.get(target, prop);
    },
  });
}

export async function createTool(
  client: pg.PoolClient,
  tool: Omit<TenantTool, "id" | "created_at">,
): Promise<TenantTool> {
  const result = await client.query<TenantTool>(
    `INSERT INTO tenant_tools (tenant_id, name, description, input_schema, endpoint, auth_config, permission, timeout_ms, rate_limit_per_min, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      tool.tenant_id,
      tool.name,
      tool.description,
      JSON.stringify(tool.input_schema),
      tool.endpoint,
      tool.auth_config ? JSON.stringify(tool.auth_config) : null,
      tool.permission,
      tool.timeout_ms,
      tool.rate_limit_per_min,
      tool.enabled,
    ],
  );
  return result.rows[0];
}

export async function getTools(
  client: pg.PoolClient,
  tenantId: string,
): Promise<TenantTool[]> {
  const result = await client.query<TenantTool>(
    "SELECT * FROM tenant_tools WHERE tenant_id = $1 AND enabled = true ORDER BY name",
    [tenantId],
  );
  return result.rows;
}

export async function getToolByName(
  client: pg.PoolClient,
  tenantId: string,
  name: string,
): Promise<TenantTool | null> {
  const result = await client.query<TenantTool>(
    "SELECT * FROM tenant_tools WHERE tenant_id = $1 AND name = $2",
    [tenantId, name],
  );
  return result.rows[0] ?? null;
}

export async function deleteTool(
  client: pg.PoolClient,
  tenantId: string,
  toolId: string,
): Promise<boolean> {
  const result = await client.query(
    "DELETE FROM tenant_tools WHERE tenant_id = $1 AND id = $2",
    [tenantId, toolId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertTool(
  client: pg.PoolClient,
  tenantId: string,
  tool: Omit<TenantTool, "id" | "tenant_id" | "created_at">,
): Promise<TenantTool> {
  const result = await client.query<TenantTool>(
    `INSERT INTO tenant_tools (tenant_id, name, description, input_schema, endpoint, auth_config, permission, timeout_ms, rate_limit_per_min, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       description = EXCLUDED.description,
       input_schema = EXCLUDED.input_schema,
       endpoint = EXCLUDED.endpoint,
       auth_config = EXCLUDED.auth_config,
       permission = EXCLUDED.permission,
       timeout_ms = EXCLUDED.timeout_ms,
       rate_limit_per_min = EXCLUDED.rate_limit_per_min,
       enabled = EXCLUDED.enabled
     RETURNING *`,
    [
      tenantId,
      tool.name,
      tool.description,
      JSON.stringify(tool.input_schema),
      tool.endpoint,
      tool.auth_config ? JSON.stringify(tool.auth_config) : null,
      tool.permission,
      tool.timeout_ms,
      tool.rate_limit_per_min,
      tool.enabled,
    ],
  );
  return result.rows[0];
}
