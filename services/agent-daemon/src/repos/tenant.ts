import type pg from "pg";

export interface Tenant {
  id: string;
  name: string;
  persona_prompt: string;
  status: "active" | "paused";
  llm_provider: string;
  llm_model: string;
  staff_whatsapp: string | null;
  google_calendar_id: string | null;
  max_monthly_spend_cents: number;
  reply_max_tokens: number;
  debounce_ms: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTenantInput {
  name: string;
  persona_prompt?: string;
  llm_model?: string;
  staff_whatsapp?: string;
  google_calendar_id?: string;
  max_monthly_spend_cents?: number;
}

export async function createTenant(
  client: pg.PoolClient,
  input: CreateTenantInput,
): Promise<Tenant> {
  const result = await client.query<Tenant>(
    `INSERT INTO tenants (name, persona_prompt, llm_model, staff_whatsapp, google_calendar_id, max_monthly_spend_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      input.persona_prompt ?? "",
      input.llm_model ?? "claude-opus-5",
      input.staff_whatsapp ?? null,
      input.google_calendar_id ?? null,
      input.max_monthly_spend_cents ?? 10000,
    ],
  );
  return result.rows[0];
}

export async function getTenant(
  client: pg.PoolClient,
  tenantId: string,
): Promise<Tenant | null> {
  const result = await client.query<Tenant>(
    "SELECT * FROM tenants WHERE id = $1",
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function listTenants(
  client: pg.PoolClient,
): Promise<Tenant[]> {
  const result = await client.query<Tenant>(
    "SELECT * FROM tenants ORDER BY name",
  );
  return result.rows;
}

export async function updateTenantStatus(
  client: pg.PoolClient,
  tenantId: string,
  status: "active" | "paused",
): Promise<Tenant | null> {
  const result = await client.query<Tenant>(
    "UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [tenantId, status],
  );
  return result.rows[0] ?? null;
}

export async function upsertTenantConfig(
  client: pg.PoolClient,
  tenantId: string,
  config: Partial<Omit<Tenant, "id" | "created_at" | "updated_at">>,
): Promise<Tenant> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      fields.push(`${key} = $${i}`);
      values.push(value);
      i++;
    }
  }

  if (fields.length === 0) {
    const result = await client.query<Tenant>(
      "SELECT * FROM tenants WHERE id = $1",
      [tenantId],
    );
    return result.rows[0];
  }

  fields.push(`updated_at = now()`);
  values.push(tenantId);

  const result = await client.query<Tenant>(
    `UPDATE tenants SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values,
  );
  return result.rows[0];
}
