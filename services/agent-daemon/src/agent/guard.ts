/**
 * Multi-layer prompt-injection / jailbreak guard.
 *
 * Layer 1 — regex (sync, <1ms): known override, roleplay, encoding and
 *   TOOL-ABUSE patterns (the classifier demonstrably misses polite
 *   "email my data to attacker@x" phrasing: scored 0.12).
 * Layer 2 — heuristics (sync): instruction density, caps, special chars.
 * Layer 3 — llama-prompt-guard-2 via Groq (async, ~instant, ~free):
 *   benign ≈ 0.0005, DAN ≈ 0.70, classic override ≈ 0.999.
 *
 * Verdict: UNSAFE if any layer fires. Fail-open on API error (logged) —
 * this is defense in depth; the permission gate + audit remain authoritative.
 */

export type GuardCategory =
  | "normal"
  | "jailbreak"
  | "instruction_override"
  | "developer_mode"
  | "system_prompt_extraction"
  | "out_of_scope_write"
  | "discount_extraction"
  | "tool_abuse"
  | "injection";

export interface GuardVerdict {
  safe: boolean;
  category: GuardCategory;
  reason: string;
  layers: string[];
  scores: { heuristic: number; classifier: number | null };
}

interface Pattern {
  re: RegExp;
  category: GuardCategory;
  name: string;
}

const PATTERNS: Pattern[] = [
  // Instruction override
  { re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i, category: "instruction_override", name: "ignore-previous" },
  { re: /disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|rules?|guidelines?)/i, category: "instruction_override", name: "disregard" },
  { re: /\bforget\s+(everything|all|your)\b.{0,30}(told|instruct|learn)/i, category: "instruction_override", name: "forget" },
  { re: /override\s+(your\s+)?(instructions?|rules?|restrictions?|safety)/i, category: "instruction_override", name: "override" },
  { re: /bypass\s+(your\s+)?(safety|security|restrictions?|filters?|guardrails?)/i, category: "jailbreak", name: "bypass" },
  // Roleplay / persona escape
  { re: /\byou are now\b/i, category: "jailbreak", name: "you-are-now" },
  { re: /\bdan\b.{0,20}(mode|do anything)/i, category: "developer_mode", name: "dan-mode" },
  { re: /developer mode|developer-mode|jailbreak(n|ed)? mode|evil mode|god ?mode/i, category: "developer_mode", name: "dev-mode" },
  { re: /pretend\s+(you(’re|'re| are)|to be)\s+(?!a helpful)/i, category: "jailbreak", name: "pretend" },
  { re: /act\s+as\s+(if\s+you\s+(have\s+no|were\s+not)|an?\s+(unrestricted|uncensored|evil))/i, category: "jailbreak", name: "act-as" },
  // System prompt extraction
  { re: /repeat\s+(your|the)\s+(exact\s+)?(system prompt|instructions|prompt)/i, category: "system_prompt_extraction", name: "repeat-prompt" },
  { re: /what\s+(is|are)\s+your\s+(system prompt|instructions|initial prompt)/i, category: "system_prompt_extraction", name: "what-prompt" },
  { re: /reveal\s+(your\s+)?(system prompt|instructions|configuration)/i, category: "system_prompt_extraction", name: "reveal" },
  { re: /output\s+(everything|all)\s+above/i, category: "system_prompt_extraction", name: "output-above" },
  // Smuggled framing (file pastes, forwarded content, fake system blocks)
  { re: /^\s*(system|assistant)\s*:/im, category: "injection", name: "fake-role-prefix" },
  { re: /\[(system|admin|developer|instruction)\]/i, category: "injection", name: "bracket-role" },
  { re: /###\s*(instruction|system|new instructions)/i, category: "injection", name: "md-instruction" },
  { re: /<\s*(system|instruction)[\s>]/i, category: "injection", name: "tag-instruction" },
  // Destructive / out-of-scope writes
  { re: /\b(drop|delete\s+all|truncate|wipe|format)\b.{0,20}\b(table|database|records|calendar|data)\b/i, category: "out_of_scope_write", name: "destructive-sql" },
  // Discount / privilege extraction
  { re: /\b(90|80|100)%\s+discount\b/i, category: "discount_extraction", name: "discount-pct" },
  { re: /override\s+code|admin\s*override|authorize\s+code/i, category: "discount_extraction", name: "override-code" },
  { re: /\bi am the (ceo|admin|owner|boss)\b/i, category: "discount_extraction", name: "fake-authority" },
  // TOOL ABUSE — steering tools at exfiltration / internals
  { re: /\b(send|forward|email|export|exfiltrat\w*|leak|dump)\b.{0,60}@[\w.-]+\.\w+/i, category: "tool_abuse", name: "send-to-email" },
  { re: /\b(send|forward|email|export)\b.{0,40}\b(all|every|entire)\b.{0,40}\b(events?|messages?|data|records|calendar|chats?|contacts?)\b/i, category: "tool_abuse", name: "bulk-exfil" },
  { re: /\b(call|use|invoke|trigger)\b.{0,20}\b(your|the|all|secret)\b.{0,20}\btools?\b/i, category: "tool_abuse", name: "invoke-tools" },
  { re: /\blist\s+(your\s+)?(tools?|endpoints?|functions?|secrets?|api\s*keys?)\b/i, category: "tool_abuse", name: "list-tools" },
  { re: /\b(webhook|https?:\/\/[^\s]+\.(xyz|tk|top|pw|cc|ru|su|onion))\b/i, category: "tool_abuse", name: "shady-url" },
];

const INSTRUCTION_VERBS = [
  "ignore", "disregard", "forget", "override", "bypass", "reveal", "repeat", "output",
  "execute", "run", "delete", "send", "forward", "pretend", "act as", "enter", "enable",
  "disable", "delete", "drop", "return", "print", "show me your",
];

/** All pattern hits (not just the first) — used by tool-result redaction. */
export function findHits(text: string): { category: GuardCategory; name: string }[] {
  const input = text.slice(0, 4000);
  return PATTERNS.filter((p) => p.re.test(input)).map((p) => ({
    category: p.category,
    name: p.name,
  }));
}

/** Sync screen: regex + heuristics. No I/O — safe for hot paths and unit tests. */
export function screenInput(text: string): {
  hit: { category: GuardCategory; name: string } | null;
  heuristic: number;
} {
  const input = text.slice(0, 4000);
  let hit: { category: GuardCategory; name: string } | null = null;
  for (const p of PATTERNS) {
    if (p.re.test(input)) {
      hit = { category: p.category, name: p.name };
      break;
    }
  }
  return { hit, heuristic: heuristicScore(input) };
}

/** 0.0–1.0 structural anomaly score. Benign chat ≈ 0.0–0.3. */
export function heuristicScore(text: string): number {
  if (!text.trim()) return 0;
  const lower = text.toLowerCase();
  let score = 0;

  // Instruction-verb density
  let verbs = 0;
  for (const v of INSTRUCTION_VERBS) {
    if (lower.includes(v)) verbs++;
  }
  score += Math.min(0.45, verbs * 0.09);

  // Excessive capitalization (shouting directives)
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 20) {
    const caps = (text.match(/[A-Z]/g) ?? []).length / letters.length;
    if (caps > 0.5) score += 0.2;
  }

  // Special-character ratio (delimiters, fences, mixed markup)
  const special = (text.match(/[`#<>{}\[\]|\\*_@$]/g) ?? []).length;
  const ratio = special / Math.max(1, text.length);
  if (ratio > 0.06) score += 0.2;
  else if (ratio > 0.03) score += 0.1;

  // Base64-looking blobs (encoded payload smuggling)
  if (/[A-Za-z0-9+/]{60,}={0,2}/.test(text.replace(/\s+/g, ""))) score += 0.15;

  // Language/script mixing (obfuscation)
  const scripts = [
    /[\u0400-\u04FF]/, // Cyrillic
    /[\u0370-\u03FF]/, // Greek
    /[\u3040-\u30FF]/, // Japanese
    /[\u4E00-\u9FFF]/, // CJK
    /[\u0600-\u06FF]/, // Arabic
  ].filter((re) => re.test(text)).length;
  if (scripts > 0 && /[a-zA-Z]{10,}/.test(text)) score += 0.1;

  return Math.min(1, Math.round(score * 100) / 100);
}

export const HEURISTIC_THRESHOLD = 0.7;
export const CLASSIFIER_THRESHOLD = 0.5;

export interface Scorer {
  /** 0.0–1.0 injection probability, or null when unavailable. */
  score(text: string): Promise<number | null>;
}

/** llama-prompt-guard-2 via Groq chat API: returns its 0–1 score text. */
export function groqPromptGuardScorer(apiKey: string, model = "meta-llama/llama-prompt-guard-2-86m"): Scorer {
  return {
    async score(text: string): Promise<number | null> {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: text.slice(0, 2000) }],
            max_tokens: 10,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const body = await res.json().catch(() => ({}));
        const out: string = body?.choices?.[0]?.message?.content?.trim() ?? "";
        const n = Number.parseFloat(out);
        return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
      } catch {
        return null;
      }
    },
  };
}

/** Full verdict across all three layers. */
export async function guardInput(
  text: string,
  scorer: Scorer | null,
): Promise<GuardVerdict> {
  const { hit, heuristic } = screenInput(text);
  if (hit) {
    return {
      safe: false,
      category: hit.category,
      reason: `pattern:${hit.name}`,
      layers: ["regex"],
      scores: { heuristic, classifier: null },
    };
  }
  if (heuristic >= HEURISTIC_THRESHOLD) {
    return {
      safe: false,
      category: "injection",
      reason: `heuristic:${heuristic}`,
      layers: ["heuristic"],
      scores: { heuristic, classifier: null },
    };
  }
  if (scorer) {
    const c = await scorer.score(text);
    if (c !== null && c >= CLASSIFIER_THRESHOLD) {
      return {
        safe: false,
        category: c >= 0.9 ? "instruction_override" : "jailbreak",
        reason: `classifier:${c.toFixed(3)}`,
        layers: ["classifier"],
        scores: { heuristic, classifier: c },
      };
    }
    return {
      safe: true,
      category: "normal",
      reason: "all layers clear",
      layers: ["regex", "heuristic", "classifier"],
      scores: { heuristic, classifier: c },
    };
  }
  return {
    safe: true,
    category: "normal",
    reason: "regex+heuristic clear (no classifier configured)",
    layers: ["regex", "heuristic"],
    scores: { heuristic, classifier: null },
  };
}
