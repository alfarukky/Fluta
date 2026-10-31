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
  pickupLatitude: true,
  pickupLongitude: true,
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

// ───────────── "Coming up": the next 7 days, for planning only ─────────────
//
// Exactly what the section shows, and nothing else: no IDs, customers,
// addresses, order numbers, or money. Dates are "YYYY-MM-DD" keys in the
// store's time zone, both ends included.

const COMING_UP_PICKUP_SELECT = {
  scheduledPickupDate: true,
  scheduledWindowStart: true,
  scheduledWindowEnd: true,
  serviceAreaName: true,
} as const satisfies Prisma.OrderSelect;

export interface ComingUpRecord {
  pickups: Prisma.OrderGetPayload<{ select: typeof COMING_UP_PICKUP_SELECT }>[];
  waitingCount: number;
  cleaningCount: number;
}

export async function findComingUp(storeId: string, firstDayKey: string, lastDayKey: string): Promise<ComingUpRecord> {
  const prisma = getPrisma();
  const days = { gte: fromDateKey(firstDayKey), lte: fromDateKey(lastDayKey) };
  const pickupOrders = { storeId, fulfilmentType: "PICKUP_DELIVERY" } as const satisfies Prisma.OrderWhereInput;

  const [pickups, waitingCount, cleaningCount] = await Promise.all([
    // Confirmed pickups on those days.
    prisma.order.findMany({
      where: { ...pickupOrders, stage: "PICKUP_SCHEDULED", pickupWindowStatus: "CONFIRMED", scheduledPickupDate: days },
      select: COMING_UP_PICKUP_SELECT,
      orderBy: [{ scheduledPickupDate: "asc" }, { scheduledWindowStart: "asc" }, { orderNumber: "asc" }],
    }),
    // Booked, with a time on those days the store hasn't confirmed yet: the
    // customer's request, or the store's suggestion (kept in the scheduled
    // fields until accepted).
    prisma.order.count({
      where: {
        ...pickupOrders,
        stage: "BOOKED",
        OR: [
          { pickupWindowStatus: "REQUESTED", requestedPickupDate: days },
          { pickupWindowStatus: "PROPOSED_BY_STORE", scheduledPickupDate: days },
        ],
      },
    }),
    // Picked up and not Ready yet. A quote sent from Booked (the pickup
    // charge) comes before pickup, so it isn't counted.
    prisma.order.count({
      where: {
        ...pickupOrders,
        OR: [
          { stage: { in: ["PICKED_UP", "RECEIVED_BY_STORE", "IN_PROGRESS"] } },
          { stage: "QUOTE_AWAITING_APPROVAL", OR: [{ stageBeforeQuote: null }, { stageBeforeQuote: { not: "BOOKED" } }] },
        ],
      },
    }),
  ]);

  return { pickups, waitingCount, cleaningCount };
}
