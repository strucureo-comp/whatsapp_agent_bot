import pino from "pino";
import { getEnv } from "@/config/env.js";

let _logger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (!_logger) {
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    });
  }
  return _logger;
}

export function createChildLogger(bindings: {
  tenant_id?: string;
  conversation_id?: string;
  wa_message_id?: string;
}): pino.Logger {
  return getLogger().child(bindings);
}

/**
 * Redaction helper for types holding auth_config.
 * Attach toJSON and util.inspect.custom to prevent secrets from reaching logs.
 */
export function makeSecretRedactor(fieldName: string) {
  return {
    toJSON() {
      return `[REDACTED_${fieldName.toUpperCase()}]`;
    },
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return `[REDACTED_${fieldName.toUpperCase()}]`;
    },
  };
}
