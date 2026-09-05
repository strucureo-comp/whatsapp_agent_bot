import type pg from "pg";

export type ConversationStatus =
  | "active"
  | "escalated"
  | "human_handling"
  | "closed";

export type ContactTag = "new_lead" | "prospect" | "converted" | "vip" | "blocked";

export interface Conversation {
  id: string;
  tenant_id: string;
  channel?: "whatsapp" | "email" | "webchat";
  customer_number?: string | null;
  customer_jid?: string | null;
  customer_email?: string | null;
  customer_name: string;
  contact_tag: ContactTag;
  notes: string;
  channel_metadata?: Record<string, unknown> | null;
  status: ConversationStatus;
  is_test: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function getOrCreateConversation(
  client: pg.PoolClient,
  tenantId: string,
  customerNumber: string,
  customerJid: string,
  isTest: boolean = false,
  customerName: string = "",
): Promise<Conversation> {
  const result = await client.query<Conversation>(
    `INSERT INTO conversations (tenant_id, customer_number, customer_jid, is_test, customer_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, customer_number) DO UPDATE
       SET customer_jid = EXCLUDED.customer_jid,
           customer_name = CASE WHEN EXCLUDED.customer_name <> '' THEN EXCLUDED.customer_name ELSE conversations.customer_name END,
           updated_at = now()
     RETURNING *`,
    [tenantId, customerNumber, customerJid, isTest, customerName],
  );
  return result.rows[0];
}

export async function getConversation(
  client: pg.PoolClient,
  conversationId: string,
  tenantId?: string,
): Promise<Conversation | null> {
  if (tenantId) {
    const result = await client.query<Conversation>(
      "SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2",
      [conversationId, tenantId],
    );
    return result.rows[0] ?? null;
  }
  const result = await client.query<Conversation>(
    "SELECT * FROM conversations WHERE id = $1",
    [conversationId],
  );
  return result.rows[0] ?? null;
}

export async function updateConversationStatus(
  client: pg.PoolClient,
  conversationId: string,
  status: ConversationStatus,
  tenantId?: string,
): Promise<Conversation | null> {
  if (tenantId) {
    const result = await client.query<Conversation>(
      "UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1 AND tenant_id = $3 RETURNING *",
      [conversationId, status, tenantId],
    );
    return result.rows[0] ?? null;
  }
  const result = await client.query<Conversation>(
    "UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [conversationId, status],
  );
  return result.rows[0] ?? null;
}

export async function listConversations(
  client: pg.PoolClient,
  tenantId: string,
  filters?: { status?: ConversationStatus; isTest?: boolean },
): Promise<Conversation[]> {
  const conditions: string[] = [`tenant_id = $1`];
  const values: unknown[] = [tenantId];
  let i = 2;

  if (filters?.status) {
    conditions.push(`status = $${i}`);
    values.push(filters.status);
    i++;
  }
  if (filters?.isTest !== undefined) {
    conditions.push(`is_test = $${i}`);
    values.push(filters.isTest);
    i++;
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const result = await client.query<Conversation>(
    `SELECT * FROM conversations ${where} ORDER BY created_at DESC LIMIT 100`,
    values,
  );
  return result.rows;
}
