import { describe, expect, it } from "vitest";

import {
  canPayOnline,
  checkPaystackTransaction,
  isMismatchCode,
  MISMATCH_CODES,
  generatePaystackReference,
  getFlutaFeeKobo,
  hasRecentPendingAttempt,
  PAYSTACK_REFERENCE_PATTERN,
  RECENT_ATTEMPT_MS,
  type OnlinePaymentOrder,
  type OnlinePaymentStore,
} from "./online-payment";

const NOW = new Date("2026-10-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const CONNECTED: OnlinePaymentStore = { status: "ACTIVE", paystackSubaccountCode: "ACCT_fake1" };

function order(overrides: Partial<OnlinePaymentOrder> = {}): OnlinePaymentOrder {
  return {
    stage: "BOOKED",
    channel: "ONLINE",
    payLater: true,
    approvedQuote: { total: 620_000 },
    payments: [],
    refunds: [],
    completedAt: null,
    cancelledAt: null,
    quoteRevisions: [{ version: 1, status: "APPROVED", approvedAt: NOW, declinedAt: null }],
    ...overrides,
  };
}

describe("canPayOnline", () => {
  it("allows the full balance due at a connected store", () => {
    expect(canPayOnline(order(), CONNECTED, NOW)).toEqual({ allowed: true, amountKobo: 620_000 });
  });

  it("asks only for what is still owed after part payments", () => {
    const paid = order({ payments: [{ amount: 200_000, status: "CONFIRMED", voidedAt: null }] });
    expect(canPayOnline(paid, CONNECTED, NOW)).toEqual({ allowed: true, amountKobo: 420_000 });
  });

  it("never counts pending or failed attempts as paid", () => {
    const attempts = order({
      payments: [
        { amount: 620_000, status: "PENDING", voidedAt: null },
        { amount: 620_000, status: "FAILED", voidedAt: null },
      ],
    });
    expect(canPayOnline(attempts, CONNECTED, NOW)).toEqual({ allowed: true, amountKobo: 620_000 });
  });

  it("refuses a store that isn't connected", () => {
    expect(canPayOnline(order(), { status: "ACTIVE", paystackSubaccountCode: null }, NOW)).toEqual({
      allowed: false,
      reason: "NOT_CONNECTED",
    });
  });

  it("refuses a Deactivated store, but allows a Paused one", () => {
    expect(canPayOnline(order(), { ...CONNECTED, status: "DEACTIVATED" }, NOW)).toMatchObject({ reason: "STORE_UNAVAILABLE" });
    expect(canPayOnline(order(), { ...CONNECTED, status: "PAUSED" }, NOW)).toMatchObject({ allowed: true });
  });

  it("refuses a cancelled order", () => {
    const cancelled = order({ stage: "CANCELLED", cancelledAt: NOW });
    expect(canPayOnline(cancelled, CONNECTED, NOW)).toMatchObject({ reason: "ORDER_CANCELLED" });
  });

  it("allows a completed order with a balance due while its link works", () => {
    const completed = order({ stage: "COMPLETED", completedAt: new Date(NOW.getTime() - DAY) });
    expect(canPayOnline(completed, CONNECTED, NOW)).toEqual({ allowed: true, amountKobo: 620_000 });
  });

  it("refuses once the link has expired", () => {
    const old = order({ stage: "COMPLETED", completedAt: new Date(NOW.getTime() - 31 * DAY) });
    expect(canPayOnline(old, CONNECTED, NOW)).toMatchObject({ reason: "LINK_EXPIRED" });
  });

  it("refuses when nothing is due, or there is no approved price yet", () => {
    const paid = order({ payments: [{ amount: 620_000, status: "CONFIRMED", voidedAt: null }] });
    expect(canPayOnline(paid, CONNECTED, NOW)).toMatchObject({ reason: "NOTHING_DUE" });
    const unpriced = order({ approvedQuote: null, quoteRevisions: [{ version: 1, status: "PENDING", approvedAt: null, declinedAt: null }] });
    expect(canPayOnline(unpriced, CONNECTED, NOW)).toMatchObject({ reason: "NOTHING_DUE" });
  });

  it("refuses while a price update waits for the customer's approval", () => {
    const pending = order({
      quoteRevisions: [
        { version: 2, status: "PENDING", approvedAt: null, declinedAt: null },
        { version: 1, status: "APPROVED", approvedAt: NOW, declinedAt: null },
      ],
    });
    expect(canPayOnline(pending, CONNECTED, NOW)).toMatchObject({ reason: "PRICE_UPDATE_PENDING" });
  });
});

describe("getFlutaFeeKobo", () => {
  it("is nothing at 0%", () => {
    expect(getFlutaFeeKobo(620_000, 0)).toBe(0);
  });

  it("works out the rate in basis points", () => {
    expect(getFlutaFeeKobo(620_000, 150)).toBe(9_300);
  });

  it("takes 5% at the 500 bps cap", () => {
    expect(getFlutaFeeKobo(620_000, 500)).toBe(31_000);
    expect(getFlutaFeeKobo(80_001, 500)).toBe(4_000); // 4,000.05
  });

  it("rounds down, in the store's favour", () => {
    expect(getFlutaFeeKobo(999, 150)).toBe(14); // 14.985
    expect(getFlutaFeeKobo(160_033, 150)).toBe(2_400); // 2,400.495
    expect(getFlutaFeeKobo(1, 500)).toBe(0);
  });
});

describe("generatePaystackReference", () => {
  it("is FL- and 20 hex characters, new every time", () => {
    const first = generatePaystackReference();
    expect(first).toMatch(PAYSTACK_REFERENCE_PATTERN);
    expect(generatePaystackReference()).not.toBe(first);
  });
});

describe("hasRecentPendingAttempt", () => {
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);

  it("is true for an online attempt still pending under 15 minutes old", () => {
    expect(hasRecentPendingAttempt([{ source: "ONLINE", status: "PENDING", createdAt: at(60_000) }], NOW)).toBe(true);
  });

  it("is false once the attempt is 15 minutes old, failed, or confirmed", () => {
    expect(hasRecentPendingAttempt([{ source: "ONLINE", status: "PENDING", createdAt: at(RECENT_ATTEMPT_MS) }], NOW)).toBe(false);
    expect(hasRecentPendingAttempt([{ source: "ONLINE", status: "FAILED", createdAt: at(60_000) }], NOW)).toBe(false);
    expect(hasRecentPendingAttempt([{ source: "ONLINE", status: "CONFIRMED", createdAt: at(60_000) }], NOW)).toBe(false);
  });

  it("ignores store-collected payments", () => {
    expect(hasRecentPendingAttempt([{ source: "STORE_COLLECTED", status: "PENDING", createdAt: at(60_000) }], NOW)).toBe(false);
  });
});

describe("checkPaystackTransaction", () => {
  const expected = { amountKobo: 620_000, paystackReference: "FL-0123456789abcdef0123", subaccountCode: "ACCT_store", mode: "test" as const };
  const txn = {
    status: "success",
    reference: expected.paystackReference,
    amountKobo: 620_000,
    currency: "NGN",
    domain: "test" as const,
    subaccountCode: "ACCT_store",
  };

  it("confirms a transaction that matches in every way", () => {
    expect(checkPaystackTransaction(expected, txn)).toEqual({ ok: true });
  });

  it.each([
    ["a status other than success", { status: "abandoned" }, "NOT_SUCCESSFUL"],
    ["another reference", { reference: "FL-ffffffffffffffffffff" }, "OTHER_REFERENCE"],
    ["the other mode", { domain: "live" as const }, "MODE_MISMATCH"],
    ["another currency", { currency: "USD" }, "CURRENCY_MISMATCH"],
    ["a different amount", { amountKobo: 619_999 }, "AMOUNT_MISMATCH"],
    ["another store's subaccount", { subaccountCode: "ACCT_other" }, "SUBACCOUNT_MISMATCH"],
    ["no subaccount", { subaccountCode: null }, "SUBACCOUNT_MISMATCH"],
  ])("refuses %s", (_, change, reason) => {
    expect(checkPaystackTransaction(expected, { ...txn, ...change })).toEqual({ ok: false, reason });
  });

  it("refuses when the store is no longer connected", () => {
    expect(checkPaystackTransaction({ ...expected, subaccountCode: null }, txn)).toEqual({ ok: false, reason: "SUBACCOUNT_MISMATCH" });
  });

  it("knows the mismatch codes, and only those", () => {
    expect(MISMATCH_CODES.every((code) => isMismatchCode(code))).toBe(true);
    expect(isMismatchCode("PAYSTACK_ABANDONED")).toBe(false);
    expect(isMismatchCode(null)).toBe(false);
  });
});
