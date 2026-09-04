import { readFileSync, existsSync } from "node:fs";
import { google } from "googleapis";
import type pg from "pg";
import { getLogger } from "@/lib/logger.js";
import { getOAuthClientForTenant } from "./google-auth.js";
import { getFreeBusyOAuth, createEventOAuth, getFreeBusy, createEvent, proposeSlots, toISTISO, type TimeSlot } from "./calendar.js";
import { SlotManager } from "@/agent/slots.js";
import { getSharedRedis } from "@/agent/handle-message.js";

export const CALENDAR_TOOL_NAMES = ["check_availability", "book_meeting", "cancel_meeting"] as const;

/** Parse preferred time string into HH:mm format (e.g. '17:00', '5pm', '5:00 PM', '10:30 am') */
export function parsePreferredTime(str?: unknown): string | null {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().toLowerCase();
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = m12[2] ? parseInt(m12[2], 10) : 0;
    const meridiem = m12[3];
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  return null;
}

/** "Fri, 05 Sep, 12:00 PM IST" — pre-formatted so the model quotes instead of converting. */
export function fmtIST(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${date}, ${time} IST`;
}

/** "Friday, 05 Sep 2026 (IST)" for anchoring relative dates like "tomorrow". */
export function todayIST(date = new Date()): string {
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date) + " (IST)"
  );
}

/** Explicit pair so the model never computes tomorrow itself. */
export function todayTomorrowIST(): { today: string; tomorrow: string; todayISO: string; tomorrowISO: string } {
  const now = new Date();
  const iso = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const tomorrow = new Date(now.getTime() + 24 * 3_600_000);
  return {
    today: todayIST(now),
    tomorrow: todayIST(tomorrow),
    todayISO: iso(now),
    tomorrowISO: iso(tomorrow),
  };
}

/** "5 Sept" label for a YYYY-MM-DD IST date — used to repair wrong labels. */
export function shortISTLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  if (!y || !m || !d || m < 1 || m > 12) return ymd;
  return `${d} ${months[m - 1]}`;
}

export interface CalendarContext {
  calendarId: string;
  oauth: InstanceType<typeof google.auth.OAuth2> | null;
  serviceCreds: Record<string, string> | null;
}

function loadServiceCreds(): Record<string, string> | null {
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
  } catch (err) {
    getLogger().warn({ err, path }, " unreadable service-account key, ignoring");
    return null;
  }
}

/**
 * Resolve how (and whether) this tenant can touch a calendar.
 * OAuth (dashboard Connect) wins; service-account file is the fallback.
 * Returns null when nothing is connected — callers must then NOT offer
 * booking and must NOT claim anything was booked.
 */
export async function getCalendarContext(
  db: pg.PoolClient | pg.Pool,
  tenant: { id: string; google_calendar_id?: string | null },
): Promise<CalendarContext | null> {
  const oauth = await getOAuthClientForTenant(db, tenant.id).catch((err) => {
    getLogger().warn({ tenantId: tenant.id, err }, "OAuth client resolution failed");
    return null;
  });
  const serviceCreds = oauth ? null : loadServiceCreds();
  if (!oauth && !serviceCreds) return null;
  return {
    calendarId: tenant.google_calendar_id?.trim() || "primary",
    oauth,
    serviceCreds,
  };
}

export function calendarToolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return [
    {
      name: "check_availability",
      description:
        "Check the business calendar for a day. Returns what's ALREADY booked plus free, held slots. Accepts an optional preferred_time (e.g. '17:00' or '5pm') to check and prioritize a specific time. Call BEFORE proposing or booking any time. If the customer requested a time (e.g. '6 sept - 5pm'), pass both date and preferred_time.",
      input_schema: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Day to check, YYYY-MM-DD (Asia/Kolkata). Defaults to tomorrow.",
          },
          preferred_time: {
            type: "string",
            description: "Optional preferred time (e.g. '17:00', '5pm', '10:30'). Checks and holds this specific time if available.",
          },
          duration_minutes: { type: "number", description: "Meeting length. Default 30." },
          work_start: { type: "string", description: "Earliest HH:mm IST, default 09:00." },
          work_end: { type: "string", description: "Latest HH:mm IST end bound, default 18:00." },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "book_meeting",
      description:
        "Create the calendar event on Google Calendar. Call ONLY after the customer confirmed a time (or explicitly requested to book). Use the exact start and end ISO strings from check_availability. Never invent confirmations — use this tool.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title, e.g. 'Call with Priya' or 'Consultation'." },
          start: { type: "string", description: "ISO start, e.g. 2026-09-06T17:00:00+05:30." },
          end: { type: "string", description: "ISO end, e.g. 2026-09-06T17:30:00+05:30." },
          attendee_email: { type: "string", description: "Customer email for the invite, if known." },
          description: { type: "string", description: "Notes on the event." },
        },
        required: ["title", "start", "end"],
        additionalProperties: false,
      },
    },
    {
      name: "cancel_meeting",
      description:
        "Cancel a real calendar event. Finds the customer's event by day, title, or time — call this instead of ever SAYING something is cancelled.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Day, YYYY-MM-DD (Asia/Kolkata). Defaults to today." },
          query: {
            type: "string",
            description: "Match by title words or HH:mm start time, e.g. 'standup' or '10:00'. Empty cancels nothing — list first.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  ];
}

function dayWindowIST(date?: string): { day: string; timeMin: string; timeMax: string } {
  let day: string;
  const match = typeof date === "string" ? date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) : null;
  if (match) {
    day = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  } else {
    const ist = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60_000);
    ist.setDate(ist.getDate() + 1);
    day = ist.toISOString().slice(0, 10);
  }
  return { day, timeMin: `${day}T00:00:00+05:30`, timeMax: `${day}T23:59:59+05:30` };
}

export async function runCheckAvailability(
  ctx: CalendarContext,
  tenantId: string,
  conversationId: string,
  input: Record<string, unknown>,
): Promise<{ content: string; is_error: boolean }> {
  const duration =
    typeof input.duration_minutes === "number" && input.duration_minutes > 0
      ? Math.min(480, Math.floor(input.duration_minutes))
      : 30;
  const { day, timeMin, timeMax } =
    typeof input.date === "string" && input.date
      ? dayWindowIST(input.date)
      : dayWindowIST(undefined);

  const busy = ctx.oauth
    ? (await getFreeBusyOAuth(ctx.oauth, ctx.calendarId, timeMin, timeMax)).busy
    : (await getFreeBusy(ctx.calendarId, timeMin, timeMax, ctx.serviceCreds!)).busy;

  // What's ALREADY on the calendar — the customer sees this alongside free slots.
  let already: ListedEvent[] = [];
  try {
    already = await listDayEvents(ctx, timeMin, timeMax);
  } catch (err) {
    getLogger().debug({ err }, "Event titles unavailable, times only");
  }
  const alreadyLines =
    already.length > 0
      ? already.map((e) => `- "${e.title}" at ${fmtIST(e.start)}`).join("\n")
      : "(nothing scheduled that day)";

  const alreadyBlock =
    `Already on the calendar that day:\n${alreadyLines}\n` +
    `Present both: what exists first, then the free options.`;

  // Business hours only (IST)
  const workStart =
    typeof input.work_start === "string" && /^\d{2}:\d{2}$/.test(input.work_start)
      ? input.work_start
      : "09:00";
  const workEnd =
    typeof input.work_end === "string" && /^\d{2}:\d{2}$/.test(input.work_end)
      ? input.work_end
      : "18:00";

  const workStartMs = new Date(`${day}T${workStart}:00+05:30`).getTime();
  const workEndMs = new Date(`${day}T${workEnd}:00+05:30`).getTime();
  const nowMs = Date.now();

  // If checking today (or past), don't propose past slots. Keep at least 15 min buffer.
  const searchStartMs = Math.max(workStartMs, nowMs + 15 * 60 * 1000);

  if (searchStartMs + duration * 60 * 1000 > workEndMs) {
    return {
      content: `No free slots remaining on ${day} between ${workStart}–${workEnd} IST (working hours have ended or insufficient time remains today). ${alreadyBlock} Please ask the customer for another date.`,
      is_error: false,
    };
  }

  // Scan free slots in the business window
  const searchMinISO = toISTISO(searchStartMs);
  const searchMaxISO = toISTISO(workEndMs);
  const allFreeSlots = proposeSlots(busy, searchMinISO, searchMaxISO, duration, 50);

  if (allFreeSlots.length === 0) {
    return {
      content: `No free slots that day between ${workStart}–${workEnd} IST. ${alreadyBlock} Ask for another date.`,
      is_error: false,
    };
  }

  // Check preferred_time if requested
  const prefTime = parsePreferredTime(input.preferred_time);
  let preferredSlot: TimeSlot | null = null;
  let prefStatusNote = "";

  if (prefTime) {
    const prefStartMs = new Date(`${day}T${prefTime}:00+05:30`).getTime();
    const prefEndMs = prefStartMs + duration * 60 * 1000;

    if (prefStartMs < searchStartMs || prefEndMs > workEndMs) {
      prefStatusNote = `Requested time ${prefTime} IST is outside available business hours (${workStart}–${workEnd} IST) or in the past.\n`;
    } else {
      const clash = busy.some((b) => {
        const bStart = new Date(b.start).getTime();
        const bEnd = new Date(b.end).getTime();
        return prefStartMs < bEnd && prefEndMs > bStart;
      });

      if (clash) {
        prefStatusNote = `Requested time ${prefTime} IST is already booked.\n`;
      } else {
        preferredSlot = {
          start: toISTISO(prefStartMs),
          end: toISTISO(prefEndMs),
        };
        prefStatusNote = `Requested time ${prefTime} IST on ${day} is AVAILABLE!\n`;
      }
    }
  }

  // Assemble candidate slots for customer hold (up to 4 slots)
  const candidateMap = new Map<string, TimeSlot>();
  if (preferredSlot) {
    candidateMap.set(preferredSlot.start, preferredSlot);
  }

  // Distribute other free slots across the day (morning, midday, afternoon, late afternoon)
  const targetCount = preferredSlot ? 4 : 4;
  if (allFreeSlots.length <= targetCount) {
    for (const s of allFreeSlots) {
      candidateMap.set(s.start, s);
    }
  } else {
    const step = (allFreeSlots.length - 1) / (targetCount - 1);
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.round(i * step);
      const s = allFreeSlots[idx];
      if (s) candidateMap.set(s.start, s);
    }
  }
  if (allFreeSlots[0]) {
    candidateMap.set(allFreeSlots[0].start, allFreeSlots[0]);
  }

  const candidateSlots = Array.from(candidateMap.values());

  const slotManager = new SlotManager(getSharedRedis());
  let held = await slotManager.proposeSlots(
    tenantId,
    conversationId,
    ctx.calendarId,
    candidateSlots,
  );

  // If held slots were taken by another customer, backfill from remaining free slots
  if (held.length < 2 && allFreeSlots.length > candidateSlots.length) {
    const unheld = allFreeSlots.filter((s) => !candidateMap.has(s.start));
    const moreHeld = await slotManager.proposeSlots(
      tenantId,
      conversationId,
      ctx.calendarId,
      unheld.slice(0, 5),
    );
    held = [...held, ...moreHeld];
  }

  if (held.length === 0) {
    return {
      content:
        `Those slots were just taken by other customers. ${alreadyBlock} ` +
        `Offer the customer another date or time.`,
      is_error: false,
    };
  }

  // Pre-formatted IST labels — quote these EXACTLY, never convert timezones.
  const lines = held
    .map((s) => `- ${fmtIST(s.start)} – ${fmtIST(s.end)} [book with start=${s.start} end=${s.end}]`)
    .join("\n");
  const anchor = todayTomorrowIST();

  return {
    content:
      `Today is ${anchor.today}. Tomorrow is ${anchor.tomorrow}.\n` +
      (prefStatusNote ? `${prefStatusNote}\n` : "") +
      `Already on the calendar that day:\n${alreadyLines}\n\n` +
      `Free slots ${workStart}–${workEnd} IST (held for this customer, quote times exactly as shown):\n${lines}\n\n` +
      `Present both: what exists first (if any), then the free options. If the customer requests or confirms one, call book_meeting.`,
    is_error: false,
  };
}

export async function runBookMeeting(
  ctx: CalendarContext,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<{ content: string; is_error: boolean }> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const start = typeof input.start === "string" ? input.start : "";
  const end = typeof input.end === "string" ? input.end : "";
  if (!title || !start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return { content: "Need a title and valid ISO start/end to book.", is_error: true };
  }
  const attendee = typeof input.attendee_email === "string" ? input.attendee_email.trim() : "";
  const description = typeof input.description === "string" ? input.description : "";

  // Re-check the exact window at confirm time — never book blind.
  const busy = ctx.oauth
    ? (await getFreeBusyOAuth(ctx.oauth, ctx.calendarId, start, end)).busy
    : (await getFreeBusy(ctx.calendarId, start, end, ctx.serviceCreds!)).busy;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const clash = busy.some((b) => {
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    return bStart < endMs && bEnd > startMs;
  });
  if (clash) {
    return {
      content: "That time just became unavailable. Run check_availability again for fresh slots.",
      is_error: true,
    };
  }

  const created = ctx.oauth
    ? await createEventOAuth(ctx.oauth, ctx.calendarId, title, description, start, end, attendee ? [attendee] : [])
    : await createEvent(ctx.calendarId, title, description, start, end, attendee ? [attendee] : [], ctx.serviceCreds!);
  if (!created || !created.id) {
    return { content: "Calendar refused the booking. Tell the customer the team will confirm manually.", is_error: true };
  }

  // Release any hold on the slot so it can't linger past the booking.
  try {
    await getSharedRedis().del(`slot:${tenantId}:${ctx.calendarId}:${start}`);
  } catch (err) {
    getLogger().debug({ err }, "Slot hold release failed (non-fatal)");
  }
  return {
    content: `Booked: "${title}" — ${fmtIST(start)} – ${fmtIST(end)} (event ${created.id}).${created.htmlLink ? ` Link: ${created.htmlLink}` : ""} Confirm to the customer with these exact times.`,
    is_error: false,
  };
}

interface ListedEvent {
  id: string;
  title: string;
  start: string;
}

async function listDayEvents(
  ctx: CalendarContext,
  timeMin: string,
  timeMax: string,
): Promise<ListedEvent[]> {
  if (ctx.oauth) {
    const calendar = google.calendar({ version: "v3", auth: ctx.oauth });
    const res = await calendar.events.list({
      calendarId: ctx.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });
    return (res.data.items ?? []).map((e) => ({
      id: e.id ?? "",
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
    }));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: ctx.serviceCreds!,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: ctx.calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
  }));
}

async function deleteEvent(ctx: CalendarContext, eventId: string): Promise<boolean> {
  try {
    if (ctx.oauth) {
      const calendar = google.calendar({ version: "v3", auth: ctx.oauth });
      await calendar.events.delete({ calendarId: ctx.calendarId, eventId });
      return true;
    }
    if (ctx.serviceCreds) {
      const auth = new google.auth.GoogleAuth({
        credentials: ctx.serviceCreds,
        scopes: ["https://www.googleapis.com/auth/calendar"],
      });
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.delete({ calendarId: ctx.calendarId, eventId });
      return true;
    }
    return false;
  } catch (err) {
    getLogger().warn({ eventId, err }, "Calendar event delete failed");
    return false;
  }
}

export async function runCancelMeeting(
  ctx: CalendarContext,
  input: Record<string, unknown>,
): Promise<{ content: string; is_error: boolean }> {
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  const day = date ?? todayIST();
  const { timeMin, timeMax } = dayWindowIST(date ?? undefined);
  const q = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";

  let events: ListedEvent[];
  try {
    events = await listDayEvents(ctx, timeMin, timeMax);
  } catch (err) {
    getLogger().warn({ err }, "Calendar list failed");
    return { content: "Could not read the calendar. The team will handle the cancellation.", is_error: true };
  }
  if (events.length === 0) {
    return { content: `No events that day (${day}). Nothing to cancel.`, is_error: false };
  }

  const timeQ = q.match(/^(\d{1,2}):(\d{2})$/)
    ? `${q.match(/^(\d{1,2}):(\d{2})$/)![1].padStart(2, "0")}:${q.match(/^(\d{1,2}):(\d{2})$/)![2]}`
    : null;
  const matches = q
    ? events.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (timeQ !== null && e.start.slice(11, 16) === timeQ) ||
          fmtIST(e.start).toLowerCase().includes(q),
      )
    : events;
  if (matches.length === 0) {
    const list = events.map((e) => `- "${e.title}" at ${fmtIST(e.start)}`).join("\n");
    return { content: `No match for "${q}". That day has:\n${list}\nAsk which one to cancel.`, is_error: false };
  }
  if (matches.length > 1) {
    const list = matches.map((e) => `- "${e.title}" at ${fmtIST(e.start)}`).join("\n");
    return { content: `Multiple matches:\n${list}\nAsk the customer which one to cancel.`, is_error: false };
  }

  const target = matches[0];
  const ok = await deleteEvent(ctx, target.id);
  if (!ok) {
    return { content: "The calendar refused the cancellation. The team will do it manually.", is_error: true };
  }
  return {
    content: `Cancelled: "${target.title}" — ${fmtIST(target.start)}. Confirm exactly this to the customer.`,
    is_error: false,
  };
}
