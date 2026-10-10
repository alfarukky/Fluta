import "server-only";

import type { OrderLineType, PricingType } from "@/generated/prisma/client";
import { lineTotalKobo } from "@/lib/money";
import { getClockTimeProblem, getPickupWindows, parseClockTime, type PickupSchedule } from "@/lib/pickup-schedule";
import { toDecimalString } from "@/lib/quantity";
import { fromDateKey } from "@/lib/time";

// Order rules. The pricing and stage rules live in src/lib so the new-order
// form's review runs the same code in the browser; they are re-exported here
// so server code (and Feature 12's quotes) has one place to import them from.
export { getOrderTotal, isOrderFullyPriced, mergeServiceLines } from "@/lib/order-pricing";
export { getInitialStage } from "@/lib/orders";

export interface PickupRequest {
  date: string; // "YYYY-MM-DD" in the store's time zone
  windowStart: string; // "HH:MM"
  windowEnd: string;
  // Staff agreed a pickup outside the normal schedule (a note explains it).
  outsideSchedule: boolean;
}

export interface PickupContext {
  today: string; // "YYYY-MM-DD" in the store's time zone
  schedule: PickupSchedule;
  isClosedDate: boolean;
}

export type PickupProblem =
  | { field: "pickupDate"; reason: "DATE_IN_PAST" | "INACTIVE_DAY" | "CLOSED_DATE" }
  | { field: "pickupWindow"; reason: "WINDOW_NOT_OFFERED" | "INVALID_TIME" | "END_NOT_AFTER_START" };

// Null when the pickup can be booked. Normally the date must be today or
// later, on an active day, not closed, in one of the store's windows. Outside
// the normal schedule only "today or later" and a custom time (on the
// 15-minute step, ending after it starts) are required.
export function getPickupProblem(request: PickupRequest, context: PickupContext): PickupProblem | null {
  if (request.date < context.today) return { field: "pickupDate", reason: "DATE_IN_PAST" };

  if (request.outsideSchedule) {
    if (getClockTimeProblem(request.windowStart) || getClockTimeProblem(request.windowEnd)) {
      return { field: "pickupWindow", reason: "INVALID_TIME" };
    }
    const start = parseClockTime(request.windowStart) ?? 0;
    const end = parseClockTime(request.windowEnd) ?? 0;
    return end > start ? null : { field: "pickupWindow", reason: "END_NOT_AFTER_START" };
  }

  if (!context.schedule.activeDays.includes(fromDateKey(request.date).getUTCDay())) {
    return { field: "pickupDate", reason: "INACTIVE_DAY" };
  }
  if (context.isClosedDate) return { field: "pickupDate", reason: "CLOSED_DATE" };

  const { openTime, closeTime } = context.schedule;
  const windows = openTime && closeTime ? getPickupWindows(openTime, closeTime) : [];
  const offered = windows.some((window) => window.start === request.windowStart && window.end === request.windowEnd);
  return offered ? null : { field: "pickupWindow", reason: "WINDOW_NOT_OFFERED" };
}

export interface PricedOrderLine {
  lineType: OrderLineType;
  serviceId: string | null;
  description: string;
  pricingType: PricingType | null;
  unitPrice: number | null;
  quantity: number | null; // hundredths
  estimate: number | null; // hundredths
  lineTotal: number | null;
}

// A type alias (not an interface) so it is assignable to Prisma's JSON input.
export type QuoteSnapshotLine = {
  lineType: OrderLineType;
  serviceId: string | null;
  description: string;
  pricingType: PricingType | null;
  unitPrice: number | null;
  quantity: string | null;
  quantityIsEstimate: boolean;
  lineTotal: number;
};

// What version 1 shows the customer, frozen in QuoteRevision.linesSnapshot.
// An unweighed line shows the customer's estimate when there is one (priced
// at the unit price) and is left out otherwise; such a version is only ever
// an estimate and is never approved.
export function buildQuoteSnapshot(
  lines: readonly PricedOrderLine[],
  fulfilmentCharge: number | null,
): { linesSnapshot: QuoteSnapshotLine[]; itemsSubtotal: number; fulfilmentCharge: number; total: number } {
  const linesSnapshot = lines.flatMap((line): QuoteSnapshotLine[] => {
    const shown = line.quantity ?? line.estimate;
    if (line.lineType === "SERVICE" && shown === null) return [];
    const lineTotal = line.lineTotal ?? lineTotalKobo(line.unitPrice ?? 0, shown ?? 0);
    return [
      {
        lineType: line.lineType,
        serviceId: line.serviceId,
        description: line.description,
        pricingType: line.pricingType,
        unitPrice: line.unitPrice,
        quantity: shown === null ? null : toDecimalString(shown),
        quantityIsEstimate: line.quantity === null && shown !== null,
        lineTotal,
      },
    ];
  });
  const itemsSubtotal = linesSnapshot.reduce((sum, line) => sum + line.lineTotal, 0);
  const charge = fulfilmentCharge ?? 0;
  return { linesSnapshot, itemsSubtotal, fulfilmentCharge: charge, total: itemsSubtotal + charge };
}
