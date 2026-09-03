"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2 } from "lucide-react";
import type { Ticket } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TicketAdvanceButton({ ticket }: { ticket: Ticket }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (ticket.status === "resolved") return null;
  const next = ticket.status === "open" ? "in_progress" : "resolved";

  async function advance() {
    setBusy(true);
    try {
      await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={advance} disabled={busy}>
      <Check /> {next === "resolved" ? "Resolve" : "Start"}
    </Button>
  );
}

export function TicketDeleteButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm("Delete this ticket?")) return;
    setBusy(true);
    try {
      await fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
      <Trash2 />
    </Button>
  );
}

export function TicketCreateForm({ tenantId }: { tenantId?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!title.trim() || !tenantId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, title: title.trim(), priority }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setTitle("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!tenantId) {
    return <p className="text-xs text-muted-foreground">Pick a tenant above to add tickets.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New ticket — e.g. Follow up on quote"
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">low</SelectItem>
            <SelectItem value="normal">normal</SelectItem>
            <SelectItem value="high">high</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={create} disabled={busy || !title.trim()}>
          <Plus /> Add
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
