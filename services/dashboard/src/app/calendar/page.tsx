import { connection } from "next/server";
import Link from "next/link";
import { Bot, CalendarDays, ExternalLink } from "lucide-react";
import { getGoogleConnection, getTenants } from "@/lib/queries";
import { getBotBookings, listUpcomingEvents } from "@/lib/google";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { NewMeetingForm } from "@/components/new-meeting-form";
import { CancelEventButton } from "@/components/cancel-event-button";
import { cn } from "@/lib/utils";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const tenants = await getTenants();
  const tenantId = params.tenant ?? tenants[0]?.id;
  const tenant = tenants.find((t) => t.id === tenantId) ?? null;
  const gconn = tenant ? await getGoogleConnection(tenant.id) : null;
  const [upcoming, botBooked] = tenant
    ? await Promise.all([
        gconn?.connected ? listUpcomingEvents(tenant.id) : { events: [] as never[], error: "Not connected" as string | undefined },
        getBotBookings(tenant.id),
      ])
    : [{ events: [], error: "No tenants" }, []];

  const href = (t?: string) => `/calendar${t ? `?tenant=${t}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar & meetings</h1>
        <p className="text-sm text-muted-foreground">
          Real events from the connected Google account · what the bot booked · book manually
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tenants.map((t) => (
          <Link
            key={t.id}
            href={href(t.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              tenant?.id === t.id ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"
            )}
          >
            {t.name}
          </Link>
        ))}
      </div>

      {!tenant ? (
        <EmptyState icon={CalendarDays} title="No tenants" />
      ) : !gconn?.connected ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={CalendarDays}
              title={`Google not connected for ${tenant.name}`}
              hint="Connect it on the tenant page first — then events appear here."
            />
            <div className="mt-4 flex justify-center">
              <Button asChild size="sm">
                <Link href={`/tenants/${tenant.id}`}>Go to tenant → Google Calendar</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming events</CardTitle>
              <CardDescription>
                {gconn.google_email ?? "Connected account"} · live from Google
              </CardDescription>
            </CardHeader>
            <CardContent>
              {upcoming.error ? (
                <p className="text-sm text-destructive">{upcoming.error}</p>
              ) : upcoming.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {upcoming.events.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(e.start)}
                          {e.end ? ` → ${formatDateTime(e.end)}` : ""}
                        </p>
                        {e.attendees.length > 0 ? (
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {e.attendees.join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <span className="flex shrink-0">
                        {e.link ? (
                          <Button asChild variant="ghost" size="icon">
                            <a href={e.link} target="_blank" rel="noreferrer">
                              <ExternalLink />
                            </a>
                          </Button>
                        ) : null}
                        <CancelEventButton tenantId={tenant.id} eventId={e.id} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Book a meeting</CardTitle>
                <CardDescription>Operator booking — straight onto the same calendar.</CardDescription>
              </CardHeader>
              <CardContent>
                <NewMeetingForm tenantId={tenant.id} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Booked by the bot</CardTitle>
              </CardHeader>
              <CardContent>
                {botBooked.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing yet — bot bookings land here with title and time.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead>Attendee</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {botBooked.map((b, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{b.title}</TableCell>
                          <TableCell className="text-xs">
                            {b.start ? formatDateTime(b.start) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{b.attendee ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">audit</Badge>
                  Sourced from the tool audit log — only real tool calls appear.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
