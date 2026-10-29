import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAYMENT_LIST_FILTERS,
  encodePaymentListCursor,
  paymentAmountSchema,
  paymentListCursorSchema,
  paymentListFiltersSchema,
  PAYMENT_TOTALS_LABELS,
  recordPaymentSchema,
  toPaymentListSearch,
  voidPaymentSchema,
} from "./payments";

describe("paymentAmountSchema", () => {
  it.each([
    ["1", 100],
    ["0.01", 1],
    ["5,000", 500_000],
    ["₦4,500.50", 450_050],
    ["10,000,000", 1_000_000_000],
    ["10000000.00", 1_000_000_000],
  ])("accepts %s as %i kobo", (input, kobo) => {
    expect(paymentAmountSchema.parse(input)).toBe(kobo);
  });

  it.each([
    ["", "Enter the amount paid"],
    ["   ", "Enter the amount paid"],
    ["0", "Enter an amount above ₦0"],
    ["0.00", "Enter an amount above ₦0"],
    ["10,000,000.01", "Amount must be ₦10,000,000 or less"],
    ["99999999", "Amount must be ₦10,000,000 or less"],
    ["-500", "Enter an amount in Naira, like 5,000 or 5,000.50"],
    ["5.005", "Enter an amount in Naira, like 5,000 or 5,000.50"],
    ["five", "Enter an amount in Naira, like 5,000 or 5,000.50"],
  ])("refuses %j", (input, message) => {
    const result = paymentAmountSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(message);
  });
});

describe("recordPaymentSchema", () => {
  const valid = { orderId: "order-1", clientRequestId: randomUUID(), amount: "5,000", method: "CASH" };

  it("trims text, and stores blank reference and note as null", () => {
    const parsed = recordPaymentSchema.parse({ ...valid, reference: "  TRX-1  ", note: "   " });
    expect(parsed).toMatchObject({ amount: 500_000, method: "CASH", reference: "TRX-1", note: null, confirmedExcess: null });
  });

  it("never allows the Paystack method for a store-collected payment", () => {
    const result = recordPaymentSchema.safeParse({ ...valid, method: "PAYSTACK" });
    expect(result.error?.issues[0]).toMatchObject({ path: ["method"], message: "Choose how the customer paid" });
  });

  it("limits the reference to 100 characters and the note to 200", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, reference: "r".repeat(100), note: "n".repeat(200) }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...valid, reference: "r".repeat(101) }).error?.issues[0].path).toEqual(["reference"]);
    expect(recordPaymentSchema.safeParse({ ...valid, note: "n".repeat(201) }).error?.issues[0].path).toEqual(["note"]);
  });

  it("requires the form's request ID", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, clientRequestId: "not-a-uuid" }).error?.issues[0].path).toEqual([
      "clientRequestId",
    ]);
  });
});

describe("voidPaymentSchema", () => {
  it("requires a reason of up to 200 characters", () => {
    expect(voidPaymentSchema.safeParse({ mode: "VOID_ONLY", paymentId: "p1", reason: "  " }).error?.issues[0].message).toBe(
      "Add a reason for voiding this payment",
    );
    expect(voidPaymentSchema.safeParse({ mode: "VOID_ONLY", paymentId: "p1", reason: "x".repeat(201) }).success).toBe(false);
    expect(voidPaymentSchema.parse({ mode: "VOID_ONLY", paymentId: "p1", reason: " Entered twice " })).toEqual({
      mode: "VOID_ONLY",
      paymentId: "p1",
      reason: "Entered twice",
    });
  });

  it("needs the correct payment's details and its own request ID to replace", () => {
    const parsed = voidPaymentSchema.parse({
      mode: "REPLACE",
      paymentId: "p1",
      reason: "Wrong amount",
      clientRequestId: randomUUID(),
      amount: "4,000",
      method: "POS",
    });
    expect(parsed).toMatchObject({ mode: "REPLACE", amount: 400_000, method: "POS", reference: null, note: null });
    expect(voidPaymentSchema.safeParse({ mode: "REPLACE", paymentId: "p1", reason: "Wrong amount", amount: "4,000", method: "POS" }).success).toBe(false);
  });
});

describe("payment list filters", () => {
  it("falls back to the defaults for anything invalid", () => {
    expect(paymentListFiltersSchema.parse({ date: "forever", method: "CHEQUE", source: ["ONLINE", "ONLINE"] })).toEqual(
      DEFAULT_PAYMENT_LIST_FILTERS,
    );
    expect(DEFAULT_PAYMENT_LIST_FILTERS).toEqual({ view: "payments", date: "today", method: null, source: null });
  });

  it("puts only non-default filters in the address", () => {
    expect(toPaymentListSearch(DEFAULT_PAYMENT_LIST_FILTERS)).toBe("");
    expect(toPaymentListSearch({ view: "payments", date: "7d", method: "CASH", source: "STORE_COLLECTED" })).toBe(
      "?date=7d&method=CASH&source=STORE_COLLECTED",
    );
    expect(toPaymentListSearch({ view: "refunds", date: "30d", method: null, source: null })).toBe("?view=refunds&date=30d");
  });

  it("labels the owner totals with their period and that they cover every method and source", () => {
    expect(PAYMENT_TOTALS_LABELS).toEqual({
      today: "Totals for today, all methods and sources",
      "7d": "Totals for the last 7 days, all methods and sources",
      "30d": "Totals for the last 30 days, all methods and sources",
    });
  });

  it("round-trips the cursor", () => {
    const cursor = { confirmedAt: new Date("2026-10-20T09:15:00.000Z"), id: "cmabc123" };
    expect(paymentListCursorSchema.parse(encodePaymentListCursor(cursor))).toEqual(cursor);
    expect(paymentListCursorSchema.safeParse("x.y").success).toBe(false);
  });
});
