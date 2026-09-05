import { requireAuth } from "@/lib/auth-server";
import { getPool } from "@/lib/db";
import { runEmailAgentTurn } from "@/lib/email/agent-turn";

/**
 * Interactive Inbound Email Simulator / Test Endpoint.
 * Allows testing the AI Email Agent end-to-end directly from the Dashboard UI.
 *
 * Route: POST /api/email/test
 */

export async function POST(request: Request) {
  const uid = await requireAuth();
  if (!uid) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tenantId, from = "client.tester@example.com", subject = "Project consultation & meeting", content = "Hello, can we schedule a call for tomorrow to discuss services?" } = body;

  if (!tenantId) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  const pool = getPool();
  // Verify tenant ownership
  const tenantRes = await pool.query(`SELECT id, name FROM tenants WHERE id = $1 AND owner_uid = $2`, [tenantId, uid]);
  if (tenantRes.rowCount === 0) {
    return Response.json({ error: "Tenant not found or access denied" }, { status: 404 });
  }

  const customerEmail = String(from).toLowerCase().trim();
  const customerName = customerEmail.split("@")[0].replace(/[._]/g, " ");

  // 1. Find or create conversation for test email
  let convRes = await pool.query(
    `SELECT id FROM conversations WHERE tenant_id = $1 AND channel = 'email' AND customer_email = $2`,
    [tenantId, customerEmail]
  );

  let conversationId: string;
  if (convRes.rowCount === 0) {
    const newConv = await pool.query(
      `INSERT INTO conversations (tenant_id, channel, customer_email, customer_name, status, is_test)
       VALUES ($1, 'email', $2, $3, 'active', false)
       RETURNING id`,
      [tenantId, customerEmail, customerName]
    );
    conversationId = newConv.rows[0].id;
  } else {
    conversationId = convRes.rows[0].id;
    await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
  }

  // 2. Insert incoming user message
  const msgRes = await pool.query(
    `INSERT INTO messages (conversation_id, channel, role, content, subject, email_message_id)
     VALUES ($1, 'email', 'user', $2, $3, $4)
     RETURNING id`,
    [conversationId, content, subject, `<test-${Date.now()}@simulator>`]
  );

  // 3. Run AI agent turn
  const turn = await runEmailAgentTurn({
    tenantId,
    conversationId,
    inboundContent: content,
    customerEmail,
    customerName,
    subject,
    inReplyTo: `<test-${Date.now()}@simulator>`,
  });

  return Response.json({
    ok: true,
    conversationId,
    inboundMessageId: msgRes.rows[0]?.id,
    reply: turn.replyContent,
    dispatched: turn.emailSent,
  });
}
