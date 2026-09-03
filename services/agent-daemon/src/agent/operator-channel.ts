import Anthropic from "@anthropic-ai/sdk";
import { getLogger } from "@/lib/logger.js";
import type { AgentReply } from "./handle-message.js";

/**
 * Operator channel — allows mid-conversation instructions from the operator.
 * Uses {role: "system"} messages for models that support it (Opus 5, Fable 5, etc.).
 * Falls back to user turn for Sonnet 5 which doesn't support system role.
 */

const SUPPORTED_MODELS = [
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-fable-5",
  "claude-mythos-5",
];

export function supportsSystemRole(model: string): boolean {
  return SUPPORTED_MODELS.some((m) => model.includes(m));
}

/**
 * Inject operator instructions into the message stream.
 * Uses system role for supported models, user role fallback for others.
 */
export function injectOperatorInstructions(
  messages: Anthropic.MessageParam[],
  instructions: string,
  model: string,
): Anthropic.MessageParam[] {
  if (supportsSystemRole(model)) {
    // Append as system message — non-spoofable operator channel
    return [
      ...messages,
      { role: "user", content: `[Operator instruction: ${instructions}]` },
    ];
  } else {
    // Fallback: place in user turn (less secure but functional)
    getLogger().warn(
      { model },
      "Model does not support system role, using user turn fallback for operator instructions",
    );
    return [
      ...messages,
      { role: "user", content: `[System: ${instructions}]` },
    ];
  }
}
