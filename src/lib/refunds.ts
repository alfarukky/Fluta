import type { PaymentMethod } from "@/generated/prisma/enums";

import { formatNaira } from "./money";
import { STORE_PAYMENT_METHODS } from "./payments";

// Refund wording and the small rules both the order page's forms and the
// server use. The store pays refunds back outside Fluta (cash, transfer, POS)
// and staff record them here. The balance itself always comes from getBalance
// (src/server/domain/balance.ts), which counts refunds that aren't voided.

// How a store can pay a refund back. Never PAYSTACK: Fluta doesn't use
// Paystack's refunds, and the database refuses it (Refund_method_check).
export const REFUND_METHODS = STORE_PAYMENT_METHODS;
export type RefundMethod = (typeof REFUND_METHODS)[number];

// How a method reads inside a sentence: "₦3,000 by transfer".
const REFUND_METHOD_IN_SENTENCE: Record<PaymentMethod, string> = {
  CASH: "in cash",
  BANK_TRANSFER: "by transfer",
  POS: "by POS",
  OTHER: "by another method",
  PAYSTACK: "online",
};

// The most that can be refunded now: what the store owes the customer, from
// getBalance's balance (below 0 means a refund is owed). Nothing while no
// price is approved, and nothing when the order isn't owed money back. The
// balance uses what the customer paid, so fees never reduce it.
export function getRefundableKobo(balanceKobo: number | null): number {
  return balanceKobo === null ? 0 : Math.max(0, -balanceKobo);
}

// The record form's amount check before sending (the server checks again
// against the balance as it is then).
export function describeRefundTooLarge(owedKobo: number): string {
  return `The refund can't be more than the ${formatNaira(owedKobo)} owed`;
}

// The server's answer when the refund is more than is owed now: someone else
// recorded a refund, say, while the form was open.
export function describeChangedRefundOwed(owedKobo: number): string {
  return `The amount owed has changed. ${formatNaira(owedKobo)} is now owed.`;
}

export const NOTHING_OWED_MESSAGE = "Nothing is owed to the customer now, so no refund can be recorded.";

export interface RefundSummary {
  amount: number;
  method: PaymentMethod;
}

// "₦3,000 by transfer".
export function describeRefundAmount({ amount, method }: RefundSummary): string {
  return `${formatNaira(amount)} ${REFUND_METHOD_IN_SENTENCE[method]}`;
}

// The staff timeline's entries. `staffName` is null when unknown.
// "Refund recorded: ₦3,000 by transfer, by Ada".
export function describeRefundRecorded(refund: RefundSummary, staffName: string | null): string {
  return `Refund recorded: ${describeRefundAmount(refund)}, by ${staffName ?? "Staff"}`;
}

// "Refund voided: ₦3,000 by transfer, by Ada". The reason is shown beneath it.
export function describeRefundVoided(refund: RefundSummary, staffName: string | null): string {
  return `Refund voided: ${describeRefundAmount(refund)}, by ${staffName ?? "Staff"}`;
}

// Beside an online payment that had a Fluta fee: Fluta keeps it, and the
// store's refund covers only what it pays back.
export const FLUTA_FEE_NOT_REFUNDED = "Fluta's fee on this payment isn't refunded";
