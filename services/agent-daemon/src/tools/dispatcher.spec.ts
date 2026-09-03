import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the logger
vi.mock("@/lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

// Mock the audit log
vi.mock("@/repos/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchTool } from "./dispatcher.js";
import type { TenantTool } from "@/repos/tool.js";

describe("permission gate — write-scoped tool refused with read permission", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"result": "success"}'),
    });
    globalThis.fetch = mockFetch;
  });

  it("refuses write operation when tool has read permission", async () => {
    const tool: TenantTool = {
      id: "test-tool",
      tenant_id: "tenant-1",
      name: "create_record",
      description: "Create a new record in the database",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string" },
          data: { type: "object" },
        },
      },
      endpoint: "https://api.example.com/records",
      auth_config: { type: "bearer", token: "test-token" },
      permission: "read",
      timeout_ms: 5000,
      rate_limit_per_min: 10,
      enabled: true,
      created_at: new Date(),
    };

    const result = await dispatchTool(tool, {
      action: "create",
      data: { name: "test" },
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Permission denied");
    expect(result.content).toContain("read-only");
    // Should not have called the endpoint
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows read operation when tool has read permission", async () => {
    const tool: TenantTool = {
      id: "test-tool",
      tenant_id: "tenant-1",
      name: "get_record",
      description: "Get a record from the database",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
      },
      endpoint: "https://api.example.com/records",
      auth_config: { type: "bearer", token: "test-token" },
      permission: "read",
      timeout_ms: 5000,
      rate_limit_per_min: 10,
      enabled: true,
      created_at: new Date(),
    };

    const result = await dispatchTool(tool, {
      id: "record-123",
    });

    expect(result.is_error).toBeFalsy();
    expect(mockFetch).toHaveBeenCalled();
  });

  it("allows write operation when tool has write permission", async () => {
    const tool: TenantTool = {
      id: "test-tool",
      tenant_id: "tenant-1",
      name: "create_record",
      description: "Create a new record in the database",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string" },
          data: { type: "object" },
        },
      },
      endpoint: "https://api.example.com/records",
      auth_config: { type: "bearer", token: "test-token" },
      permission: "write",
      timeout_ms: 5000,
      rate_limit_per_min: 10,
      enabled: true,
      created_at: new Date(),
    };

    const result = await dispatchTool(tool, {
      action: "create",
      data: { name: "test" },
    });

    expect(result.is_error).toBeFalsy();
    expect(mockFetch).toHaveBeenCalled();
  });

  it("does not expose tool name in error message to customer", async () => {
    const tool: TenantTool = {
      id: "test-tool",
      tenant_id: "tenant-1",
      name: "secret_admin_tool",
      description: "Internal admin tool",
      input_schema: { type: "object", properties: {} },
      endpoint: "https://api.internal/admin",
      auth_config: { type: "bearer", token: "secret-token" },
      permission: "read",
      timeout_ms: 5000,
      rate_limit_per_min: 10,
      enabled: true,
      created_at: new Date(),
    };

    const result = await dispatchTool(tool, {
      action: "delete_all",
    });

    expect(result.is_error).toBe(true);
    // Error message should not reveal tool internals to customer
    expect(result.content).not.toContain("secret_admin_tool");
    expect(result.content).not.toContain("secret-token");
  });
});
