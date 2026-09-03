"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ClearTestChats({ tenantId }: { tenantId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clear() {
    if (!confirm("Delete ALL test chats? Their messages go too. Real chats are untouched.")) return;
    setBusy(true);
    try {
      const q = tenantId ? `?test=1&tenant=${tenantId}` : "?test=1";
      const res = await fetch(`/api/conversations${q}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      alert(`Deleted ${body.deleted ?? 0} test chat(s).`);
      router.push("/conversations");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>
      <Eraser /> {busy ? "Clearing…" : "Clear test chats"}
    </Button>
  );
}
