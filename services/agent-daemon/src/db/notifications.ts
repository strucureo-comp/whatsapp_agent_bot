import type { PoolClient } from "pg";
import { getLogger } from "@/lib/logger.js";

/**
 * Postgres LISTEN/NOTIFY on message insert for live log tailing.
 * The daemon subscribes to 'strucureo:message' and emits structured log lines.
 */

export function startNotificationListener(pool: PoolClient): void {
  const log = getLogger();

  pool.on("notification", (msg) => {
    if (msg.channel === "strucureo:message") {
      try {
        const payload = JSON.parse(msg.payload ?? "{}");
        log.info(
          {
            tenantId: payload.tenant_id,
            conversationId: payload.conversation_id,
            waMessageId: payload.wa_message_id,
            role: payload.role,
          },
          "New message",
        );
      } catch {
        log.warn({ payload: msg.payload }, "Failed to parse notification payload");
      }
    }
  });

  pool.query("LISTEN strucureo:message").then(() => {
    log.info("Listening for message notifications");
  }).catch((err) => {
    log.error({ err }, "Failed to subscribe to notifications");
  });
}

/**
 * Create the NOTIFY trigger in Postgres.
 * Called during migration.
 */
export const NOTIFY_TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION notify_message_insert() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('strucureo:message', json_build_object(
    'tenant_id', NEW.tenant_id,
    'conversation_id', NEW.conversation_id,
    'wa_message_id', NEW.wa_message_id,
    'role', NEW.role
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_insert_notify ON messages;
CREATE TRIGGER message_insert_notify
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_insert();
`;
