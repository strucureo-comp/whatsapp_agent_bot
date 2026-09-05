/**
 * Email AI Agent Turn.
 * Processes inbound customer emails through the tenant's configured LLM,
 * adapts formatting to professional email etiquette, and dispatches the reply.
 */

import { getPool } from "@/lib/db";
import { getDecryptedTenantSecret, SecretProvider } from "@/lib/tenant-secrets";
import { sendOutboundEmail } from "./sender";

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

interface EmailTurnOptions {
  tenantId: string;
  conversationId: string;
  inboundContent: string;
  customerEmail: string;
  customerName?: string;
  subject?: string;
  inReplyTo?: string;
}

export async function runEmailAgentTurn(opts: EmailTurnOptions): Promise<{
  replyContent: string;
  emailSent: boolean;
  messageId?: string;
}> {
  const { tenantId, conversationId, inboundContent, customerEmail, customerName, subject, inReplyTo } = opts;
  const pool = getPool();

  // 1. Fetch tenant info and company profile
  const tenantRes = await pool.query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM tenant_secrets ts WHERE ts.tenant_id = t.id) AS has_byok
     FROM tenants t WHERE t.id = $1`,
    [tenantId]
  );
  if (tenantRes.rowCount === 0) {
    throw new Error(`Tenant ${tenantId} not found`);
  }
  const tenant = tenantRes.rows[0];

  // 2. Fetch conversation history (up to last 10 messages)
  const historyRes = await pool.query(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC LIMIT 10`,
    [conversationId]
  );

  // 3. Build Email-specific system prompt
  const basePersona = (tenant.persona_prompt ?? "").trim() || "You are a professional customer support representative for the business.";
  const profile = (tenant.company_profile ?? {}) as Record<string, unknown>;
  const profileLines: string[] = [];
  for (const [key, val] of Object.entries(profile)) {
    if (val && typeof val === "string") {
      profileLines.push(`${key.replace(/_/g, " ")}: ${val}`);
    }
  }

  const bizName = (profile.business_name as string) || tenant.name || "our company";
  const salutation = customerName ? `Hi ${customerName},` : "Hello,";

  const systemPrompt = `${basePersona}

## Business profile (factual context):
${profileLines.length > 0 ? profileLines.map((l) => `- ${l}`).join("\n") : `- Business Name: ${bizName}`}

## Communication Channel: EMAIL
- You are answering the customer via formal email.
- Write with professional email structure:
  - Start with a polite greeting (${salutation}).
  - Answer clearly, helpfully, and concisely in 1 to 3 well-formatted paragraphs.
  - If providing options, use bullet points.
  - End with a professional sign-off (e.g., "Best regards,\nThe ${bizName} Team").
- NEVER say "I am an AI assistant", "As an AI model", or give disclaimer speeches.
- Speak directly as an authorized team member of ${bizName}.
`;

  // 4. Resolve LLM provider and credentials
  const provider = (tenant.llm_provider || "groq") as SecretProvider;
  const model = tenant.llm_model || (provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini");
  
  let apiKey = await getDecryptedTenantSecret(tenantId, provider).catch(() => null);
  if (!apiKey) {
    if (provider === "groq") apiKey = process.env.GROQ_API_KEY || null;
    else if (provider === "openai") apiKey = process.env.OPENAI_API_KEY || null;
    else if (provider === "anthropic") apiKey = process.env.ANTHROPIC_API_KEY || null;
  }

  const baseUrl = tenant.llm_base_url || DEFAULT_BASE_URLS[provider] || "https://api.groq.com/openai/v1";

  // Build message array for LLM
  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...historyRes.rows.map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];

  // If latest message is not in history yet
  if (historyRes.rows.length === 0 || historyRes.rows[historyRes.rows.length - 1].content !== inboundContent) {
    llmMessages.push({ role: "user", content: inboundContent });
  }

  let replyText = "";

  try {
    if (provider === "anthropic" && apiKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: llmMessages.filter((m) => m.role !== "system"),
          max_tokens: Math.min(tenant.reply_max_tokens || 800, 1500),
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      replyText = data?.content?.find((c: any) => c.type === "text")?.text?.trim() || "";
    } else if (apiKey) {
      // OpenAI-compatible endpoint
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = "https://www.strucureo.com";
        headers["X-Title"] = "Strucureo Omnichannel Agent";
      }

      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: llmMessages,
          temperature: 0.6,
          max_tokens: Math.min(tenant.reply_max_tokens || 800, 1500),
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      replyText = data?.choices?.[0]?.message?.content?.trim() || "";
    }
  } catch (err) {
    console.error("[Email Agent] LLM inference failed:", err);
  }

  // Fallback reply if LLM fails or no key
  if (!replyText) {
    replyText = `${salutation}\n\nThank you for getting in touch with ${bizName}. We have received your message regarding "${subject || "your inquiry"}" and a team member will follow up with you shortly.\n\nBest regards,\nThe ${bizName} Team`;
  }

  // 5. Save assistant reply in messages table
  const replySubject = subject ? (subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`) : "Re: Your Inquiry";
  
  const insertRes = await pool.query(
    `INSERT INTO messages (conversation_id, channel, role, content, subject, in_reply_to)
     VALUES ($1, 'email', 'assistant', $2, $3, $4)
     RETURNING id, created_at`,
    [conversationId, replyText, replySubject, inReplyTo || null]
  );

  // Touch conversation updated_at
  await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);

  // 6. Send outbound email to customer
  const sendResult = await sendOutboundEmail({
    tenantId,
    to: customerEmail,
    subject: replySubject,
    text: replyText,
    inReplyTo: inReplyTo,
  });

  return {
    replyContent: replyText,
    emailSent: sendResult.ok,
    messageId: insertRes.rows[0]?.id,
  };
}
