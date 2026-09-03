import type { TenantTool } from "@/repos/tool.js";
import { screenToolResult } from "./safety.js";

/**
 * Tool dispatcher — runs a tool call against the registered endpoint.
 * Permission gate lives here: each tool's run() checks permission before executing.
 */

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  /** False when the permission gate refused — used for the audit log. */
  allowed?: boolean;
}

export async function dispatchTool(
  tool: TenantTool,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  // Permission gate — enforced inside each tool's run()
  if (tool.permission === "read" && isWriteOperation(input)) {
    return {
      tool_use_id: "",
      content: "Permission denied: this tool is read-only for the requested operation.",
      is_error: true,
      allowed: false,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), tool.timeout_ms);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Attach auth if configured — never rendered into prompts
    if (tool.auth_config) {
      const auth = tool.auth_config as Record<string, string>;
      if (auth.type === "bearer") {
        headers["Authorization"] = `Bearer ${auth.token}`;
      } else if (auth.type === "api_key") {
        headers[auth.header || "X-API-Key"] = auth.key;
      }
    }

    const response = await fetch(tool.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        tool_use_id: "",
        content: `Tool "${tool.name}" returned status ${response.status}`,
        is_error: true,
        allowed: true,
      };
    }

    const body = await response.text();

    // Response size cap — prevent context window blowout
    const maxSize = 10000;
    const truncated = body.length > maxSize ? body.slice(0, maxSize) + "...[truncated]" : body;

    // REST bodies are third-party content: strip override payloads, frame the rest.
    const screened = screenToolResult(tool.name, truncated);
    return {
      tool_use_id: "",
      content: screened.text,
      allowed: true,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        tool_use_id: "",
        content: `Tool "${tool.name}" timed out after ${tool.timeout_ms}ms`,
        is_error: true,
        allowed: true,
      };
    }
    return {
      tool_use_id: "",
      content: `Tool "${tool.name}" error: ${err}`,
      is_error: true,
      allowed: true,
    };
  }
}

function isWriteOperation(input: Record<string, unknown>): boolean {
  // Heuristic: if the input has action/method fields that suggest mutation
  const writeIndicators = ["create", "update", "delete", "remove", "post", "put", "patch"];
  const inputStr = JSON.stringify(input).toLowerCase();
  return writeIndicators.some((indicator) => inputStr.includes(indicator));
}
