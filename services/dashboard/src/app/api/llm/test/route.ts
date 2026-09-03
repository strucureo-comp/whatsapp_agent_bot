import { getDecryptedTenantSecret, SecretProvider } from "@/lib/tenant-secrets";

const DEFAULT_BASE_URLS: Record<string, string> = {
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



async function testOpenAICompatible(opts: {
  provider: string;
  baseUrl: string;
  model: string;
  key?: string;
}) {
  const { provider, baseUrl, model, key } = opts;
  const started = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://www.strucureo.com";
    headers["X-Title"] = "Strucureo WhatsApp Agent";
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 15,
      temperature: 0,
      tools: [
        {
          type: "function",
          function: {
            name: "ping",
            description: "Test tool, do not call it.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `${provider} HTTP ${res.status}`;
    throw new Error(msg);
  }

  const choice = body?.choices?.[0]?.message ?? {};
  const sample: string = (choice?.content?.trim() || "(tool-call response)") as string;
  const toolCalls = Array.isArray(choice?.tool_calls) ? choice.tool_calls.length : 0;
  return { sample, tool_calls: toolCalls, latency_ms: Date.now() - started };
}

async function testAnthropic(model: string, key: string) {
  const started = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 15,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      tools: [
        {
          name: "ping",
          description: "Test tool, do not call it.",
          input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.message ?? `Anthropic HTTP ${res.status}`;
    throw new Error(detail);
  }
  const blocks: { type?: string; text?: string }[] = body?.content ?? [];
  const sample = blocks.find((b) => b.type === "text")?.text?.trim() ?? "(tool-call response)";
  return { sample, latency_ms: Date.now() - started };
}

export async function POST(request: Request) {
  let body: { provider?: string; model?: string; tenantId?: string; baseUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, model, tenantId, baseUrl } = body;
  if (!provider || !model) {
    return Response.json({ error: "provider and model are required" }, { status: 400 });
  }
  if (!tenantId) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  // Resolve key from tenant_secrets DB — no env fallback
  const key = await getDecryptedTenantSecret(tenantId, provider as SecretProvider);

  // Ollama or custom endpoints might not need keys
  if (!key && provider !== "ollama" && provider !== "custom") {
    return Response.json(
      {
        error: `No API key configured for ${provider}. Save your API key in the dashboard first.`,
      },
      { status: 400 }
    );
  }

  try {
    if (provider === "anthropic") {
      if (!key) throw new Error("Anthropic requires an API key");
      const result = await testAnthropic(model, key);
      return Response.json({ ok: true, ...result });
    }

    const resolvedBaseUrl = baseUrl?.trim() || DEFAULT_BASE_URLS[provider];
    if (!resolvedBaseUrl) {
      return Response.json(
        { error: `Provider "${provider}" requires a Base URL.` },
        { status: 400 }
      );
    }

    const result = await testOpenAICompatible({
      provider,
      baseUrl: resolvedBaseUrl,
      model,
      key: key ?? undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
