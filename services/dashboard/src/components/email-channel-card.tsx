"use client";

import { useState } from "react";
import { Mail, Copy, Check, Send, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { Tenant } from "@/lib/queries";

export function EmailChannelCard({ tenant }: { tenant: Tenant }) {
  const inboundAddress = `${tenant.inbound_email_slug || "agent"}@inbound.strucureo.com`;
  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/email/inbound`
    : "https://whatsapp-agent-bot-murex.vercel.app/api/email/inbound";

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Settings form state
  const [customEmail, setCustomEmail] = useState(tenant.custom_email_address || "");
  const [signature, setSignature] = useState(tenant.email_signature || `Best regards,\nThe ${tenant.name} Team`);
  const [emailEnabled, setEmailEnabled] = useState(tenant.email_enabled ?? true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Live test simulator state
  const [testFrom, setTestFrom] = useState("prospect.client@example.com");
  const [testSubject, setTestSubject] = useState("Inquiry: Schedule consultation for next week");
  const [testBody, setTestBody] = useState("Hi there, I am interested in your services. Can we arrange a call or meeting tomorrow afternoon?");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reply?: string; dispatched?: boolean; error?: string } | null>(null);

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custom_email_address: customEmail.trim() || null,
          email_signature: signature.trim() || null,
          email_enabled: emailEnabled,
        }),
      });
      if (res.ok) {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save email settings:", err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRunSimulator = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant.id,
          from: testFrom,
          subject: testSubject,
          content: testBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ error: data.error || "Failed to simulate email" });
      } else {
        setTestResult({ reply: data.reply, dispatched: data.dispatched });
      }
    } catch (err) {
      setTestResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="border-blue-100 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-blue-50/50 via-indigo-50/30 to-transparent border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Email Channel (Two-Way Inbound & Outbound)
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                  Omnichannel
                </Badge>
              </CardTitle>
              <CardDescription>
                Receive client emails, let the AI agent draft professional replies, and schedule meetings.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="email-active-switch" className="text-xs text-muted-foreground font-medium">
              {emailEnabled ? "Agent Active" : "Paused"}
            </Label>
            <Switch
              id="email-active-switch"
              checked={emailEnabled}
              onCheckedChange={setEmailEnabled}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-5">
        {/* 1. Inbound Routing Addresses */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-zinc-800">Inbound Mail Address</Label>
              <span className="text-[10px] text-muted-foreground">Direct client email</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 border">
                {inboundAddress}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(inboundAddress, setCopiedAddress)}
                className="h-8 gap-1 text-xs shrink-0"
              >
                {copiedAddress ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedAddress ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Emails sent to this address automatically trigger the AI agent.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-zinc-800">Inbound Webhook URL</Label>
              <span className="text-[10px] text-muted-foreground">Resend / Cloudflare / Postmark</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 border">
                {webhookUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(webhookUrl, setCopiedWebhook)}
                className="h-8 gap-1 text-xs shrink-0"
              >
                {copiedWebhook ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedWebhook ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Paste this into your email forwarding or MX webhook provider.
            </p>
          </div>
        </div>

        {/* 2. Configuration Settings */}
        <div className="grid gap-4 sm:grid-cols-2 pt-1 border-t">
          <div className="space-y-1.5">
            <Label htmlFor="custom-email" className="text-xs font-medium">
              Custom Business Email (Optional)
            </Label>
            <Input
              id="custom-email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              placeholder="e.g., info@yourcompany.com"
              className="text-xs h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Shown in the "From" line of outgoing email replies.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-signature" className="text-xs font-medium">
              Email Closing Signature
            </Label>
            <Textarea
              id="email-signature"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Best regards,&#10;The Team"
              rows={2}
              className="text-xs resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">
            {settingsSaved && <span className="text-green-600 font-medium">✓ Email settings saved</span>}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="h-8 text-xs"
          >
            {savingSettings ? "Saving..." : "Save Email Settings"}
          </Button>
        </div>

        {/* 3. Interactive Inbound Email Simulator */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-semibold text-zinc-900">
                Live Inbound Email Simulator
              </span>
            </div>
            <span className="text-[11px] text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full font-medium">
              Instant AI Test
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] font-medium text-zinc-700">Client Email (Sender)</Label>
              <Input
                value={testFrom}
                onChange={(e) => setTestFrom(e.target.value)}
                className="text-xs h-8 mt-1 bg-white"
              />
            </div>
            <div>
              <Label className="text-[11px] font-medium text-zinc-700">Subject</Label>
              <Input
                value={testSubject}
                onChange={(e) => setTestSubject(e.target.value)}
                className="text-xs h-8 mt-1 bg-white"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] font-medium text-zinc-700">Inbound Email Message</Label>
            <Textarea
              value={testBody}
              onChange={(e) => setTestBody(e.target.value)}
              rows={2}
              className="text-xs mt-1 bg-white resize-none"
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleRunSimulator}
              disabled={testing || !testBody.trim()}
              className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {testing ? "Agent Processing Email..." : "Send Test Inbound Email"}
            </Button>
          </div>

          {/* Test Output Box */}
          {testResult && (
            <div className="mt-3 rounded-lg border bg-white p-3.5 text-xs shadow-xs space-y-2">
              {testResult.error ? (
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{testResult.error}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b pb-1.5 text-[11px]">
                    <span className="font-semibold text-zinc-700">
                      AI Agent Reply (Delivered to {testFrom}):
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      Dispatched Outbound
                    </Badge>
                  </div>
                  <div className="whitespace-pre-wrap font-sans text-zinc-800 leading-relaxed bg-zinc-50 p-2.5 rounded border border-zinc-100">
                    {testResult.reply}
                  </div>
                  <p className="text-[10px] text-muted-foreground text-right">
                    Conversation thread created/updated in{" "}
                    <a href={`/conversations?channel=email`} className="text-blue-600 underline">
                      Chats & Inboxes
                    </a>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
