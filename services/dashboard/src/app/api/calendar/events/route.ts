import { revalidatePath } from "next/cache";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/google";

/**
 * POST /api/calendar/events — operator-created meeting from the dashboard.
 * { tenant_id, title, date (YYYY-MM-DD), time (HH:mm IST), duration_minutes?, attendee_email?, description? }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tenantId = body.tenant_id;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  if (typeof tenantId !== "string" || !tenantId) {
    return Response.json({ error: "tenant_id is required" }, { status: 400 });
  }
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return Response.json(
      { error: "date must be YYYY-MM-DD and time HH:mm (IST)" },
      { status: 400 }
    );
  }
  const duration =
    typeof body.duration_minutes === "number" && body.duration_minutes > 0
      ? Math.min(480, Math.floor(body.duration_minutes))
      : 30;
  const start = `${date}T${time}:00+05:30`;
  const endMs = Date.parse(start) + duration * 60_000;
  if (Number.isNaN(Date.parse(start))) {
    return Response.json({ error: "Invalid date/time" }, { status: 400 });
  }
  const istEnd = new Date(endMs + 330 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const end = `${istEnd.getUTCFullYear()}-${pad(istEnd.getUTCMonth() + 1)}-${pad(istEnd.getUTCDate())}T${pad(istEnd.getUTCHours())}:${pad(istEnd.getUTCMinutes())}:00+05:30`;
  const attendeeEmail =
    typeof body.attendee_email === "string" && body.attendee_email.includes("@")
      ? body.attendee_email.trim()
      : undefined;

  try {
    const created = await createCalendarEvent(tenantId, {
      title,
      start,
      end,
      attendeeEmail,
      description: typeof body.description === "string" ? body.description : "",
    });
    revalidatePath("/calendar");
    return Response.json({ ok: true, ...created });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/calendar/events?tenant_id=&event_id= — cancel a meeting.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id");
  const eventId = url.searchParams.get("event_id");
  if (!tenantId || !eventId) {
    return Response.json({ error: "tenant_id and event_id are required" }, { status: 400 });
  }
  try {
    await deleteCalendarEvent(tenantId, eventId);
    revalidatePath("/calendar");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
