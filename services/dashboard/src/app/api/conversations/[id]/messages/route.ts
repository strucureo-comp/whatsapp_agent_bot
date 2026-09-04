import { requireAuth } from "@/lib/auth-server";
import { getPool } from "@/lib/db";
import { sendGatewayMessage } from "@/lib/gateway";
import { revalidatePath } from "next/cache";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await requireAuth();
  if (!uid) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const pool = getPool();

  try {
    const convRes = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN tenants t ON t.id = c.tenant_id
       WHERE c.id = $1 AND t.owner_uid = $2`,
      [id, uid]
    );

    if (convRes.rowCount === 0) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    const msgsRes = await pool.query(
      `SELECT id, conversation_id, wa_message_id, role, content, usage_json, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return Response.json({ messages: msgsRes.rows });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await requireAuth();
  if (!uid) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return Response.json({ error: "Message content cannot be empty" }, { status: 400 });
  }

  const pool = getPool();
  // Fetch conversation and verify ownership via tenant
  const convRes = await pool.query(
    `SELECT c.id, c.tenant_id, c.customer_number, c.customer_jid, c.status
     FROM conversations c
     JOIN tenants t ON t.id = c.tenant_id
     WHERE c.id = $1 AND t.owner_uid = $2`,
    [id, uid]
  );

  if (convRes.rowCount === 0) {
    return Response.json({ error: "Conversation not found or access denied" }, { status: 404 });
  }

  const conv = convRes.rows[0];

  // 1. Insert message into database
  const msgRes = await pool.query(
    `INSERT INTO messages (conversation_id, role, content, usage_json)
     VALUES ($1, 'assistant', $2, NULL)
     RETURNING id, conversation_id, wa_message_id, role, content, usage_json, created_at`,
    [id, content]
  );

  // 2. Touch conversation updated_at
  await pool.query(
    `UPDATE conversations
     SET updated_at = NOW()
     WHERE id = $1`,
    [id]
  );

  // 3. Send message via WhatsApp gateway
  const recipient = conv.customer_jid || conv.customer_number;
  const gatewayRes = await sendGatewayMessage(conv.tenant_id, recipient, content);

  revalidatePath("/conversations");
  revalidatePath("/");

  return Response.json({
    ok: true,
    message: msgRes.rows[0],
    gatewayStatus: gatewayRes?.status ?? "queued",
  });
}
