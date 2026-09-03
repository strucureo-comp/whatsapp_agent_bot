import { getEnv } from "@/config/env.js";
import { getLogger } from "@/lib/logger.js";
import { getPool } from "@/db/pool.js";
import { getRecentMessages, createMessage } from "@/repos/message.js";
import { getConversation } from "@/repos/conversation.js";
import { getTools } from "@/repos/tool.js";
import { getLlmClient, type LlmProvider } from "@/llm/client.js";
import { buildMcpPrompt } from "@/llm/mcp.js";
import { classifyInput, CANNED_JAILBREAK_REPLY } from "./classifier.js";
import { checkEscalationTriggers, escalateConversation, HOLDING_MESSAGE } from "./escalation.js";
import { checkRateLimit, checkSpendCap } from "./rate-limit.js";
import { dispatchTool } from "@/tools/dispatcher.js";
import { screenToolResult } from "@/tools/safety.js";
import { logToolAttempt } from "@/repos/audit.js";
import {
  CALENDAR_TOOL_NAMES,
  calendarToolDefinitions,
  fmtIST,
  getCalendarContext,
  runBookMeeting,
  runCancelMeeting,
  runCheckAvailability,
  shortISTLabel,
  todayTomorrowIST,
} from "@/tools/calendar-tools.js";

/**
 * Clamp a caller-supplied clock to reality. WhatsApp timestamps are
 * sender-clock seconds — trust them within ±6h, else use server time.
 */
function sanitizeAnchorMs(nowMs?: number): Date {
  if (typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs > 0) {
    const skew = Math.abs(Date.now() - nowMs);
    if (skew <= 6 * 3_600_000) return new Date(nowMs);
  }
  return new Date();
}
import Redis from "ioredis";

export interface InboundMessage {
  message_id?: string;
  content: string;
  role?: "user";
  from_jid?: string;
  timestamp?: number;
  addressing_mode?: string;
}

export interface AgentReply {
  content: string;
  /** True when the turn was recorded but intentionally not answered (human/escalated mode). */
  skipped?: boolean;
  tool_failures?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

const MAX_TOOL_ROUNDS = 8;
const THINKING_BUDGET = 10000;

let _sharedRedis: Redis | undefined;
export function getSharedRedis(): Redis {
  if (!_sharedRedis) {
    const env = getEnv();
    _sharedRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
    _sharedRedis.on("error", (err) => {
      getLogger().warn({ err }, "Shared Redis error");
    });
  }
  return _sharedRedis;
}

/**
 * Company profile (tenants.company_profile, edited from the dashboard) rendered
 * as factual context, plus a non-overridable identity rule so the model answers
 * as the business instead of as Groq/Anthropic/Meta.
 */
function buildSystemPrompt(
  tenant: {
    persona_prompt?: string | null;
    company_profile?: Record<string, unknown> | null;
  },
  calendarConnected: boolean,
): string {
  const base =
    (tenant.persona_prompt ?? "").trim() || "You are a helpful WhatsApp assistant for the business.";
  const profile = (tenant.company_profile ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const push = (label: string, v: unknown) => {
    if (Array.isArray(v)) {
      const items = v.map((x) => String(x).trim()).filter(Boolean);
      if (items.length > 0) lines.push(`${label}: ${items.join("; ")}`);
      return;
    }
    const s = text(v);
    if (s) lines.push(`${label}: ${s}`);
  };
  push("Business name", profile.business_name);
  push("Industry", profile.industry);
  push("About", profile.about);
  push("Hours", profile.hours);
  push("Address", profile.address);
  push("Phone", profile.phone);
  push("Email", profile.email);
  push("Website", profile.website);
  push("Services / products", profile.services);
  push("Policies", profile.policies);

  let system = base;
  if (lines.length > 0) {
    system +=
      "\n\n## Business profile (factual — use this when customers ask about the business)\n" +
      lines.map((l) => `- ${l}`).join("\n");
  }
  const bizName = text(profile.business_name) || "this business";
  system += `\n\nIdentity rule: you are ${bizName}'s WhatsApp assistant. Never claim to be Groq, Anthropic, Claude, Meta, or any model company, and never share vendor links, emails, or handles.`;
  if (calendarConnected) {
    system +=
      "\n\nBooking: check_availability and book_meeting tools are wired to the real business calendar. For ANY meeting question, call check_availability first and book_meeting to confirm. Never state a meeting is booked, cancelled, moved, or that an invite was sent unless the tool just returned it.";
  } else {
    system +=
      "\n\nBooking: you have NO calendar access and NO booking tools. Never claim a meeting is booked, cancelled, rescheduled, or that an invite was sent. Offer to take the details (date, time, email) for the team to confirm.";
  }
  return system;
}

function getModelConfig(model: string, replyMaxTokens: number): {
  thinking: { enabled: boolean; budget_tokens: number } | undefined;
  maxTokens: number;
} {
  const supportsThinking = model.includes("claude") && !model.includes("haiku");
  if (!supportsThinking) {
    return { thinking: undefined, maxTokens: replyMaxTokens };
  }
  // Anthropic requires max_tokens > thinking budget. Keep the customer-facing
  // reply cap via truncation, but give the API enough headroom for thinking.
  return {
    thinking: { enabled: true, budget_tokens: THINKING_BUDGET },
    maxTokens: Math.max(replyMaxTokens, THINKING_BUDGET + 1024),
  };
}

/**
 * The single path to the model. Used by both the live consumer and the test command.
 * Accepts a list of messages for burst coalescing.
 */
export async function handleMessage(
  tenantId: string,
  conversationId: string,
  messages: InboundMessage[],
  opts?: { nowMs?: number; freshSession?: boolean },
): Promise<AgentReply> {
  const log = getLogger();
  const env = getEnv();
  const pool = getPool();
  const client = await pool.connect();
  const llm = getLlmClient();
  // Anchor "today" to when the customer WROTE, not when we process.
  // Overnight queues used to flip the date mid-turn (sent 11:55 PM,
  // processed 12:05 AM → "tomorrow" moved a day).
  const anchorNow = sanitizeAnchorMs(opts?.nowMs);
  let toolFailures = 0;
  // Set only when book_meeting/cancel_meeting SUCCEED this turn — the single
  // fact that permits booking-completion language in the reply.
  let bookingToolRan = false;

  // Past-tense completion claims vs legitimate descriptions of existing
  // calendar state ("you already have X booked"). Descriptive patterns are
  // allowed first; only ungrounded completion claims are blocked.
  const DESCRIBE_EXISTING =
    /(already|currently|existing).{0,40}(booked|scheduled)|booked.{0,25}on your calendar|nothing (is |are )?(booked|scheduled)|no (meetings|events).{0,25}(booked|scheduled)/i;
  const BOOKING_CLAIM =
    /\b(meeting booked|booked (your|for|a meeting)|invite.{0,12}sent|is now set for|rescheduled|moved (your|the) meeting|booking confirmed|your meeting is confirmed|cancelled)\b/i;
  const hasUngroundedBookingClaim = (text: string) => {
    if (DESCRIBE_EXISTING.test(text)) return false;
    return BOOKING_CLAIM.test(text);
  };

  try {
    // Verify the conversation belongs to this tenant — prevents cross-tenant reads.
    const conversation = await getConversation(client, conversationId, tenantId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found for tenant ${tenantId}`);

    // Deterministic date/time answers — never send "what day is it" to the
    // LLM. It free-styles weekdays ("Thursday, 4 Sept" for a Friday) even
    // with anchors in the prompt. Answered from the message-time anchor.
    const dateAnswer = answerDateTimeQuestion(
      messages.map((m) => m.content).join("\n"),
      anchorNow,
    );
    if (dateAnswer) {
      for (const msg of messages) {
        await createMessage(client, {
          conversationId,
          waMessageId: msg.message_id,
          role: "user",
          content: msg.content,
        });
      }
      await createMessage(client, { conversationId, role: "assistant", content: dateAnswer });
      return { content: dateAnswer };
    }

    // Human / escalated mode: the bot stays silent so staff can talk.
    // Inbound is still saved (history keeps loading) but no LLM call, no reply.
    if (conversation.status !== "active") {
      log.info(
        { tenantId, conversationId, status: conversation.status },
        "Conversation not bot-handled, recording without reply",
      );
      for (const msg of messages) {
        await createMessage(client, {
          conversationId,
          waMessageId: msg.message_id,
          role: "user",
          content: msg.content,
        });
      }
      return { content: "", skipped: true };
    }

    // Fetch tenant config
    const tenantResult = await client.query(
      "SELECT * FROM tenants WHERE id = $1",
      [tenantId],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    // Rate limit check — needs Redis, not a pg client.
    const rateLimitKey = `ratelimit:${tenantId}:${conversationId}`;
    const rateLimit = await checkRateLimit(getSharedRedis(), rateLimitKey, 30, 60_000);
    if (!rateLimit.allowed) {
      log.warn({ tenantId, conversationId }, "Rate limit exceeded");
      return {
        content: "You're sending messages too quickly. Please wait a moment and try again.",
      };
    }

    // Spend cap check
    const spendCheck = await checkSpendCap(pool, tenantId);
    if (!spendCheck.allowed) {
      log.warn(
        { tenantId, spendCents: spendCheck.spendCents, capCents: spendCheck.capCents },
        "Spend cap exceeded",
      );
      return {
        content: "I've reached the spending limit for this month. Please contact support.",
      };
    }

    const normalized = messages.map((m) => ({ role: "user" as const, content: m.content }));

    // Classifier pre-pass
    const classifierResult = await classifyInput(
      tenantId,
      conversationId,
      normalized,
    );

    if (!classifierResult.safe) {
      log.warn(
        { tenantId, conversationId, category: classifierResult.category },
        "Input flagged by classifier",
      );

      // Save the flagged user message
      for (const msg of messages) {
        await createMessage(client, {
          conversationId,
          waMessageId: msg.message_id,
          role: "user",
          content: msg.content,
        });
      }

      // Save the refusal
      await createMessage(client, {
        conversationId,
        role: "assistant",
        content: CANNED_JAILBREAK_REPLY,
      });

      return { content: CANNED_JAILBREAK_REPLY };
    }

    // Check escalation triggers (pre-LLM: explicit requests / complaints).
    // toolFailures is 0 here; post-tool failures are checked after execution.
    const triggers = checkEscalationTriggers(normalized, toolFailures);

    if (triggers.length > 0) {
      log.info({ tenantId, conversationId, triggers }, "Escalation triggered");

      // Escalate the conversation
      await escalateConversation(
        client,
        conversationId,
        tenantId,
        triggers,
        messages.map((m) => m.content).join("\n"),
      );

      // Save user messages
      for (const msg of messages) {
        await createMessage(client, {
          conversationId,
          waMessageId: msg.message_id,
          role: "user",
          content: msg.content,
        });
      }

      // Send holding message
      await createMessage(client, {
        conversationId,
        role: "assistant",
        content: HOLDING_MESSAGE,
      });

      return { content: HOLDING_MESSAGE };
    }

    // Audit must never break a reply.
    const safeAudit = async (toolName: string, input: Record<string, unknown>, allowed: boolean) => {
      try {
        await logToolAttempt(client, {
          tenantId,
          toolName,
          conversationId,
          allowed,
          requestSummary: input,
        });
      } catch (err) {
        log.warn({ tenantId, toolName, err }, "Audit log write failed");
      }
    };

    // Session window: idle past the window → this turn sees no history.
    // Storage is untouched (dashboard history keeps everything); only the
    // model's context starts fresh so stale topics stop leaking in.
    if (opts?.freshSession) {
      log.info({ tenantId, conversationId }, "Session window expired — fresh turn, history skipped");
    }

    // Fetch tools for this tenant only
    const tools = await getTools(client, tenantId);

    // Built-in calendar tools — live only when a calendar is actually connected.
    const calCtx = await getCalendarContext(client, {
      id: tenantId,
      google_calendar_id: tenant.google_calendar_id,
    });

    // Build conversation history (tenant-verified) — skipped on fresh sessions.
    const history = opts?.freshSession
      ? []
      : await getRecentMessages(client, conversationId, 20, tenantId);

    // Build messages array
    const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // Add history
    for (const msg of history) {
      llmMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    // Add new messages
    for (const msg of messages) {
      llmMessages.push({
        role: "user",
        content: msg.content,
      });
    }

    // Build tools — tenant REST tools plus built-in calendar tools when connected.
    const llmTools = [
      ...tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Record<string, unknown>,
      })),
      ...(calCtx ? calendarToolDefinitions() : []),
    ];

    // Sort tool definitions by name — critical for cache hit rate
    llmTools.sort((a, b) => a.name.localeCompare(b.name));

    // Determine provider and model
    const provider: LlmProvider = tenant.llm_provider === "groq" ? "groq" : "anthropic";
    const model = tenant.llm_model || env.DEFAULT_LLM_MODEL;
    const replyMaxTokens: number = tenant.reply_max_tokens ?? 400;
    const { thinking, maxTokens } = getModelConfig(model, replyMaxTokens);

    // Add today's date as context — in the BUSINESS timezone (IST), not UTC,
    // with tomorrow pre-computed so the model never does date arithmetic.
    // Anchored to the customer's message time, plus the exact send time so
    // "now" is unambiguous even for queued/retried turns.
    const { todayISO, tomorrowISO } = todayTomorrowIST(anchorNow);
    const latestSent = Math.max(
      ...messages.map((m) =>
        typeof m.timestamp === "number" && m.timestamp > 0 ? m.timestamp * 1000 : anchorNow.getTime(),
      ),
    );
    llmMessages.push({
      role: "user",
      content:
        `[Today is ${todayISO}, tomorrow is ${tomorrowISO} (Asia/Kolkata). When the user says "tomorrow", use ${tomorrowISO}.] ` +
        `[Customer's latest message sent at ${fmtIST(new Date(latestSent).toISOString())} (Asia/Kolkata).]`,
    });

    // System prompt: persona + dashboard company profile + identity/booking guardrails.
    let systemPrompt = buildSystemPrompt(tenant, calCtx !== null);

    // MCP-style tools block: every model sees the catalog + calling convention
    // in the prompt itself, not just via the provider's function-calling API.
    if (llmTools.length > 0) {
      systemPrompt += `\n\n${buildMcpPrompt(llmTools)}`;
    }
    const offerTools = llmTools.length > 0;

    // Call the model. Some models (e.g. groq/compound-mini) reject tool
    // definitions outright — fall back to a tool-less turn rather than
    // failing the customer's message forever.
    let response;
    try {
      response = await llm.createMessage(
        provider,
        model,
        llmMessages.map((m) => ({ ...m, role: m.role })),
        {
          maxTokens,
          system: systemPrompt,
          tools: offerTools ? llmTools : undefined,
          thinking,
        },
      );
    } catch (err) {
      if (offerTools && isToolUnsupportedError(err)) {
        log.warn(
          { tenantId, provider, model },
          "Model rejects tool calling — retrying without tools",
        );
        response = await llm.createMessage(
          provider,
          model,
          llmMessages.map((m) => ({ ...m, role: m.role })),
          {
            maxTokens,
            system:
              systemPrompt +
              "\n\nTooling unavailable on this model: you have NO tools. Never claim bookings, availability checks, or any external action — take the details for the team.",
            tools: undefined,
            thinking,
          },
        );
      } else {
        throw err;
      }
    }

    let replyContent = response.content;
    let totalUsage = {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
    };

    // Tool execution loop — continue until the model stops requesting tools
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Add assistant message with tool calls to conversation
      llmMessages.push({
        role: "assistant",
        content: replyContent || "[tool call]",
      });

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const toolCalls = response.tool_calls;
        if (!toolCalls || toolCalls.length === 0) break;

        log.info(
          { tenantId, conversationId, round, toolCount: toolCalls.length },
          "Executing tool calls",
        );

        // Execute each tool call
        const toolResults: Array<{ role: "user"; content: string }> = [];
        for (const tc of toolCalls) {
          // Built-in calendar tools run in-process against the real calendar.
          if (calCtx && (CALENDAR_TOOL_NAMES as readonly string[]).includes(tc.name)) {
            const calResult =
              tc.name === "check_availability"
                ? await runCheckAvailability(calCtx, tenantId, conversationId, tc.input)
                : tc.name === "book_meeting"
                  ? await runBookMeeting(calCtx, tenantId, tc.input)
                  : await runCancelMeeting(calCtx, tc.input);
            if (calResult.is_error) {
              toolFailures++;
            } else if (tc.name === "book_meeting" || tc.name === "cancel_meeting") {
              bookingToolRan = true;
            }
            await safeAudit(tc.name, tc.input, true);
            // Calendar data (titles, descriptions) is third-party content too.
            const screenedCal = screenToolResult(tc.name, calResult.content);
            toolResults.push({
              role: "user",
              content: `Tool result for ${tc.name}: ${screenedCal.text}`,
            });
            continue;
          }

          const tool = tools.find((t) => t.name === tc.name);
          if (!tool) {
            toolFailures++;
            toolResults.push({
              role: "user",
              content: `Tool "${tc.name}" not found. Available tools: ${tools.map((t) => t.name).join(", ")}`,
            });
            continue;
          }

          const result = await dispatchTool(tool, tc.input);
          if (result.is_error) {
            toolFailures++;
          }
          await safeAudit(tc.name, tc.input, result.allowed !== false);
          toolResults.push({
            role: "user",
            content: `Tool result for ${tc.name}: ${result.content}`,
          });
        }

        // Add tool results to messages
        llmMessages.push(...toolResults);

        // Call model again with tool results
        response = await llm.createMessage(provider, model, llmMessages, {
          maxTokens,
          system: systemPrompt,
          tools: llmTools,
          thinking,
        });

        replyContent = response.content;
        totalUsage.input_tokens += response.usage?.input_tokens ?? 0;
        totalUsage.output_tokens += response.usage?.output_tokens ?? 0;
        totalUsage.cache_creation_input_tokens += response.usage?.cache_creation_input_tokens ?? 0;
        totalUsage.cache_read_input_tokens += response.usage?.cache_read_input_tokens ?? 0;

        // Add assistant response for next round
        llmMessages.push({
          role: "assistant",
          content: replyContent || "[continuing]",
        });

        // Stop if no more tool calls
        if (!response.tool_calls || response.tool_calls.length === 0) break;
      }
    }

    // Post-tool escalation: repeated tool failure hands to a human.
    if (toolFailures >= 3) {
      log.info({ tenantId, conversationId, toolFailures }, "Escalation triggered by tool failures");
      await escalateConversation(
        client,
        conversationId,
        tenantId,
        [{ type: "tool_failure", reason: `${toolFailures} consecutive tool failures` }],
        messages.map((m) => m.content).join("\n"),
      );
      for (const msg of messages) {
        await createMessage(client, {
          conversationId,
          waMessageId: msg.message_id,
          role: "user",
          content: msg.content,
        });
      }
      await createMessage(client, {
        conversationId,
        role: "assistant",
        content: HOLDING_MESSAGE,
      });
      return { content: HOLDING_MESSAGE, tool_failures: toolFailures, usage: totalUsage };
    }

    // Deterministic anti-hallucination net: booking-completion language is
    // only sendable when a booking tool actually succeeded this turn.
    // Prompts alone did not hold — this check cannot be talked around.
    if (!bookingToolRan && hasUngroundedBookingClaim(replyContent)) {
      log.warn(
        { tenantId, conversationId, toolFailures, preview: replyContent.slice(0, 200) },
        "Blocked ungrounded booking claim (no booking tool ran)"
      );
      replyContent =
        "Noted — I've passed that to the team, who will confirm shortly. Want me to check which times are free in the meantime?";
    }

    // Deterministic date-label repair: "tomorrow (4 Sept)" when tomorrow is
    // the 5th gets corrected to "tomorrow (5 Sept)". Only fires on an actual
    // day/month mismatch — correct labels pass through untouched.
    const dateFix = fixRelativeDateLabels(replyContent, anchorNow);
    if (dateFix.fixed) {
      log.info({ tenantId, conversationId }, "Corrected relative date label");
      replyContent = dateFix.text;
    }

    // Truncate at sentence boundary if over limit
    if (replyContent.length > replyMaxTokens * 4) {
      replyContent = truncateAtSentence(replyContent, replyMaxTokens * 4);
    }

    // Never persist or send an empty reply (some models return blank text
    // with hidden reasoning). An honest fallback beats silence or a 400 loop.
    if (!replyContent.trim()) {
      log.warn({ tenantId, conversationId, provider, model }, "Empty model reply, using fallback");
      replyContent = "Let me check that with the team and get back to you shortly.";
    }

    // Persist usage for cost attribution
    const usageJson = {
      input_tokens: totalUsage.input_tokens,
      output_tokens: totalUsage.output_tokens,
      cache_creation_input_tokens: totalUsage.cache_creation_input_tokens,
      cache_read_input_tokens: totalUsage.cache_read_input_tokens,
    };

    // Save user messages
    for (const msg of messages) {
      await createMessage(client, {
        conversationId,
        waMessageId: msg.message_id,
        role: "user",
        content: msg.content,
      });
    }

    // Save assistant message
    await createMessage(client, {
      conversationId,
      role: "assistant",
      content: replyContent,
      usageJson,
    });

    log.info(
      {
        tenantId,
        conversationId,
        provider,
        model,
        inputTokens: totalUsage.input_tokens,
        outputTokens: totalUsage.output_tokens,
        toolFailures,
      },
      "Agent reply generated",
    );

    return { content: replyContent, tool_failures: toolFailures, usage: totalUsage };
  } finally {
    client.release();
  }
}

function isToolUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /tool/i.test(msg) && /not supported/i.test(msg);
}

const IST_TZ = "Asia/Kolkata";

function istParts(d: Date) {
  const weekday = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TZ, weekday: "long" }).format(d);
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TZ, day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return { weekday, day, time };
}

/**
 * Pure date/time questions are answered deterministically from the anchor
 * clock — the LLM is never consulted. Returns null for everything else
 * (booking requests like "book tomorrow" must NOT match).
 */
export function answerDateTimeQuestion(text: string, now: Date): string | null {
  const t = text.trim().toLowerCase();
  if (t.length > 140) return null;
  const { weekday, day, time } = istParts(now);
  const plusDays = (n: number) => {
    const d = new Date(now.getTime() + n * 86_400_000);
    return istParts(d);
  };
  const isTodayQ =
    /what'?s (today'?s date|the date|today)|what day is (it|today)|today'?s date|which date (is it|today)|aaj (ki )?(date|tareekh|tarikh|day|din)\b|date (hai|hain|kya)/i.test(t);
  const isTomorrowQ =
    /tomorrow'?s date|what('?s| day is) tomorrow|kal (ki )?(date|tareekh|tarikh|day|din)\b/i.test(t);
  const isDayAfterQ = /day after tomorrow/i.test(t);
  const isTimeQ = /^(what'?s the time|current time|time (kya hai|hai|now|right now)|time batao)\b/i.test(t);
  if (isDayAfterQ) {
    const p = plusDays(2);
    return `${p.weekday}, ${p.day} is the day after tomorrow (IST).`;
  }
  if (isTomorrowQ) {
    const p = plusDays(1);
    return `Tomorrow is ${p.weekday}, ${p.day} (IST).`;
  }
  if (isTodayQ) {
    return `Today is ${weekday}, ${day} (IST).`;
  }
  if (isTimeQ) {
    return `It's ${time} IST right now.`;
  }
  return null;
}

const MONTH_NUM: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sept: "09", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function fixRelativeDateLabels(
  text: string,
  now: Date = new Date()
): { text: string; fixed: boolean } {
  const { todayISO, tomorrowISO } = todayTomorrowIST(now);
  let fixed = false;
  const out = text.replace(
    /\b(today|tomorrow)\s*\(([^)]{1,30})\)/gi,
    (m, word: string, inner: string) => {
      const wantISO = word.toLowerCase() === "tomorrow" ? tomorrowISO : todayISO;
      const dayMatch = inner.match(/(\d{1,2})/);
      if (!dayMatch) return m;
      const monMatch = inner.match(/(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*/i);
      const dayOk = Number(dayMatch[1]) === Number(wantISO.slice(8, 10));
      const monOk = !monMatch || MONTH_NUM[monMatch[1].toLowerCase()] === wantISO.slice(5, 7);
      if (dayOk && monOk) return m;
      fixed = true;
      return `${word} (${shortISTLabel(wantISO)})`;
    }
  );
  return { text: out, fixed };
}

function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastExcl = truncated.lastIndexOf("!");
  const lastQ = truncated.lastIndexOf("?");
  const lastSentence = Math.max(lastPeriod, lastExcl, lastQ);
  if (lastSentence > maxLen * 0.5) {
    return truncated.slice(0, lastSentence + 1);
  }
  return truncated + "...";
}
