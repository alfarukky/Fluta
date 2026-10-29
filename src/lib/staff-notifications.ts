import type { NotificationAudience, NotificationType, StoreRole } from "@/generated/prisma/enums";

// The staff bell (Feature 17b). Rules shared by the server and the bell.

// Notifications older than this are never unread or listed, and the
// scheduled job deletes them.
export const NOTIFICATION_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// The bell lists this many, newest first.
export const NOTIFICATION_LIST_SIZE = 20;

// How often the bell asks for the unread count while the tab is visible.
export const NOTIFICATION_POLL_MS = 30_000;

// "Payment needs review" is for owners only (the database checks this too).
export function getNotificationAudience(type: NotificationType): NotificationAudience {
  return type === "PAYMENT_NEEDS_REVIEW" ? "OWNERS_ONLY" : "STAFF_AND_OWNERS";
}

// What a member may see. Riders see nothing.
export function getVisibleAudiences(role: StoreRole): NotificationAudience[] {
  if (role === "OWNER") return ["STAFF_AND_OWNERS", "OWNERS_ONLY"];
  if (role === "STAFF") return ["STAFF_AND_OWNERS"];
  return [];
}

// The oldest moment a notification can still be unread: after the member
// last opened the bell, and within the retention period.
export function getUnreadAfter(seenAt: Date | null, now: Date): Date {
  const oldest = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  return seenAt && seenAt > oldest ? seenAt : oldest;
}

export function getRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
}

// The badge: "9+" above 9, nothing at 0.
export function formatUnreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

// The bell's accessible name, with the count.
export function describeUnread(count: number): string {
  if (count <= 0) return "Notifications, none unread";
  return `Notifications, ${count > 9 ? "more than 9" : count} unread`;
}

// The short line for one notification. Built when shown: only the customer's
// name, never a phone number or address.
export function describeNotification(type: NotificationType, customerName: string): string {
  switch (type) {
    case "ONLINE_BOOKING":
      return `New online booking from ${customerName}`;
    case "PRICE_APPROVED":
      return `${customerName} approved the price update`;
    case "PRICE_DECLINED":
      return `${customerName} declined the price update`;
    case "PICKUP_ACCEPTED":
      return `${customerName} accepted the pickup time`;
    case "PAYMENT_RECEIVED":
      return `Online payment received from ${customerName}`;
    case "PAYMENT_NEEDS_REVIEW":
      return `An online payment from ${customerName} needs review`;
  }
}
