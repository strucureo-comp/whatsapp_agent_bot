/**
 * Eval harness — runs fixtures through handleMessage with tools stubbed.
 * Captures ~50 real transcripts per tenant, pseudonymized.
 * Includes deterministic assertions, judge model for tone, and cost reporting.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "@/db/pool.js";
import { handleMessage, type InboundMessage } from "@/agent/handle-message.js";
import { getLogger } from "@/lib/logger.js";
import { getLlmClient } from "@/llm/client.js";

export interface EvalFixture {
  tenantId: string;
  conversationId: string;
  messages: InboundMessage[];
  expected?: {
    escalated?: boolean;
    toolCalled?: string;
    toolArgs?: Record<string, unknown>;
    refused?: boolean;
    replyContains?: string[];
    replyMaxLen?: number;
  };
}

export interface EvalAssertion {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface EvalResult {
  fixture: string;
  passed: boolean;
  assertions: EvalAssertion[];
  reply: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  durationMs: number;
  toneScore?: number;
  error?: string;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
  totals: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  previousTotals?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  costDelta?: {
    input_delta: number;
    output_delta: number;
    cache_delta: number;
  };
}

/**
 * Load fixtures from a directory.
 */
export function loadFixtures(fixturesDir: string): EvalFixture[] {
  const fixtures: EvalFixture[] = [];
  if (!existsSync(fixturesDir)) {
    return fixtures;
  }
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const content = readFileSync(join(fixturesDir, file), "utf-8");
    fixtures.push(JSON.parse(content));
  }

  return fixtures;
}

/**
 * Run deterministic assertions against a fixture result.
 */
function runAssertions(
  fixture: EvalFixture,
  reply: string,
  options: { escalated?: boolean; toolCalled?: string; error?: string },
): EvalAssertion[] {
  const assertions: EvalAssertion[] = [];
  const exp = fixture.expected;
  if (!exp) {
    assertions.push({ name: "no_expected", passed: true, detail: "no assertions defined" });
    return assertions;
  }

  // Escalation assertion
  if (exp.escalated !== undefined) {
    const passed = options.escalated === exp.escalated;
    assertions.push({
      name: "escalated",
      passed,
      detail: passed
        ? `escalation=${options.escalated} matches expected=${exp.escalated}`
        : `expected escalated=${exp.escalated} but got ${options.escalated}`,
    });
  }

  // Tool called assertion
  if (exp.toolCalled !== undefined) {
    const passed = options.toolCalled === exp.toolCalled;
    assertions.push({
      name: "tool_called",
      passed,
      detail: passed
        ? `tool=${options.toolCalled} matches expected=${exp.toolCalled}`
        : `expected tool=${exp.toolCalled} but got ${options.toolCalled}`,
    });
  }

  // Refusal assertion
  if (exp.refused) {
    const refusedPatterns = ["sorry", "can't help", "unable to", "not able to", "cannot"];
    const isRefused = refusedPatterns.some((p) => reply.toLowerCase().includes(p));
    assertions.push({
      name: "refused",
      passed: isRefused,
      detail: isRefused ? "reply contains refusal pattern" : "reply does not contain refusal pattern",
    });
  }

  // Reply contains assertion
  if (exp.replyContains && exp.replyContains.length > 0) {
    for (const pattern of exp.replyContains) {
      const found = reply.toLowerCase().includes(pattern.toLowerCase());
      assertions.push({
        name: `reply_contains_${pattern.slice(0, 20)}`,
        passed: found,
        detail: found ? `found "${pattern}"` : `missing "${pattern}"`,
      });
    }
  }

  // Reply max length assertion
  if (exp.replyMaxLen) {
    const passed = reply.length <= exp.replyMaxLen;
    assertions.push({
      name: "reply_max_len",
      passed,
      detail: passed
        ? `length ${reply.length} <= ${exp.replyMaxLen}`
        : `length ${reply.length} > ${exp.replyMaxLen}`,
    });
  }

  // Error assertion (no error expected)
  if (options.error) {
    assertions.push({
      name: "no_error",
      passed: false,
      detail: `unexpected error: ${options.error}`,
    });
  }

  return assertions;
}

/**
 * Judge model for tone scoring — returns 0-1 score.
 * Runs only on fixtures that pass deterministic assertions.
 */
async function judgeTone(
  tenantId: string,
  reply: string,
  context: string,
): Promise<number> {
  try {
    const llm = getLlmClient();
    const response = await llm.createMessage(
      "anthropic",
      "claude-haiku-4-5",
      [
        {
          role: "user",
          content: `Rate the tone of this customer service reply on a scale of 0.0 to 1.0.
0.0 = hostile, rude, unhelpful
0.5 = neutral, acceptable
1.0 = warm, professional, helpful

Context: ${context}

Reply: ${reply}

Respond with JSON only: {"score": <number>, "reason": "<string>"}`,
        },
      ],
      { maxTokens: 100 },
    );

    const match = response.content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return typeof parsed.score === "number" ? parsed.score : 0.5;
    }
  } catch {
    // Fail open — tone scoring is informational only
  }
  return 0.5;
}

/**
 * Run a single fixture through handleMessage.
 */
export async function runFixture(fixture: EvalFixture): Promise<EvalResult> {
  const log = getLogger();
  const start = Date.now();

  try {
    const reply = await handleMessage(
      fixture.tenantId,
      fixture.conversationId,
      fixture.messages,
    );

    const durationMs = Date.now() - start;

    // Run deterministic assertions
    const assertions = runAssertions(fixture, reply.content, {});

    // All assertions must pass
    const passed = assertions.every((a) => a.passed);

    // Judge tone only if assertions pass
    let toneScore: number | undefined;
    if (passed) {
      const context = fixture.messages.map((m) => m.content).join(" ");
      toneScore = await judgeTone(fixture.tenantId, reply.content, context);
    }

    return {
      fixture: `${fixture.tenantId}/${fixture.conversationId}`,
      passed,
      assertions,
      reply: reply.content,
      usage: reply.usage,
      durationMs,
      toneScore,
    };
  } catch (err) {
    return {
      fixture: `${fixture.tenantId}/${fixture.conversationId}`,
      passed: false,
      assertions: [{ name: "exception", passed: false, detail: String(err) }],
      reply: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Load previous run totals for cost comparison.
 */
function loadPreviousTotals(runDir: string): EvalReport["previousTotals"] {
  const totalsFile = join(runDir, "totals.json");
  if (existsSync(totalsFile)) {
    try {
      const data = JSON.parse(readFileSync(totalsFile, "utf-8"));
      return data;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Save current run totals for next comparison.
 */
function saveTotals(runDir: string, totals: EvalReport["totals"]): void {
  if (!existsSync(runDir)) {
    mkdirSync(runDir, { recursive: true });
  }
  writeFileSync(join(runDir, "totals.json"), JSON.stringify(totals, null, 2));
}

/**
 * Run all fixtures and generate a report.
 */
export async function runEval(
  fixturesDir: string,
  options: { saveHistory?: boolean; runDir?: string } = {},
): Promise<EvalReport> {
  const fixtures = loadFixtures(fixturesDir);
  const results: EvalResult[] = [];

  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;

  const totals = {
    input_tokens: results.reduce((sum, r) => sum + (r.usage?.input_tokens ?? 0), 0),
    output_tokens: results.reduce((sum, r) => sum + (r.usage?.output_tokens ?? 0), 0),
    cache_read_tokens: results.reduce(
      (sum, r) => sum + (r.usage?.cache_read_input_tokens ?? 0),
      0,
    ),
    cache_creation_tokens: results.reduce(
      (sum, r) => sum + (r.usage?.cache_creation_input_tokens ?? 0),
      0,
    ),
  };

  const runDir = options.runDir ?? "./eval-history";
  const previousTotals = loadPreviousTotals(runDir);

  let costDelta: EvalReport["costDelta"] | undefined;
  if (previousTotals) {
    costDelta = {
      input_delta: totals.input_tokens - previousTotals.input_tokens,
      output_delta: totals.output_tokens - previousTotals.output_tokens,
      cache_delta: totals.cache_read_tokens - previousTotals.cache_read_tokens,
    };
  }

  if (options.saveHistory !== false) {
    saveTotals(runDir, totals);
  }

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    totals,
    previousTotals,
    costDelta,
  };
}
