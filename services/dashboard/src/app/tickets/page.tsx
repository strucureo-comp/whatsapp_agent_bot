import { connection } from "next/server";
import Link from "next/link";
import { TicketCheck } from "lucide-react";
import { requireAuth } from "@/lib/auth-server";
import { getTenants, getTickets } from "@/lib/queries";
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
import { TicketStatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { TicketAdvanceButton, TicketCreateForm, TicketDeleteButton } from "@/components/ticket-controls";
import { cn } from "@/lib/utils";

export default async function TicketsPage(props: { searchParams: Promise<any> }) {
  await connection();
  const uid = await requireAuth();
  const params = await props.searchParams;
  const tenantId = params.tenant || undefined;
  const status = params.status && params.status !== "all" ? params.status : undefined;
  
  const [tickets, tenants] = await Promise.all([
    getTickets(uid, { tenantId, status }),
    getTenants(uid),
  ]);

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const t = patch.tenant !== undefined ? patch.tenant : tenantId;
    const s = patch.status !== undefined ? patch.status : status;
    if (t) q.set("tenant", t);
    if (s && s !== "open") q.set("status", s);
    const str = q.toString();
    return `/tickets${str ? `?${str}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          Work items per client — quote to send, visit to schedule, payment to chase
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href({ tenant: undefined })}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium",
            !tenantId ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"
          )}
        >
          All tenants
        </Link>
        {tenants.map((t) => (
          <Link
            key={t.id}
            href={href({ tenant: t.id })}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              tenantId === t.id ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"
            )}
          >
            {t.name}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New ticket</CardTitle>
        </CardHeader>
        <CardContent>
          <TicketCreateForm tenantId={tenantId} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1">
        {["open", "in_progress", "resolved", "all"].map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              status === s ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"
            )}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {tickets.length === 0 ? (
            <EmptyState
              icon={TicketCheck}
              title="No tickets here"
              hint="Create one above, or quicker — from any chat via the Contact panel."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>
                      {t.conversation_id ? (
                        <Link
                          href={`/conversations?c=${t.conversation_id}`}
                          className="text-xs hover:underline"
                        >
                          {t.customer_name || t.customer_number}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{t.tenant_name}</TableCell>
                    <TableCell>
                      <TicketStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={t.priority === "high" ? "warning" : "outline"}
                      >
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex gap-1">
                        <TicketAdvanceButton ticket={t} />
                        <TicketDeleteButton ticketId={t.id} />
                      </span>
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
