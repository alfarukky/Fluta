import "server-only";

import type { NotificationAudience, NotificationType, Prisma } from "@/generated/prisma/client";
import { getNotificationAudience, getRetentionCutoff, NOTIFICATION_LIST_SIZE } from "@/lib/staff-notifications";

import { getPrisma } from "./client";

// The staff bell (Feature 17b). Notifications are written by the event's own
// transaction (addStaffNotification), and read per member: unread means
// created after Membership.notificationsSeenAt and within 30 days.

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export interface StaffNotificationEvent {
  storeId: string;
  orderId: string;
  type: NotificationType;
  // The record the event created or changed: the order (new booking), the
  // quote revision (approved or declined), the status event (pickup
  // accepted), or the payment (received, needs review).
  sourceId: string;
}

// Called inside the event's transaction, as its last write, so a rolled-back
// event leaves no notification and the row's time (clock_timestamp(), set by
// the database) is as close to the commit as possible. A repeat of the same
// event (a second webhook, a retried action) is skipped by the unique
// [storeId, type, sourceId] rule, without failing the transaction.
export async function addStaffNotification(tx: Prisma.TransactionClient, event: StaffNotificationEvent): Promise<void> {
  await tx.notification.createMany({
    data: [{ ...event, audience: getNotificationAudience(event.type) }],
    skipDuplicates: true,
  });
}

// The bell's unread count: one count on the [storeId, createdAt] index.
export async function countUnreadNotifications(
  storeId: string,
  audiences: readonly NotificationAudience[],
  after: Date,
): Promise<number> {
  if (audiences.length === 0) return 0;
  return getPrisma().notification.count({
    where: { storeId, audience: { in: [...audiences] }, createdAt: { gt: after } },
  });
}

export interface OpenedNotification {
  id: string;
  type: NotificationType;
  orderId: string;
  createdAt: Date;
  order: { orderNumber: number; customer: { name: string }; store: { orderPrefix: string } };
}

export interface OpenedNotifications {
  // When this member had last opened the bell, before now.
  previouslySeenAt: Date | null;
  seenAt: Date;
  items: OpenedNotification[];
}

// Opening the bell: saves one database "now" as this member's
// notificationsSeenAt and lists the newest notifications up to that moment.
// One created a moment later is after it, so it stays unread. Null when the
// membership is no longer active in this store.
export async function openNotifications(
  storeId: string,
  membershipId: string,
  audiences: readonly NotificationAudience[],
): Promise<OpenedNotifications | null> {
  return getPrisma().$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ previous: Date | null; seen: Date }[]>`
      UPDATE "Membership" AS m
      SET "notificationsSeenAt" = clock_timestamp()
      FROM (SELECT "id", "notificationsSeenAt" FROM "Membership" WHERE "id" = ${membershipId} FOR UPDATE) AS old
      WHERE m."id" = old."id" AND m."storeId" = ${storeId} AND m."isActive" = TRUE
      RETURNING old."notificationsSeenAt" AS previous, m."notificationsSeenAt" AS seen`;
    const row = rows[0];
    if (!row) return null;

    const items =
      audiences.length === 0
        ? []
        : await tx.notification.findMany({
            where: {
              storeId,
              audience: { in: [...audiences] },
              createdAt: { lte: row.seen, gt: getRetentionCutoff(row.seen) },
            },
            select: {
              id: true,
              type: true,
              orderId: true,
              createdAt: true,
              order: { select: { orderNumber: true, customer: { select: { name: true } }, store: { select: { orderPrefix: true } } } },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: NOTIFICATION_LIST_SIZE,
          });
    return { previouslySeenAt: row.previous, seenAt: row.seen, items };
  }, TRANSACTION_OPTIONS);
}

// The scheduled job: notifications older than the cutoff, across all stores.
// Returns how many were deleted.
export async function deleteNotificationsBefore(cutoff: Date): Promise<number> {
  const { count } = await getPrisma().notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
