/**
 * Correlation ID propagation — ensures {tenant_id, conversation_id, wa_message_id}
 * are present on all log lines and exported spans.
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

export interface CorrelationIds {
  tenantId?: string;
  conversationId?: string;
  waMessageId?: string;
  correlationId: string;
}

/**
 * Generate a new correlation ID.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Create a child logger with correlation IDs bound.
 */
export function withCorrelation(
  logger: Logger,
  ids: Partial<CorrelationIds>,
): Logger {
  return logger.child({
    tenantId: ids.tenantId,
    conversationId: ids.conversationId,
    waMessageId: ids.waMessageId,
    correlationId: ids.correlationId ?? generateCorrelationId(),
  });
}
