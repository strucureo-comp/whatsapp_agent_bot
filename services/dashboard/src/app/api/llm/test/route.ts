// NOTE: both tests attach a dummy tool. The bot always sends tools when any
// exist (calendar built-ins), and some models 400 on that — the test must
// prove tool-calling works, not just plain chat.
async function testGroq(model: string, key: string) {
  const started = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 5,
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
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Groq HTTP ${res.status}`);
  }
  const msg = body?.choices?.[0]?.message ?? {};
  const sample: string = (msg?.content?.trim() || "(no text — model may have tool-called instead)") as string;
  const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : 0;
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
      max_tokens: 5,
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
  const sample = blocks.find((b) => b.type === "text")?.text?.trim() ?? "(empty)";
  return { sample, latency_ms: Date.now() - started };
}

export async function POST(request: Request) {
  let body: { provider?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { provider, model } = body;
  if ((provider !== "groq" && provider !== "anthropic") || !model) {
    return Response.json(
      { error: "provider must be groq|anthropic and model is required" },
      { status: 400 }
    );
  }
  const key = provider === "groq" ? process.env.GROQ_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json(
      { error: `No API key configured for ${provider} (server .env)` },
      { status: 400 }
    );
  }
  try {
    const result = provider === "groq" ? await testGroq(model, key) : await testAnthropic(model, key);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
