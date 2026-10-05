import "server-only";

import type { StoreStatus } from "@/generated/prisma/client";

export type SubscriptionStatus = "ACTIVE" | "OVERDUE" | "SUSPENDED" | "CANCELLED";

export interface StoreAccessStore {
  status: StoreStatus;
  timeZone: string;
}

export interface StoreAccessSubscription {
  cancelledAt: Date | null;
  graceDays: number;
  // Unpaid (OPEN) invoices only. dueDate is a calendar date (@db.Date).
  invoices: { dueDate: Date }[];
}

export interface StoreAccess {
  subscriptionStatus: SubscriptionStatus;
  // Online bookings and staff-entered orders; the booking page uses this too.
  canAcceptNewOrders: boolean;
  // Staff sign in and work on existing orders (stages, quotes, payments, refunds).
  canWorkOnExistingOrders: boolean;
  // Owner edits settings, services, and staff.
  canEditSettings: boolean;
  // Guests view, approve, and pay through existing tracking links.
  canUseTrackingLinks: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" for `now` as seen in the store's time zone.
function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Derived from invoices, never stored (except Cancelled). An invoice is past
// due from the day after its due date in the store's time zone, and the
// subscription is Suspended once the grace period has also passed.
export function getSubscriptionStatus(
  subscription: StoreAccessSubscription,
  timeZone: string,
  now: Date,
): SubscriptionStatus {
  if (subscription.cancelledAt) return "CANCELLED";
  if (subscription.invoices.length === 0) return "ACTIVE";

  const oldestDue = Math.min(...subscription.invoices.map((invoice) => invoice.dueDate.getTime()));
  const today = localDate(now, timeZone);
  if (today <= isoDate(new Date(oldestDue))) return "ACTIVE";
  if (today <= isoDate(new Date(oldestDue + subscription.graceDays * DAY_MS))) return "OVERDUE";
  return "SUSPENDED";
}

// What a store may do, from its operational status (set by Fluta admins) and
// its subscription status (billing). The overview's access table, in one place.
// A store without a subscription is treated as Suspended: existing orders can
// still be worked on, but no new orders are accepted.
export function getStoreAccess(
  store: StoreAccessStore,
  subscription: StoreAccessSubscription | null,
  now: Date,
): StoreAccess {
  const subscriptionStatus = subscription ? getSubscriptionStatus(subscription, store.timeZone, now) : "SUSPENDED";
  const canAcceptNewOrders =
    store.status === "ACTIVE" && (subscriptionStatus === "ACTIVE" || subscriptionStatus === "OVERDUE");
  const canWorkOnExistingOrders = store.status !== "DEACTIVATED" && subscriptionStatus !== "CANCELLED";

  return {
    subscriptionStatus,
    canAcceptNewOrders,
    canWorkOnExistingOrders,
    canEditSettings: canWorkOnExistingOrders,
    canUseTrackingLinks: store.status !== "DEACTIVATED",
  };
}
