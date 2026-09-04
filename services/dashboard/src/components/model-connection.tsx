"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PlugZap,
  Save,
  KeyRound,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Server,
  Sparkles,
} from "lucide-react";
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
import {
  SECRET_PROVIDERS,
  SecretProvider,
  TenantSecretMasked,
} from "@/lib/tenant-secrets-config";


export function ModelConnection({ tenant }: { tenant: Tenant }) {
  const router = useRouter();

  const [provider, setProvider] = useState<SecretProvider>(
    (tenant.llm_provider as SecretProvider) || "groq"
  );
  const [model, setModel] = useState(tenant.llm_model || "llama-3.3-70b-versatile");
  const [baseUrl, setBaseUrl] = useState(tenant.llm_base_url || "");

  const [tenantSecrets, setTenantSecrets] = useState<TenantSecretMasked[]>([]);

  const [inputKey, setInputKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [deletingKey, setDeletingKey] = useState(false);

  const [savingConfig, setSavingConfig] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    latency_ms: number;
    sample: string;
    tool_calls?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function loadSecrets() {
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/secrets`);
      if (res.ok) {
        const data = await res.json();
        setTenantSecrets(data.secrets || []);
      }
    } catch {
      // Non-fatal
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch(`/api/tenants/${tenant.id}/secrets`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setTenantSecrets(data.secrets || []);
        }
      } catch {
        // Non-fatal
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [tenant.id]);

  const currentProviderDef =
    SECRET_PROVIDERS.find((p) => p.value === provider) || SECRET_PROVIDERS[0];
  const activeTenantSecret = tenantSecrets.find((s) => s.provider === provider);

  async function handleProviderChange(newProvider: SecretProvider) {
    setProvider(newProvider);
    setError(null);
    setTestResult(null);
    setSuccessMsg(null);
    setInputKey("");

    const def = SECRET_PROVIDERS.find((p) => p.value === newProvider);
    if (def) {
      setModel(def.defaultModel);
      if (newProvider === "custom" || newProvider === "ollama") {
        setBaseUrl(tenant.llm_base_url || def.defaultBaseUrl || "");
      } else {
        setBaseUrl(tenant.llm_base_url || "");
      }
    }
  }

  async function handleSaveKey() {
    if (!inputKey.trim()) return;
    setSavingKey(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          label: `${currentProviderDef.label} Key`,
          key: inputKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setInputKey("");
      setSuccessMsg(`Encrypted key for ${provider} saved securely.`);
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleDeleteKey() {
    if (!confirm(`Remove encrypted BYOK key for ${provider}?`)) return;
    setDeletingKey(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/secrets?provider=${provider}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setSuccessMsg(`BYOK key for ${provider} removed.`);
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingKey(false);
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: provider,
          llm_model: model.trim(),
          llm_base_url: baseUrl.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setSuccessMsg("LLM connection settings saved successfully.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          tenantId: tenant.id,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setTestResult({
        latency_ms: data.latency_ms,
        sample: data.sample,
        tool_calls: data.tool_calls,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Provider selection & model */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label className="font-semibold">LLM Provider</Label>
          <Select
            value={provider}
            onValueChange={(val) => handleProviderChange(val as SecretProvider)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {SECRET_PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  <div className="flex items-center gap-2">
                    <span>{p.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Switch provider at any time. Supports OpenAI, Claude, Groq, local Ollama, and any OpenAI-compatible API.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="conn-model" className="font-semibold">
            Model ID
          </Label>
          <Input
            id="conn-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list={`models-${tenant.id}`}
            placeholder={currentProviderDef.defaultModel}
          />
          <datalist id={`models-${tenant.id}`}>
            {currentProviderDef.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
          <div className="flex flex-wrap gap-1 mt-1">
            {currentProviderDef.models.slice(0, 3).map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setModel(m.id)}
                className="text-[11px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                {m.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Custom Base URL (OpenAI-compatible) */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/20">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url" className="text-xs font-semibold flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            API Base URL {provider === "custom" || provider === "ollama" ? "(Required)" : "(Optional override)"}
          </Label>
          {currentProviderDef.defaultBaseUrl && (
            <span className="text-[11px] text-muted-foreground">
              Default: {currentProviderDef.defaultBaseUrl}
            </span>
          )}
        </div>
        <Input
          id="base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={currentProviderDef.defaultBaseUrl || "https://your-custom-llm.com/v1"}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Tenant endpoint for this provider. Leaves standard OpenAI `/chat/completions` spec intact.
        </p>
      </div>

      {/* BYOK (Bring Your Own Key) Card */}
      <div className="p-4 rounded-lg border bg-card flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Tenant API Key (BYOK)</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {activeTenantSecret ? (
              <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                BYOK Active: {activeTenantSecret.key_masked}
              </Badge>
            ) : currentProviderDef.requiresKey ? (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                No Key Configured — Add Your API Key Below
              </Badge>
            ) : (
              <Badge variant="secondary">No Key Required (Local/Open)</Badge>
            )}
          </div>
        </div>

        {activeTenantSecret ? (
          <div className="flex items-center justify-between bg-muted/40 p-3 rounded text-xs">
            <div>
              <p className="font-medium">
                Encrypted Key: <span className="font-mono">{activeTenantSecret.key_masked}</span>
              </p>
              <p className="text-muted-foreground text-[11px] mt-0.5">
                Saved {new Date(activeTenantSecret.updated_at).toLocaleDateString()} — encrypted with AES-256-GCM.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteKey}
              disabled={deletingKey}
              className="h-7 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {deletingKey ? "Removing…" : "Remove Key"}
            </Button>
          </div>
        ) : null}

        {/* Input to add or rotate key */}
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="password"
            autoComplete="off"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder={
              activeTenantSecret
                ? "Enter new key to replace current key..."
                : `Enter ${currentProviderDef.label} API Key (e.g. sk-...)`
            }
            className="text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSaveKey}
            disabled={savingKey || !inputKey.trim()}
            className="whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            {savingKey ? "Encrypting…" : activeTenantSecret ? "Rotate Key" : "Save Key"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-600 shrink-0" />
          Keys are encrypted at rest with AES-256-GCM using <code className="text-[10px] bg-muted px-1 py-0.5 rounded">CREDENTIALS_ENC_KEY</code> and never leave the backend.
        </p>
      </div>

      {/* Action buttons & test outputs */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button onClick={handleSaveConfig} disabled={savingConfig}>
          <Save className="h-4 w-4 mr-1.5" />
          {savingConfig ? "Saving settings…" : "Save Connection"}
        </Button>

        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !model.trim()}
          className="border-primary/30 hover:border-primary"
        >
          <PlugZap className="h-4 w-4 mr-1.5 text-primary" />
          {testing ? "Testing live tool-call…" : "Test Connection & Tools"}
        </Button>
      </div>

      {/* Success banner */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 text-xs border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Test result card */}
      {testResult && (
        <div className="p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              Live Connection Verified ({testResult.latency_ms}ms)
            </div>
            <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-300 text-[10px]">
              Tool-Calling Supported
            </Badge>
          </div>
          <div className="text-xs font-mono bg-background/80 p-2.5 rounded border border-emerald-200 dark:border-emerald-900 text-foreground">
            {testResult.sample}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-xs border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1 font-mono text-[11px] break-all">{error}</div>
        </div>
      )}
    </div>
  );
}
