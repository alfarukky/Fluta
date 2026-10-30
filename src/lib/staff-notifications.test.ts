import { describe, expect, it } from "vitest";

import {
  describeNotification,
  describeUnread,
  formatUnreadBadge,
  getNotificationAudience,
  getRetentionCutoff,
  getUnreadAfter,
  getVisibleAudiences,
} from "./staff-notifications";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("audiences", () => {
  it("keeps payments needing review for owners only", () => {
    expect(getNotificationAudience("PAYMENT_NEEDS_REVIEW")).toBe("OWNERS_ONLY");
    for (const type of ["ONLINE_BOOKING", "PRICE_APPROVED", "PRICE_DECLINED", "PICKUP_ACCEPTED", "PAYMENT_RECEIVED"] as const) {
      expect(getNotificationAudience(type)).toBe("STAFF_AND_OWNERS");
    }
  });

  it("shows owners everything, staff the shared ones, and riders nothing", () => {
    expect(getVisibleAudiences("OWNER")).toEqual(["STAFF_AND_OWNERS", "OWNERS_ONLY"]);
    expect(getVisibleAudiences("STAFF")).toEqual(["STAFF_AND_OWNERS"]);
    expect(getVisibleAudiences("RIDER")).toEqual([]);
  });
});

describe("getUnreadAfter", () => {
  it("is the last time the bell was opened", () => {
    const seen = new Date(NOW.getTime() - DAY_MS);
    expect(getUnreadAfter(seen, NOW)).toEqual(seen);
  });

  it("never reaches back more than 30 days", () => {
    expect(getUnreadAfter(null, NOW)).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
    expect(getUnreadAfter(new Date(NOW.getTime() - 45 * DAY_MS), NOW)).toEqual(getRetentionCutoff(NOW));
  });
});

describe("the badge", () => {
  it("shows the count up to 9, then 9+", () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(9)).toBe("9");
    expect(formatUnreadBadge(10)).toBe("9+");
  });

  it("names the count for screen readers", () => {
    expect(describeUnread(0)).toBe("Notifications, none unread");
    expect(describeUnread(3)).toBe("Notifications, 3 unread");
    expect(describeUnread(12)).toBe("Notifications, more than 9 unread");
  });
});

describe("describeNotification", () => {
  it("builds one short line per type, with only the customer's name", () => {
    expect(describeNotification("ONLINE_BOOKING", "Chidi Okeke")).toBe("New online booking from Chidi Okeke");
    expect(describeNotification("PRICE_APPROVED", "Chidi Okeke")).toBe("Chidi Okeke approved the price update");
    expect(describeNotification("PRICE_DECLINED", "Chidi Okeke")).toBe("Chidi Okeke declined the price update");
    expect(describeNotification("PICKUP_ACCEPTED", "Chidi Okeke")).toBe("Chidi Okeke accepted the pickup time");
    expect(describeNotification("PAYMENT_RECEIVED", "Chidi Okeke")).toBe("Online payment received from Chidi Okeke");
    expect(describeNotification("PAYMENT_NEEDS_REVIEW", "Chidi Okeke")).toBe("An online payment from Chidi Okeke needs review");
  });

  it("shows a review's order and stars, never its comment", () => {
    expect(describeNotification("REVIEW_RECEIVED", "Musa", { orderNumber: "FF-1024", rating: 5 })).toBe(
      "Musa rated FF-1024 ★★★★★ (5 out of 5)",
    );
    expect(describeNotification("REVIEW_RECEIVED", "Musa", { orderNumber: "FF-1024", rating: 2 })).toBe(
      "Musa rated FF-1024 ★★☆☆☆ (2 out of 5)",
    );
    expect(describeNotification("REVIEW_RECEIVED", "Musa", { orderNumber: "FF-1024", rating: null })).toBe("Musa rated FF-1024");
  });
});
