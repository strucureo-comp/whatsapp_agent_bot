import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Per-tenant credential encryption (AES-256-GCM).
 * CREDENTIALS_ENC_KEY lives ONLY on the server (env, never DB, never git).
 * Accepts 64 hex chars or any string (sha256-stretched).
 */
function getEncKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENC_KEY ?? "";
  if (!raw) {
    throw new Error("CREDENTIALS_ENC_KEY is not set — refusing to handle tenant secrets");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("Malformed secret envelope");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Mask for display: ****1234. The full value never leaves the server. */
export function maskKey(key: string): string {
  const clean = key.replace(/\s+/g, "");
  if (clean.length === 0) return "••••";
  if (clean.length <= 4) return `****${clean}`;
  return `****${clean.slice(-4)}`;
}
