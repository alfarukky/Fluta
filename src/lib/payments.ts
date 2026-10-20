import type { OrderStage, PaymentMethod, PaymentSource } from "@/generated/prisma/enums";

import { formatNaira } from "./money";
import type { PaymentState } from "./orders";

// Payment wording and the small rules both the order page's forms and the
// server use. The balance itself always comes from getBalance
// (src/server/domain/balance.ts).

// What staff can record at the store. PAYSTACK is online only (Feature 17),
// and the database refuses it on a store-collected payment.
export const STORE_PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "POS", "OTHER"] as const satisfies readonly PaymentMethod[];
export type StorePaymentMethod = (typeof STORE_PAYMENT_METHODS)[number];

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  STORE_COLLECTED: "Store",
  ONLINE: "Online",
};

// How a method reads inside a sentence: "₦5,000 cash".
const METHOD_IN_SENTENCE: Record<PaymentMethod, string> = {
  CASH: "cash",
  BANK_TRANSFER: "bank transfer",
  POS: "POS",
  OTHER: "other method",
  PAYSTACK: "online",
};

// ₦10,000,000 in kobo: the most one payment can be.
export const MAX_PAYMENT_AMOUNT = 1_000_000_000;

// The balance figures getBalance works out, as the order page shows them.
export interface BalanceFigures {
  state: PaymentState;
  balanceKobo: number | null;
  confirmedPaymentsKobo: number;
}

// The payments section's last line. Until a price is approved there is no
// balance, so it shows what has been paid so far instead (a deposit).
export function describeBalance(balance: BalanceFigures): { label: string; value: string } {
  if (balance.balanceKobo === null) return { label: "Paid so far", value: formatNaira(balance.confirmedPaymentsKobo) };
  if (balance.state === "NOTHING_DUE") return { label: "Balance", value: "Nothing due" };
  if (balance.balanceKobo < 0) return { label: "Refund owed", value: formatNaira(-balance.balanceKobo) };
  return { label: "Balance due", value: formatNaira(balance.balanceKobo) };
}

// The amount the record form starts with: the balance due, or blank when
// nothing is due (or no price is approved yet).
export function getSuggestedPaymentKobo(balanceKobo: number | null): number | null {
  return balanceKobo !== null && balanceKobo > 0 ? balanceKobo : null;
}

export interface Overpayment {
  // How much the payment is above the balance due.
  excessKobo: number;
  // What the store will owe the customer once it is recorded.
  refundOwedKobo: number;
}

// How far a payment goes past the balance due, or null when it doesn't. With
// no approved price yet there is no balance, so nothing is an overpayment
// (a deposit). An order already owed a refund owes more with every payment.
export function getOverpayment(balanceKobo: number | null, amountKobo: number): Overpayment | null {
  if (balanceKobo === null) return null;
  const due = Math.max(balanceKobo, 0);
  if (amountKobo <= due) return null;
  return { excessKobo: amountKobo - due, refundOwedKobo: amountKobo - balanceKobo };
}

// Whether an overpayment staff confirmed (its excess, from the warning they
// saw) covers the one the server works out now. Confirming a smaller excess
// never covers a bigger one, so overpayments are only recorded deliberately.
export function isOverpaymentConfirmed(overpayment: Overpayment | null, confirmedExcessKobo: number | null): boolean {
  return overpayment === null || (confirmedExcessKobo !== null && overpayment.excessKobo <= confirmedExcessKobo);
}

export function describeOverpayment({ excessKobo, refundOwedKobo }: Overpayment): string {
  return `This is ${formatNaira(excessKobo)} more than the balance due. The store will owe the customer ${formatNaira(refundOwedKobo)}.`;
}

// When the balance changed while the form was open (another payment, say).
export function describeChangedBalance(balanceKobo: number, { excessKobo }: Overpayment): string {
  return `The balance has changed. ${formatNaira(Math.max(balanceKobo, 0))} is now due. This payment is ${formatNaira(excessKobo)} more. Record it anyway?`;
}

// Record payment is the main action once the order is Ready or Completed and
// money is still due. Otherwise it is a secondary action.
export function isRecordPaymentPrimary(stage: OrderStage, state: PaymentState): boolean {
  return (stage === "READY" || stage === "COMPLETED") && state === "OUTSTANDING";
}

// Payments can be recorded on any order except a cancelled one. Money owed
// back on a cancelled order is a refund (Feature 18).
export function canRecordPaymentAt(stage: OrderStage): boolean {
  return stage !== "CANCELLED";
}

export interface PaymentSummary {
  amount: number;
  method: PaymentMethod;
  source: PaymentSource;
}

// "₦5,000 cash", "₦6,200 online".
export function describePaymentAmount({ amount, method }: PaymentSummary): string {
  return `${formatNaira(amount)} ${METHOD_IN_SENTENCE[method]}`;
}

// The staff timeline's entries. `staffName` is null when unknown.
// "Payment recorded: ₦5,000 cash, by Ada", "Payment received online: ₦6,200".
export function describePaymentRecorded(payment: PaymentSummary, staffName: string | null): string {
  if (payment.source === "ONLINE") return `Payment received online: ${formatNaira(payment.amount)}`;
  return `Payment recorded: ${describePaymentAmount(payment)}, by ${staffName ?? "Staff"}`;
}

// "Payment voided: ₦5,000 cash, by Ada". The reason is shown beneath it.
export function describePaymentVoided(payment: PaymentSummary, staffName: string | null): string {
  return `Payment voided: ${describePaymentAmount(payment)}, by ${staffName ?? "Staff"}`;
}
