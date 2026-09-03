import type pg from "pg";

export interface Message {
  id: string;
  conversation_id: string;
  wa_message_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  usage_json: Record<string, unknown> | null;
  created_at: Date;
}

export interface CreateMessageInput {
  conversationId: string;
  waMessageId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  usageJson?: Record<string, unknown>;
}

export async function createMessage(
  client: pg.PoolClient,
  input: CreateMessageInput,
): Promise<Message> {
  const result = await client.query<Message>(
    `INSERT INTO messages (conversation_id, wa_message_id, role, content, usage_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING *`,
    [
      input.conversationId,
      input.waMessageId ?? null,
      input.role,
      input.content,
      input.usageJson ? JSON.stringify(input.usageJson) : null,
    ],
  );
  return result.rows[0];
}

export async function getMessages(
  client: pg.PoolClient,
  conversationId: string,
  limit: number = 50,
  tenantId?: string,
): Promise<Message[]> {
  if (tenantId) {
    const result = await client.query<Message>(
      `SELECT m.* FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = $1 AND c.tenant_id = $2
       ORDER BY m.created_at ASC
       LIMIT $3`,
      [conversationId, tenantId, limit],
    );
    return result.rows;
  }
  const result = await client.query<Message>(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit],
  );
  return result.rows;
}

export async function getMessageByWaId(
  client: pg.PoolClient,
  waMessageId: string,
): Promise<Message | null> {
  const result = await client.query<Message>(
    "SELECT * FROM messages WHERE wa_message_id = $1",
    [waMessageId],
  );
  return result.rows[0] ?? null;
}

export async function getRecentMessages(
  client: pg.PoolClient,
  conversationId: string,
  count: number = 10,
  tenantId?: string,
): Promise<Message[]> {
  if (tenantId) {
    const result = await client.query<Message>(
      `SELECT * FROM (
        SELECT m.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1 AND c.tenant_id = $2
        ORDER BY m.created_at DESC
        LIMIT $3
      ) sub
      ORDER BY created_at ASC`,
      [conversationId, tenantId, count],
    );
    return result.rows;
  }
  const result = await client.query<Message>(
    `SELECT * FROM (
      SELECT * FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    ) sub
    ORDER BY created_at ASC`,
    [conversationId, count],
  );
  return result.rows;
}
