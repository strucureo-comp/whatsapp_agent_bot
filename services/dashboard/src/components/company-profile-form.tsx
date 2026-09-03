"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Save } from "lucide-react";
import type { CompanyProfile, Tenant } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const FIELDS: { key: keyof CompanyProfile; label: string; placeholder: string; textarea?: boolean }[] = [
  { key: "business_name", label: "Business name", placeholder: "e.g. Sharma Sweets" },
  { key: "industry", label: "Industry", placeholder: "e.g. Bakery / Clinic / Salon" },
  { key: "about", label: "About (one or two lines)", placeholder: "What the business does", textarea: true },
  { key: "hours", label: "Hours", placeholder: "e.g. Mon–Sat, 9am–9pm" },
  { key: "address", label: "Address", placeholder: "Shop no, street, city" },
  { key: "phone", label: "Phone", placeholder: "+91…" },
  { key: "email", label: "Email", placeholder: "hello@…" },
  { key: "website", label: "Website", placeholder: "https://…" },
  { key: "services", label: "Services / products (one per line or ;-separated)", placeholder: "Cakes; Snacks; Party orders", textarea: true },
  { key: "policies", label: "Policies (refunds, delivery, appointments…)", placeholder: "No refunds after…", textarea: true },
];

export function CompanyProfileForm({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<CompanyProfile>(tenant.company_profile ?? {});

  function set(key: keyof CompanyProfile, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Drop empty fields so the prompt only carries real facts.
      const cleaned: CompanyProfile = {};
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === "string" && v.trim()) cleaned[k as keyof CompanyProfile] = v.trim();
      }
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_profile: cleaned }),
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
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        These facts are injected into every bot reply as the business profile — live on the
        next turn, no restart needed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={`flex flex-col gap-2 ${f.textarea ? "sm:col-span-2" : ""}`}>
            <Label htmlFor={`cp-${f.key}`}>{f.label}</Label>
            {f.textarea ? (
              <Textarea
                id={`cp-${f.key}`}
                rows={3}
                value={form[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            ) : (
              <Input
                id={`cp-${f.key}`}
                value={form[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          <Save /> {saving ? "Saving…" : "Save company profile"}
        </Button>
        {saved ? <span className="text-xs text-green-700">Saved — live on next reply.</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
