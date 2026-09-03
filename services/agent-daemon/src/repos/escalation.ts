import type pg from "pg";

export interface Escalation {
  id: string;
  conversation_id: string;
  tenant_id: string;
  reason: string;
  summary: string | null;
  status: "open" | "resolved";
  created_at: Date;
  resolved_at: Date | null;
}

export async function createEscalation(
  client: pg.PoolClient,
  input: {
    conversationId: string;
    tenantId: string;
    reason: string;
    summary?: string;
  },
): Promise<Escalation> {
  const result = await client.query<Escalation>(
    `INSERT INTO escalations (conversation_id, tenant_id, reason, summary)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.conversationId, input.tenantId, input.reason, input.summary ?? null],
  );
  return result.rows[0];
}

export async function resolveEscalation(
  client: pg.PoolClient,
  escalationId: string,
): Promise<Escalation | null> {
  const result = await client.query<Escalation>(
    "UPDATE escalations SET status = 'resolved', resolved_at = now() WHERE id = $1 RETURNING *",
    [escalationId],
  );
  return result.rows[0] ?? null;
}

export async function listEscalations(
  client: pg.PoolClient,
  status?: "open" | "resolved",
): Promise<Escalation[]> {
  const query = status
    ? "SELECT * FROM escalations WHERE status = $1 ORDER BY created_at DESC"
    : "SELECT * FROM escalations ORDER BY created_at DESC";
  const params = status ? [status] : [];
  const result = await client.query<Escalation>(query, params);
  return result.rows;
}
