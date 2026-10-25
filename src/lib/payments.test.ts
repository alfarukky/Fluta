import { describe, expect, it } from "vitest";

import {
  canRecordPaymentAt,
  describeBalance,
  describeChangedBalance,
  describeOverpayment,
  describePaymentRecorded,
  describePaymentVoided,
  getOverpayment,
  getSuggestedPaymentKobo,
  isOverpaymentConfirmed,
  isRecordPaymentPrimary,
} from "./payments";

describe("describeBalance", () => {
  it("shows Paid so far before a price is approved, because there is no balance yet", () => {
    expect(describeBalance({ state: "AWAITING_QUOTE", balanceKobo: null, confirmedPaymentsKobo: 500_000 })).toEqual({
      label: "Paid so far",
      value: "₦5,000",
    });
    expect(describeBalance({ state: "AWAITING_QUOTE", balanceKobo: null, confirmedPaymentsKobo: 0 })).toEqual({
      label: "Paid so far",
      value: "₦0",
    });
  });

  it("shows the balance due, refund owed, or nothing due once a price is approved", () => {
    expect(describeBalance({ state: "OUTSTANDING", balanceKobo: 250_000, confirmedPaymentsKobo: 0 })).toEqual({
      label: "Balance due",
      value: "₦2,500",
    });
    expect(describeBalance({ state: "PAID", balanceKobo: 0, confirmedPaymentsKobo: 400_000 })).toEqual({
      label: "Balance due",
      value: "₦0",
    });
    expect(describeBalance({ state: "REFUND_OWED", balanceKobo: -100_000, confirmedPaymentsKobo: 500_000 })).toEqual({
      label: "Refund owed",
      value: "₦1,000",
    });
    expect(describeBalance({ state: "NOTHING_DUE", balanceKobo: 0, confirmedPaymentsKobo: 0 })).toEqual({
      label: "Balance",
      value: "Nothing due",
    });
  });
});

describe("getSuggestedPaymentKobo", () => {
  it("pre-fills the balance due, and nothing when none is due or no price is approved", () => {
    expect(getSuggestedPaymentKobo(450_050)).toBe(450_050);
    expect(getSuggestedPaymentKobo(0)).toBeNull();
    expect(getSuggestedPaymentKobo(-100)).toBeNull();
    expect(getSuggestedPaymentKobo(null)).toBeNull();
  });
});

describe("getOverpayment", () => {
  it("is null up to the balance due", () => {
    expect(getOverpayment(500_000, 500_000)).toBeNull();
    expect(getOverpayment(500_000, 100_000)).toBeNull();
  });

  it("is null before a price is approved: a deposit is never an overpayment", () => {
    expect(getOverpayment(null, 10_000_000)).toBeNull();
  });

  it("gives the amount over the balance and what the store will owe", () => {
    expect(getOverpayment(500_000, 600_000)).toEqual({ excessKobo: 100_000, refundOwedKobo: 100_000 });
    // Already paid: every kobo is over.
    expect(getOverpayment(0, 1)).toEqual({ excessKobo: 1, refundOwedKobo: 1 });
    // Already owed a refund: the store owes that and the whole payment.
    expect(getOverpayment(-200_000, 500_000)).toEqual({ excessKobo: 500_000, refundOwedKobo: 700_000 });
  });
});

describe("isOverpaymentConfirmed", () => {
  const overpayment = { excessKobo: 100_000, refundOwedKobo: 100_000 }

  it("needs no confirmation when nothing is over", () => {
    expect(isOverpaymentConfirmed(null, null)).toBe(true);
  });

  it("needs staff to have confirmed at least this much", () => {
    expect(isOverpaymentConfirmed(overpayment, null)).toBe(false);
    expect(isOverpaymentConfirmed(overpayment, 99_999)).toBe(false);
    expect(isOverpaymentConfirmed(overpayment, 100_000)).toBe(true);
    expect(isOverpaymentConfirmed(overpayment, 150_000)).toBe(true);
  });
});

describe("overpayment wording", () => {
  it("states the excess and what the store will owe", () => {
    expect(describeOverpayment({ excessKobo: 150_000, refundOwedKobo: 150_000 })).toBe(
      "This is ₦1,500 more than the balance due. The store will owe the customer ₦1,500.",
    );
  });

  it("explains a balance that changed while the form was open", () => {
    expect(describeChangedBalance(200_000, { excessKobo: 300_000, refundOwedKobo: 300_000 })).toBe(
      "The balance has changed. ₦2,000 is now due. This payment is ₦3,000 more. Record it anyway?",
    );
    expect(describeChangedBalance(-50_000, { excessKobo: 100_000, refundOwedKobo: 150_000 })).toBe(
      "The balance has changed. ₦0 is now due. This payment is ₦1,000 more. Record it anyway?",
    );
  });
});

describe("record payment rules", () => {
  it("is the main action only when Ready or Completed with a balance due", () => {
    expect(isRecordPaymentPrimary("READY", "OUTSTANDING")).toBe(true);
    expect(isRecordPaymentPrimary("COMPLETED", "OUTSTANDING")).toBe(true);
    expect(isRecordPaymentPrimary("READY", "PAID")).toBe(false);
    expect(isRecordPaymentPrimary("IN_PROGRESS", "OUTSTANDING")).toBe(false);
    expect(isRecordPaymentPrimary("BOOKED", "AWAITING_QUOTE")).toBe(false);
  });

  it("is never allowed on a cancelled order", () => {
    expect(canRecordPaymentAt("CANCELLED")).toBe(false);
    expect(canRecordPaymentAt("BOOKED")).toBe(true);
    expect(canRecordPaymentAt("COMPLETED")).toBe(true);
  });
});

describe("timeline wording", () => {
  it("names the amount, method, and who", () => {
    const cash = { amount: 500_000, method: "CASH", source: "STORE_COLLECTED" } as const
    expect(describePaymentRecorded(cash, "Ada")).toBe("Payment recorded: ₦5,000 cash, by Ada");
    expect(describePaymentRecorded({ ...cash, method: "BANK_TRANSFER" }, null)).toBe(
      "Payment recorded: ₦5,000 bank transfer, by Staff",
    );
    expect(describePaymentVoided(cash, "Ada")).toBe("Payment voided: ₦5,000 cash, by Ada");
    const online = { amount: 620_000, method: "PAYSTACK", source: "ONLINE" } as const;
    expect(describePaymentRecorded(online, null)).toBe("Online payment received: ₦6,200 (Paystack)");
    expect(describePaymentRecorded({ ...online, receivedAfter: "CANCELLED" }, null)).toBe(
      "Online payment received: ₦6,200 (Paystack), after the order was cancelled",
    );
    expect(describePaymentRecorded({ ...online, receivedAfter: "PAID" }, null)).toBe(
      "Online payment received: ₦6,200 (Paystack), after it was paid in full",
    );
  });
});
