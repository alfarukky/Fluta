import { describe, expect, it } from "vitest";

import { submitReviewSchema } from "@/schemas/reviews";

import {
  getReviewRefusal,
  getReviewReminderDueAt,
  getReviewWindowEnd,
  isReminderDaytime,
  isReviewReminderDue,
  isReviewReminderStillNeeded,
  isWithinReviewWindow,
  type ReminderOrder,
} from "./reviews";

const LAGOS = "Africa/Lagos"; // UTC+1, no clock changes
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Lagos wall-clock time as a UTC instant.
function lagos(text: string): Date {
  return new Date(`${text}+01:00`);
}

function reminderOrder(overrides: Partial<ReminderOrder> = {}): ReminderOrder {
  return {
    stage: "COMPLETED",
    completedAt: lagos("2026-10-29T10:00:00"),
    storeStatus: "ACTIVE",
    timeZone: LAGOS,
    hasReview: false,
    ...overrides,
  };
}

describe("the 7-day review window", () => {
  const completedAt = lagos("2026-10-29T15:00:00");
  const order = { stage: "COMPLETED" as const, completedAt };

  it("ends exactly 7 × 24 hours after completion", () => {
    expect(getReviewWindowEnd(order)).toEqual(lagos("2026-11-05T15:00:00"));
    expect(isWithinReviewWindow(order, lagos("2026-11-05T14:59:59"))).toBe(true);
    expect(isWithinReviewWindow(order, lagos("2026-11-05T15:00:00"))).toBe(false);
  });

  it("is open right after completion", () => {
    expect(isWithinReviewWindow(order, completedAt)).toBe(true);
  });

  it("never opens for an order that isn't completed", () => {
    expect(getReviewWindowEnd({ stage: "CANCELLED", completedAt })).toBeNull();
    expect(isWithinReviewWindow({ stage: "READY", completedAt: null }, completedAt)).toBe(false);
    // Reopened: completedAt is cleared.
    expect(isWithinReviewWindow({ stage: "OUT_FOR_DELIVERY", completedAt: null }, completedAt)).toBe(false);
  });

  it("explains why a review is refused, an existing review first", () => {
    const now = lagos("2026-10-30T09:00:00");
    expect(getReviewRefusal({ ...order, hasReview: false }, now)).toBeNull();
    expect(getReviewRefusal({ ...order, hasReview: true }, now)).toBe("ALREADY_REVIEWED");
    expect(getReviewRefusal({ stage: "CANCELLED", completedAt: null, hasReview: false }, now)).toBe("NOT_COMPLETED");
    expect(getReviewRefusal({ stage: "CANCELLED", completedAt: null, hasReview: true }, now)).toBe("ALREADY_REVIEWED");
    expect(getReviewRefusal({ ...order, hasReview: false }, lagos("2026-11-06T09:00:00"))).toBe("WINDOW_ENDED");
  });
});

describe("the reminder's daytime window", () => {
  it("runs from 8:00 AM up to 8:00 PM in the store's time zone", () => {
    expect(isReminderDaytime(lagos("2026-10-30T07:59:00"), LAGOS)).toBe(false);
    expect(isReminderDaytime(lagos("2026-10-30T08:00:00"), LAGOS)).toBe(true);
    expect(isReminderDaytime(lagos("2026-10-30T19:59:00"), LAGOS)).toBe(true);
    expect(isReminderDaytime(lagos("2026-10-30T20:00:00"), LAGOS)).toBe(false);
  });

  it("follows the store's own time zone", () => {
    // 10:00 AM in Lagos is 5:00 AM in New York.
    const at = lagos("2026-10-30T10:00:00");
    expect(isReminderDaytime(at, LAGOS)).toBe(true);
    expect(isReminderDaytime(at, "America/New_York")).toBe(false);
  });
});

describe("getReviewReminderDueAt", () => {
  it("is 3 hours after completion during the day", () => {
    expect(getReviewReminderDueAt(lagos("2026-10-30T10:00:00"), LAGOS)).toEqual(lagos("2026-10-30T13:00:00"));
    expect(getReviewReminderDueAt(lagos("2026-10-30T16:59:00"), LAGOS)).toEqual(lagos("2026-10-30T19:59:00"));
  });

  it("waits until 8:00 AM the next day after a late-evening completion", () => {
    expect(getReviewReminderDueAt(lagos("2026-10-30T17:00:00"), LAGOS)).toEqual(lagos("2026-10-31T08:00:00"));
    expect(getReviewReminderDueAt(lagos("2026-10-30T21:30:00"), LAGOS)).toEqual(lagos("2026-10-31T08:00:00"));
  });

  it("waits until 8:00 AM the same day after a completion in the small hours", () => {
    expect(getReviewReminderDueAt(lagos("2026-10-30T02:00:00"), LAGOS)).toEqual(lagos("2026-10-30T08:00:00"));
    // 3 hours later is 7:30 AM.
    expect(getReviewReminderDueAt(lagos("2026-10-30T04:30:00"), LAGOS)).toEqual(lagos("2026-10-30T08:00:00"));
    // 3 hours later is exactly 8:00 AM.
    expect(getReviewReminderDueAt(lagos("2026-10-30T05:00:00"), LAGOS)).toEqual(lagos("2026-10-30T08:00:00"));
  });

  it("uses the store's time zone", () => {
    // 5:00 PM in New York (EDT) is 10:00 PM in Lagos. 3 hours later is 8:00 PM
    // in New York, the end of its day, so it waits for 8:00 AM there.
    const completedAt = new Date("2026-10-15T21:00:00Z");
    expect(getReviewReminderDueAt(completedAt, "America/New_York")).toEqual(new Date("2026-10-16T12:00:00Z")); // 8:00 AM EDT
  });
});

describe("isReviewReminderDue", () => {
  it("is due 3 hours after completion, not before", () => {
    const order = reminderOrder({ completedAt: lagos("2026-10-30T10:00:00") });
    expect(isReviewReminderDue(order, lagos("2026-10-30T12:59:00"))).toBe(false);
    expect(isReviewReminderDue(order, lagos("2026-10-30T13:00:00"))).toBe(true);
    expect(isReviewReminderDue(order, lagos("2026-10-30T13:04:00"))).toBe(true);
  });

  it("holds a late-evening completion until 8:00 AM", () => {
    const order = reminderOrder({ completedAt: lagos("2026-10-30T19:00:00") });
    expect(isReviewReminderDue(order, lagos("2026-10-30T22:00:00"))).toBe(false);
    expect(isReviewReminderDue(order, lagos("2026-10-31T07:55:00"))).toBe(false);
    expect(isReviewReminderDue(order, lagos("2026-10-31T08:00:00"))).toBe(true);
  });

  it("waits for the morning if it came due just before 8:00 PM but the job runs after", () => {
    const order = reminderOrder({ completedAt: lagos("2026-10-30T16:58:00") });
    expect(isReviewReminderDue(order, lagos("2026-10-30T19:59:00"))).toBe(true);
    expect(isReviewReminderDue(order, lagos("2026-10-30T20:01:00"))).toBe(false);
    expect(isReviewReminderDue(order, lagos("2026-10-31T08:01:00"))).toBe(true);
  });

  it("is never due once the window ends, or for reviewed, reopened, or cancelled orders", () => {
    const now = lagos("2026-10-30T13:00:00");
    expect(isReviewReminderDue(reminderOrder({ hasReview: true }), now)).toBe(false);
    expect(isReviewReminderDue(reminderOrder({ stage: "READY", completedAt: null }), now)).toBe(false);
    expect(isReviewReminderDue(reminderOrder({ stage: "CANCELLED" }), now)).toBe(false);
    expect(isReviewReminderDue(reminderOrder({ storeStatus: "DEACTIVATED" }), now)).toBe(false);
    expect(isReviewReminderDue(reminderOrder(), new Date(lagos("2026-10-29T10:00:00").getTime() + 7 * 24 * HOUR))).toBe(false);
  });
});

describe("isReviewReminderStillNeeded", () => {
  const now = lagos("2026-10-30T13:00:00");

  it("is needed while the order is completed, unreviewed, and within the window", () => {
    expect(isReviewReminderStillNeeded(reminderOrder(), now)).toBe(true);
    // Unlike queuing, the last check before a retry doesn't look at the clock's hour.
    expect(isReviewReminderStillNeeded(reminderOrder(), lagos("2026-10-30T21:00:00"))).toBe(true);
  });

  it("isn't needed once reviewed, reopened, cancelled, past the window, or deactivated", () => {
    expect(isReviewReminderStillNeeded(reminderOrder({ hasReview: true }), now)).toBe(false);
    expect(isReviewReminderStillNeeded(reminderOrder({ stage: "READY", completedAt: null }), now)).toBe(false);
    expect(isReviewReminderStillNeeded(reminderOrder({ stage: "CANCELLED" }), now)).toBe(false);
    expect(isReviewReminderStillNeeded(reminderOrder(), lagos("2026-11-05T10:00:00"))).toBe(false);
    expect(isReviewReminderStillNeeded(reminderOrder({ storeStatus: "DEACTIVATED" }), now)).toBe(false);
  });
});

describe("submitReviewSchema", () => {
  it("requires a whole star rating from 1 to 5", () => {
    for (const rating of [1, 2, 3, 4, 5]) expect(submitReviewSchema.safeParse({ rating }).success).toBe(true);
    for (const rating of [0, 6, 3.5, -1, Number.NaN]) expect(submitReviewSchema.safeParse({ rating }).success).toBe(false);
    expect(submitReviewSchema.safeParse({ rating: "5" }).success).toBe(false);
    expect(submitReviewSchema.safeParse({}).success).toBe(false);
  });

  it("trims the comment and stores an empty one as null", () => {
    expect(submitReviewSchema.parse({ rating: 4, comment: "  Lovely  " }).comment).toBe("Lovely");
    expect(submitReviewSchema.parse({ rating: 4, comment: "   " }).comment).toBeNull();
    expect(submitReviewSchema.parse({ rating: 4, comment: "" }).comment).toBeNull();
    expect(submitReviewSchema.parse({ rating: 4, comment: null }).comment).toBeNull();
    expect(submitReviewSchema.parse({ rating: 4 }).comment).toBeNull();
  });

  it("allows up to 300 characters after trimming", () => {
    expect(submitReviewSchema.safeParse({ rating: 4, comment: "a".repeat(300) }).success).toBe(true);
    expect(submitReviewSchema.safeParse({ rating: 4, comment: ` ${"a".repeat(300)} ` }).success).toBe(true);
    const tooLong = submitReviewSchema.safeParse({ rating: 4, comment: "a".repeat(301) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe("Your comment must be 300 characters or fewer");
  });

  it("keeps the comment as plain text, never interpreting it", () => {
    expect(submitReviewSchema.parse({ rating: 2, comment: "<b>late</b>" }).comment).toBe("<b>late</b>");
  });
});
