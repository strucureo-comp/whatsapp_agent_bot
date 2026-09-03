"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import type { Tenant } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function TenantEditor({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: tenant.name,
    status: tenant.status,
    staff_whatsapp: tenant.staff_whatsapp ?? "",
    google_calendar_id: tenant.google_calendar_id ?? "",
    persona_prompt: tenant.persona_prompt ?? "",
    max_monthly_spend_cents: String(tenant.max_monthly_spend_cents),
    reply_max_tokens: String(tenant.reply_max_tokens),
    debounce_ms: String(tenant.debounce_ms),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          max_monthly_spend_cents: parseInt(form.max_monthly_spend_cents, 10),
          reply_max_tokens: parseInt(form.reply_max_tokens, 10),
          debounce_ms: parseInt(form.debounce_ms, 10),
        }),
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

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Active</Label>
          <div className="flex h-9 items-center gap-2">
            <Switch
              checked={form.status === "active"}
              onCheckedChange={(on) => set("status", on ? "active" : "paused")}
            />
            <span className="text-sm text-muted-foreground">
              {form.status === "active" ? "Bot replies to customers" : "Paused — bot silent"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff">Staff WhatsApp (escalation alerts)</Label>
          <Input
            id="staff"
            value={form.staff_whatsapp}
            onChange={(e) => set("staff_whatsapp", e.target.value)}
            placeholder="+91…"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cal">Google Calendar ID</Label>
          <Input
            id="cal"
            value={form.google_calendar_id}
            onChange={(e) => set("google_calendar_id", e.target.value)}
            placeholder="shared calendar id"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="spend">Monthly spend cap (cents)</Label>
          <Input
            id="spend"
            inputMode="numeric"
            value={form.max_monthly_spend_cents}
            onChange={(e) => set("max_monthly_spend_cents", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tokens">Reply max tokens</Label>
            <Input
              id="tokens"
              inputMode="numeric"
              value={form.reply_max_tokens}
              onChange={(e) => set("reply_max_tokens", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="debounce">Debounce (ms)</Label>
            <Input
              id="debounce"
              inputMode="numeric"
              value={form.debounce_ms}
              onChange={(e) => set("debounce_ms", e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="persona">Persona prompt</Label>
        <Textarea
          id="persona"
          rows={10}
          className="font-mono text-xs"
          value={form.persona_prompt}
          onChange={(e) => set("persona_prompt", e.target.value)}
          placeholder="You are the WhatsApp assistant for …"
        />
        <p className="text-xs text-muted-foreground">
          This is the system prompt. Forbid vendor self-identity here — the model otherwise
          answers as Groq/Anthropic instead of your business.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          <Save /> {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved ? <span className="text-xs text-green-700">Saved.</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
