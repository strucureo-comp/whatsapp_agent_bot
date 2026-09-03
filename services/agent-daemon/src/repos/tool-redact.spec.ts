import { describe, it, expect } from "vitest";
import { redactAuthConfig } from "./tool.js";
import type { TenantTool } from "./tool.js";

describe("auth_config redaction", () => {
  it("redacts auth_config when serialized", () => {
    const tool: TenantTool = {
      id: "test-tool",
      tenant_id: "tenant-1",
      name: "get_user",
      description: "Get user details",
      input_schema: { type: "object", properties: { id: { type: "string" } } },
      endpoint: "https://api.example.com/users",
      auth_config: {
        type: "bearer",
        token: "sk-secret-1234567890",
      },
      permission: "read",
      timeout_ms: 5000,
      rate_limit_per_min: 10,
      enabled: true,
      created_at: new Date(),
    };

    const redacted = redactAuthConfig(tool.auth_config);

    // When serialized via JSON.stringify, auth_config should be redacted
    const serialized = JSON.stringify({ auth_config: redacted });
    expect(serialized).not.toContain("sk-secret-1234567890");
    expect(serialized).toContain("REDACTED_AUTH_CONFIG");
  });

  it("never renders auth_config into prompts", () => {
    const tool: TenantTool = {
      id: "test-tool",
      tenant_id: "tenant-1",
      name: "create_record",
      description: "Create a record",
      input_schema: { type: "object", properties: {} },
      endpoint: "https://api.example.com/records",
      auth_config: {
        type: "api_key",
        header: "X-API-Key",
        value: "super-secret-api-key-12345",
      },
      permission: "write",
      timeout_ms: 5000,
      rate_limit_per_min: 10,
      enabled: true,
      created_at: new Date(),
    };

    const redacted = redactAuthConfig(tool.auth_config);

    // When serialized, secrets should not appear
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("super-secret-api-key");
    expect(serialized).not.toContain("X-API-Key");
  });

  it("returns null for null auth_config", () => {
    expect(redactAuthConfig(null)).toBeNull();
  });
});
