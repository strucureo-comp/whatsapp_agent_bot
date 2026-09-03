import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrashSafety } from "./crash-safety.js";

// Mock Redis
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
};

describe("CrashSafety", () => {
  let crashSafety: CrashSafety;

  beforeEach(() => {
    vi.clearAllMocks();
    crashSafety = new CrashSafety(mockRedis as any);
  });

  it("acquires lock when available", async () => {
    mockRedis.set.mockResolvedValue("OK");

    const token = await crashSafety.acquireLock("tenant-1", "conv-1");

    expect(token).toBeDefined();
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      "crash:lock:tenant-1:conv-1",
      token,
      "PX",
      120_000,
      "NX",
    );
  });

  it("returns null when lock is held", async () => {
    mockRedis.set.mockResolvedValue(null);

    const token = await crashSafety.acquireLock("tenant-1", "conv-1");

    expect(token).toBeNull();
  });

  it("releases lock when token matches", async () => {
    mockRedis.get.mockResolvedValue("my-token");

    await crashSafety.releaseLock("tenant-1", "conv-1", "my-token");

    expect(mockRedis.del).toHaveBeenCalledWith("crash:lock:tenant-1:conv-1");
  });

  it("does not release lock when token mismatches", async () => {
    mockRedis.get.mockResolvedValue("other-token");

    await crashSafety.releaseLock("tenant-1", "conv-1", "my-token");

    expect(mockRedis.del).not.toHaveBeenCalled();
  });
});
