import "server-only";

import type { OrderStage, PaymentStatus } from "@/generated/prisma/enums";
import type { PaymentState } from "@/lib/orders";

export type { PaymentState };

// An order's balance and payment state: the one place they are worked out.
// Payment state is derived, never stored:
//   balance = approved total − confirmed payments + refunds paid
// Paid at 0, Outstanding above 0, Refund owed below 0. Voided payments and
// refunds never count. A cancelled order owes nothing, so whatever was
// collected (less refunds paid) becomes Refund owed; at 0 it is Nothing due,
// never Paid.
//
// The orders list's payment filter mirrors this rule in SQL
// (src/server/data/orders.ts); an integration test keeps the two in step.

export interface BalanceOrder {
  stage: OrderStage;
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
  const confirmedPaymentsKobo = sum(
    order.payments.filter((payment) => payment.status === "CONFIRMED" && payment.voidedAt === null),
  );
  const paidRefundsKobo = sum(order.refunds.filter((refund) => refund.voidedAt === null));

  const approvedTotalKobo = order.stage === "CANCELLED" ? 0 : (order.approvedQuote?.total ?? null);
  // No approved quote yet (an unweighed per-kg order, say): there is no
  // balance, and none is ever worked out from estimates.
  if (approvedTotalKobo === null) {
    return { state: "AWAITING_QUOTE", approvedTotalKobo: null, confirmedPaymentsKobo, paidRefundsKobo, balanceKobo: null };
  }

  const balanceKobo = approvedTotalKobo - confirmedPaymentsKobo + paidRefundsKobo;
  const settled = order.stage === "CANCELLED" ? "NOTHING_DUE" : "PAID";
  const state = balanceKobo === 0 ? settled : balanceKobo > 0 ? "OUTSTANDING" : "REFUND_OWED";
  return { state, approvedTotalKobo, confirmedPaymentsKobo, paidRefundsKobo, balanceKobo };
}

function sum(records: readonly { amount: number }[]): number {
  return records.reduce((total, record) => total + record.amount, 0);
}
