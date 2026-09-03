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
    await client.query(
      `UPDATE escalations SET status = 'resolved', resolved_at = NOW()
        WHERE conversation_id = $1 AND status = 'open'`,
      [id]
    );
    const conv = await client.query(
      `UPDATE conversations SET status = 'active', updated_at = NOW()
        WHERE id = $1 RETURNING id`,
      [id]
    );
    if (conv.rowCount === 0) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    await client.query("COMMIT");
    revalidatePath("/conversations");
    revalidatePath("/escalations");
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
