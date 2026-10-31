import "server-only";

import type { OrderStage } from "@/generated/prisma/client";
import { fromStoredCoordinates } from "@/lib/location";
import { formatOrderNumber } from "@/lib/orders";
import { addDaysToDateKey, formatShortDay, formatTwelveHour, toDateKey } from "@/lib/time";
import type { ComingUp, ComingUpDay, DeliveryCard, DeliverySections, PickupCard } from "@/types/deliveries";

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
  pickupLatitude: { toString(): string } | null;
  pickupLongitude: { toString(): string } | null;
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
      location: fromStoredCoordinates(order.pickupLatitude, order.pickupLongitude),
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

// ───────────── "Coming up": the next 7 days, for planning only ─────────────

// Tomorrow through the 7th day after today, in the store's time zone. Today
// stays in the Pickups section above.
export const COMING_UP_DAYS = 7;

export function getComingUpRange(todayKey: string): { firstDayKey: string; lastDayKey: string } {
  return { firstDayKey: addDaysToDateKey(todayKey, 1), lastDayKey: addDaysToDateKey(todayKey, COMING_UP_DAYS) };
}

export const OUT_OF_AREA_LABEL = "Outside our service areas";

export interface ComingUpPickupRecord {
  scheduledPickupDate: Date | null;
  scheduledWindowStart: string | null;
  scheduledWindowEnd: string | null;
  serviceAreaName: string | null;
}

export interface ComingUpInput {
  pickups: readonly ComingUpPickupRecord[];
  waitingCount: number;
  cleaningCount: number;
}

// The wording, singular and plural, in one place.
export const comingUpWording = {
  pickupCount: (count: number) => (count === 1 ? "1 pickup" : `${count} pickups`),
  waiting: (count: number) =>
    count === 1
      ? "1 more pickup is waiting for the store to confirm a time."
      : `${count} more pickups are waiting for the store to confirm a time.`,
  cleaning: (count: number) =>
    count === 1 ? "1 order is being cleaned and will need delivery." : `${count} orders are being cleaned and will need delivery.`,
  empty: "Nothing coming up in the next 7 days",
};

// Confirmed pickups grouped by day (days with none left out), each sorted by
// window start, plus the two counts. Pickups outside the 7 days are dropped
// here too, whatever the caller passed.
export function buildComingUp(input: ComingUpInput, todayKey: string): ComingUp {
  const { firstDayKey, lastDayKey } = getComingUpRange(todayKey);
  const byDay = new Map<string, ComingUpPickupRecord[]>();
  for (const pickup of input.pickups) {
    if (!pickup.scheduledPickupDate) continue;
    const date = toDateKey(pickup.scheduledPickupDate);
    if (date < firstDayKey || date > lastDayKey) continue;
    byDay.set(date, [...(byDay.get(date) ?? []), pickup]);
  }

  const days: ComingUpDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pickups]) => {
      const day = formatShortDay(date);
      return {
        date,
        heading: `${date === firstDayKey ? `Tomorrow, ${day}` : day} · ${comingUpWording.pickupCount(pickups.length)}`,
        pickups: [...pickups]
          .sort((a, b) => (a.scheduledWindowStart ?? "").localeCompare(b.scheduledWindowStart ?? ""))
          .map(formatComingUpPickup),
      };
    });

  const waiting = input.waitingCount > 0 ? comingUpWording.waiting(input.waitingCount) : null;
  const cleaning = input.cleaningCount > 0 ? comingUpWording.cleaning(input.cleaningCount) : null;
  return { days, waiting, cleaning, empty: days.length === 0 && !waiting && !cleaning };
}

// "10:00 AM – 12:00 PM · Wuse", or just the area when there's no window.
function formatComingUpPickup(pickup: ComingUpPickupRecord): string {
  const area = pickup.serviceAreaName ?? OUT_OF_AREA_LABEL;
  const { scheduledWindowStart: start, scheduledWindowEnd: end } = pickup;
  return start && end ? `${formatTwelveHour(start)} – ${formatTwelveHour(end)} · ${area}` : area;
}
