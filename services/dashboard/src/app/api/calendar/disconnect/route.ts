import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { deleteGoogleConnection } from "@/lib/queries";

export async function POST(request: Request) {
  let body: { tenant_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.tenant_id) {
    return Response.json({ error: "tenant_id is required" }, { status: 400 });
  }

  // Best-effort revoke so Google drops the grant too.
  try {
    const row = await getPool().query(
      `SELECT access_token FROM tenant_google_tokens WHERE tenant_id = $1`,
      [body.tenant_id]
    );
    const token = row.rows[0]?.access_token as string | undefined;
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10000),
      }).catch(() => undefined);
    }
  } catch {
    // Revoke is best-effort; row deletion below is the real disconnect.
  }

  await deleteGoogleConnection(body.tenant_id);
  revalidatePath(`/tenants/${body.tenant_id}`);
  return Response.json({ ok: true });
}
