import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";

const STATUSES = new Set(["open", "in_progress", "resolved"]);
const PRIORITIES = new Set(["low", "normal", "high"]);

/**
 * PATCH /api/tickets/[id] { status?, priority?, title? }
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
    if (typeof body.status !== "string" || !STATUSES.has(body.status)) {
      return Response.json({ error: "status must be open|in_progress|resolved" }, { status: 400 });
    }
    vals.push(body.status);
    sets.push(`status = $${vals.length}`);
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority)) {
      return Response.json({ error: "priority must be low|normal|high" }, { status: 400 });
    }
    vals.push(body.priority);
    sets.push(`priority = $${vals.length}`);
  }
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 200) {
      return Response.json({ error: "title must be 1–200 chars" }, { status: 400 });
    }
    vals.push(title);
    sets.push(`title = $${vals.length}`);
  }
  if (sets.length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    vals.push(id);
    const res = await getPool().query(
      `UPDATE tickets SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = $${vals.length} RETURNING id, status`,
      vals
    );
    if (res.rowCount === 0) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }
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

/**
 * DELETE /api/tickets/[id]
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await getPool().query(`DELETE FROM tickets WHERE id = $1`, [id]);
    if (res.rowCount === 0) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }
    revalidatePath("/tickets");
    revalidatePath("/conversations");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
