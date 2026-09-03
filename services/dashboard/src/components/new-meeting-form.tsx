"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewMeetingForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [attendee, setAttendee] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          title: title.trim(),
          date,
          time,
          duration_minutes: parseInt(duration, 10) || 30,
          attendee_email: attendee.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(`Booked for ${date} ${time} IST${body.link ? " — view it in Google Calendar" : ""}.`);
      setTitle("");
      setAttendee("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const valid = title.trim() && date && time;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="nm-title">Title</Label>
          <Input
            id="nm-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Call with Priya"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-date">Date</Label>
          <Input id="nm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-time">Time (IST)</Label>
          <Input id="nm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-dur">Duration (min)</Label>
          <Input
            id="nm-dur"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-att">Attendee email (optional)</Label>
          <Input
            id="nm-att"
            type="email"
            value={attendee}
            onChange={(e) => setAttendee(e.target.value)}
            placeholder="customer@…"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={create} disabled={busy || !valid}>
          <CalendarPlus /> {busy ? "Booking…" : "Book meeting"}
        </Button>
        {result ? <span className="text-xs text-green-700">{result}</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
