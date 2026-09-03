import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";

const TOGGLEABLE = new Set(["active", "human_handling", "closed"]);
const TAGS = new Set(["new_lead", "prospect", "converted", "vip", "blocked"]);

/**
 * PATCH /api/conversations/[id]
 * { status } — agent ON (active) / human mode (human_handling) / closed.
 * { customer_name, contact_tag, notes } — contact management.
 */
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

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !TOGGLEABLE.has(body.status)) {
      return Response.json(
        { error: "status must be one of: active, human_handling, closed" },
        { status: 400 }
      );
    }
    vals.push(body.status);
    sets.push(`status = $${vals.length}`);
  }
  if (body.customer_name !== undefined) {
    if (typeof body.customer_name !== "string" || body.customer_name.length > 120) {
      return Response.json({ error: "customer_name must be a short string" }, { status: 400 });
    }
    vals.push(body.customer_name.trim());
    sets.push(`customer_name = $${vals.length}`);
  }
  if (body.contact_tag !== undefined) {
    if (typeof body.contact_tag !== "string" || !TAGS.has(body.contact_tag)) {
      return Response.json(
        { error: "contact_tag must be one of: new_lead, prospect, converted, vip, blocked" },
        { status: 400 }
      );
    }
    vals.push(body.contact_tag);
    sets.push(`contact_tag = $${vals.length}`);
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 2000) {
      return Response.json({ error: "notes must be under 2000 chars" }, { status: 400 });
    }
    vals.push(body.notes.trim());
    sets.push(`notes = $${vals.length}`);
  }

  if (sets.length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    vals.push(id);
    const res = await getPool().query(
      `UPDATE conversations SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = $${vals.length}
        RETURNING id, status, customer_name, contact_tag`,
      vals
    );
    if (res.rowCount === 0) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    revalidatePath("/conversations");
    revalidatePath("/");
    return Response.json({ ok: true, conversation: res.rows[0] });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations/[id] — remove a chat and its messages.
 * Used for temp/test chats. Escalations on it are cascade-deleted,
 * audit rows keep a null conversation ref, tickets are unlinked.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await getPool().query(`DELETE FROM conversations WHERE id = $1`, [id]);
    if (res.rowCount === 0) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    revalidatePath("/conversations");
    revalidatePath("/escalations");
    revalidatePath("/");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
