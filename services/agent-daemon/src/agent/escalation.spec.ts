import { describe, it, expect } from "vitest";
import { checkEscalationTriggers } from "./escalation.js";

describe("escalation triggers", () => {
  it("detects explicit request for human", () => {
    const triggers = checkEscalationTriggers(
      [{ role: "user", content: "I want to speak to a human" }],
      0,
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe("explicit_request");
  });

  it("detects complaint sentiment", () => {
    const triggers = checkEscalationTriggers(
      [{ role: "user", content: "This is terrible service, I'm very frustrated" }],
      0,
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe("complaint_urgency");
  });

  it("detects tool failure threshold", () => {
    const triggers = checkEscalationTriggers(
      [{ role: "user", content: "Hello" }],
      3,
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe("tool_failure");
  });

  it("returns no triggers for normal message", () => {
    const triggers = checkEscalationTriggers(
      [{ role: "user", content: "What are your business hours?" }],
      0,
    );
    expect(triggers).toHaveLength(0);
  });
});
