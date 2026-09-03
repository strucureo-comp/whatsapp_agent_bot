"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, PlugZap, Save } from "lucide-react";
import type { Tenant } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

// Model IDs already used in this repo — pick one or type your own.
const SUGGESTIONS: Record<string, string[]> = {
  groq: ["groq/compound-mini"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
};

interface KeyStatus {
  anthropic: boolean;
  groq: boolean;
}

export function ModelConnection({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [provider, setProvider] = useState(tenant.llm_provider);
  const [model, setModel] = useState(tenant.llm_model);
  const [keys, setKeys] = useState<KeyStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/llm/status")
      .then((r) => r.json())
      .then(setKeys)
      .catch(() => setKeys(null));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm_provider: provider, llm_model: model }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTestResult(`OK in ${body.latency_ms}ms — model replied: “${body.sample}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  const keyOn = provider === "groq" ? keys?.groq : keys?.anthropic;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs">
        <Plug className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">API keys (from server .env):</span>
        <Badge variant={keys?.anthropic ? "success" : "secondary"}>
          Anthropic {keys == null ? "…" : keys.anthropic ? "set" : "missing"}
        </Badge>
        <Badge variant={keys?.groq ? "success" : "secondary"}>
          Groq {keys == null ? "…" : keys.groq ? "set" : "missing"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Provider</Label>
          <Select
            value={provider}
            onValueChange={(v) => {
              setProvider(v);
              const sug = SUGGESTIONS[v]?.[0];
              if (sug) setModel(sug);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">anthropic</SelectItem>
              <SelectItem value="groq">groq</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="conn-model">Model</Label>
          <Input
            id="conn-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list={`models-${tenant.id}`}
            placeholder={SUGGESTIONS[provider]?.[0] ?? "model id"}
          />
          <datalist id={`models-${tenant.id}`}>
            {(SUGGESTIONS[provider] ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>

      {keys != null && !keyOn ? (
        <p className="text-xs text-amber-700">
          No API key for {provider} on the server — add it to the root .env and restart the
          daemon, or pick the other provider.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving}>
          <Save /> {saving ? "Saving…" : "Save connection"}
        </Button>
        <Button variant="outline" onClick={test} disabled={testing || !model}>
          <PlugZap /> {testing ? "Testing…" : "Test connection"}
        </Button>
      </div>
      {testResult ? <p className="text-xs text-green-700">{testResult}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
