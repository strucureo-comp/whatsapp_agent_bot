import { existsSync } from "node:fs";
import { connection } from "next/server";
import Link from "next/link";
import { CalendarCheck, Wrench } from "lucide-react";
import { getGoogleConnection, getTenants, getTools } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PermissionBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const [tools, tenants] = await Promise.all([
    getTools(params.tenant || undefined),
    getTenants(),
  ]);
  const inScope = params.tenant ? tenants.filter((t) => t.id === params.tenant) : tenants;
  const gconns = await Promise.all(inScope.map((t) => getGoogleConnection(t.id)));
  const saPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const serviceAccount = Boolean(saPath && existsSync(saPath));
  const bookingLive = inScope.filter((_, i) => gconns[i].connected || serviceAccount);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tools</h1>
        <p className="text-sm text-muted-foreground">
          REST connectors per tenant · register new ones from the REPL (`tools add`)
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/tools"
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium",
            !params.tenant ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"
          )}
        >
          All tenants
        </Link>
        {tenants.map((t) => (
          <Link
            key={t.id}
            href={`/tools?tenant=${t.id}`}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              params.tenant === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-white hover:bg-accent"
            )}
          >
            {t.name}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Built-in booking tools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">check_availability</Badge>
              <Badge variant="outline" className="font-mono">book_meeting</Badge>
              <Badge variant="outline" className="font-mono">cancel_meeting</Badge>
            </div>
            {inScope.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tenants in scope.</p>
            ) : bookingLive.length === inScope.length ? (
              <p className="text-xs text-green-700">
                Live for {bookingLive.length} tenant{bookingLive.length === 1 ? "" : "s"} — the bot
                checks real free/busy and books for real. Every call lands in the audit log.
              </p>
            ) : (
              <p className="text-xs text-amber-700">
                Inactive{inScope.length === 1 ? "" : " on some tenants"} — no Google account
                connected{serviceAccount ? "" : " and no service-account key"}. The bot is
                instructed to never claim bookings until one is linked
                (tenant page → Google Calendar).
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tools.length} custom tool{tools.length === 1 ? "" : "s"}</CardTitle>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <EmptyState icon={Wrench} title="No tools registered" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Permission</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Timeout</TableHead>
                  <TableHead className="text-right">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.tenant_name}</TableCell>
                    <TableCell>
                      <PermissionBadge permission={t.permission} />
                    </TableCell>
                    <TableCell className="max-w-60 truncate font-mono text-xs text-muted-foreground">
                      {t.endpoint}
                    </TableCell>
                    <TableCell className="text-right text-xs">{t.timeout_ms}ms</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={t.enabled ? "success" : "secondary"}>
                        {t.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
