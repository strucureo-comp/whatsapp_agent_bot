import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("@/lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

// Mock shared Redis
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
  keys: vi.fn().mockResolvedValue([]),
};

vi.mock("@/agent/handle-message.js", () => ({
  getSharedRedis: () => mockRedis,
}));

import { proposeSlots, toISTISO } from "./calendar.js";
import { parsePreferredTime, runCheckAvailability, type CalendarContext } from "./calendar-tools.js";

describe("Calendar Availability & Slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
  });

  describe("toISTISO", () => {
    it("formats dates with +05:30 IST offset matching the exact timestamp", () => {
      const iso = toISTISO("2026-09-06T17:00:00+05:30");
      expect(iso).toBe("2026-09-06T17:00:00+05:30");
      expect(new Date(iso).getTime()).toBe(new Date("2026-09-06T17:00:00+05:30").getTime());
    });
  });

  describe("parsePreferredTime", () => {
    it("parses 24h and 12h time strings", () => {
      expect(parsePreferredTime("17:00")).toBe("17:00");
      expect(parsePreferredTime("5pm")).toBe("17:00");
      expect(parsePreferredTime("5:00 pm")).toBe("17:00");
      expect(parsePreferredTime("5:30 PM")).toBe("17:30");
      expect(parsePreferredTime("9am")).toBe("09:00");
      expect(parsePreferredTime("10:30 am")).toBe("10:30");
      expect(parsePreferredTime("invalid")).toBeNull();
      expect(parsePreferredTime(null)).toBeNull();
    });
  });

  describe("proposeSlots", () => {
    it("finds all free slots across business hours on an empty day (not capped at 3)", () => {
      const timeMin = "2026-09-06T09:00:00+05:30";
      const timeMax = "2026-09-06T18:00:00+05:30";
      const slots = proposeSlots([], timeMin, timeMax, 30);

      // 9 hours = 18 thirty-minute slots
      expect(slots.length).toBe(18);
      expect(slots[0].start).toBe("2026-09-06T09:00:00+05:30");
      expect(slots[0].end).toBe("2026-09-06T09:30:00+05:30");
      expect(slots[slots.length - 1].start).toBe("2026-09-06T17:30:00+05:30");
      expect(slots[slots.length - 1].end).toBe("2026-09-06T18:00:00+05:30");
    });

    it("skips slots overlapping with busy events", () => {
      const timeMin = "2026-09-06T09:00:00+05:30";
      const timeMax = "2026-09-06T12:00:00+05:30";
      const busy = [
        {
          start: "2026-09-06T10:00:00+05:30",
          end: "2026-09-06T11:00:00+05:30",
        },
      ];
      const slots = proposeSlots(busy, timeMin, timeMax, 30);

      // 09:00-09:30, 09:30-10:00, (skip 10:00-11:00), 11:00-11:30, 11:30-12:00
      expect(slots.length).toBe(4);
      expect(slots.some((s) => s.start === "2026-09-06T10:00:00+05:30")).toBe(false);
      expect(slots.some((s) => s.start === "2026-09-06T10:30:00+05:30")).toBe(false);
    });
  });

  describe("runCheckAvailability", () => {
    const mockCtx: CalendarContext = {
      calendarId: "primary",
      serviceCreds: {},
    };

    it("returns free slots during business hours on an empty day", async () => {
      const result = await runCheckAvailability(mockCtx, "tenant-1", "conv-1", {
        date: "2026-09-06",
      });

      expect(result.is_error).toBe(false);
      expect(result.content).toContain("Free slots 09:00–18:00 IST");
      expect(result.content).toContain("Sun, 06 Sep");
      expect(result.content).not.toContain("No free slots that day");
    });

    it("prioritizes and marks preferred_time (5pm / 17:00) as AVAILABLE when free", async () => {
      const result = await runCheckAvailability(mockCtx, "tenant-1", "conv-1", {
        date: "2026-09-06",
        preferred_time: "5pm",
      });

      expect(result.is_error).toBe(false);
      expect(result.content).toContain("Requested time 17:00 IST on 2026-09-06 is AVAILABLE!");
      expect(result.content.toLowerCase()).toContain("5:00 pm ist");
      expect(result.content).toContain("start=2026-09-06T17:00:00+05:30");
    });
  });
});
