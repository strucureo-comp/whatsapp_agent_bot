import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { saveGoogleConnection } from "@/lib/queries";

function fail(tenantId: string | null, reason: string): Response {
  const dest =
    tenantId && tenantId !== "unknown"
      ? `/tenants/${tenantId}?google=error&reason=${encodeURIComponent(reason)}`
      : `/tenants?google=error&reason=${encodeURIComponent(reason)}`;
  return Response.redirect(new URL(dest, process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000"), 302);
}

/**
 * Google OAuth callback. Exchanges ?code= for tokens, stores per-tenant,
 * then lands back on the tenant page with ?google=connected.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return fail(state, `Google said: ${oauthError}`);
  if (!code || !state) return fail(state, "Missing code or state from Google");

  const tenant = await getPool().query(`SELECT id FROM tenants WHERE id = $1`, [state]);
  if (tenant.rowCount === 0) return fail(null, "Unknown tenant in state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/google/callback";
  if (!clientId || !clientSecret) return fail(state, "Google OAuth not configured on server");

  // Code → tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.access_token) {
    return fail(state, tokens?.error_description ?? tokens?.error ?? "Token exchange failed");
  }
  if (!tokens.refresh_token) {
    return fail(
      state,
      "Google did not return a refresh token — remove this app at myaccount.google.com/permissions and reconnect"
    );
  }

  // Who just connected? (for the status line in the dashboard)
  let email: string | null = null;
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const info = await me.json().catch(() => ({}));
    email = info?.email ?? null;
  } catch {
    email = null;
  }

  await saveGoogleConnection({
    tenantId: state,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresInSec: Number(tokens.expires_in ?? 3600),
    scope: String(tokens.scope ?? ""),
    googleEmail: email,
  });

  revalidatePath(`/tenants/${state}`);
  return Response.redirect(
    new URL(`/tenants/${state}?google=connected`, redirectUri),
    302
  );
}
