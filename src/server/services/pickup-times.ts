import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { fromDateKey, getLocalDateKey } from "@/lib/time";
import type { SuggestPickupInput } from "@/schemas/pickup-times";
import { getFulfilmentOptionsAndSchedule, isClosedDate, listClosedDateKeys } from "@/server/data/fulfilment";
import { confirmRequestedPickup, suggestPickupTime, type PickupOrderRecord } from "@/server/data/pickup-times";
import { canTransition, getStageOrderState, toContext } from "@/server/domain/order-stages";
import { getPickupProblem } from "@/server/domain/orders";

import { ORDER_CHANGED_MESSAGE, ORDER_NOT_FOUND_MESSAGE } from "./quotes";

// Staff confirming a pickup order's requested time, or suggesting another.
// storeId, the user, and their role come from the caller's membership (see
// src/actions/pickup-times.ts). Every rule is checked again inside the
// transaction, against the order as it is in the database.

export interface PickupTimeActor {
  storeId: string;
  userId: string;
  role: StoreRole;
  timeZone: string;
}

export type PickupTimeResult = { ok: true; message: string } | { ok: false; message: string; field?: "date" | "window" };

export const PICKUP_CHARGE_WAITING_MESSAGE =
  "Waiting for the customer to approve the pickup charge. Send another price update if they decline it.";

// Why the pickup time can't change now, or null. Shared by the page (to
// offer the buttons) and both actions. Turning pickup off in the store's
// settings doesn't matter here: it only stops new pickup orders.
export function getPickupTimeRefusal(order: Pick<PickupOrderRecord, "stage" | "fulfilmentType" | "pickupWindowStatus">, pickupChargeWaiting: boolean): string | null {
  if (order.fulfilmentType !== "PICKUP_DELIVERY") return "Only pickup & delivery orders have a pickup time.";
  if (order.stage === "QUOTE_AWAITING_APPROVAL" || pickupChargeWaiting) return PICKUP_CHARGE_WAITING_MESSAGE;
  if (order.stage === "CANCELLED") return "This order is cancelled.";
  if (order.stage !== "BOOKED") return "The pickup time is already confirmed.";
  if (order.pickupWindowStatus !== "REQUESTED" && order.pickupWindowStatus !== "PROPOSED_BY_STORE") {
    return "The pickup time is already confirmed.";
  }
  return null;
}

function checkPickupChange(order: PickupOrderRecord): string | null {
  return getPickupTimeRefusal(order, getStageOrderState(order).hasRevisionAwaitingApproval);
}

// ───────────── Confirm requested time ─────────────

export async function confirmPickupTime(actor: PickupTimeActor, orderId: string, now: Date): Promise<PickupTimeResult> {
  const outcome = await confirmRequestedPickup<string>(
    actor.storeId,
    orderId,
    (order) => {
      const refusal = checkPickupChange(order);
      if (refusal) return refusal;
      // A suggestion is waiting for the customer: only they can accept it.
      if (order.pickupWindowStatus !== "REQUESTED") return ORDER_CHANGED_MESSAGE;
      const state = { ...getStageOrderState(order), pickupWindowConfirmed: true };
      const check = canTransition("BOOKED", "PICKUP_SCHEDULED", toContext(state, actor.role, null, false));
      return check.allowed ? null : check.reason;
    },
    actor.userId,
    now,
  );
  switch (outcome.status) {
    case "CHANGED":
      return { ok: true, message: "Pickup time confirmed" };
    case "NOT_FOUND":
      return { ok: false, message: ORDER_NOT_FOUND_MESSAGE };
    case "CONFLICT":
      return { ok: false, message: ORDER_CHANGED_MESSAGE };
    case "REFUSED":
      return { ok: false, message: outcome.refusal };
  }
}

// ───────────── Suggest another time ─────────────

// The store's schedule for the "Suggest another time" dialog.
export async function loadPickupTimeOptions(storeId: string, timeZone: string, now: Date) {
  const today = getLocalDateKey(now, timeZone);
  const [settings, closedDates] = await Promise.all([getFulfilmentOptionsAndSchedule(storeId), listClosedDateKeys(storeId, today)]);
  const { activeDays, openTime, closeTime } = settings;
  return { schedule: { activeDays, openTime, closeTime }, closedDates, today };
}

const PICKUP_PROBLEM_MESSAGES = {
  DATE_IN_PAST: "Choose today or a later date.",
  INACTIVE_DAY: "The store doesn't pick up on this day. Choose another date, or turn on Outside normal schedule.",
  CLOSED_DATE: "The store is closed on this date. Choose another date, or turn on Outside normal schedule.",
  WINDOW_NOT_OFFERED: "Choose one of the store's pickup windows.",
  INVALID_TIME: "Choose a start and end time.",
  END_NOT_AFTER_START: "The end time must be after the start time.",
} as const;

// A window from the store's schedule (getPickupWindows), or "Outside normal
// schedule" with any date, a custom start and end, and a note. The order
// stays Booked until the customer accepts.
export async function suggestPickup(actor: PickupTimeActor, input: SuggestPickupInput, now: Date): Promise<PickupTimeResult> {
  const today = getLocalDateKey(now, actor.timeZone);
  const [schedule, closed] = await Promise.all([
    getFulfilmentOptionsAndSchedule(actor.storeId),
    input.outsideSchedule ? Promise.resolve(false) : isClosedDate(actor.storeId, input.date),
  ]);
  const problem = getPickupProblem(
    { date: input.date, outsideSchedule: input.outsideSchedule, windowStart: input.windowStart, windowEnd: input.windowEnd },
    { today, schedule, isClosedDate: closed },
  );
  if (problem) {
    return { ok: false, message: PICKUP_PROBLEM_MESSAGES[problem.reason], field: problem.field === "pickupDate" ? "date" : "window" };
  }

  const outcome = await suggestPickupTime<string>(
    actor.storeId,
    input.orderId,
    {
      date: fromDateKey(input.date),
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      isOutsideSchedule: input.outsideSchedule,
      note: input.outsideSchedule ? input.note : null,
    },
    checkPickupChange,
    actor.userId,
    now,
  );
  switch (outcome.status) {
    case "CHANGED":
      return { ok: true, message: "Pickup time suggested to the customer" };
    case "NOT_FOUND":
      return { ok: false, message: ORDER_NOT_FOUND_MESSAGE };
    case "CONFLICT":
      return { ok: false, message: ORDER_CHANGED_MESSAGE };
    case "REFUSED":
      return { ok: false, message: outcome.refusal };
  }
}
