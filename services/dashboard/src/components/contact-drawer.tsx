"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Contact2, Plus, Save, Trash2, X } from "lucide-react";
import type { Conversation, Ticket } from "@/lib/queries";
import type { ContactTag } from "@/lib/contact";
import { CONTACT_TAGS } from "@/lib/contact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TicketStatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

export function ContactDrawer({
  conversation,
  tickets,
}: {
  conversation: Conversation;
  tickets: Ticket[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(conversation.customer_name ?? "");
  const [tag, setTag] = useState<ContactTag>(conversation.contact_tag ?? "new_lead");
  const [notes, setNotes] = useState(conversation.notes ?? "");
  const [ticketTitle, setTicketTitle] = useState("");
  const [addingTicket, setAddingTicket] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: name, contact_tag: tag, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete this chat with ${conversation.customer_name || conversation.customer_number}? Messages are removed too.`
      )
    )
      return;
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push("/conversations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addTicket() {
    if (!ticketTitle.trim()) return;
    setAddingTicket(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: conversation.tenant_id,
          conversation_id: conversation.id,
          title: ticketTitle.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setTicketTitle("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingTicket(false);
    }
  }

  async function advanceTicket(t: Ticket) {
    const next = t.status === "open" ? "in_progress" : t.status === "in_progress" ? "resolved" : "open";
    try {
      await fetch(`/api/tickets/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Contact2 /> Contact
      </Button>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30",
          open ? "block" : "hidden"
        )}
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col gap-4 overflow-y-auto border-l bg-white p-5 shadow-xl transition-transform",
          open ? "translate-x-0" : "translate-x-full"
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Contact</h2>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ct-name">Name</Label>
          <Input
            id="ct-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. Priya Sharma"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Client type</Label>
          <Select value={tag} onValueChange={(v) => { setTag(v as ContactTag); setSaved(false); }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_TAGS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ct-notes">Notes</Label>
          <Textarea
            id="ct-notes"
            rows={3}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(false);
            }}
            placeholder="Prefers evening calls, quoted ₹…"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save /> {saving ? "Saving…" : "Save contact"}
          </Button>
          {saved ? <span className="text-xs text-green-700">Saved.</span> : null}
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Tickets for this chat</h3>
          <div className="flex gap-2">
            <Input
              value={ticketTitle}
              onChange={(e) => setTicketTitle(e.target.value)}
              placeholder="New ticket — e.g. Send Diwali quote"
              onKeyDown={(e) => {
                if (e.key === "Enter") addTicket();
              }}
            />
            <Button size="sm" onClick={addTicket} disabled={addingTicket || !ticketTitle.trim()}>
              <Plus />
            </Button>
          </div>
          {tickets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tickets yet.</p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => advanceTicket(t)}
                title="Click to advance status"
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-accent"
              >
                <span className="truncate font-medium">{t.title}</span>
                <TicketStatusBadge status={t.status} />
              </button>
            ))
          )}
          <p className="text-[11px] text-muted-foreground">Click a ticket to move it forward.</p>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
          <div>
            <Button variant="destructive" size="sm" onClick={remove}>
              <Trash2 /> Delete this chat
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Removes the conversation and its messages. Tickets stay, unlinked.
          </p>
        </div>

        <div className="mt-auto font-mono text-[11px] text-muted-foreground">
          {conversation.customer_number}
        </div>
      </aside>
    </>
  );
}
