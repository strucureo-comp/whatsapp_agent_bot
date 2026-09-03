import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the logger to avoid env dependency
vi.mock("@/lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

import { SlotManager } from "./slots.js";

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
};

describe("SlotManager", () => {
  let manager: SlotManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SlotManager(mockRedis as any, 300_000);
  });

  it("proposes available slots", async () => {
    mockRedis.get.mockResolvedValue(null);

    const slots = await manager.proposeSlots("tenant-1", "conv-1", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
      { start: "2024-01-01T11:00:00Z", end: "2024-01-01T11:30:00Z" },
    ]);

    expect(slots).toHaveLength(2);
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
  });

  it("skips slots held by another conversation", async () => {
    mockRedis.get
      .mockResolvedValueOnce("other-conv") // first slot held
      .mockResolvedValueOnce(null); // second slot available

    const slots = await manager.proposeSlots("tenant-1", "conv-1", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
      { start: "2024-01-01T11:00:00Z", end: "2024-01-01T11:30:00Z" },
    ]);

    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe("2024-01-01T11:00:00Z");
  });

  it("allows same conversation to re-request slot", async () => {
    mockRedis.get.mockResolvedValue("conv-1"); // same conversation

    const slots = await manager.proposeSlots("tenant-1", "conv-1", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);

    expect(slots).toHaveLength(1);
  });

  it("confirms slot and removes hold", async () => {
    mockRedis.del.mockResolvedValue(1);

    const result = await manager.confirmSlot("tenant-1", "cal-1", "2024-01-01T10:00:00Z", "2024-01-01T10:30:00Z");

    expect(result.confirmed).toBe(true);
    expect(mockRedis.del).toHaveBeenCalledWith("slot:tenant-1:cal-1:2024-01-01T10:00:00Z");
  });

  it("releases all slots for a conversation", async () => {
    mockRedis.keys.mockResolvedValue([
      "slot:tenant-1:cal-1:2024-01-01T10:00:00Z",
      "slot:tenant-1:cal-1:2024-01-01T11:00:00Z",
    ]);
    mockRedis.get
      .mockResolvedValueOnce("conv-1")
      .mockResolvedValueOnce("conv-2");

    await manager.releaseSlots("tenant-1", "conv-1");

    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(mockRedis.del).toHaveBeenCalledWith("slot:tenant-1:cal-1:2024-01-01T10:00:00Z");
  });

  it("two customers offered overlapping slot — only one gets it", async () => {
    // Customer A proposes slot at 10:00 — slot is free
    mockRedis.get.mockResolvedValueOnce(null);
    const slotsA = await manager.proposeSlots("tenant-1", "conv-A", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);
    expect(slotsA).toHaveLength(1);

    // Customer B proposes same slot — now held by conv-A
    mockRedis.get.mockResolvedValueOnce("conv-A");
    const slotsB = await manager.proposeSlots("tenant-1", "conv-B", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);
    expect(slotsB).toHaveLength(0);

    // Customer A confirms the booking
    mockRedis.del.mockResolvedValue(1);
    const result = await manager.confirmSlot("tenant-1", "cal-1", "2024-01-01T10:00:00Z", "2024-01-01T10:30:00Z");
    expect(result.confirmed).toBe(true);
  });

  it("slot expires after TTL and becomes available again", async () => {
    // First proposal holds the slot
    mockRedis.get.mockResolvedValue(null);
    await manager.proposeSlots("tenant-1", "conv-A", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);

    // Simulate TTL expiry — key no longer exists
    mockRedis.get.mockResolvedValue(null);

    // Customer B should now be able to propose the same slot
    const slotsB = await manager.proposeSlots("tenant-1", "conv-B", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);
    expect(slotsB).toHaveLength(1);
  });

  it("re-checks freebusy at confirm time — rejects if busy", async () => {
    const mockFreeBusyChecker = {
      checkFreeBusy: vi.fn().mockResolvedValue([
        { start: "2024-01-01T09:30:00Z", end: "2024-01-01T10:15:00Z" }, // overlaps with 10:00-10:30
      ]),
    };

    const managerWithChecker = new SlotManager(mockRedis as any, 300_000, mockFreeBusyChecker);

    // Hold the slot first
    mockRedis.get.mockResolvedValue(null);
    await managerWithChecker.proposeSlots("tenant-1", "conv-A", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);

    // Try to confirm — should fail because calendar is busy
    mockRedis.del.mockResolvedValue(1);
    const result = await managerWithChecker.confirmSlot(
      "tenant-1",
      "cal-1",
      "2024-01-01T10:00:00Z",
      "2024-01-01T10:30:00Z",
    );

    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe("slot_no_longer_available");
    expect(mockFreeBusyChecker.checkFreeBusy).toHaveBeenCalled();
  });

  it("confirms slot when freebusy check passes", async () => {
    const mockFreeBusyChecker = {
      checkFreeBusy: vi.fn().mockResolvedValue([]), // no busy slots
    };

    const managerWithChecker = new SlotManager(mockRedis as any, 300_000, mockFreeBusyChecker);

    // Hold the slot first
    mockRedis.get.mockResolvedValue(null);
    await managerWithChecker.proposeSlots("tenant-1", "conv-A", "cal-1", [
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T10:30:00Z" },
    ]);

    // Confirm — should succeed
    mockRedis.del.mockResolvedValue(1);
    const result = await managerWithChecker.confirmSlot(
      "tenant-1",
      "cal-1",
      "2024-01-01T10:00:00Z",
      "2024-01-01T10:30:00Z",
    );

    expect(result.confirmed).toBe(true);
  });
});
