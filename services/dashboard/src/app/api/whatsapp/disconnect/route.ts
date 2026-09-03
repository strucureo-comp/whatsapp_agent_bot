import { revalidatePath } from "next/cache";
import { disconnectSession } from "@/lib/gateway";

export async function POST(request: Request) {
  let body: { tenant_id?: string; wipe?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.tenant_id) {
    return Response.json({ error: "tenant_id is required" }, { status: 400 });
  }
  const result = await disconnectSession(body.tenant_id, body.wipe === true);
  if (!result) {
    return Response.json({ error: "Gateway unreachable" }, { status: 502 });
  }
  revalidatePath("/whatsapp");
  revalidatePath("/");
  return Response.json(result);
}
