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
    `SELECT c.id, c.tenant_id, c.channel, c.customer_number, c.customer_jid, c.customer_email, c.status
     FROM conversations c
     JOIN tenants t ON t.id = c.tenant_id
     WHERE c.id = $1 AND t.owner_uid = $2`,
    [id, uid]
  );

  if (convRes.rowCount === 0) {
    return Response.json({ error: "Conversation not found or access denied" }, { status: 404 });
  }

  const conv = convRes.rows[0];
  const isEmail = conv.channel === "email";

  let lastSubject = "Message from Support";
  if (isEmail) {
    const lastSubRes = await pool.query(
      `SELECT subject FROM messages WHERE conversation_id = $1 AND subject IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (lastSubRes.rowCount && lastSubRes.rows[0].subject) {
      const s = lastSubRes.rows[0].subject;
      lastSubject = s.toLowerCase().startsWith("re:") ? s : `Re: ${s}`;
    }
  }

  // 1. Insert message into database
  const msgRes = await pool.query(
    `INSERT INTO messages (conversation_id, channel, role, content, subject, usage_json)
     VALUES ($1, $2, 'assistant', $3, $4, NULL)
     RETURNING id, conversation_id, wa_message_id, channel, subject, role, content, usage_json, created_at`,
    [id, conv.channel || "whatsapp", content, isEmail ? lastSubject : null]
  );

  // 2. Touch conversation updated_at
  await pool.query(
    `UPDATE conversations
     SET updated_at = NOW()
     WHERE id = $1`,
    [id]
  );

  // 3. Dispatch outbound via the conversation's active channel
  let dispatchStatus = "queued";
  if (isEmail && conv.customer_email) {
    const { sendOutboundEmail } = await import("@/lib/email/sender");
    const emailRes = await sendOutboundEmail({
      tenantId: conv.tenant_id,
      to: conv.customer_email,
      subject: lastSubject,
      text: content,
    });
    dispatchStatus = emailRes.ok ? "sent" : "failed";
  } else {
    const recipient = conv.customer_jid || conv.customer_number;
    if (recipient) {
      const gatewayRes = await sendGatewayMessage(conv.tenant_id, recipient, content);
      dispatchStatus = gatewayRes?.status ?? "queued";
    }
  }

  revalidatePath("/conversations");
  revalidatePath("/");

  return Response.json({
    ok: true,
    message: msgRes.rows[0],
    gatewayStatus: dispatchStatus,
  });
}
