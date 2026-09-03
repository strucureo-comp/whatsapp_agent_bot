import { getLogger } from "@/lib/logger.js";
import { gatewayRequest } from "@/lib/gateway.js";

/**
 * Channel interface — the seam between the agent daemon and the WhatsApp gateway.
 * All outbound messaging goes through here. The gateway is a separate process.
 */

export interface InboundMessage {
  message_id: string;
  from_jid: string;
  content: string;
  timestamp: number;
  addressing_mode: string;
  phone?: string;
}

export interface AgentReply {
  content: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Send a text message via the gateway.
 *
 * A 200 means the gateway accepted the message onto outbound:<tenant>, not that
 * WhatsApp has delivered it — the gateway's sender pool does that asynchronously
 * and reports a permanent failure as a send_failed event on the tenant's channel.
 */
export async function sendText(
  tenantId: string,
  to: string,
  body: string,
  options?: { allowUnsolicited?: boolean },
): Promise<void> {
  const log = getLogger();

  const result = await gatewayRequest<{ status: string; message_id?: string }>(
    "/messages/send",
    {
      method: "POST",
      body: {
        tenant_id: tenantId,
        to,
        body,
        ...(options?.allowUnsolicited ? { allow_unsolicited: true } : {}),
      },
    },
  );

  if (!result.ok) {
    log.error({ tenantId, to, err: result.error }, "Failed to send message");
    throw new Error(`Gateway send failed: ${result.error}`);
  }

  log.debug(
    { tenantId, to, messageId: result.data?.message_id },
    "Message queued on gateway",
  );
}
