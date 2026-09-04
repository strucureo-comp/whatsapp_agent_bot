import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function requireAuth(): Promise<string> {
  const cookieStore = await cookies();
  const uid = cookieStore.get("auth_uid")?.value;

  if (!uid) {
    return "";
  }

  return uid;
}

export async function getAuthUid(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("auth_uid")?.value || null;
}
