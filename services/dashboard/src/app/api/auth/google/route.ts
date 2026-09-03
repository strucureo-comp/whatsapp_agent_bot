import { getPool } from "@/lib/db";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/**
 * Start Google OAuth for a tenant: /api/auth/google?tenant=<uuid>
 * Redirects to Google's consent screen; Google calls back at
 * /api/auth/google/callback with ?code=&state=<tenantId>.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant");
  if (!tenantId) {
    return Response.json({ error: "tenant query param is required" }, { status: 400 });
  }

  const tenant = await getPool().query(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
  if (tenant.rowCount === 0) {
    return Response.json({ error: "Unknown tenant" }, { status: 404 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/google/callback";
  if (!clientId) {
    return Response.json({ error: "GOOGLE_CLIENT_ID not configured on server" }, { status: 500 });
  }

  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", redirectUri);
  consent.searchParams.set("scope", SCOPES);
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");
  consent.searchParams.set("state", tenantId);

  return Response.redirect(consent.toString(), 302);
}
