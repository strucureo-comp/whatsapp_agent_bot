"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Unplug } from "lucide-react";
import type { GoogleConnection } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function GoogleCalendarCard({
  tenantId,
  connection,
  calendarId,
}: {
  tenantId: string;
  connection: GoogleConnection;
  calendarId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!confirm("Disconnect this Google account? Booking checks will stop working.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!connection.connected) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          No Google account linked. Connect to let the bot check availability and create events
          as the tenant — no service-account sharing needed.
        </p>
        <div>
          <Button asChild>
            <a href={`/api/auth/google?tenant=${tenantId}`}>
              <CalendarDays /> Connect Google Calendar
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="success">connected</Badge>
        {connection.google_email ? (
          <span className="font-mono text-xs">{connection.google_email}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted p-2">
          <p className="text-muted-foreground">Reads calendar</p>
          <p className="font-mono font-medium">{calendarId || "primary"}</p>
        </div>
        <div className="rounded-md bg-muted p-2">
          <p className="text-muted-foreground">Token expires</p>
          <p className="font-medium">{formatDateTime(connection.expiry)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Access tokens auto-refresh from the stored refresh token. Reconnect if booking starts
        failing.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
          <Unplug /> {busy ? "Disconnecting…" : "Disconnect"}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
