"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PairForm({ tenantId, defaultPhone }: { tenantId: string; defaultPhone?: string | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    setCode(null);
    try {
      const res = await fetch("/api/whatsapp/pair-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.status === "already_paired") {
        setError("Already paired — disconnect with wipe first to link a different number.");
      } else {
        setCode(body.pairing_code ?? null);
        setExpires(body.expires_at ?? null);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`phone-${tenantId}`}>Business number (with country code)</Label>
        <div className="flex gap-2">
          <Input
            id={`phone-${tenantId}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91…"
            className="font-mono"
          />
          <Button onClick={request} disabled={busy || !phone}>
            <KeyRound /> {busy ? "Requesting…" : "Get code"}
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {code ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-3">
          <p className="text-xs text-green-800">Enter this on the phone → Linked devices:</p>
          <p className="font-mono text-2xl font-bold tracking-widest text-green-900">{code}</p>
          {expires ? <p className="text-xs text-green-700">Expires {expires}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function DisconnectButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!confirm("Disconnect this WhatsApp session? The bot will stop replying.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/disconnect", {
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

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
        {busy ? "Disconnecting…" : "Disconnect"}
      </Button>
    </span>
  );
}
