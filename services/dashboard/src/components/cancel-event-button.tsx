"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CancelEventButton({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirm("Cancel this meeting on Google Calendar?")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/calendar/events?tenant_id=${tenantId}&event_id=${encodeURIComponent(eventId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="icon" className="shrink-0" onClick={cancel} disabled={busy} title="Cancel meeting">
      <CalendarX />
    </Button>
  );
}
