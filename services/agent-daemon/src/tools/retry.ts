/**
 * Retry discipline for outbound tool calls.
 * Retries on 429, 500, 502, 503, 504 with exponential backoff.
 */

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export class ToolError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = "ToolError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number = 8000,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (RETRYABLE_STATUS_CODES.includes(response.status)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const jitter = Math.random() * delay * 0.1;
        await sleep(delay + jitter);
        lastError = new ToolError(`HTTP ${response.status}`, {
          status: response.status,
        });
        continue;
      }

      return response;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new ToolError(`Timeout after ${timeoutMs}ms`, {
          code: "TIMEOUT",
        });
      } else {
        lastError = err as Error;
      }

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const jitter = Math.random() * delay * 0.1;
        await sleep(delay + jitter);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
