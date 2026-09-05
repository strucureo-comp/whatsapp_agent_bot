import { getPool } from "@/lib/db";
import { runEmailAgentTurn } from "@/lib/email/agent-turn";

/**
 * Inbound Email Webhook Handler.
 * Supports:
 * - Resend Inbound Webhook
 * - SendGrid Inbound Parse / Postmark Inbound Webhook / Cloudflare Email Routing
 * - Direct JSON Payload / Simulator
 *
 * Route: POST /api/email/inbound
 */

export async function POST(request: Request) {
  const pool = getPool();
  let payload: any = {};

  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const obj: Record<string, any> = {};
      formData.forEach((value, key) => {
        obj[key] = typeof value === "string" ? value : value.name;
      });
      payload = obj;
    } else {
      payload = await request.json();
    }
  } catch (err) {
    return Response.json({ error: "Failed to parse inbound body" }, { status: 400 });
  }

  // 1. Normalize email fields across providers (Resend, Postmark, SendGrid, custom)
  // 'from': "John Doe <john@domain.com>" or "john@domain.com"
  const rawFrom = payload.from || payload.From || payload.sender || "";
  let customerEmail = "";
  let customerName = "";

  const fromMatch = String(rawFrom).match(/(?:(.*)<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/);
  if (fromMatch) {
    customerName = (fromMatch[1] || "").replace(/["']/g, "").trim();
    customerEmail = fromMatch[2].toLowerCase().trim();
  } else {
    customerEmail = String(rawFrom).toLowerCase().trim();
  }

  // 'to': "slug@inbound.strucureo.com"
  const rawTo = Array.isArray(payload.to) ? payload.to[0] : (payload.to || payload.To || payload.recipient || "");
  const toAddress = String(rawTo).toLowerCase().trim();
  const toSlug = toAddress.split("@")[0]?.replace(/^<|>$/g, "").trim();

  // 'subject'
  const subject = (payload.subject || payload.Subject || "Inquiry").trim();

  // 'content' / body: strip long historical quote chains to prevent prompt bloat
  let content = (payload.text || payload.textBody || payload.body || payload.html || "").trim();
  // Strip common email quote dividers
  content = content.split(/(\r?\n-----Original Message-----|\r?\nOn .+ wrote:|\r?\nFrom: .+ Sent:)/i)[0].trim();

  if (!customerEmail) {
    return Response.json({ error: "Missing or invalid sender email ('from')" }, { status: 400 });
  }
  if (!content) {
    return Response.json({ error: "Empty email content" }, { status: 400 });
  }

  const messageId = payload.messageId || payload.MessageID || payload.headers?.["message-id"] || `<${Date.now()}@inbound.email>`;
  const inReplyTo = payload.inReplyTo || payload.headers?.["in-reply-to"] || null;

  // 2. Resolve Tenant by inbound_email_slug, custom_email_address, or URL query param
  const url = new URL(request.url);
  const explicitTenantId = url.searchParams.get("tenant");

  let tenantQuery = `
    SELECT id, name, inbound_email_slug, email_enabled, status
    FROM tenants
    WHERE inbound_email_slug = $1 OR custom_email_address = $2
  `;
  const tenantVals: any[] = [toSlug, toAddress];

  if (explicitTenantId) {
    tenantQuery = `SELECT id, name, inbound_email_slug, email_enabled, status FROM tenants WHERE id = $1`;
    tenantVals.length = 0;
    tenantVals.push(explicitTenantId);
  }

  let tenantRes = await pool.query(tenantQuery, tenantVals);
  if (tenantRes.rowCount === 0) {
    // If only 1 tenant exists on system, match to it as default fallback
    const fallbackRes = await pool.query(`SELECT id, name, inbound_email_slug, email_enabled, status FROM tenants LIMIT 1`);
    if (fallbackRes.rowCount === 0) {
      return Response.json({ error: "No matching tenant found for recipient" }, { status: 404 });
    }
    tenantRes = fallbackRes;
  }

  const tenant = tenantRes.rows[0];
  if (!tenant.email_enabled || tenant.status === "paused") {
    return Response.json({ status: "skipped", reason: "Tenant email handling is disabled or paused" });
  }

  // 3. Find or create Conversation for this customer email
  let convRes = await pool.query(
    `SELECT id, status, contact_tag FROM conversations
     WHERE tenant_id = $1 AND channel = 'email' AND customer_email = $2`,
    [tenant.id, customerEmail]
  );

  let conversationId: string;
  if (convRes.rowCount === 0) {
    const newConv = await pool.query(
      `INSERT INTO conversations (
         tenant_id, channel, customer_email, customer_name, status, is_test
       )
       VALUES ($1, 'email', $2, $3, 'active', false)
       RETURNING id`,
      [tenant.id, customerEmail, customerName || customerEmail.split("@")[0]]
    );
    conversationId = newConv.rows[0].id;
  } else {
    conversationId = convRes.rows[0].id;
    // Update name if we now have one
    if (customerName) {
      await pool.query(
        `UPDATE conversations
         SET customer_name = $1, updated_at = NOW()
         WHERE id = $2 AND (customer_name IS NULL OR customer_name = '')`,
        [customerName, conversationId]
      );
    } else {
      await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
    }
  }

  // 4. Save Inbound Message
  const inboundMsgRes = await pool.query(
    `INSERT INTO messages (
       conversation_id, channel, role, content, subject, email_message_id, in_reply_to, metadata
     )
     VALUES ($1, 'email', 'user', $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [
      conversationId,
      content,
      subject,
      messageId,
      inReplyTo,
      JSON.stringify({ raw_from: rawFrom, raw_to: rawTo }),
    ]
  );

  // 5. Run AI Agent Turn (Generates reply and sends outbound email in the thread)
  const agentTurnResult = await runEmailAgentTurn({
    tenantId: tenant.id,
    conversationId,
    inboundContent: content,
    customerEmail,
    customerName,
    subject,
    inReplyTo: messageId,
  });

  return Response.json({
    ok: true,
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    conversation_id: conversationId,
    inbound_message_id: inboundMsgRes.rows[0]?.id,
    agent_reply: {
      content: agentTurnResult.replyContent,
      email_dispatched: agentTurnResult.emailSent,
    },
  });
}
