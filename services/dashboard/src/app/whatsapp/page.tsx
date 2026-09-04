import { connection } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { Smartphone } from "lucide-react";
import { getTenants } from "@/lib/queries";
import { getGatewayHealth, getSessionStatus } from "@/lib/gateway";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionStatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { DisconnectButton, PairForm } from "@/components/pair-form";

export default async function WhatsappPage() {
  await connection();
  const uid = await requireAuth();
  const [tenants, gatewayUp] = await Promise.all([getTenants(uid), getGatewayHealth()]);
  const sessions = await Promise.all(
    tenants.map(async (t) => ({
      tenant: t,
      session: gatewayUp ? await getSessionStatus(t.id) : null,
    }))
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Gateway {gatewayUp ? "reachable" : "unreachable — start it with `make gateway-supervised`"}
        </p>
      </div>

      {tenants.length === 0 ? (
        <EmptyState icon={Smartphone} title="No tenants to link" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sessions.map(({ tenant, session }) => (
            <Card key={tenant.id}>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{tenant.name}</CardTitle>
                  <CardDescription className="font-mono text-xs">{tenant.id}</CardDescription>
                </div>
                <SessionStatusBadge status={gatewayUp ? session?.status : "gateway down"} />
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted p-2">
                    <p className="text-muted-foreground">Linked as</p>
                    <p className="font-mono font-medium">{session?.jid || "—"}</p>
                  </div>
                  <div className="rounded-md bg-muted p-2">
                    <p className="text-muted-foreground">Staff alerts to</p>
                    <p className="font-mono font-medium">{tenant.staff_whatsapp || "—"}</p>
                  </div>
                </div>
                {session?.status === "connected" ? (
                  <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2">
                    <p className="text-xs text-green-800">Session live — replies are flowing.</p>
                    <DisconnectButton tenantId={tenant.id} />
                  </div>
                ) : (
                  <PairForm tenantId={tenant.id} defaultPhone={tenant.staff_whatsapp} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
