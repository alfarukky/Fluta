import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { getOrderPath } from "@/lib/order-links";
import { formatOrderNumber } from "@/lib/orders";
import { describeNotification, getRetentionCutoff, getUnreadAfter, getVisibleAudiences } from "@/lib/staff-notifications";
import { formatDateTime } from "@/lib/time";
import { countUnreadNotifications, deleteNotificationsBefore, openNotifications } from "@/server/data/staff-notifications";
import type { NotificationItem } from "@/types/staff-notifications";

// The staff bell for one signed-in member. Callers pass the member from
// authorizeStoreMember: the store always comes from the membership.
export interface BellMember {
  storeId: string;
  timeZone: string;
  membershipId: string;
  role: StoreRole;
  notificationsSeenAt: Date | null;
}

export async function getUnreadNotificationCount(member: BellMember, now: Date): Promise<number> {
  return countUnreadNotifications(
    member.storeId,
    getVisibleAudiences(member.role),
    getUnreadAfter(member.notificationsSeenAt, now),
  );
}

// Marks everything up to now seen for this member, and returns the newest
// notifications up to that moment. Null when the membership is no longer active.
export async function openNotificationBell(member: BellMember): Promise<NotificationItem[] | null> {
  const opened = await openNotifications(member.storeId, member.membershipId, getVisibleAudiences(member.role));
  if (!opened) return null;
  const unreadAfter = getUnreadAfter(opened.previouslySeenAt, opened.seenAt);
  return opened.items.map((item) => {
    const orderNumber = formatOrderNumber(item.order.store, item.order.orderNumber);
    return {
      id: item.id,
      text: describeNotification(item.type, item.order.customer.name, { orderNumber, rating: item.order.review?.rating ?? null }),
      orderNumber,
      time: formatDateTime(item.createdAt, member.timeZone),
      href: getOrderPath(item.orderId),
      isNew: item.createdAt > unreadAfter,
    };
  });
}

// The scheduled job: deletes notifications older than 30 days. Returns how many.
export async function clearOldNotifications(now: Date): Promise<number> {
  return deleteNotificationsBefore(getRetentionCutoff(now));
}
