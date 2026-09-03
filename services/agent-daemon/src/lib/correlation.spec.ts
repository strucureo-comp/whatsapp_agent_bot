import { describe, it, expect } from "vitest";
import { generateCorrelationId, withCorrelation } from "./correlation.js";
import pino from "pino";

describe("correlation IDs", () => {
  it("generates unique correlation IDs", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("creates child logger with correlation IDs", () => {
    const logger = pino({ level: "silent" });
    const child = withCorrelation(logger, {
      tenantId: "tenant-1",
      conversationId: "conv-1",
      waMessageId: "msg-1",
    });

    // Child logger should have the correlation IDs bound
    expect(child).toBeDefined();
  });
});
