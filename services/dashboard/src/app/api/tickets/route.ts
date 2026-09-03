import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";

const PRIORITIES = new Set(["low", "normal", "high"]);

/**
 * POST /api/tickets { tenant_id, title, conversation_id?, priority? }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tenantId = body.tenant_id;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (typeof tenantId !== "string" || !tenantId) {
    return Response.json({ error: "tenant_id is required" }, { status: 400 });
  }
  if (!title || title.length > 200) {
    return Response.json({ error: "title is required (max 200 chars)" }, { status: 400 });
  }
  const priority =
    typeof body.priority === "string" && PRIORITIES.has(body.priority) ? body.priority : "normal";
  const conversationId =
    typeof body.conversation_id === "string" && body.conversation_id
      ? body.conversation_id
      : null;

  try {
    const res = await getPool().query(
      `INSERT INTO tickets (tenant_id, conversation_id, title, priority)
       VALUES ($1, $2, $3, $4) RETURNING id, status`,
      [tenantId, conversationId, title, priority]
    );
    revalidatePath("/tickets");
    revalidatePath("/conversations");
    return Response.json({ ok: true, ticket: res.rows[0] });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
