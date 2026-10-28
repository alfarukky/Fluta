import { describe, expect, it } from "vitest";

import type { BalanceOrder } from "./balance";
import { decideRefund, decideRefundVoid, REFUND_ALREADY_VOIDED_MESSAGE } from "./refunds";

const order = (overrides: Partial<BalanceOrder> = {}): BalanceOrder => ({
  stage: "COMPLETED",
  channel: "COUNTER",
  payLater: false,
  approvedQuote: { total: 1_000_000 },
  payments: [],
  refunds: [],
  ...overrides,
});

const confirmed = (amount: number) => ({ amount, status: "CONFIRMED" as const, voidedAt: null });
const refund = (amount: number, voidedAt: Date | null = null) => ({ amount, voidedAt });

describe("decideRefund", () => {
  // ₦10,000 total, ₦15,000 paid, ₦2,000 already refunded: ₦3,000 refundable.
  const overpaid = order({ payments: [confirmed(1_500_000)], refunds: [refund(200_000)] });

  it("allows a refund up to max(0, −balance), counting refunds already paid", () => {
    expect(decideRefund(overpaid, 300_000)).toEqual({ allowed: true });
    // A part refund.
    expect(decideRefund(overpaid, 100_000)).toEqual({ allowed: true });
  });

  it("refuses more than is owed now, with the new amount owed", () => {
    expect(decideRefund(overpaid, 300_001)).toEqual({
      allowed: false,
      code: "MORE_THAN_OWED",
      reason: "The amount owed has changed. ₦3,000 is now owed.",
      owedKobo: 300_000,
    });
  });

  it("judges a stale form against the balance as it is now", () => {
    // The form opened when ₦3,000 was owed; another refund of ₦1,000 was recorded since.
    const now = order({ payments: [confirmed(1_500_000)], refunds: [refund(200_000), refund(100_000)] });
    expect(decideRefund(now, 300_000)).toMatchObject({ allowed: false, code: "MORE_THAN_OWED", owedKobo: 200_000 });
  });

  it("refuses when nothing is owed: paid, outstanding, or no price yet", () => {
    for (const nothing of [
      order({ payments: [confirmed(1_000_000)] }),
      order({ payments: [confirmed(400_000)] }),
      order({ stage: "BOOKED", approvedQuote: null, payments: [confirmed(400_000)] }),
      order({ stage: "CANCELLED", payments: [confirmed(400_000)], refunds: [refund(400_000)] }),
    ]) {
      expect(decideRefund(nothing, 100)).toMatchObject({ allowed: false, code: "NOTHING_OWED", owedKobo: 0 });
    }
  });

  it("works at any stage: a cancelled paid order owes everything paid", () => {
    const cancelled = order({ stage: "CANCELLED", payments: [confirmed(600_000)] });
    expect(decideRefund(cancelled, 600_000)).toEqual({ allowed: true });
    expect(decideRefund(cancelled, 600_001)).toMatchObject({ code: "MORE_THAN_OWED", owedKobo: 600_000 });
  });

  it("never counts voided refunds or voided payments", () => {
    const withVoids = order({
      stage: "CANCELLED",
      payments: [confirmed(600_000), { amount: 900_000, status: "VOIDED", voidedAt: new Date() }],
      refunds: [refund(600_000, new Date())],
    });
    expect(decideRefund(withVoids, 600_000)).toEqual({ allowed: true });
    expect(decideRefund(withVoids, 600_001)).toMatchObject({ code: "MORE_THAN_OWED", owedKobo: 600_000 });
  });
});

describe("decideRefundVoid", () => {
  it("voids a refund that isn't voided", () => {
    expect(decideRefundVoid({ voidedAt: null, voidedByUserId: null }, "ada", false)).toEqual({ kind: "void" });
    expect(decideRefundVoid({ voidedAt: null, voidedByUserId: null }, "ada", true)).toEqual({ kind: "void" });
  });

  it("treats a retried Void only by the same owner as done", () => {
    expect(decideRefundVoid({ voidedAt: new Date(), voidedByUserId: "ada" }, "ada", false)).toEqual({ kind: "alreadyVoided" });
  });

  it("refuses a second void by someone else, or a replacement on a voided refund", () => {
    const refused = { kind: "refused", code: "ALREADY_VOIDED", reason: REFUND_ALREADY_VOIDED_MESSAGE };
    expect(decideRefundVoid({ voidedAt: new Date(), voidedByUserId: "ada" }, "kemi", false)).toEqual(refused);
    expect(decideRefundVoid({ voidedAt: new Date(), voidedByUserId: "ada" }, "ada", true)).toEqual(refused);
  });
});
