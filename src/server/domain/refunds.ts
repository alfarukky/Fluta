import "server-only";

import { describeChangedRefundOwed, getRefundableKobo, NOTHING_OWED_MESSAGE } from "@/lib/refunds";

import { getBalance, type BalanceOrder } from "./balance";

// The rules for recording and voiding refunds. Pure: the caller loads the
// order and refund, inside its transaction with the order locked, and passes
// them in. Eligibility depends only on the balance as it is now, never on the
// order's stage: a cancelled or completed order can be owed money back too.

export const REFUND_LIST_PAGE_SIZE = 25;

export type RefundDecision =
  | { allowed: true }
  // Nothing is owed to the customer now.
  | { allowed: false; code: "NOTHING_OWED"; reason: string; owedKobo: 0 }
  // More than is owed now (a stale form: someone else recorded a refund).
  | { allowed: false; code: "MORE_THAN_OWED"; reason: string; owedKobo: number };

// The most that can be refunded is max(0, −balance), with refunds already
// paid counted in. A replacement for a voided refund is judged the same way,
// with the voided refund left out of `order.refunds` by the caller.
export function decideRefund(order: BalanceOrder, amountKobo: number): RefundDecision {
  const owedKobo = getRefundableKobo(getBalance(order).balanceKobo);
  if (owedKobo === 0) return { allowed: false, code: "NOTHING_OWED", reason: NOTHING_OWED_MESSAGE, owedKobo: 0 };
  if (amountKobo > owedKobo) {
    return { allowed: false, code: "MORE_THAN_OWED", reason: describeChangedRefundOwed(owedKobo), owedKobo };
  }
  return { allowed: true };
}

export interface VoidableRefund {
  voidedAt: Date | null;
  voidedByUserId: string | null;
}

export type RefundVoidDecision =
  | { kind: "void" }
  // A retried "Void only" by the owner who voided it: nothing more to do.
  | { kind: "alreadyVoided" }
  | { kind: "refused"; code: "ALREADY_VOIDED"; reason: string };

export const REFUND_ALREADY_VOIDED_MESSAGE = "This refund was already voided. Refresh to see the latest.";

// Only a refund that isn't voided can be voided.
export function decideRefundVoid(refund: VoidableRefund, actorUserId: string, replacing: boolean): RefundVoidDecision {
  if (refund.voidedAt !== null) {
    if (!replacing && refund.voidedByUserId === actorUserId) return { kind: "alreadyVoided" };
    return { kind: "refused", code: "ALREADY_VOIDED", reason: REFUND_ALREADY_VOIDED_MESSAGE };
  }
  return { kind: "void" };
}
