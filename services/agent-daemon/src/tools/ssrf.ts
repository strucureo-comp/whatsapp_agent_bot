import { isIPv4, isIPv6 } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF validation — rejects private, loopback, and link-local addresses.
 * Must be called at tool registration time, not on first call.
 */

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./, // link-local / cloud metadata endpoint
  /^::1$/,
  /^fc00:/,
  /^fd00:/,
  /^fe80:/,
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:172\./,
  /^::ffff:192\.168\./,
  /^::ffff:169\.254\./,
];

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Validate a URL for SSRF safety at registration time.
 * Requirements:
 * - Must be HTTPS
 * - Resolve the hostname
 * - Reject private, loopback, and link-local ranges
 * - Re-validate after redirects (call after following redirects)
 */
export async function validateEndpoint(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(`Invalid URL: ${url}`);
  }

  // Require HTTPS
  if (parsed.protocol !== "https:") {
    throw new SsrfError(`Endpoint must use HTTPS, got: ${parsed.protocol}`);
  }

  // Resolve hostname
  const hostname = parsed.hostname;
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateAddress(addr.address)) {
        throw new SsrfError(
          `Endpoint resolves to private/link-local address: ${addr.address} (${hostname})`,
        );
      }
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError(`DNS resolution failed for ${hostname}: ${err}`);
  }
}

/**
 * Re-validate after redirects — call this on the final URL after following redirects.
 */
export async function validateAfterRedirect(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(`Invalid redirect URL: ${url}`);
  }

  const hostname = parsed.hostname;
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateAddress(addr.address)) {
        throw new SsrfError(
          `Redirect target resolves to private address: ${addr.address}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError(`DNS resolution failed after redirect: ${err}`);
  }
}

function isPrivateAddress(ip: string): boolean {
  return PRIVATE_RANGES.some((pattern) => pattern.test(ip));
}
