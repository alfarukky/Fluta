import "server-only";

import { randomBytes } from "node:crypto";

import type { PaymentSource, PaymentStatus, StoreStatus } from "@/generated/prisma/enums";
import { isAwaitingApproval, type RevisionStatus } from "@/lib/orders";
import { isMismatchCode, MISMATCH_CODES, type MismatchCode } from "@/lib/online-payment";
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

// ───────────── Confirming a payment (plan 6.6 and 6.8) ─────────────

export { isMismatchCode, MISMATCH_CODES, type MismatchCode };

export interface ExpectedTransaction {
  // The Payment as saved before Paystack was called.
  amountKobo: number;
  paystackReference: string;
  // The store's subaccount now. Null if the store was disconnected since.
  subaccountCode: string | null;
  // PAYSTACK_MODE: a test payment never confirms in live mode, or the reverse.
  mode: "test" | "live";
}

export interface ReportedTransaction {
  status: string;
  reference: string;
  amountKobo: number;
  currency: string;
  domain: "test" | "live";
  subaccountCode: string | null;
}

export type TransactionCheck =
  | { ok: true }
  // Not (yet) paid: nothing to confirm, and nothing wrong.
  | { ok: false; reason: "NOT_SUCCESSFUL" | "OTHER_REFERENCE" }
  // Paid, but not what Fluta asked for: recorded for review.
  | { ok: false; reason: MismatchCode };

// Whether Paystack's transaction confirms this payment. Every check must pass:
// status success, the same reference, the exact amount in kobo, NGN, the
// mode Fluta runs in, and the store's own subaccount (Paystack always sends
// it for a split payment, Phase 3 fixtures, so a missing one doesn't match).
export function checkPaystackTransaction(expected: ExpectedTransaction, txn: ReportedTransaction): TransactionCheck {
  if (txn.status !== "success") return { ok: false, reason: "NOT_SUCCESSFUL" };
  if (txn.reference !== expected.paystackReference) return { ok: false, reason: "OTHER_REFERENCE" };
  if (txn.domain !== expected.mode) return { ok: false, reason: "MODE_MISMATCH" };
  if (txn.currency !== "NGN") return { ok: false, reason: "CURRENCY_MISMATCH" };
  if (txn.amountKobo !== expected.amountKobo) return { ok: false, reason: "AMOUNT_MISMATCH" };
  if (txn.subaccountCode === null || txn.subaccountCode !== expected.subaccountCode) {
    return { ok: false, reason: "SUBACCOUNT_MISMATCH" };
  }
  return { ok: true };
}

// The reconciliation job (plan 7.1) checks attempts PENDING for 30 minutes,
// started in the last 48 hours; older ones are failed without asking.
export const RECONCILE_AFTER_MS = 30 * 60 * 1000;
export const RECONCILE_UNTIL_MS = 48 * 60 * 60 * 1000;
export const RECONCILE_BATCH = 20;

// Failure codes for attempts that never completed. Not mismatches, so a late
// success from Paystack still confirms them.
export const ATTEMPT_FAILURE_CODES = { abandoned: "PAYSTACK_ABANDONED", failed: "PAYSTACK_FAILED", expired: "EXPIRED" } as const;
