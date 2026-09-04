import { revalidatePath } from "next/cache";
import { requestPairingCode } from "@/lib/gateway";
import { getAuthUid } from "@/lib/auth-server";
import { getTenant } from "@/lib/queries";
import { NextResponse } from "next/server";

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
  const uid = await getAuthUid();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getTenant(body.tenant_id, uid);
  if (!tenant) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await requestPairingCode(body.tenant_id, body.phone);
  if (!result) {
    return Response.json({ error: "Gateway unreachable or pairing failed" }, { status: 502 });
  }
  revalidatePath("/whatsapp");
  return Response.json(result);
}
