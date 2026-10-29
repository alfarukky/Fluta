import "server-only";

import type { OrderChannel, OrderStage, PaymentStatus } from "@/generated/prisma/enums";
import type { PaymentState } from "@/lib/orders";

export type { PaymentState };

// An order's balance and payment state: the one place they are worked out.
// Payment state is derived, never stored:
//   balance = approved total − confirmed payments + refunds paid
// Paid at 0, Refund owed below 0. Above 0 it is Outstanding, unless:
//   - a payment has started online but isn't confirmed yet: Pending
//   - an online booking meant to be paid at booking (payLater false) has no
//     confirmed payment yet and is still open: Payment required
// Staff-entered orders (counter, phone, WhatsApp) are never Payment
// required: those customers were never asked to pay online. Pending and
// failed payments never count, so they never change the balance. Voided
// payments and refunds never count. A cancelled order owes nothing, so
// whatever was collected (less refunds paid) becomes Refund owed; at 0 it is
// Nothing due, never Paid.
//
// The orders list's payment filter mirrors this rule in SQL
// (src/server/data/orders.ts); an integration test keeps the two in step.

export interface BalanceOrder {
  stage: OrderStage;
  channel: OrderChannel;
  payLater: boolean;
  approvedQuote: { total: number } | null;
  payments: readonly { amount: number; status: PaymentStatus; voidedAt: Date | null }[];
  refunds: readonly { amount: number; voidedAt: Date | null }[];
}

export type Balance =
  | {
      state: "AWAITING_QUOTE";
      approvedTotalKobo: null;
      confirmedPaymentsKobo: number;
      paidRefundsKobo: number;
      balanceKobo: null;
    }
  | {
      state: Exclude<PaymentState, "AWAITING_QUOTE">;
      approvedTotalKobo: number;
      confirmedPaymentsKobo: number;
      paidRefundsKobo: number;
      balanceKobo: number;
    };

export function getBalance(order: BalanceOrder): Balance {
  const confirmed = order.payments.filter((payment) => payment.status === "CONFIRMED" && payment.voidedAt === null);
  const confirmedPaymentsKobo = sum(confirmed);
  const paidRefundsKobo = sum(order.refunds.filter((refund) => refund.voidedAt === null));

  const approvedTotalKobo = order.stage === "CANCELLED" ? 0 : (order.approvedQuote?.total ?? null);
  // No approved quote yet (a quote-required item still to be priced, say): there is no
  // balance, and none is ever worked out from estimates.
  if (approvedTotalKobo === null) {
    return { state: "AWAITING_QUOTE", approvedTotalKobo: null, confirmedPaymentsKobo, paidRefundsKobo, balanceKobo: null };
  }

  const balanceKobo = approvedTotalKobo - confirmedPaymentsKobo + paidRefundsKobo;
  const state = balanceKobo === 0 ? settledState(order) : balanceKobo > 0 ? dueState(order, confirmed.length) : "REFUND_OWED";
  return { state, approvedTotalKobo, confirmedPaymentsKobo, paidRefundsKobo, balanceKobo };
}

function settledState(order: BalanceOrder): "PAID" | "NOTHING_DUE" {
  return order.stage === "CANCELLED" ? "NOTHING_DUE" : "PAID";
}

// Money is due: which kind of due.
function dueState(order: BalanceOrder, confirmedCount: number): "PENDING" | "PAYMENT_REQUIRED" | "OUTSTANDING" {
  // Only online payments are ever PENDING (store-collected ones are recorded
  // confirmed).
  if (order.payments.some((payment) => payment.status === "PENDING")) return "PENDING";
  const open = order.stage !== "COMPLETED" && order.stage !== "CANCELLED";
  if (order.channel === "ONLINE" && !order.payLater && confirmedCount === 0 && open) return "PAYMENT_REQUIRED";
  return "OUTSTANDING";
}

function sum(records: readonly { amount: number }[]): number {
  return records.reduce((total, record) => total + record.amount, 0);
}
