import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-server";
import { ArrowLeft, ArrowRight, Save, Trash2, Webhook } from "lucide-react";
import { getGoogleConnection, getRecentAudit, getTenant, getTools } from "@/lib/queries";
import { getSessionStatus } from "@/lib/gateway";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TenantStatusBadge, SessionStatusBadge, PermissionBadge } from "@/components/status-badge";
import { TenantEditor } from "@/components/tenant-editor";
import { CompanyProfileForm } from "@/components/company-profile-form";
import { ModelConnection } from "@/components/model-connection";
import { GoogleCalendarCard } from "@/components/google-calendar-card";
import { formatCents } from "@/components/stat-card";

export default async function TenantDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  await connection();
  const uid = await requireAuth();
  const { id } = await props.params;
  const query = await props.searchParams;
  const tenant = await getTenant(id, uid);
  if (!tenant) notFound();
  const [tools, audit, session, gconn] = await Promise.all([
    getTools(uid, id),
    getRecentAudit(id),
    getSessionStatus(id),
    getGoogleConnection(id),
  ]);
  const pct =
    tenant.max_monthly_spend_cents > 0
      ? Math.min(100, Math.round((tenant.spend_cents / tenant.max_monthly_spend_cents) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/tenants">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{tenant.name}</h1>
            <p className="font-mono text-xs text-muted-foreground">{tenant.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TenantStatusBadge status={tenant.status} />
          <SessionStatusBadge status={session?.status} />
        </div>
      </div>

      {query.google === "connected" ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Google Calendar connected — the bot can now check availability and create events.
        </div>
      ) : null}
      {query.google === "error" ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Google connect failed: {query.reason ?? "unknown error"}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company profile</CardTitle>
              <CardDescription>
                Business facts the bot uses when customers ask — hours, address, services.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyProfileForm tenant={tenant} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model connection</CardTitle>
              <CardDescription>Which LLM answers for this tenant — test it live.</CardDescription>
            </CardHeader>
            <CardContent>
              <ModelConnection tenant={tenant} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Google Calendar</CardTitle>
                <CardDescription>Tenant-owned booking — replaces service-account sharing.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/calendar?tenant=${tenant.id}`}>Open calendar →</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <GoogleCalendarCard
                tenantId={tenant.id}
                connection={gconn}
                calendarId={tenant.google_calendar_id}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuration</CardTitle>
              <CardDescription>Takes effect on the next turn — no restart needed.</CardDescription>
            </CardHeader>
            <CardContent>
              <TenantEditor tenant={tenant} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spend</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {formatCents(tenant.spend_cents)}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {formatCents(tenant.max_monthly_spend_cents)}
                </span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {tenant.conversation_count} chats · {tenant.open_escalations} open escalations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tools ({tools.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tools registered.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {tools.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{t.name}</span>
                      <PermissionBadge permission={t.permission} />
                    </div>
                  ))}
                </div>
              )}
              <Button asChild variant="ghost" size="sm" className="mt-3">
                <Link href={`/tools?tenant=${tenant.id}`}>View all →</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent tool calls</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tool activity yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {audit.slice(0, 8).map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{a.tool_name}</span>
                      <span className={a.allowed ? "text-green-700" : "text-destructive"}>
                        {a.allowed ? "allowed" : "denied"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
