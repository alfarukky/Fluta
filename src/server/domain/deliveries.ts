import type { OrderStage } from "@/generated/prisma/client";
import { formatOrderNumber } from "@/lib/orders";
import { toDateKey } from "@/lib/time";
import type { DeliveryCard, DeliverySections, PickupCard } from "@/types/deliveries";

// Building the Deliveries view's three sections from the store's pickup and
// delivery orders. Pure: the caller passes the orders and today's date in
// the store's time zone.

export interface DeliveryOrder {
  id: string;
  orderNumber: number;
  stage: OrderStage;
  addressText: string | null;
  serviceAreaName: string | null;
  isOutOfArea: boolean;
  scheduledPickupDate: Date | null;
  scheduledWindowStart: string | null;
  scheduledWindowEnd: string | null;
  isOutsideSchedule: boolean;
  customer: { name: string; phone: string };
}

export function buildDeliverySections(
  orders: readonly DeliveryOrder[],
  todayKey: string,
  store: { orderPrefix: string },
): DeliverySections {
  const sections: DeliverySections = { pickups: [], onTheWay: [], readyToDeliver: [] };

  for (const order of orders) {
    const card = {
      orderId: order.id,
      orderNumber: formatOrderNumber(store, order.orderNumber),
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      address: order.addressText,
      areaName: order.serviceAreaName,
      isOutOfArea: order.isOutOfArea,
    };
    if (order.stage === "PICKUP_SCHEDULED") {
      if (!order.scheduledPickupDate) continue;
      const scheduledDate = toDateKey(order.scheduledPickupDate);
      if (scheduledDate > todayKey) continue;
      sections.pickups.push({
        ...card,
        stage: "PICKUP_SCHEDULED",
        scheduledDate,
        windowStart: order.scheduledWindowStart,
        windowEnd: order.scheduledWindowEnd,
        isOutsideSchedule: order.isOutsideSchedule,
        isOverdue: scheduledDate < todayKey,
      });
    } else if (order.stage === "OUT_FOR_DELIVERY") {
      sections.onTheWay.push({ ...card, stage: "OUT_FOR_DELIVERY" } satisfies DeliveryCard);
    } else if (order.stage === "READY") {
      sections.readyToDeliver.push({ ...card, stage: "READY" } satisfies DeliveryCard);
    }
  }

  sections.pickups.sort(comparePickups);
  return sections;
}

// Overdue pickups first (oldest first), then today's; within a day, by
// window start, then order number.
function comparePickups(a: PickupCard, b: PickupCard): number {
  return (
    Number(b.isOverdue) - Number(a.isOverdue) ||
    a.scheduledDate.localeCompare(b.scheduledDate) ||
    (a.windowStart ?? "").localeCompare(b.windowStart ?? "") ||
    a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
  );
}
