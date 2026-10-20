import "server-only";

import type { PaymentSource, PaymentStatus } from "@/generated/prisma/enums";
import {
  canRecordPaymentAt,
  describeChangedBalance,
  getOverpayment,
  isOverpaymentConfirmed,
  type Overpayment,
} from "@/lib/payments";
import { addDaysToDateKey, getLocalDateKey, startOfLocalDay } from "@/lib/time";
import type { PaymentDateRange, PaymentListFilters } from "@/schemas/payments";
import type { PaymentListCursor, PaymentListQuery } from "@/types/payments";

import { getBalance, type BalanceOrder } from "./balance";

// The rules for recording and voiding store-collected payments. Pure: the
// caller loads the order and payment, inside its transaction, and passes them in.

export const PAYMENT_LIST_PAGE_SIZE = 25;

export const ORDER_CANCELLED_MESSAGE =
  "Payments can't be recorded on a cancelled order. Money owed back is handled as a refund.";

export type PaymentDecision =
  | { allowed: true }
  | { allowed: false; code: "ORDER_CANCELLED"; reason: string }
  // The payment is more than the balance due now, and staff didn't confirm
  // that much: the form shows the new balance and asks again.
  | { allowed: false; code: "OVERPAYMENT_UNCONFIRMED"; reason: string; balanceKobo: number; overpayment: Overpayment };

// Whether a store-collected payment of `amountKobo` may be recorded on this
// order, judged on the balance as it is now (getBalance). A correct payment
// recorded in place of a voided one (`replacing`) corrects a record, so it is
// allowed on a cancelled order too. The caller leaves the voided payment out
// of `order.payments`.
export function decideStorePayment(
  order: BalanceOrder,
  amountKobo: number,
  confirmedExcessKobo: number | null,
  { replacing = false }: { replacing?: boolean } = {},
): PaymentDecision {
  if (!replacing && !canRecordPaymentAt(order.stage)) {
    return { allowed: false, code: "ORDER_CANCELLED", reason: ORDER_CANCELLED_MESSAGE };
  }
  const { balanceKobo } = getBalance(order);
  const overpayment = getOverpayment(balanceKobo, amountKobo);
  if (overpayment && balanceKobo !== null && !isOverpaymentConfirmed(overpayment, confirmedExcessKobo)) {
    return {
      allowed: false,
      code: "OVERPAYMENT_UNCONFIRMED",
      reason: describeChangedBalance(balanceKobo, overpayment),
      balanceKobo,
      overpayment,
    };
  }
  return { allowed: true };
}

export interface VoidablePayment {
  source: PaymentSource;
  status: PaymentStatus;
  voidedByUserId: string | null;
}

export type VoidRefusalCode = "ONLINE_PAYMENT" | "ALREADY_VOIDED" | "NOT_CONFIRMED";

export type VoidDecision =
  | { kind: "void" }
  // A retried "Void only" by the owner who voided it: nothing more to do.
  | { kind: "alreadyVoided" }
  | { kind: "refused"; code: VoidRefusalCode; reason: string };

export const ALREADY_VOIDED_MESSAGE = "This payment was already voided. Refresh to see the latest.";

// Only a confirmed, store-collected payment can be voided. A mistaken online
// payment is handled as a refund (Feature 18).
export function decideVoid(payment: VoidablePayment, actorUserId: string, replacing: boolean): VoidDecision {
  if (payment.source !== "STORE_COLLECTED") {
    return {
      kind: "refused",
      code: "ONLINE_PAYMENT",
      reason: "Online payments can't be voided. A mistaken online payment is handled as a refund.",
    };
  }
  if (payment.status === "VOIDED") {
    if (!replacing && payment.voidedByUserId === actorUserId) return { kind: "alreadyVoided" };
    return { kind: "refused", code: "ALREADY_VOIDED", reason: ALREADY_VOIDED_MESSAGE };
  }
  if (payment.status !== "CONFIRMED") {
    return { kind: "refused", code: "NOT_CONFIRMED", reason: "Only confirmed payments can be voided." };
  }
  return { kind: "void" };
}

// Days before today included by each date filter.
const RANGE_DAYS_BEFORE_TODAY: Record<PaymentDateRange, number> = { today: 0, "7d": 6, "30d": 29 };

// The start of the chosen period: calendar days in the store's time zone
// (today, plus the 6 or 29 days before), converted to UTC only here.
export function getPeriodStart(range: PaymentDateRange, timeZone: string, now: Date): Date {
  const today = getLocalDateKey(now, timeZone);
  return startOfLocalDay(addDaysToDateKey(today, -RANGE_DAYS_BEFORE_TODAY[range]), timeZone);
}

// The page's filters as a list query. Payments are listed, filtered, and
// paged by when they were confirmed, so each counts on the day it was received.
export function buildPaymentListQuery(
  filters: PaymentListFilters,
  timeZone: string,
  now: Date,
  after: PaymentListCursor | null = null,
): PaymentListQuery {
  return {
    confirmedFrom: getPeriodStart(filters.date, timeZone, now),
    method: filters.method,
    source: filters.source,
    after,
  };
}
