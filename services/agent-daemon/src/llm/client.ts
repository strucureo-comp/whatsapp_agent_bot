import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  MCP_CALL_REMINDER,
  MCP_PROMPT_MARKER,
  buildMcpPrompt,
  parseMcpToolCall,
} from "./mcp.js";

/**
 * Unified LLM client supporting both Anthropic (Claude) and Groq (open-source models).
 * The tenant's llm_provider field determines which client to use.
 */

export const LlmProviderSchema = z.enum(["anthropic", "groq"]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  tool_calls?: LlmToolCall[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ThinkingConfig {
  enabled: boolean;
  budget_tokens?: number;
}

export class LlmClient {
  private anthropic: Anthropic;
  private groq: Groq;

  constructor() {
    this.anthropic = new Anthropic();
    this.groq = new Groq();
  }

  async createMessage(
    provider: LlmProvider,
    model: string,
    messages: LlmMessage[],
    options: {
      maxTokens?: number;
      system?: string;
      tools?: LlmTool[];
      thinking?: ThinkingConfig;
    } = {},
  ): Promise<LlmResponse> {
    if (provider === "groq") {
      return this.createGroqMessage(model, messages, options);
    }
    return this.createAnthropicMessage(model, messages, options);
  }

  private async createAnthropicMessage(
    model: string,
    messages: LlmMessage[],
    options: {
      maxTokens?: number;
      system?: string;
      tools?: LlmTool[];
      thinking?: ThinkingConfig;
    } = {},
  ): Promise<LlmResponse> {
    const { maxTokens = 1024, system, tools, thinking } = options;

    // Convert messages to Anthropic format
    const claudeMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Build system blocks with cache control
    const systemBlocks: Anthropic.TextBlockParam[] = system
      ? [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ]
      : [];

    // Build tools
    const claudeTools: Anthropic.Tool[] = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    })) ?? [];

    // Build thinking config if enabled
    const thinkingConfig = thinking?.enabled
      ? {
          type: "enabled" as const,
          budget_tokens: thinking.budget_tokens ?? 10000,
        }
      : undefined;

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemBlocks.length > 0 ? systemBlocks : undefined,
      messages: claudeMessages,
      tools: claudeTools.length > 0 ? claudeTools : undefined,
      ...(thinkingConfig && { thinking: thinkingConfig }),
    });

    let content = "";
    const toolCalls: LlmToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // Safety net: a model that saw the MCP block may emit the textual
    // convention instead of a native call. Intercept it so raw JSON never
    // reaches the customer.
    if (claudeTools.length > 0) {
      const fenced = parseMcpToolCall(
        content,
        claudeTools.map((t) => t.name)
      );
      if (fenced.call) {
        content = fenced.text;
        toolCalls.push(fenced.call);
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    };
  }

  private async createGroqMessage(
    model: string,
    messages: LlmMessage[],
    options: {
      maxTokens?: number;
      system?: string;
      tools?: LlmTool[];
      thinking?: ThinkingConfig;
    } = {},
  ): Promise<LlmResponse> {
    const { maxTokens = 1024, system, tools } = options;

    // No tools requested — plain chat, every model supports this.
    if (!tools || tools.length === 0) {
      return this.groqChat(model, messages, { maxTokens, system });
    }

    // Models that already proved they reject native tools go straight
    // to the prompt-driven loop (one wasted 400 per process, max).
    if (!textOnlyModels.has(model)) {
      try {
        return await this.groqChat(model, messages, { maxTokens, system, tools });
      } catch (err) {
        if (!isToolUnsupportedError(err)) throw err;
        textOnlyModels.add(model);
      }
    }
    const out = await this.groqTextualToolCall(model, messages, { maxTokens, system, tools });
    if (out.tool_calls?.length) {
      // eslint-disable-next-line no-console
      console.info(`[llm] textual tool call on ${model}: ${out.tool_calls[0].name}`);
    }
    return out;
  }

  /**
   * Native OpenAI-style call. Throws on models without tool support —
   * the caller falls back to groqTextualToolCall.
   */
  private async groqChat(
    model: string,
    messages: LlmMessage[],
    options: {
      maxTokens?: number;
      system?: string;
      tools?: LlmTool[];
    },
  ): Promise<LlmResponse> {
    const { maxTokens = 1024, system, tools } = options;

    // Groq uses OpenAI-compatible format
    const groqMessages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [];

    // Add system message
    if (system) {
      groqMessages.push({ role: "system", content: system });
    }

    // Convert messages
    for (const msg of messages) {
      if (msg.role === "system") continue; // Already handled
      groqMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    // Build tools for Groq (OpenAI format)
    const groqTools = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const response = await this.groq.chat.completions.create({
      model,
      messages: groqMessages,
      max_tokens: maxTokens,
      tools: groqTools && groqTools.length > 0 ? groqTools : undefined,
      temperature: 0.7,
    });

    const choice = response.choices[0];
    let content = choice.message?.content ?? "";

    // Handle tool calls
    const toolCalls: LlmToolCall[] = [];
    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          input: safeParseToolArgs(tc.function.arguments),
        });
      }
    }

    // Same safety net as Anthropic: intercept a textual MCP block emitted
    // through the native path so raw JSON never reaches the customer.
    if (groqTools && groqTools.length > 0) {
      const fenced = parseMcpToolCall(
        content,
        groqTools.map((t) => t.function.name)
      );
      if (fenced.call) {
        content = fenced.text;
        toolCalls.push(fenced.call);
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  /**
   * Prompt-driven tool calling for models without a function-calling API.
   * The tool catalog goes into the system prompt with a strict ```tool
   * JSON-block convention; the block is parsed back into a tool call so the
   * agent loop above works unchanged for every model.
   */
  private async groqTextualToolCall(
    model: string,
    messages: LlmMessage[],
    options: {
      maxTokens?: number;
      system?: string;
      tools: LlmTool[];
    },
  ): Promise<LlmResponse> {
    const { maxTokens = 1024, system, tools } = options;

    // handle-message.ts already puts the shared MCP tools block in the
    // system prompt; only add it here for direct client users (eval etc.).
    // Either way the same ```tool convention + parser applies.
    const base = system ?? "You are a helpful assistant.";
    const toolSystem = base.includes(MCP_PROMPT_MARKER)
      ? `${base}\n\n${MCP_CALL_REMINDER}`
      : `${base}\n\n${buildMcpPrompt(tools)}`;

    const groqMessages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: toolSystem },
    ];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      groqMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    const names = tools.map((t) => t.name);

    // Attempt 1: JSON-mode router — response_format forces valid JSON, so
    // even stubborn models must decide. One call returns both the tool
    // decision and a sendable draft reply.
    try {
      const routerSystem =
        `${toolSystem}\n\nNow respond with EXACTLY one JSON object, no other text:\n` +
        `{"tool": {"name": "<one of: ${names.join(", ")}>", "arguments": {<schema args>}} | null, ` +
        `"reply": "<your direct reply to the user, complete on its own>"}\n` +
        `Set tool (not null) whenever the latest user message matches a tool's job. ` +
        `reply must always be finished text you could send as-is.`;
      const routed = await this.groq.chat.completions.create({
        model,
        messages: [{ role: "system", content: routerSystem }, ...groqMessages.slice(1)],
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_object" },
      });
      const rawRouted = routed.choices[0].message?.content ?? "";
      const decision = parseRouterJson(rawRouted, names);
      if (decision) {
        // eslint-disable-next-line no-console
        console.info(`[llm] json-router on ${model}: tool=${decision.call?.name ?? "none"}`);
        return {
          content: decision.reply,
          tool_calls: decision.call ? [decision.call] : undefined,
          usage: {
            input_tokens: routed.usage?.prompt_tokens ?? 0,
            output_tokens: routed.usage?.completion_tokens ?? 0,
          },
        };
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info(
        `[llm] json-router failed on ${model}, fence fallback: ${String(err).slice(0, 120)}`
      );
    }

    // Attempt 2: plain text + ```tool fence parse (legacy path).
    const response = await this.groq.chat.completions.create({
      model,
      messages: groqMessages,
      max_tokens: maxTokens,
      temperature: 0,
    });

    const raw = response.choices[0].message?.content ?? "";
    const parsed = parseMcpToolCall(raw, names);

    return {
      content: parsed.text,
      tool_calls: parsed.call ? [parsed.call] : undefined,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Parse the JSON-mode router output. Null when unusable (caller falls
 * through to the fence parser). Unknown tool names are dropped while the
 * reply still stands on its own.
 */
function parseRouterJson(
  raw: string,
  knownTools: string[],
): { reply: string; call?: LlmToolCall } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as { tool?: unknown; reply?: unknown };
  const reply = typeof obj.reply === "string" && obj.reply.trim() ? obj.reply : "";
  let call: LlmToolCall | undefined;
  if (typeof obj.tool === "object" && obj.tool !== null) {
    const t = obj.tool as { name?: unknown; arguments?: unknown };
    if (typeof t.name === "string" && knownTools.includes(t.name)) {
      call = {
        name: t.name,
        input:
          typeof t.arguments === "object" && t.arguments !== null
            ? (t.arguments as Record<string, unknown>)
            : {},
      };
    }
  }
  if (!reply && !call) return null;
  return { reply, call };
}

// Models proven (this process) to reject native tool definitions.
const textOnlyModels = new Set<string>();

function isToolUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /tool/i.test(msg) && /not supported/i.test(msg);
}

function safeParseToolArgs(args: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(args);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Singleton
let _client: LlmClient | undefined;
export function getLlmClient(): LlmClient {
  if (!_client) {
    _client = new LlmClient();
  }
  return _client;
}
