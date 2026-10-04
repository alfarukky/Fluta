import { describe, expect, it } from "vitest";

import type { StoreStatus } from "@/generated/prisma/enums";

import {
  getStoreAccess,
  getSubscriptionStatus,
  type StoreAccess,
  type StoreAccessSubscription,
  type SubscriptionStatus,
} from "./store-access";

const LAGOS = "Africa/Lagos";
// 4 October 2026, 12:00 in Lagos.
const NOW = new Date("2026-10-04T11:00:00Z");

function dueDate(isoDay: string): { dueDate: Date } {
  return { dueDate: new Date(`${isoDay}T00:00:00Z`) };
}

// A subscription whose derived status is `status` at NOW.
function subscriptionWith(status: SubscriptionStatus): StoreAccessSubscription {
  const base = { cancelledAt: null, graceDays: 7 };
  switch (status) {
    case "ACTIVE":
      return { ...base, invoices: [dueDate("2026-10-10")] };
    case "OVERDUE":
      return { ...base, invoices: [dueDate("2026-10-01")] };
    case "SUSPENDED":
      return { ...base, invoices: [dueDate("2026-09-20")] };
    case "CANCELLED":
      return { ...base, cancelledAt: new Date("2026-09-30T09:00:00Z"), invoices: [] };
  }
}

type Capabilities = Omit<StoreAccess, "subscriptionStatus">;
const ALL: Capabilities = {
  canAcceptNewOrders: true,
  canWorkOnExistingOrders: true,
  canEditSettings: true,
  canUseTrackingLinks: true,
};
const EXISTING_ORDERS_ONLY: Capabilities = { ...ALL, canAcceptNewOrders: false };
const TRACKING_ONLY: Capabilities = {
  canAcceptNewOrders: false,
  canWorkOnExistingOrders: false,
  canEditSettings: false,
  canUseTrackingLinks: true,
};
const NOTHING: Capabilities = { ...TRACKING_ONLY, canUseTrackingLinks: false };

// The overview's access table, for every store status × subscription status.
const EXPECTED: Record<StoreStatus, Record<SubscriptionStatus, Capabilities>> = {
  ACTIVE: { ACTIVE: ALL, OVERDUE: ALL, SUSPENDED: EXISTING_ORDERS_ONLY, CANCELLED: TRACKING_ONLY },
  PAUSED: {
    ACTIVE: EXISTING_ORDERS_ONLY,
    OVERDUE: EXISTING_ORDERS_ONLY,
    SUSPENDED: EXISTING_ORDERS_ONLY,
    CANCELLED: TRACKING_ONLY,
  },
  DEACTIVATED: { ACTIVE: NOTHING, OVERDUE: NOTHING, SUSPENDED: NOTHING, CANCELLED: NOTHING },
};

describe("getStoreAccess", () => {
  for (const [storeStatus, bySubscription] of Object.entries(EXPECTED)) {
    for (const [subscriptionStatus, capabilities] of Object.entries(bySubscription)) {
      it(`store ${storeStatus} with subscription ${subscriptionStatus}`, () => {
        const access = getStoreAccess(
          { status: storeStatus as StoreStatus, timeZone: LAGOS },
          subscriptionWith(subscriptionStatus as SubscriptionStatus),
          NOW,
        );
        expect(access).toEqual({ subscriptionStatus, ...capabilities });
      });
    }
  }

  it("fails closed for a store with no subscription", () => {
    expect(getStoreAccess({ status: "ACTIVE", timeZone: LAGOS }, null, NOW)).toEqual({
      subscriptionStatus: "CANCELLED",
      ...TRACKING_ONLY,
    });
  });
});

describe("getSubscriptionStatus", () => {
  const status = (subscription: Partial<StoreAccessSubscription>, now = NOW) =>
    getSubscriptionStatus({ cancelledAt: null, graceDays: 7, invoices: [], ...subscription }, LAGOS, now);

  it("is Active with no unpaid invoices", () => {
    expect(status({})).toBe("ACTIVE");
  });

  it("is Active through the due date, in the store's time zone", () => {
    expect(status({ invoices: [dueDate("2026-10-04")] })).toBe("ACTIVE");
    // 23:30 UTC on the due date is already the next day in Lagos.
    expect(status({ invoices: [dueDate("2026-10-04")] }, new Date("2026-10-04T23:30:00Z"))).toBe("OVERDUE");
  });

  it("is Overdue through the last day of the grace period, then Suspended", () => {
    expect(status({ invoices: [dueDate("2026-09-27")] })).toBe("OVERDUE");
    expect(status({ invoices: [dueDate("2026-09-26")] })).toBe("SUSPENDED");
    expect(status({ graceDays: 10, invoices: [dueDate("2026-09-26")] })).toBe("OVERDUE");
  });

  it("goes by the oldest unpaid invoice", () => {
    expect(status({ invoices: [dueDate("2026-10-20"), dueDate("2026-09-01")] })).toBe("SUSPENDED");
  });

  it("is Cancelled once cancelledAt is set, whatever the invoices", () => {
    expect(status({ cancelledAt: NOW, invoices: [] })).toBe("CANCELLED");
  });
});
