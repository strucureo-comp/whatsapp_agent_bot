import type { LlmTool, LlmToolCall } from "./client.js";

/**
 * MCP-style tool prompting.
 *
 * Every turn that offers tools carries this block in the system prompt —
 * a tools/list-style catalog plus one strict calling convention — so ANY
 * model knows what it can call and exactly how, whether it uses native
 * function-calling or the prompt-driven fallback in client.ts.
 */

export const MCP_PROMPT_MARKER = "<mcp-tools>";

const TOOL_FENCE = "```tool";
const FENCE_END = "```";

export function buildMcpPrompt(tools: LlmTool[]): string {
  const catalog = tools
    .map(
      (t) =>
        `<tool name="${t.name}">\n<description>${t.description}</description>\n<parameters>${JSON.stringify(t.input_schema)}</parameters>\n</tool>`
    )
    .join("\n");
  return `${MCP_PROMPT_MARKER}
## Tools (call these instead of answering from memory)
<tools>
${catalog}
</tools>

Decision rule: if the user's message matches what a tool above does — availability, booking, lookup, action — you MUST call it first. NEVER invent times, slots, confirmations, records, or emails when a tool exists for the job.
How to call: if your API offers native function calling, use it normally and write NO text. ONLY if function calling is NOT available to you, reply with exactly this block and nothing else (no greeting, no explanation):
${TOOL_FENCE}
{"name": "<tool name>", "arguments": {<args matching its parameters schema>}}
${FENCE_END}
Rules: valid JSON; exactly one tool per message; omit optional arguments you do not need. After a "Tool result for ..." message arrives, use its facts in your reply. If no tool fits, answer normally.`;
}

/** Short nudge used when the full block is already in the system prompt. */
export const MCP_CALL_REMINDER = `Reminder: to use a tool, reply with ONLY a ${TOOL_FENCE} block ({"name": ..., "arguments": {...}}). If no tool fits, answer normally.`;

/**
 * Pull a ```tool {"name","arguments"}``` block out of model text.
 * Unknown tool names are ignored so a confused model degrades to a
 * plain answer instead of executing something unexpected.
 */
export function parseMcpToolCall(
  raw: string,
  knownTools: Set<string> | string[],
): { text: string; call?: LlmToolCall } {
  const known = Array.isArray(knownTools) ? new Set(knownTools) : knownTools;
  const fence = raw.match(/```tool\s*([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fence?.[1]) candidates.push(fence[1]);
  candidates.push(raw);
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { name?: unknown }).name === "string" &&
        known.has((parsed as { name: string }).name)
      ) {
        const { name } = parsed as { name: string };
        const args = (parsed as { arguments?: unknown }).arguments;
        const text = fence ? raw.replace(fence[0], "").trim() : "";
        return {
          text,
          call: {
            name,
            input:
              typeof args === "object" && args !== null
                ? (args as Record<string, unknown>)
                : {},
          },
        };
      }
    } catch {
      // Not JSON — try the next candidate.
    }
  }
  return { text: raw };
}
