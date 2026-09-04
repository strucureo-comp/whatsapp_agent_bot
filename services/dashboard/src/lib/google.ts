import { getPool } from "./db";

export interface CalendarEventItem {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  attendees: string[];
  link: string | null;
  meetLink: string | null;
  organizer: string | null;
}

async function getValidAccessToken(tenantId: string): Promise<string | null> {
  const pool = getPool();
  const row = await pool.query(
    `SELECT access_token, refresh_token, expiry FROM tenant_google_tokens WHERE tenant_id = $1`,
    [tenantId]
  );
  if (row.rows.length === 0) return null;
  const { access_token, refresh_token, expiry } = row.rows[0] as {
    access_token: string;
    refresh_token: string;
    expiry: Date;
  };
  if (new Date(expiry).getTime() - Date.now() > 60_000) return access_token;

  // Refresh and persist.
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) return null;
  const expiresIn = Number(body.expires_in ?? 3600);
  await pool.query(
    `UPDATE tenant_google_tokens SET access_token = $1,
       expiry = NOW() + ($2 || ' seconds')::interval, updated_at = NOW()
     WHERE tenant_id = $3`,
    [body.access_token as string, String(expiresIn), tenantId]
  );
  return body.access_token as string;
}

async function calendarIdFor(tenantId: string): Promise<string> {
  const row = await getPool().query(
    `SELECT google_calendar_id FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return (row.rows[0]?.google_calendar_id as string | null)?.trim() || "primary";
}

export async function listUpcomingEvents(
  tenantId: string,
  maxResults = 20
): Promise<{ events: CalendarEventItem[]; error?: string }> {
  const token = await getValidAccessToken(tenantId);
  if (!token) return { events: [], error: "Google account not connected" };
  const calendarId = await calendarIdFor(tenantId);
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("maxResults", String(maxResults));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { events: [], error: body?.error?.message ?? `Google HTTP ${res.status}` };
  }
  const body = await res.json().catch(() => ({}));
  const events: CalendarEventItem[] = ((body.items ?? []) as Record<string, unknown>[]).map(
    (it) => {
      const start = it.start as Record<string, string> | undefined;
      const end = it.end as Record<string, string> | undefined;
      const attendees = ((it.attendees ?? []) as Record<string, string>[]).map(
        (a) => a.email ?? ""
      );
      return {
        id: String(it.id ?? ""),
        title: String(it.summary ?? "(no title)"),
        start: start?.dateTime ?? start?.date ?? null,
        end: end?.dateTime ?? end?.date ?? null,
        attendees: attendees.filter(Boolean),
        link: (it.htmlLink as string | undefined) ?? null,
        meetLink: (it.hangoutLink as string | undefined) ?? null,
        organizer: ((it.organizer as Record<string, string> | undefined)?.email ?? null) as string | null,
      };
    }
  );
  return { events };
}

export interface AvailableSlot {
  time: string;
  label: string;
  start: string;
  end: string;
}

export async function getCalendarFreeSlots(
  tenantId: string,
  date: string,
  durationMinutes = 30
): Promise<{ slots: AvailableSlot[]; error?: string }> {
  const token = await getValidAccessToken(tenantId);
  if (!token) return { slots: [], error: "Google account not connected" };
  const calendarId = await calendarIdFor(tenantId);

  const timeMin = `${date}T00:00:00+05:30`;
  const timeMax = `${date}T23:59:59+05:30`;

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { slots: [], error: body?.error?.message ?? `Google HTTP ${res.status}` };
  }

  const body = await res.json().catch(() => ({}));
  const busyList: Array<{ start: string; end: string }> =
    body?.calendars?.[calendarId]?.busy ?? [];

  // Business hours: 09:00 to 18:00 IST
  const workStartMs = new Date(`${date}T09:00:00+05:30`).getTime();
  const workEndMs = new Date(`${date}T18:00:00+05:30`).getTime();
  const durationMs = durationMinutes * 60 * 1000;
  const nowMs = Date.now();

  // If checking today, exclude slots in the past
  const searchStartMs = Math.max(workStartMs, nowMs + 10 * 60 * 1000);

  const slots: AvailableSlot[] = [];
  let cur = workStartMs;

  while (cur + durationMs <= workEndMs) {
    const slotEnd = cur + durationMs;
    const overlaps = busyList.some((b) => {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      return cur < bEnd && slotEnd > bStart;
    });

    if (!overlaps && cur >= searchStartMs) {
      const dStart = new Date(cur);
      const dEnd = new Date(slotEnd);
      const timeStr = dStart.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const startLabel = dStart.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const endLabel = dEnd.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const istStart = new Date(cur + 330 * 60 * 1000);
      const istEnd = new Date(slotEnd + 330 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const isoStart = `${istStart.getUTCFullYear()}-${pad(istStart.getUTCMonth() + 1)}-${pad(istStart.getUTCDate())}T${pad(istStart.getUTCHours())}:${pad(istStart.getUTCMinutes())}:00+05:30`;
      const isoEnd = `${istEnd.getUTCFullYear()}-${pad(istEnd.getUTCMonth() + 1)}-${pad(istEnd.getUTCDate())}T${pad(istEnd.getUTCHours())}:${pad(istEnd.getUTCMinutes())}:00+05:30`;

      slots.push({
        time: timeStr,
        label: `${startLabel} – ${endLabel}`,
        start: isoStart,
        end: isoEnd,
      });
    }

    cur += 30 * 60 * 1000;
  }

  return { slots };
}

export async function createCalendarEvent(
  tenantId: string,
  input: {
    title: string;
    start: string;
    end: string;
    attendeeEmail?: string;
    description?: string;
  }
): Promise<{ id: string; link: string | null }> {
  const token = await getValidAccessToken(tenantId);
  if (!token) throw new Error("Google account not connected");
  const calendarId = await calendarIdFor(tenantId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? "",
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : [],
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Google HTTP ${res.status}`);
  return { id: String(body.id ?? ""), link: (body.htmlLink as string | undefined) ?? null };
}

export async function deleteCalendarEvent(tenantId: string, eventId: string): Promise<void> {
  const token = await getValidAccessToken(tenantId);
  if (!token) throw new Error("Google account not connected");
  const calendarId = await calendarIdFor(tenantId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok && res.status !== 410) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Google HTTP ${res.status}`);
  }
}

export interface BotBooking {
  title: string;
  start: string | null;
  end: string | null;
  attendee: string | null;
  at: string;
}

/** Meetings the bot booked (from its audit trail). */
export async function getBotBookings(tenantId: string, limit = 20): Promise<BotBooking[]> {
  const res = await getPool().query(
    `SELECT request_summary, created_at FROM audit_log
      WHERE tenant_id = $1 AND tool_name = 'book_meeting'
      ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit]
  );
  return res.rows.map((r) => {
    const s = (r.request_summary ?? {}) as Record<string, string>;
    return {
      title: s.title ?? "(untitled)",
      start: s.start ?? null,
      end: s.end ?? null,
      attendee: s.attendee_email ?? null,
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  });
}

export function getGoogleRedirectUri(request?: Request): string {
  const envUri = process.env.GOOGLE_REDIRECT_URI;
  if (envUri && !envUri.includes("your-project-name") && !envUri.includes("<")) {
    return envUri;
  }
  if (request) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    return `${proto}://${host}/api/auth/google/callback`;
  }
  return "http://localhost:3000/api/auth/google/callback";
}
