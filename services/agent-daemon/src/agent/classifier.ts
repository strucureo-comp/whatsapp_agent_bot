import { z } from "zod";
import { getLogger } from "@/lib/logger.js";
import { groqPromptGuardScorer, guardInput, type GuardCategory } from "./guard.js";

const classificationSchema = z.object({
  safe: z.boolean(),
  category: z.enum([
    "normal",
    "jailbreak",
    "instruction_override",
    "developer_mode",
    "system_prompt_extraction",
    "out_of_scope_write",
    "discount_extraction",
    "tool_abuse",
    "injection",
  ]),
  reason: z.string(),
});

type Classification = z.infer<typeof classificationSchema>;

const CATEGORY_MAP: Record<GuardCategory, Classification["category"]> = {
  normal: "normal",
  jailbreak: "jailbreak",
  instruction_override: "instruction_override",
  developer_mode: "developer_mode",
  system_prompt_extraction: "system_prompt_extraction",
  out_of_scope_write: "out_of_scope_write",
  discount_extraction: "discount_extraction",
  tool_abuse: "tool_abuse",
  injection: "injection",
};

/**
 * Layered input guard (replaces the old Anthropic-only pre-pass, which was
 * dead without an API key): regex + heuristics run sync, then
 * llama-prompt-guard via Groq when GROQ_API_KEY is configured.
 * Fail-open with a log — this is defense in depth, not the security boundary.
 */
export async function classifyInput(
  tenantId: string,
  conversationId: string,
  messages: Array<{ role: string; content: string }>,
  groqKey?: string,
): Promise<Classification> {
  const log = getLogger();

  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  try {
    const apiKey = groqKey ?? process.env.GROQ_API_KEY;
    const scorer = apiKey ? groqPromptGuardScorer(apiKey) : null;
    const verdict = await guardInput(userMessages, scorer);

    if (!verdict.safe) {
      log.warn(
        {
          tenantId,
          conversationId,
          category: verdict.category,
          reason: verdict.reason,
          layers: verdict.layers,
        },
        "Flagged input detected",
      );
    }

    const parsed = classificationSchema.safeParse({
      safe: verdict.safe,
      category: CATEGORY_MAP[verdict.category],
      reason: `${verdict.reason} [${verdict.layers.join("+")}]`,
    });
    if (!parsed.success) {
      return { safe: true, category: "normal", reason: "invalid classification" };
    }
    return parsed.data;
  } catch (err) {
    log.error({ tenantId, conversationId, err }, "Classification failed");
    // Fail open — classification is defense in depth, not the security boundary
    return { safe: true, category: "normal", reason: "classification error" };
  }
}

export const CANNED_JAILBREAK_REPLY =
  "I'm sorry, I can't help with that request. Is there something else I can assist you with?";
