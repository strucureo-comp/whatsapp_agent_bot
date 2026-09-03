import { revalidatePath } from "next/cache";
import { requestPairingCode } from "@/lib/gateway";

export async function POST(request: Request) {
  let body: { tenant_id?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.tenant_id || !body.phone) {
    return Response.json({ error: "tenant_id and phone are required" }, { status: 400 });
  }
  const result = await requestPairingCode(body.tenant_id, body.phone);
  if (!result) {
    return Response.json({ error: "Gateway unreachable or pairing failed" }, { status: 502 });
  }
  revalidatePath("/whatsapp");
  return Response.json(result);
}
