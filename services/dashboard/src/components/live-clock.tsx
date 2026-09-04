"use client";

import { useEffect, useState } from "react";
import { Clock, CheckCircle2, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveClockProps {
  compact?: boolean;
  className?: string;
}

export function LiveClock({ compact = false, className }: LiveClockProps) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!mounted) {
    if (compact) {
      return (
        <div className={cn("flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground", className)}>
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">--:--:-- IST</span>
        </div>
      );
    }
    return (
      <div className={cn("flex items-center justify-between gap-3 rounded-lg border bg-zinc-50/50 p-3 shadow-xs", className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>India Standard Time (IST)</span>
        </div>
        <span className="font-mono text-sm font-semibold text-zinc-400">--:--:-- IST</span>
      </div>
    );
  }

  // Current time in Asia/Kolkata
  const timeStr = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const dateStr = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // Check IST business hours (09:00 - 18:00)
  const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  const isBusinessHours = istMinutes >= 9 * 60 && istMinutes < 18 * 60;

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-md border border-zinc-200/80 bg-zinc-50/80 px-2.5 py-1.5 text-xs text-zinc-700 shadow-xs",
          className
        )}
        title={`Calendar timezone: Asia/Kolkata (IST) · ${dateStr}`}
      >
        <div className="flex items-center gap-1.5 font-medium">
          <span
            className={cn(
              "relative flex h-2 w-2",
              isBusinessHours ? "text-emerald-500" : "text-amber-500"
            )}
          >
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                isBusinessHours ? "bg-emerald-400" : "bg-amber-400"
              )}
            />
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                isBusinessHours ? "bg-emerald-500" : "bg-amber-500"
              )}
            />
          </span>
          <span className="font-mono font-semibold">{timeStr}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          IST
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-zinc-200/80 bg-linear-to-r from-zinc-50 via-white to-zinc-50/50 p-3.5 shadow-xs transition-all",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Live Calendar Time
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600">
                Asia/Kolkata (UTC+05:30)
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{dateStr}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-lg font-bold tracking-tight text-zinc-900">
              {timeStr}
            </div>
          </div>

          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border shadow-2xs",
              isBusinessHours
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isBusinessHours ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              )}
            />
            {isBusinessHours ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>Working Hours (09:00–18:00 IST)</span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Moon className="h-3 w-3" />
                <span>After Hours (09:00–18:00 IST)</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
