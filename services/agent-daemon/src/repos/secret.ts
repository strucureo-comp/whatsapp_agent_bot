import type pg from "pg";
import { getLogger } from "@/lib/logger.js";
import { decryptSecret, encryptSecret, maskKey } from "@/lib/secrets.js";

export type SecretProvider =
  | "anthropic" | "openai" | "groq" | "openrouter" | "together" | "fireworks"
  | "gemini" | "deepseek" | "xai" | "ollama" | "custom";

export const SECRET_PROVIDERS: { value: SecretProvider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "together", label: "Together AI" },
  { value: "fireworks", label: "Fireworks" },
  { value: "gemini", label: "Google Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "xai", label: "xAI (Grok)" },
  { value: "ollama", label: "Ollama / self-hosted" },
  { value: "custom", label: "Custom OpenAI-compatible" },
];

export interface TenantSecret {
  tenant_id: string;
  provider: SecretProvider;
  label: string;
  key_masked: string;
  created_at: Date;
  updated_at: Date;
}

/** Masked list for the dashboard — ciphertext never serialized. */
export async function listTenantSecretsMasked(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<TenantSecret[]> {
  const res = await client.query(
    `SELECT tenant_id, provider, label, key_encrypted, created_at, updated_at
       FROM tenant_secrets WHERE tenant_id = $1 ORDER BY provider`,
    [tenantId]
  );
  return res.rows.map((r) => ({
    tenant_id: r.tenant_id,
    provider: r.provider as SecretProvider,
    label: (r.label ?? "") as string,
    key_masked: maskKey(safeDecryptTail(r.key_encrypted as string)),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function safeDecryptTail(enc: string): string {
  try {
    return decryptSecret(enc);
  } catch {
    return "";
  }
}

export async function upsertTenantSecret(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
  provider: SecretProvider,
  label: string,
  keyEncrypted: string,
): Promise<void> {
  await client.query(
    `INSERT INTO tenant_secrets (tenant_id, provider, label, key_encrypted, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       label = EXCLUDED.label,
       key_encrypted = EXCLUDED.key_encrypted,
       updated_at = NOW()`,
    [tenantId, provider, label, keyEncrypted]
  );
}

export async function setTenantSecretPlain(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
  provider: SecretProvider,
  label: string,
  plainKey: string,
): Promise<void> {
  const encrypted = encryptSecret(plainKey);
  await upsertTenantSecret(client, tenantId, provider, label, encrypted);
}

export async function deleteTenantSecret(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
  provider: SecretProvider,
): Promise<boolean> {
  const res = await client.query(
    `DELETE FROM tenant_secrets WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getDecryptedTenantSecret(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
  provider: SecretProvider,
): Promise<string | null> {
  try {
    const res = await client.query(
      `SELECT key_encrypted FROM tenant_secrets WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );
    if (res.rows.length === 0) return null;
    return decryptSecret(res.rows[0].key_encrypted as string);
  } catch (err) {
    getLogger().warn({ tenantId, provider, err }, "Tenant secret decrypt failed");
    return null;
  }
}

/**
 * Decrypted keys for one tenant, keyed by provider. Resolution order
 * everywhere: tenant secret → global env key → undefined.
 */
export async function getDecryptedTenantKeys(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<Partial<Record<SecretProvider, string>>> {
  const out: Partial<Record<SecretProvider, string>> = {};
  try {
    const res = await client.query(
      `SELECT provider, key_encrypted FROM tenant_secrets WHERE tenant_id = $1`,
      [tenantId]
    );
    for (const r of res.rows) {
      try {
        const key = decryptSecret(r.key_encrypted as string);
        if (key) out[r.provider as SecretProvider] = key;
      } catch (err) {
        getLogger().warn({ tenantId, provider: r.provider }, "Tenant secret undecryptable — skipping to env fallback");
        void err;
      }
    }
  } catch (err) {
    getLogger().warn({ tenantId, err }, "Tenant secrets lookup failed — env fallback");
  }
  return out;
}
