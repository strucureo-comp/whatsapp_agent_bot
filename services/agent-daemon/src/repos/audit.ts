import type pg from "pg";

export interface AuditEntry {
  id: string;
  tenant_id: string;
  tool_name: string;
  conversation_id: string | null;
  allowed: boolean;
  request_summary: Record<string, unknown> | null;
  created_at: Date;
}

export async function logToolAttempt(
  client: pg.PoolClient,
  input: {
    tenantId: string;
    toolName: string;
    conversationId?: string;
    allowed: boolean;
    requestSummary?: Record<string, unknown>;
  },
): Promise<AuditEntry> {
  const result = await client.query<AuditEntry>(
    `INSERT INTO audit_log (tenant_id, tool_name, conversation_id, allowed, request_summary)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.tenantId,
      input.toolName,
      input.conversationId ?? null,
      input.allowed,
      input.requestSummary ? JSON.stringify(input.requestSummary) : null,
    ],
  );
  return result.rows[0];
}

export async function listAuditEntries(
  client: pg.PoolClient,
  filters?: { allowed?: boolean; limit?: number },
): Promise<AuditEntry[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (filters?.allowed !== undefined) {
    conditions.push(`allowed = $${i}`);
    values.push(filters.allowed);
    i++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ?? 100;

  const result = await client.query<AuditEntry>(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${i}`,
    [...values, limit],
  );
  return result.rows;
}
