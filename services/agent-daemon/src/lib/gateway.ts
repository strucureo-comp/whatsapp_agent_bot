import { getEnv } from "@/config/env.js";

/**
 * The single HTTP client for the WhatsApp gateway.
 *
 * There were four hand-rolled `fetch` call sites before this, and every one of
 * them reported `(err as Error).message` on a transport failure. undici always
 * sets that to the literal string "fetch failed" — the reason lives in
 * `err.cause.code`, so "gateway isn't running" and "gateway died mid-request"
 * were indistinguishable from each other and from a DNS mistake.
 */

export interface GatewayResponse<T = unknown> {
  ok: boolean;
  status?: number;
  error?: string;
  data?: T;
}

/** Default per-request budget. The gateway's own pairing wait is longer, so
 *  /pair-code passes its own. */
export const GATEWAY_TIMEOUT_MS = 8000;

/**
 * Pull the real network cause out of a fetch rejection.
 *
 * Node wraps multi-address attempts (IPv6 then IPv4 for localhost, which is
 * exactly this case) in an AggregateError, so the code can be one level deeper.
 */
export function describeFetchError(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "timed out";
  }
  if (err instanceof Error && err.name === "AbortError") {
    return "aborted";
  }

  const cause = (err as { cause?: unknown }).cause;

  const codeOf = (e: unknown): string | undefined => {
    const code = (e as { code?: unknown })?.code;
    return typeof code === "string" ? code : undefined;
  };

  const direct = codeOf(cause);
  if (direct) return explainCode(direct);

  const nested = (cause as { errors?: unknown[] })?.errors;
  if (Array.isArray(nested)) {
    for (const inner of nested) {
      const code = codeOf(inner);
      if (code) return explainCode(code);
    }
  }

  if (cause instanceof Error && cause.message) return cause.message;
  return err instanceof Error ? err.message : String(err);
}

function explainCode(code: string): string {
  switch (code) {
    case "ECONNREFUSED":
      return "ECONNREFUSED (gateway not running)";
    case "ECONNRESET":
    // undici reports a socket torn down mid-request as UND_ERR_SOCKET rather than
    // ECONNRESET, which is the exact symptom of the gateway dying under load.
    case "UND_ERR_SOCKET":
      return `${code} (gateway died mid-request)`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `${code} (gateway host does not resolve)`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return `${code} (gateway did not accept the connection)`;
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return `${code} (gateway accepted the request but never answered)`;
    default:
      return code;
  }
}

export interface GatewayRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Call the gateway and normalize every failure mode into {ok, error}.
 *
 * Never throws: a transport failure, a non-2xx, and a malformed body all come
 * back the same shape, so callers cannot accidentally leave one unhandled.
 */
export async function gatewayRequest<T = unknown>(
  path: string,
  options: GatewayRequestOptions = {},
): Promise<GatewayResponse<T>> {
  const env = getEnv();
  const { method = "GET", body, timeoutMs = GATEWAY_TIMEOUT_MS } = options;

  let response: Response;
  try {
    response = await fetch(`${env.GATEWAY_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GATEWAY_SECRET}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Without this a dead-but-listening gateway hangs the REPL indefinitely.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error: `cannot reach gateway at ${env.GATEWAY_URL} — ${describeFetchError(err)}`,
    };
  }

  const raw = (await response.text()).trim();

  if (!response.ok) {
    // The gateway explains itself in {"error":"..."}; surface that instead of the
    // bare status line, which says nothing about which field was rejected.
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // Non-JSON body, e.g. a 404 page from the mux — pass it through as-is.
    }
    return {
      ok: false,
      status: response.status,
      error: detail
        ? `HTTP ${response.status}: ${detail}`
        : `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  try {
    return {
      ok: true,
      status: response.status,
      data: (raw ? JSON.parse(raw) : null) as T,
    };
  } catch {
    return {
      ok: false,
      status: response.status,
      error: `gateway returned a ${response.status} with a non-JSON body: ${raw.slice(0, 200)}`,
    };
  }
}

/** True when the gateway answers /health. Never throws. */
export async function gatewayHealth(): Promise<GatewayResponse> {
  return gatewayRequest("/health", { timeoutMs: 3000 });
}
