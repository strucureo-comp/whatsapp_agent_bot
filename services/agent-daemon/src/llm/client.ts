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

export const LlmProviderSchema = z.enum([
  "anthropic", "openai", "groq", "openrouter", "together", "fireworks",
  "gemini", "deepseek", "xai", "ollama", "custom",
]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

/** Default base URLs — OpenAI-compatible /chat/completions for every one. */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

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

export interface LlmKeys {
  anthropicKey?: string;
  groqKey?: string;
  /** Key for any non-anthropic provider (openai/openrouter/custom/…). */
  genericKey?: string;
  /** Tenant-set base URL; falls back to PROVIDER_BASE_URLS by provider. */
  baseUrl?: string;
}

export class LlmClient {
  private anthropic: Anthropic;
  private groq: Groq;
  private keys: LlmKeys;

  constructor(keys: LlmKeys = {}) {
    // Per-tenant BYOK first, platform env key as fallback. The SDKs read
    // env themselves when no explicit key is passed.
    this.anthropic = new Anthropic(
      keys.anthropicKey ? { apiKey: keys.anthropicKey } : undefined
    );
    const groqOpts: { apiKey?: string; baseURL?: string } = {};
    if (keys.groqKey) groqOpts.apiKey = keys.groqKey;
    if (keys.baseUrl) groqOpts.baseURL = keys.baseUrl;
    this.groq = new Groq(Object.keys(groqOpts).length > 0 ? groqOpts : undefined);
    this.keys = keys;
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
    if (provider === "anthropic") {
      return this.createAnthropicMessage(model, messages, options);
    }
    // Everything else speaks OpenAI-compatible /chat/completions. Groq keeps
    // its SDK path (it is the platform default); all others go generic.
    if (provider === "groq") {
      return this.createGroqMessage(model, messages, options);
    }
    return this.createOpenAICompatibleMessage(provider, model, messages, options);
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

    const response = await withGroqRetry(() =>
      this.groq.chat.completions.create({
        model,
        messages: groqMessages,
        max_tokens: maxTokens,
        tools: groqTools && groqTools.length > 0 ? groqTools : undefined,
        temperature: 0.7,
      }),
    );

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
      const routed = await withGroqRetry(() =>
        this.groq.chat.completions.create({
          model,
          messages: [{ role: "system", content: routerSystem }, ...groqMessages.slice(1)],
          max_tokens: maxTokens,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      );
      const rawRouted = routed.choices[0].message?.content ?? "";
      const decision = parseRouterJson(rawRouted, names);
      if (decision) {
        // eslint-disable-next-line no-console
        console.info(`[llm] json-router on ${model}: tool=${decision.call?.name ?? "none"}`);
        return {
          content: decision.call ? "" : decision.reply,
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
    const response = await withGroqRetry(() =>
      this.groq.chat.completions.create({
        model,
        messages: groqMessages,
        max_tokens: maxTokens,
        temperature: 0,
      }),
    );

    const raw = response.choices[0].message?.content ?? "";
    const parsed = parseMcpToolCall(raw, names);

    return {
      content: parsed.call ? "" : parsed.text,
      tool_calls: parsed.call ? [parsed.call] : undefined,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  /**
   * Any-provider path: OpenAI-compatible /chat/completions over plain fetch.
   * Covers openai, openrouter, together, fireworks, gemini (OpenAI-compat
   * endpoint), deepseek, xai, ollama and fully custom base URLs. Same tool
   * chain as Groq: native tools → JSON-mode router → fence fallback.
   */
  private async createOpenAICompatibleMessage(
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
    const { maxTokens = 1024, system, tools } = options;
    const base = this.keys.baseUrl?.replace(/\/+$/, "") || PROVIDER_BASE_URLS[provider];
    if (!base) {
      throw new Error(`No base URL for provider "${provider}" — set one in the dashboard`);
    }
    const apiKey = this.keys.genericKey ?? this.keys.groqKey;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://www.strucureo.com";
      headers["X-Title"] = "Strucureo WhatsApp Agent";
    }

    const chatMessages = system
      ? [{ role: "system" as const, content: system }]
      : [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      chatMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
    }
    const oaiTools = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const call = async (body: Record<string, unknown>) =>
      fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`${provider} HTTP ${res.status}: ${text.slice(0, 300)}`);
        }
        return (await res.json()) as {
          choices?: { message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
      });

    // Attempt 1: native OpenAI-style tools.
    if (oaiTools && oaiTools.length > 0) {
      try {
        const body = await call({
          model,
          messages: chatMessages,
          max_tokens: maxTokens,
          tools: oaiTools,
        });
        const msg = body.choices?.[0]?.message;
        let content = msg?.content ?? "";
        const toolCalls: LlmToolCall[] = [];
        for (const tc of msg?.tool_calls ?? []) {
          if (tc.function?.name) {
            toolCalls.push({
              name: tc.function.name,
              input: safeParseToolArgs(tc.function.arguments ?? "{}"),
            });
          }
        }
        // Fence safety net (same as SDK paths).
        if (oaiTools.length > 0) {
          const fenced = parseMcpToolCall(content, oaiTools.map((t) => t.function.name));
          if (fenced.call) {
            content = fenced.text;
            toolCalls.push(fenced.call);
          }
        }
        return {
          content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: {
            input_tokens: body.usage?.prompt_tokens ?? 0,
            output_tokens: body.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err) {
        if (!isToolUnsupportedError(err)) throw err;
        // fall through to router
      }
    }

    // Attempt 2: JSON-mode router (works on json_object-capable providers).
    const names = (tools ?? []).map((t) => t.name);
    const toolSystem = system ?? "You are a helpful assistant.";
    const withTools =
      names.length > 0
        ? toolSystem.includes(MCP_PROMPT_MARKER)
          ? `${toolSystem}\n\n${MCP_CALL_REMINDER}`
          : `${toolSystem}\n\n${buildMcpPrompt(tools!)}`
        : toolSystem;
    const routerMessages = [{ role: "system" as const, content: withTools }, ...chatMessages.slice(system ? 1 : 0)];
    try {
      const routed = await call({
        model,
        messages: routerMessages,
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_object" },
      });
      const decision = parseRouterJson(routed.choices?.[0]?.message?.content ?? "", names);
      if (decision && (decision.reply || decision.call)) {
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
      // Router unsupported — plain completion with fence parsing.
      void err;
    }

    // Attempt 3: plain text + fence.
    const plain = await call({
      model,
      messages: names.length > 0 ? routerMessages : chatMessages,
      max_tokens: maxTokens,
      temperature: 0,
    });
    const raw = plain.choices?.[0]?.message?.content ?? "";
    const parsed = parseMcpToolCall(raw, names);
    return {
      content: parsed.text,
      tool_calls: parsed.call ? [parsed.call] : undefined,
      usage: {
        input_tokens: plain.usage?.prompt_tokens ?? 0,
        output_tokens: plain.usage?.completion_tokens ?? 0,
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

async function withGroqRetry<T>(fn: () => Promise<T>, maxRetries = 2, delayMs = 1500): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      const e = err as {
        status?: number;
        message?: string;
        error?: { code?: string; type?: string };
        headers?: Record<string, string>;
      };
      const is429 =
        e?.status === 429 ||
        e?.status === 503 ||
        String(e?.message || "").includes("429") ||
        e?.error?.code === "rate_limit_exceeded";
      if (is429 && attempt <= maxRetries) {
        const retryAfterSec = parseFloat(e?.headers?.["retry-after"] || "1.5");
        const waitMs = isNaN(retryAfterSec) ? delayMs : Math.max(retryAfterSec * 1000, delayMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
}

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

// Small client cache keyed by credential set. 1000 tenants share platform
// keys (1 entry); BYOK tenants get their own. FIFO-capped, never logs keys.
const _clients = new Map<string, LlmClient>();

export function getLlmClient(keys: LlmKeys = {}): LlmClient {
  const cacheKey = `a${hashTail(keys.anthropicKey)}:g${hashTail(keys.groqKey)}:o${hashTail(keys.genericKey)}:${keys.baseUrl ?? ""}`;
  const hit = _clients.get(cacheKey);
  if (hit) return hit;
  const client = new LlmClient(keys);
  _clients.set(cacheKey, client);
  if (_clients.size > 100) {
    const oldest = _clients.keys().next().value;
    if (oldest !== undefined) _clients.delete(oldest);
  }
  return client;
}

function hashTail(key: string | undefined): string {
  if (!key) return "";
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return `:${(h >>> 0).toString(36)}`;
}
