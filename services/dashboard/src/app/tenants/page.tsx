import { connection } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import Link from "next/link";
import { Users } from "lucide-react";
import { getTenants } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TenantStatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { formatCents } from "@/components/stat-card";

export default async function TenantsPage() {
  await connection();
  const uid = await requireAuth();
  const tenants = await getTenants(uid);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            One WhatsApp number, persona and budget per tenant
          </p>
        </div>
        <Link
          href="/tenants/new"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          Create New Agent
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All tenants</CardTitle>
        </CardHeader>
        <CardContent>
          {tenants.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No tenants yet"
              hint="Click 'Create New Agent' above to get started!"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Chats</TableHead>
                  <TableHead className="text-right">Open esc.</TableHead>
                  <TableHead className="text-right">Spend / cap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => {
                  const pct =
                    t.max_monthly_spend_cents > 0
                      ? Math.min(100, Math.round((t.spend_cents / t.max_monthly_spend_cents) * 100))
                      : 0;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link href={`/tenants/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TenantStatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.llm_provider} / {t.llm_model}
                      </TableCell>
                      <TableCell className="text-right">{t.conversation_count}</TableCell>
                      <TableCell className="text-right">{t.open_escalations}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs">
                            {formatCents(t.spend_cents)} / {formatCents(t.max_monthly_spend_cents)}
                          </span>
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <span
                              className={`block h-full rounded-full ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
