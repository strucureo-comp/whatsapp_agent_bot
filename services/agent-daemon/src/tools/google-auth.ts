import { google } from "googleapis";
import type pg from "pg";
import { getLogger } from "@/lib/logger.js";
import {
  getGoogleTokens,
  updateGoogleAccessToken,
} from "@/repos/google-tokens.js";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * OAuth2 client for a tenant's connected Google account, or null when the
 * tenant hasn't completed the dashboard Calendar connect flow.
 *
 * Refresh is handled transparently and the fresh access token is persisted
 * back to tenant_google_tokens so the next call doesn't re-refresh.
 */
export async function getOAuthClientForTenant(
  db: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<InstanceType<typeof google.auth.OAuth2> | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/google/callback";
  if (!clientId || !clientSecret) {
    getLogger().warn("Google OAuth client not configured (GOOGLE_CLIENT_ID/SECRET missing)");
    return null;
  }

  const stored = await getGoogleTokens(db, tenantId);
  if (!stored) return null;

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: new Date(stored.expiry).getTime(),
  });

  // Persist refreshed tokens — googleapis emits 'tokens' on refresh.
  oauth.on("tokens", (tokens) => {
    if (!tokens.access_token) return;
    const expiresIn = Math.max(
      60,
      Math.round(((tokens.expiry_date ?? Date.now() + 3600_000) - Date.now()) / 1000),
    );
    updateGoogleAccessToken(db, tenantId, tokens.access_token, expiresIn).catch((err) =>
      getLogger().error({ tenantId, err }, "Failed to persist refreshed Google token"),
    );
  });

  // Proactively refresh when expired or expiring within a minute.
  if (new Date(stored.expiry).getTime() - Date.now() < 60_000) {
    try {
      await oauth.getAccessToken();
    } catch (err) {
      getLogger().warn({ tenantId, err }, "Google token refresh failed — tenant must reconnect");
      return null;
    }
  }

  return oauth;
}
