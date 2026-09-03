import { connection } from "next/server";
import Link from "next/link";
import { Siren } from "lucide-react";
import { getEscalations } from "@/lib/queries";
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
import { EmptyState } from "@/components/empty-state";
import { ResolveEscalationByIdButton } from "@/components/resolve-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function EscalationsPage() {
  await connection();
  const [open, resolved] = await Promise.all([
    getEscalations("open"),
    getEscalations("resolved"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Escalations</h1>
        <p className="text-sm text-muted-foreground">
          {open.length} open · resolving hands the chat back to the bot
        </p>
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>
        <TabsContent value="open">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Needs staff attention</CardTitle>
            </CardHeader>
            <CardContent>
              {open.length === 0 ? (
                <EmptyState icon={Siren} title="Inbox zero" hint="No customer is waiting on a human right now." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {open.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <Link
                            href={`/conversations/${e.conversation_id}`}
                            className="font-mono text-xs font-medium hover:underline"
                          >
                            {e.customer_number}
                          </Link>
                        </TableCell>
                        <TableCell>{e.tenant_name}</TableCell>
                        <TableCell className="max-w-70 truncate text-muted-foreground">
                          {e.reason}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <ResolveEscalationByIdButton escalationId={e.id} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="resolved">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recently resolved</CardTitle>
            </CardHeader>
            <CardContent>
              {resolved.length === 0 ? (
                <EmptyState icon={Siren} title="Nothing resolved yet" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Resolved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolved.slice(0, 20).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">{e.customer_number}</TableCell>
                        <TableCell>{e.tenant_name}</TableCell>
                        <TableCell className="max-w-70 truncate text-muted-foreground">
                          {e.reason}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.resolved_at ? new Date(e.resolved_at).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">tip</Badge>
        Open the conversation to read the thread before resolving.
      </div>
    </div>
  );
}
