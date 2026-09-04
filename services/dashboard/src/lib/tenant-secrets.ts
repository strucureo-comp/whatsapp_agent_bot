import { getPool } from "./db";
import { encryptSecret, decryptSecret, maskKey } from "./secrets";

import { SecretProvider, SECRET_PROVIDERS, TenantSecretMasked } from "./tenant-secrets-config";
export { SECRET_PROVIDERS };
export type { SecretProvider, TenantSecretMasked };

export async function listTenantSecretsMasked(tenantId: string): Promise<TenantSecretMasked[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT tenant_id, provider, label, key_encrypted, created_at, updated_at
       FROM tenant_secrets WHERE tenant_id = $1 ORDER BY provider`,
    [tenantId]
  );
  return res.rows.map((r) => {
    let plain = "";
    try {
      plain = decryptSecret(r.key_encrypted as string);
    } catch {
      plain = "";
    }
    return {
      tenant_id: r.tenant_id,
      provider: r.provider as SecretProvider,
      label: (r.label ?? "") as string,
      key_masked: maskKey(plain),
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  });
}

export async function upsertTenantSecret(
  tenantId: string,
  provider: SecretProvider,
  label: string,
  plainKey: string,
): Promise<void> {
  const pool = getPool();
  const encrypted = encryptSecret(plainKey);
  await pool.query(
    `INSERT INTO tenant_secrets (tenant_id, provider, label, key_encrypted, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       label = EXCLUDED.label,
       key_encrypted = EXCLUDED.key_encrypted,
       updated_at = NOW()`,
    [tenantId, provider, label, encrypted]
  );
}

export async function deleteTenantSecret(
  tenantId: string,
  provider: SecretProvider,
): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(
    `DELETE FROM tenant_secrets WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getDecryptedTenantSecret(
  tenantId: string,
  provider: SecretProvider,
): Promise<string | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `SELECT key_encrypted FROM tenant_secrets WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );
    if (res.rows.length === 0) return null;
    return decryptSecret(res.rows[0].key_encrypted as string);
  } catch {
    return null;
  }
}
