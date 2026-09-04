import { connection } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import Link from "next/link";
import {
  Users,
  MessagesSquare,
  Siren,
  MessageCircle,
  Wallet,
  ArrowRight,
  CircleAlert,
} from "lucide-react";
import { getEscalations, getOverviewStats, getTenants } from "@/lib/queries";
import { getGatewayHealth, getSessionStatus } from "@/lib/gateway";
import { StatCard, formatCents } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConversationStatusBadge, SessionStatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default async function OverviewPage() {
  await connection();
  const uid = await requireAuth();
  const [stats, tenants, escalations, gatewayUp] = await Promise.all([
    getOverviewStats(uid),
    getTenants(uid),
    getEscalations(uid, "open"),
    getGatewayHealth(),
  ]);
  const sessions = await Promise.all(
    tenants.map(async (t) => ({ tenantId: t.id, session: await getSessionStatus(t.id) }))
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Gateway {gatewayUp ? "reachable" : "unreachable"} · {stats.tenants} tenant
            {stats.tenants === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/conversations">
            View conversations <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Tenants" value={String(stats.tenants)} icon={Users} />
        <StatCard title="Active chats" value={String(stats.activeConversations)} icon={MessagesSquare} />
        <StatCard
          title="Escalated"
          value={String(stats.escalatedConversations)}
          icon={CircleAlert}
          hint={stats.escalatedConversations > 0 ? "Needs staff attention" : "All clear"}
        />
        <StatCard title="Messages today" value={String(stats.messagesToday)} icon={MessageCircle} />
        <StatCard title="Open escalations" value={String(stats.openEscalations)} icon={Siren} />
        <StatCard
          title="Spend (month)"
          value={formatCents(stats.spendMonthCents)}
          icon={Wallet}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Open escalations</CardTitle>
              <CardDescription>Oldest first — resolve from the detail view.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/escalations">
                All <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {escalations.length === 0 ? (
              <EmptyState icon={Siren} title="No open escalations" hint="The bot is handling everything on its own." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {escalations.slice(0, 5).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.tenant_name}</TableCell>
                      <TableCell className="font-mono text-xs">{e.customer_number}</TableCell>
                      <TableCell className="max-w-55 truncate text-muted-foreground">
                        {e.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>WhatsApp sessions</CardTitle>
              <CardDescription>Live status from the gateway.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/whatsapp">
                Manage <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Linked as</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => {
                  const s = sessions.find((x) => x.tenantId === t.id)?.session;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>
                        <SessionStatusBadge status={gatewayUp ? s?.status : "gateway down"} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s?.jid || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {tenants.length > 0 && (
              <div className="mt-4">
                <CardDescription>Latest escalated chats</CardDescription>
                <div className="mt-2 flex flex-col gap-2">
                  {escalations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing escalated.</p>
                  ) : (
                    escalations.slice(0, 3).map((e) => (
                      <Link
                        key={e.id}
                        href={`/conversations/${e.conversation_id}`}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs hover:bg-accent"
                      >
                        <span className="font-medium">{e.customer_number}</span>
                        <ConversationStatusBadge status="escalated" />
                      </Link>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
