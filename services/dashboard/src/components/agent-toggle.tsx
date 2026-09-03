"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, User } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Agent ON (active) ⇄ Human mode (human_handling).
 * Human mode: inbound still lands in history, bot sends nothing —
 * staff replies from the linked phone. Escalated chats resolve separately.
 */
export function AgentToggle({
  conversationId,
  status,
  compact = false,
}: {
  conversationId: string;
  status: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentOn = status === "active";

  async function flip(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: on ? "active" : "human_handling" }),
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

  if (status === "escalated") return null;

  return (
    <span className={cn("inline-flex items-center gap-2", compact && "gap-1.5")}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
          agentOn ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
        )}
      >
        {agentOn ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
        {!compact && (agentOn ? "Agent on" : "Human mode")}
      </span>
      <Switch
        checked={agentOn}
        onCheckedChange={flip}
        disabled={busy}
        aria-label="Toggle agent replies"
      />
      {!compact && (
        <Label className="text-xs text-muted-foreground">
          {agentOn ? "Bot replies" : "Staff replies"}
        </Label>
      )}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
