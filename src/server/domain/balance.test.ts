import { describe, expect, it } from "vitest";

import type { PaymentStatus } from "@/generated/prisma/enums";

import { getBalance, type BalanceOrder } from "./balance";

const VOIDED_AT = new Date("2026-10-10T09:00:00Z");

function payment(amount: number, status: PaymentStatus = "CONFIRMED", voidedAt: Date | null = null) {
  return { amount, status, voidedAt };
}

function refund(amount: number, voidedAt: Date | null = null) {
  return { amount, voidedAt };
}

function order(overrides: Partial<BalanceOrder> = {}): BalanceOrder {
  return { stage: "IN_PROGRESS", approvedQuote: { total: 620_000 }, payments: [], refunds: [], ...overrides };
}

describe("getBalance", () => {
  it("is Outstanding when nothing has been paid", () => {
    expect(getBalance(order())).toEqual({
      state: "OUTSTANDING",
      approvedTotalKobo: 620_000,
      confirmedPaymentsKobo: 0,
      paidRefundsKobo: 0,
      balanceKobo: 620_000,
    });
  });

  it("is Outstanding when part has been paid", () => {
    expect(getBalance(order({ payments: [payment(200_000)] }))).toMatchObject({
      state: "OUTSTANDING",
      balanceKobo: 420_000,
    });
  });

  it("is Paid when confirmed payments cover the approved total", () => {
    expect(getBalance(order({ payments: [payment(500_000), payment(120_000)] }))).toMatchObject({
      state: "PAID",
      confirmedPaymentsKobo: 620_000,
      balanceKobo: 0,
    });
  });

  it("is Paid for a ₦0 order with no payments", () => {
    expect(getBalance(order({ approvedQuote: { total: 0 } }))).toMatchObject({ state: "PAID", balanceKobo: 0 });
  });

  it("is Refund owed when confirmed payments exceed the approved total", () => {
    // Paid ₦6,200, then a revision lowered the total to ₦5,000.
    expect(getBalance(order({ approvedQuote: { total: 500_000 }, payments: [payment(620_000)] }))).toMatchObject({
      state: "REFUND_OWED",
      balanceKobo: -120_000,
    });
  });

  it("counts refunds paid against the amount owed back", () => {
    const refunded = order({ approvedQuote: { total: 500_000 }, payments: [payment(620_000)] });
    expect(getBalance({ ...refunded, refunds: [refund(50_000)] })).toMatchObject({
      state: "REFUND_OWED",
      paidRefundsKobo: 50_000,
      balanceKobo: -70_000,
    });
    expect(getBalance({ ...refunded, refunds: [refund(50_000), refund(70_000)] })).toMatchObject({
      state: "PAID",
      balanceKobo: 0,
    });
  });

  it("is Awaiting quote with null totals, never 0, when no quote is approved", () => {
    expect(getBalance(order({ approvedQuote: null }))).toEqual({
      state: "AWAITING_QUOTE",
      approvedTotalKobo: null,
      confirmedPaymentsKobo: 0,
      paidRefundsKobo: 0,
      balanceKobo: null,
    });
  });

  it("still reports confirmed payments on an order awaiting a quote", () => {
    expect(getBalance(order({ approvedQuote: null, payments: [payment(100_000)] }))).toMatchObject({
      state: "AWAITING_QUOTE",
      confirmedPaymentsKobo: 100_000,
      balanceKobo: null,
    });
  });

  describe("cancelled orders", () => {
    it("turns a paid order into Refund owed", () => {
      expect(getBalance(order({ stage: "CANCELLED", payments: [payment(620_000)] }))).toEqual({
        state: "REFUND_OWED",
        approvedTotalKobo: 0,
        confirmedPaymentsKobo: 620_000,
        paidRefundsKobo: 0,
        balanceKobo: -620_000,
      });
    });

    it("is Nothing due, not Paid, once the refund is paid", () => {
      const cancelled = order({ stage: "CANCELLED", payments: [payment(620_000)], refunds: [refund(620_000)] });
      expect(getBalance(cancelled)).toMatchObject({ state: "NOTHING_DUE", balanceKobo: 0 });
    });

    it("is Nothing due, not Paid, when nothing was collected", () => {
      expect(getBalance(order({ stage: "CANCELLED" }))).toEqual({
        state: "NOTHING_DUE",
        approvedTotalKobo: 0,
        confirmedPaymentsKobo: 0,
        paidRefundsKobo: 0,
        balanceKobo: 0,
      });
    });

    it("counts the approved total as zero even without an approved quote", () => {
      expect(getBalance(order({ stage: "CANCELLED", approvedQuote: null }))).toMatchObject({
        state: "NOTHING_DUE",
        approvedTotalKobo: 0,
        balanceKobo: 0,
      });
    });
  });

  describe("what doesn't count", () => {
    it.each<PaymentStatus>(["PENDING", "FAILED", "VOIDED"])("ignores %s payments", (status) => {
      expect(getBalance(order({ payments: [payment(620_000, status)] }))).toMatchObject({
        state: "OUTSTANDING",
        confirmedPaymentsKobo: 0,
        balanceKobo: 620_000,
      });
    });

    it("ignores a confirmed payment that has been voided", () => {
      expect(getBalance(order({ payments: [payment(620_000, "CONFIRMED", VOIDED_AT)] }))).toMatchObject({
        state: "OUTSTANDING",
        confirmedPaymentsKobo: 0,
      });
    });

    it("ignores voided refunds", () => {
      const overpaid = order({ approvedQuote: { total: 500_000 }, payments: [payment(620_000)] });
      expect(getBalance({ ...overpaid, refunds: [refund(120_000, VOIDED_AT)] })).toMatchObject({
        state: "REFUND_OWED",
        paidRefundsKobo: 0,
        balanceKobo: -120_000,
      });
    });
  });
});
