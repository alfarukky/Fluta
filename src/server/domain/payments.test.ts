import { describe, expect, it } from "vitest";

import type { BalanceOrder } from "./balance";
import { decideStorePayment, decideVoid, getPeriodStart, ORDER_CANCELLED_MESSAGE } from "./payments";

const order = (overrides: Partial<BalanceOrder> = {}): BalanceOrder => ({
  stage: "READY",
  approvedQuote: { total: 500_000 },
  payments: [],
  refunds: [],
  ...overrides,
});

const confirmed = (amount: number) => ({ amount, status: "CONFIRMED" as const, voidedAt: null });

describe("decideStorePayment", () => {
  it("allows a payment up to the balance due without a confirmation", () => {
    expect(decideStorePayment(order(), 500_000, null)).toEqual({ allowed: true });
    expect(decideStorePayment(order({ payments: [confirmed(200_000)] }), 300_000, null)).toEqual({ allowed: true });
  });

  it("allows a deposit of any size before a price is approved", () => {
    expect(decideStorePayment(order({ stage: "BOOKED", approvedQuote: null }), 1_000_000_000, null)).toEqual({ allowed: true });
  });

  it("refuses an overpayment staff didn't confirm, with the balance as it is now", () => {
    const decision = decideStorePayment(order({ payments: [confirmed(300_000)] }), 500_000, null);
    expect(decision).toEqual({
      allowed: false,
      code: "OVERPAYMENT_UNCONFIRMED",
      reason: "The balance has changed. ₦2,000 is now due. This payment is ₦3,000 more. Record it anyway?",
      balanceKobo: 200_000,
      overpayment: { excessKobo: 300_000, refundOwedKobo: 300_000 },
    });
  });

  it("refuses when the confirmed excess is smaller than the real one, and allows it once covered", () => {
    const stale = order({ payments: [confirmed(300_000)] });
    expect(decideStorePayment(stale, 500_000, 100_000)).toMatchObject({ allowed: false, code: "OVERPAYMENT_UNCONFIRMED" });
    expect(decideStorePayment(stale, 500_000, 300_000)).toEqual({ allowed: true });
  });

  it("never counts voided payments", () => {
    const voided = { amount: 500_000, status: "VOIDED" as const, voidedAt: new Date() };
    expect(decideStorePayment(order({ payments: [voided] }), 500_000, null)).toEqual({ allowed: true });
  });

  it("refuses a cancelled order, but allows a correction there", () => {
    const cancelled = order({ stage: "CANCELLED" });
    expect(decideStorePayment(cancelled, 100, null)).toEqual({
      allowed: false,
      code: "ORDER_CANCELLED",
      reason: ORDER_CANCELLED_MESSAGE,
    });
    // A cancelled order owes nothing, so the correct amount is a confirmed overpayment.
    expect(decideStorePayment(cancelled, 100, 100, { replacing: true })).toEqual({ allowed: true });
  });
});

describe("decideVoid", () => {
  const payment = { source: "STORE_COLLECTED" as const, status: "CONFIRMED" as const, voidedByUserId: null };

  it("voids a confirmed store-collected payment", () => {
    expect(decideVoid(payment, "owner-1", false)).toEqual({ kind: "void" });
    expect(decideVoid(payment, "owner-1", true)).toEqual({ kind: "void" });
  });

  it("never voids an online payment", () => {
    expect(decideVoid({ ...payment, source: "ONLINE" }, "owner-1", false)).toMatchObject({ kind: "refused", code: "ONLINE_PAYMENT" });
  });

  it("treats the same owner's retried Void only as done, and refuses anyone else", () => {
    const voided = { ...payment, status: "VOIDED" as const, voidedByUserId: "owner-1" };
    expect(decideVoid(voided, "owner-1", false)).toEqual({ kind: "alreadyVoided" });
    expect(decideVoid(voided, "owner-2", false)).toMatchObject({ kind: "refused", code: "ALREADY_VOIDED" });
    // A replacement retry is matched by its request ID before this.
    expect(decideVoid(voided, "owner-1", true)).toMatchObject({ kind: "refused", code: "ALREADY_VOIDED" });
  });

  it("refuses pending or failed payments", () => {
    expect(decideVoid({ ...payment, status: "PENDING" }, "owner-1", false)).toMatchObject({ code: "NOT_CONFIRMED" });
    expect(decideVoid({ ...payment, status: "FAILED" }, "owner-1", false)).toMatchObject({ code: "NOT_CONFIRMED" });
  });
});

describe("getPeriodStart", () => {
  // 20 Oct 2026, 00:30 in Lagos (UTC+1): still the 19th in UTC.
  const now = new Date("2026-10-19T23:30:00.000Z");

  it("counts calendar days in the store's time zone", () => {
    expect(getPeriodStart("today", "Africa/Lagos", now)).toEqual(new Date("2026-10-19T23:00:00.000Z"));
    expect(getPeriodStart("7d", "Africa/Lagos", now)).toEqual(new Date("2026-10-13T23:00:00.000Z"));
    expect(getPeriodStart("30d", "Africa/Lagos", now)).toEqual(new Date("2026-09-20T23:00:00.000Z"));
  });
});
