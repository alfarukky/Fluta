import "server-only";

import { randomBytes } from "node:crypto";

import type { PaymentSource, PaymentStatus, StoreStatus } from "@/generated/prisma/enums";
import { isAwaitingApproval, type RevisionStatus } from "@/lib/orders";
import { getTrackingLinkStatus } from "@/lib/tokens";

import { getBalance, type BalanceOrder } from "./balance";

// The rules for paying an order online through Paystack (plan sections 3,
// 6.3, and 6.4). Pure apart from the random reference: the caller loads the
// order and its store and passes them in.

// A PENDING online attempt this recent means the customer may still be on
// Paystack's page: the order page shows "A payment is being confirmed"
// instead of Pay now, and a repeated Book and pay starts nothing new.
export const RECENT_ATTEMPT_MS = 15 * 60 * 1000;

export interface OnlinePaymentStore {
  status: StoreStatus;
  // Null: not connected, so online payment is unavailable.
  paystackSubaccountCode: string | null;
}

export interface OnlinePaymentOrder extends BalanceOrder {
  completedAt: Date | null;
  cancelledAt: Date | null;
  quoteRevisions: readonly RevisionStatus[];
}

export type OnlinePaymentRefusal =
  | "NOT_CONNECTED"
  | "STORE_UNAVAILABLE"
  | "LINK_EXPIRED"
  | "ORDER_CANCELLED"
  | "NOTHING_DUE"
  | "PRICE_UPDATE_PENDING";

export type OnlinePaymentDecision = { allowed: true; amountKobo: number } | { allowed: false; reason: OnlinePaymentRefusal };

// Whether the order can be paid online now, and how much: always the full
// balance due (3.4), never an amount the customer types.
export function canPayOnline(order: OnlinePaymentOrder, store: OnlinePaymentStore, now: Date): OnlinePaymentDecision {
  if (store.paystackSubaccountCode === null) return { allowed: false, reason: "NOT_CONNECTED" };
  if (store.status === "DEACTIVATED") return { allowed: false, reason: "STORE_UNAVAILABLE" };

  const balance = getBalance(order);
  const link = getTrackingLinkStatus(
    {
      storeStatus: store.status,
      stage: order.stage,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      paymentState: balance.state,
    },
    now,
  );
  if (link !== "VALID") return { allowed: false, reason: "LINK_EXPIRED" };
  if (order.stage === "CANCELLED") return { allowed: false, reason: "ORDER_CANCELLED" };
  // Approval comes first: paying the old total while a new one waits invites confusion.
  if (order.quoteRevisions.some(isAwaitingApproval)) return { allowed: false, reason: "PRICE_UPDATE_PENDING" };
  if (balance.balanceKobo === null || balance.balanceKobo <= 0) return { allowed: false, reason: "NOTHING_DUE" };
  return { allowed: true, amountKobo: balance.balanceKobo };
}

// Fluta's share of one online payment: the store's rate in basis points
// (100 = 1%), rounded down to whole kobo so any rounding favours the store.
export function getFlutaFeeKobo(amountKobo: number, feeBps: number): number {
  return Math.floor((amountKobo * feeBps) / 10_000);
}

// A new reference for every attempt: "FL-" and 20 random hex characters.
// It reveals nothing (no order number, store, or phone), and uses only
// characters Paystack allows (alphanumerics, "-", ".", "=").
export function generatePaystackReference(): string {
  return `FL-${randomBytes(10).toString("hex")}`;
}

export const PAYSTACK_REFERENCE_PATTERN = /^FL-[0-9a-f]{20}$/;

export interface OnlineAttempt {
  source: PaymentSource;
  status: PaymentStatus;
  createdAt: Date;
}

// The newest PENDING online attempt started within the last 15 minutes.
export function hasRecentPendingAttempt(payments: readonly OnlineAttempt[], now: Date): boolean {
  return payments.some(
    (payment) =>
      payment.source === "ONLINE" && payment.status === "PENDING" && now.getTime() - payment.createdAt.getTime() < RECENT_ATTEMPT_MS,
  );
}
