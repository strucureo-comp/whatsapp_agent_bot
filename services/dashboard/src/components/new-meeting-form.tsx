"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Clock, Sparkles, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SlotItem {
  time: string;
  label: string;
  start: string;
  end: string;
}

function getISTDate(offsetDays = 0): string {
  const d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60_000);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function NewMeetingForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => getISTDate(1)); // Default to tomorrow
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [attendee, setAttendee] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Available slots state
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<SlotItem[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Fetch slots whenever date or duration changes
  useEffect(() => {
    if (!date || !tenantId) return;

    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);

    const dur = parseInt(duration, 10) || 30;
    fetch(`/api/calendar/availability?tenant_id=${encodeURIComponent(tenantId)}&date=${encodeURIComponent(date)}&duration=${dur}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setSlotsError(data.error);
          setAvailableSlots([]);
        } else {
          setAvailableSlots(data.slots || []);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setSlotsError(err instanceof Error ? err.message : "Failed to load slots");
        setAvailableSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, date, duration]);

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

  // Preset quick times
  const PRESET_TIMES = ["09:00", "10:30", "12:00", "14:30", "16:00", "17:00"];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="nm-title" className="text-xs font-semibold">Title</Label>
          <Input
            id="nm-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Consultation / Call with Priya"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="nm-date" className="text-xs font-semibold">Date</Label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDate(getISTDate(0))}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  date === getISTDate(0)
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:bg-zinc-200"
                )}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDate(getISTDate(1))}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  date === getISTDate(1)
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:bg-zinc-200"
                )}
              >
                Tomorrow
              </button>
            </div>
          </div>
          <Input id="nm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-dur" className="text-xs font-semibold">Duration (min)</Label>
          <Input
            id="nm-dur"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="30"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-time" className="text-xs font-semibold">Time (HH:mm IST)</Label>
          <Input id="nm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-att" className="text-xs font-semibold">Attendee email (optional)</Label>
          <Input
            id="nm-att"
            type="email"
            value={attendee}
            onChange={(e) => setAttendee(e.target.value)}
            placeholder="customer@example.com"
          />
        </div>
      </div>

      {/* Available Slots Section */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-700">
              Free Slots on Calendar (09:00–18:00 IST)
            </span>
          </div>
          {slotsLoading ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking Google Calendar…
            </span>
          ) : availableSlots.length > 0 ? (
            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200 bg-emerald-50">
              {availableSlots.length} slot{availableSlots.length === 1 ? "" : "s"} free
            </Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {slotsError ? "Offline preview" : "No open slots"}
            </span>
          )}
        </div>

        {availableSlots.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
            {availableSlots.map((s) => {
              const selected = time === s.time;
              return (
                <button
                  key={s.time}
                  type="button"
                  onClick={() => setTime(s.time)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium transition-all",
                    selected
                      ? "border-primary bg-primary text-primary-foreground shadow-2xs"
                      : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-100"
                  )}
                  title={s.label}
                >
                  {s.time}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {slotsError
                ? "Calendar disconnected or offline. You can select a standard time:"
                : "No free slots remaining on this day during working hours (09:00–18:00 IST). Quick presets:"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TIMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTime(t)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium transition-all",
                    time === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                  )}
                >
                  {t} IST
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={create} disabled={busy || !valid}>
          <CalendarPlus className="h-4 w-4" /> {busy ? "Booking…" : "Book meeting"}
        </Button>
        {result ? <span className="text-xs text-green-700 font-medium">{result}</span> : null}
        {error ? <span className="text-xs text-destructive font-medium">{error}</span> : null}
      </div>
    </div>
  );
}
