import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";

/**
 * DELETE /api/conversations?test=1[&tenant=<id>] — bulk-clear temp/test chats.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("test") !== "1") {
    return Response.json({ error: "Only bulk delete supported: ?test=1" }, { status: 400 });
  }
  const tenant = url.searchParams.get("tenant");
  try {
    const res = tenant
      ? await getPool().query(
          `DELETE FROM conversations WHERE is_test = true AND tenant_id = $1`,
          [tenant]
        )
      : await getPool().query(`DELETE FROM conversations WHERE is_test = true`);
    revalidatePath("/conversations");
    return Response.json({ ok: true, deleted: res.rowCount ?? 0 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
