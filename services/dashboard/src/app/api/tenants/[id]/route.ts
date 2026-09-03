import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";

const ALLOWED = new Set([
  "name",
  "persona_prompt",
  "company_profile",
  "status",
  "llm_provider",
  "llm_model",
  "staff_whatsapp",
  "google_calendar_id",
  "max_monthly_spend_cents",
  "reply_max_tokens",
  "debounce_ms",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED.has(key)) continue;
    vals.push(value === "" ? null : value);
    sets.push(`${key} = $${vals.length}`);
  }
  if (sets.length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }
  if (body.status && body.status !== "active" && body.status !== "paused") {
    return Response.json({ error: "status must be active or paused" }, { status: 400 });
  }

  vals.push(id);
  try {
    const res = await getPool().query(
      `UPDATE tenants SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length} RETURNING id`,
      vals
    );
    if (res.rowCount === 0) {
      return Response.json({ error: "Tenant not found" }, { status: 404 });
    }
    revalidatePath("/tenants");
    revalidatePath("/");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
