import Redis from "ioredis";
import { getLogger } from "@/lib/logger.js";

/**
 * Proposed appointment slots held in Redis with a short TTL.
 * Prevents double-booking when two customers are offered overlapping slots.
 */

export interface ProposedSlot {
  conversationId: string;
  tenantId: string;
  start: string;
  end: string;
  calendarId: string;
}

export interface FreeBusyChecker {
  checkFreeBusy(
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{ start: string; end: string }>>;
}

export class SlotManager {
  private redis: Redis;
  private ttlMs: number;
  private freeBusyChecker?: FreeBusyChecker;

  constructor(redis: Redis, ttlMs: number = 300_000, freeBusyChecker?: FreeBusyChecker) {
    this.redis = redis;
    this.ttlMs = ttlMs;
    this.freeBusyChecker = freeBusyChecker;
  }

  /**
   * Propose slots for a conversation.
   * Returns slots that are not already held by another conversation.
   */
  async proposeSlots(
    tenantId: string,
    conversationId: string,
    calendarId: string,
    slots: Array<{ start: string; end: string }>,
  ): Promise<Array<{ start: string; end: string }>> {
    const available: Array<{ start: string; end: string }> = [];

    for (const slot of slots) {
      const key = `slot:${tenantId}:${calendarId}:${slot.start}`;
      const holder = await this.redis.get(key);

      if (!holder) {
        // Slot is available — hold it
        await this.redis.set(key, conversationId, "PX", this.ttlMs);
        available.push(slot);
      } else if (holder === conversationId) {
        // Same conversation re-requesting — still available
        available.push(slot);
      }
      // else: another conversation holds this slot — skip
    }

    getLogger().debug(
      { tenantId, conversationId, proposed: slots.length, available: available.length },
      "Slots proposed",
    );

    return available;
  }

  /**
   * Confirm a slot booking.
   * Re-checks freebusy at confirm time before creating the event.
   * Removes the hold so it can't be used by another conversation.
   */
  async confirmSlot(
    tenantId: string,
    calendarId: string,
    start: string,
    end: string,
  ): Promise<{ confirmed: boolean; reason?: string }> {
    const key = `slot:${tenantId}:${calendarId}:${start}`;

    // Re-check freebusy at confirm time if checker is available
    if (this.freeBusyChecker) {
      try {
        const busySlots = await this.freeBusyChecker.checkFreeBusy(calendarId, start, end);
        const isBusy = busySlots.some(
          (busy) => busy.start < end && busy.end > start,
        );

        if (isBusy) {
          getLogger().warn(
            { tenantId, calendarId, start },
            "Slot no longer available at confirm time",
          );
          // Release the hold since the slot is no longer valid
          await this.redis.del(key);
          return { confirmed: false, reason: "slot_no_longer_available" };
        }
      } catch (err) {
        getLogger().error(
          { tenantId, calendarId, start, err },
          "Failed to re-check freebusy at confirm time",
        );
        // Proceed with confirmation if freebusy check fails (fail open)
      }
    }

    const deleted = await this.redis.del(key);
    return { confirmed: deleted > 0 };
  }

  /**
   * Release all slots held by a conversation.
   */
  async releaseSlots(
    tenantId: string,
    conversationId: string,
  ): Promise<void> {
    const pattern = `slot:${tenantId}:*`;
    const keys = await this.redis.keys(pattern);

    for (const key of keys) {
      const holder = await this.redis.get(key);
      if (holder === conversationId) {
        await this.redis.del(key);
      }
    }
  }
}
