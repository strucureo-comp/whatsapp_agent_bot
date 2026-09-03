import { google } from "googleapis";
import { getLogger } from "@/lib/logger.js";

/**
 * Google Calendar integration.
 * Uses a service account; tenant shares their calendar with "make changes to events".
 * Events show the service account as organizer without Workspace domain-wide delegation.
 */

export interface TimeSlot {
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

/**
 * Get free/busy information for a calendar.
 */
export async function getFreeBusy(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  credentials: Record<string, string>,
): Promise<{ busy: Array<{ start: string; end: string }> }> {
  const log = getLogger();

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });

    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      },
    });

    const busy = response.data.calendars?.[calendarId]?.busy ?? [];
    return {
      busy: busy.map((b) => ({
        start: b.start ?? "",
        end: b.end ?? "",
      })),
    };
  } catch (err) {
    log.error({ calendarId, err }, "Failed to get free/busy");
    return { busy: [] };
  }
}

/**
 * Free/busy using a tenant's connected Google account (OAuth).
 * Prefer this over getFreeBusy when tenant_google_tokens has a row —
 * events are owned by the tenant, not the service account.
 */
export async function getFreeBusyOAuth(
  oauth: InstanceType<typeof google.auth.OAuth2>,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ busy: Array<{ start: string; end: string }> }> {
  const log = getLogger();

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth });
    const response = await calendar.freebusy.query({
      requestBody: { timeMin, timeMax, items: [{ id: calendarId }] },
    });
    const busy = response.data.calendars?.[calendarId]?.busy ?? [];
    return { busy: busy.map((b) => ({ start: b.start ?? "", end: b.end ?? "" })) };
  } catch (err) {
    log.error({ calendarId, err }, "Failed to get free/busy (OAuth)");
    return { busy: [] };
  }
}

/**
 * Create an event using a tenant's connected Google account (OAuth).
 */
export async function createEventOAuth(
  oauth: InstanceType<typeof google.auth.OAuth2>,
  calendarId: string,
  summary: string,
  description: string,
  start: string,
  end: string,
  attendees: string[],
): Promise<{ id: string; htmlLink: string } | null> {
  const log = getLogger();

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth });
    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: attendees.map((email) => ({ email })),
      },
    });
    return { id: response.data.id ?? "", htmlLink: response.data.htmlLink ?? "" };
  } catch (err) {
    log.error({ calendarId, err }, "Failed to create event (OAuth)");
    return null;
  }
}

/**
 * Propose 2-3 available slots given busy times.
 */
export function proposeSlots(
  busy: Array<{ start: string; end: string }>,
  timeMin: string,
  timeMax: string,
  durationMinutes: number = 30,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const durationMs = durationMinutes * 60 * 1000;

  let current = new Date(timeMin).getTime();
  const end = new Date(timeMax).getTime();

  while (current + durationMs <= end && slots.length < 3) {
    const slotEnd = current + durationMs;
    const slotStart = new Date(current).toISOString();
    const slotEndISO = new Date(slotEnd).toISOString();

    // Check if slot overlaps with any busy time
    const overlaps = busy.some((b) => {
      const busyStart = new Date(b.start).getTime();
      const busyEnd = new Date(b.end).getTime();
      return current < busyEnd && slotEnd > busyStart;
    });

    if (!overlaps) {
      slots.push({ start: slotStart, end: slotEndISO });
    }

    current = slotEnd;
  }

  return slots;
}

/**
 * Create a calendar event.
 */
export async function createEvent(
  calendarId: string,
  summary: string,
  description: string,
  start: string,
  end: string,
  attendees: string[],
  credentials: Record<string, string>,
): Promise<{ id: string; htmlLink: string } | null> {
  const log = getLogger();

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });

    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: attendees.map((email) => ({ email })),
      },
    });

    return {
      id: response.data.id ?? "",
      htmlLink: response.data.htmlLink ?? "",
    };
  } catch (err) {
    log.error({ calendarId, err }, "Failed to create event");
    return null;
  }
}
