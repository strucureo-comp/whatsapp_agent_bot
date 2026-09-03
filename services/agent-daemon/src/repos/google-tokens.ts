import type pg from "pg";

export interface GoogleTokens {
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expiry: Date;
  scope: string;
  google_email: string | null;
  updated_at: Date;
}

export async function getGoogleTokens(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<GoogleTokens | null> {
  const res = await client.query<GoogleTokens>(
    `SELECT tenant_id, access_token, refresh_token, expiry, scope, google_email, updated_at
       FROM tenant_google_tokens WHERE tenant_id = $1`,
    [tenantId],
  );
  return res.rows[0] ?? null;
}

export async function saveGoogleTokens(
  client: pg.PoolClient | pg.Pool,
  input: {
    tenantId: string;
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
    scope: string;
    googleEmail?: string | null;
  },
): Promise<void> {
  const expiry = new Date(Date.now() + input.expiresInSec * 1000);
  await client.query(
    `INSERT INTO tenant_google_tokens (tenant_id, access_token, refresh_token, expiry, scope, google_email, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expiry = EXCLUDED.expiry,
       scope = EXCLUDED.scope,
       google_email = EXCLUDED.google_email,
       updated_at = NOW()`,
    [input.tenantId, input.accessToken, input.refreshToken, expiry, input.scope, input.googleEmail ?? null],
  );
}

export async function updateGoogleAccessToken(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
  accessToken: string,
  expiresInSec: number,
): Promise<void> {
  const expiry = new Date(Date.now() + expiresInSec * 1000);
  await client.query(
    `UPDATE tenant_google_tokens SET access_token = $1, expiry = $2, updated_at = NOW()
      WHERE tenant_id = $3`,
    [accessToken, expiry, tenantId],
  );
}

export async function deleteGoogleTokens(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<void> {
  await client.query(`DELETE FROM tenant_google_tokens WHERE tenant_id = $1`, [tenantId]);
}
