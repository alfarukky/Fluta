import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { fromDateKey } from "@/lib/time";

import { getPrisma } from "./client";

// The orders behind the Deliveries view. storeId always comes from the
// caller's membership. Only pickup and delivery orders, checked here in the
// query, and only the fields a card shows: never prices, payments,
// revisions, notes, or history.

export const DELIVERY_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  stage: true,
  addressText: true,
  serviceAreaName: true,
  isOutOfArea: true,
  scheduledPickupDate: true,
  scheduledWindowStart: true,
  scheduledWindowEnd: true,
  isOutsideSchedule: true,
  customer: { select: { name: true, phone: true } },
} as const satisfies Prisma.OrderSelect;

export type DeliveryOrderRecord = Prisma.OrderGetPayload<{ select: typeof DELIVERY_ORDER_SELECT }>;

// Pickups scheduled for today (a "YYYY-MM-DD" key in the store's time zone)
// or earlier, plus every order at Ready or Out for delivery.
export async function findDeliveryOrders(storeId: string, todayKey: string): Promise<DeliveryOrderRecord[]> {
  return getPrisma().order.findMany({
    where: {
      storeId,
      fulfilmentType: "PICKUP_DELIVERY",
      OR: [
        { stage: "PICKUP_SCHEDULED", scheduledPickupDate: { lte: fromDateKey(todayKey) } },
        { stage: { in: ["READY", "OUT_FOR_DELIVERY"] } },
      ],
    },
    select: DELIVERY_ORDER_SELECT,
    orderBy: { orderNumber: "asc" },
  });
}
