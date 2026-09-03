import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const esc = await client.query(
      `UPDATE escalations SET status = 'resolved', resolved_at = NOW()
        WHERE id = $1 AND status = 'open' RETURNING conversation_id`,
      [id]
    );
    if (esc.rowCount === 0) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Escalation not found or already resolved" }, { status: 404 });
    }
    await client.query(
      `UPDATE conversations SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [esc.rows[0].conversation_id]
    );
    await client.query("COMMIT");
    revalidatePath("/escalations");
    revalidatePath("/conversations");
    revalidatePath("/");
    return Response.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
