import type { PoolClient } from "pg";
import { getLogger } from "@/lib/logger.js";
import { sendText } from "@/channel/index.js";

/**
 * Escalation triggers:
 * - first-time client needing onboarding
 * - complaint/urgency sentiment
 * - low confidence or repeated tool failure
 * - explicit request for a human
 */

export interface EscalationTrigger {
  type: "first_time_client" | "complaint_urgency" | "low_confidence" | "tool_failure" | "explicit_request";
  reason: string;
}

/**
 * Check if any escalation triggers are met.
 */
export function checkEscalationTriggers(
  messages: Array<{ role: string; content: string }>,
  toolFailures: number,
): EscalationTrigger[] {
  const triggers: EscalationTrigger[] = [];
  const lastUser = messages.filter((m) => m.role === "user").pop();
  const content = lastUser?.content.toLowerCase() ?? "";

  // Explicit request for a human
  if (
    content.includes("speak to a person") ||
    content.includes("talk to a human") ||
    content.includes("speak to a human") ||
    content.includes("transfer me") ||
    content.includes("real person") ||
    content.includes("live agent")
  ) {
    triggers.push({ type: "explicit_request", reason: "Customer explicitly requested a human" });
  }

  // Complaint/urgency sentiment
  if (
    content.includes("urgent") ||
    content.includes("complaint") ||
    content.includes("frustrated") ||
    content.includes("angry") ||
    content.includes("terrible") ||
    content.includes("worst") ||
    content.includes("unacceptable") ||
    content.includes("disappointed")
  ) {
    triggers.push({ type: "complaint_urgency", reason: "Customer expressed urgency or complaint sentiment" });
  }

  // Repeated tool failure
  if (toolFailures >= 3) {
    triggers.push({ type: "tool_failure", reason: `${toolFailures} consecutive tool failures` });
  }

  return triggers;
}

/**
 * Escalate a conversation.
 */
export async function escalateConversation(
  pool: PoolClient,
  conversationId: string,
  tenantId: string,
  triggers: EscalationTrigger[],
  summary: string,
): Promise<void> {
  // Update conversation status
  await pool.query(
    "UPDATE conversations SET status = 'escalated' WHERE id = $1",
    [conversationId],
  );

  // Create escalation record
  await pool.query(
    `INSERT INTO escalations (conversation_id, tenant_id, reason, status)
     VALUES ($1, $2, $3, 'open')`,
    [conversationId, tenantId, triggers.map((t) => t.reason).join("; ")],
  );

  // Get tenant staff whatsapp
  const tenantResult = await pool.query(
    "SELECT staff_whatsapp, name FROM tenants WHERE id = $1",
    [tenantId],
  );

  const tenant = tenantResult.rows[0];
  if (tenant?.staff_whatsapp) {
    // Get customer number
    const convResult = await pool.query(
      "SELECT customer_number FROM conversations WHERE id = $1",
      [conversationId],
    );
    const customerNumber = convResult.rows[0]?.customer_number;

    // Send notification to staff via gateway HTTP API
    const message = `🚨 *Escalation*\n\nCustomer: ${customerNumber}\nTenant: ${tenant.name}\nReason: ${triggers.map((t) => t.reason).join("; ")}\n\nSummary: ${summary}`;

    const log = getLogger();

    try {
      // Staff have never messaged the bot, so the gateway's unsolicited-outbound
      // check would 403 this. Internal escalation alerts explicitly bypass it —
      // the gateway still requires Bearer auth + rate limiting.
      await sendText(tenantId, tenant.staff_whatsapp, message, { allowUnsolicited: true });
      log.info(
        { tenantId, staffWhatsapp: tenant.staff_whatsapp },
        "Escalation notification sent",
      );
    } catch (err) {
      log.error({ tenantId, err }, "Failed to send escalation notification");
    }
  }
}

/**
 * Resolve an escalation.
 */
export async function resolveEscalation(
  pool: PoolClient,
  escalationId: string,
): Promise<void> {
  await pool.query(
    "UPDATE escalations SET status = 'resolved', resolved_at = NOW() WHERE id = $1",
    [escalationId],
  );

  // Get the conversation id
  const result = await pool.query(
    "SELECT conversation_id FROM escalations WHERE id = $1",
    [escalationId],
  );

  if (result.rows[0]) {
    await pool.query(
      "UPDATE conversations SET status = 'active' WHERE id = $1",
      [result.rows[0].conversation_id],
    );
  }
}

/**
 * Holding message to send when escalating.
 */
export const HOLDING_MESSAGE =
  "I've escalated your request to a member of our team. They'll be with you shortly. Is there anything else I can help with in the meantime?";
