import { describe, expect, it } from "vitest";

import { RECEIPT_TEXT, describeReceiptBalance, hasActiveConfirmedPayment } from "@/lib/receipts";
import type { Receipt } from "@/types/receipts";

import { getBalance } from "./balance";
import type { QuoteSnapshotLine } from "./orders";
import { buildReceipt, type ReceiptOrder } from "./receipts";

// 30 Oct 2026, 10:42 AM in Lagos (UTC+1).
const CREATED = new Date("2026-10-30T09:42:00Z");
const DAY = 24 * 60 * 60 * 1000;

function serviceLine(description: string, quantity: number, unitPrice: number): QuoteSnapshotLine {
  return {
    lineType: "SERVICE",
    serviceId: "svc",
    description,
    pricingType: "PER_ITEM",
    requiresQuote: false,
    unitPrice,
    quantity: String(quantity),
    quantityIsEstimate: false,
    lineTotal: unitPrice * quantity,
  };
}

function otherLine(description: string, lineTotal: number): QuoteSnapshotLine {
  return {
    lineType: "ADJUSTMENT",
    serviceId: null,
    description,
    pricingType: null,
    requiresQuote: false,
    unitPrice: null,
    quantity: null,
    quantityIsEstimate: false,
    lineTotal,
  };
}

const LINES = [serviceLine("Shirt", 4, 80_000), serviceLine("Duvet", 2, 500_000), otherLine("Discount", -50_000)];

type Payment = ReceiptOrder["payments"][number];
type Refund = ReceiptOrder["refunds"][number];

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    amount: 500_000,
    method: "CASH",
    status: "CONFIRMED",
    voidedAt: null,
    confirmedAt: CREATED,
    createdAt: CREATED,
    ...overrides,
  };
}

function refund(overrides: Partial<Refund> = {}): Refund {
  return { id: "ref-1", amount: 100_000, method: "BANK_TRANSFER", voidedAt: null, paidAt: new Date(CREATED.getTime() + 2 * DAY), ...overrides };
}

// The part-paid example in the spec: ₦14,200 total, ₦5,000 paid in cash.
function order(overrides: Partial<ReceiptOrder> = {}): ReceiptOrder {
  return {
    orderNumber: 1024,
    stage: "IN_PROGRESS",
    channel: "COUNTER",
    payLater: false,
    fulfilmentType: "PICKUP_DELIVERY",
    createdAt: CREATED,
    store: {
      name: "FreshFold Laundry",
      addressText: "12 Admiralty Way, Lekki",
      phone: "+2348030001234",
      timeZone: "Africa/Lagos",
      orderPrefix: "FF",
    },
    customer: { name: "Aisha Bello", phone: "+2348031234521" },
    lines: [
      { id: "l1", description: "Shirt", quantity: "4", estimatedQuantity: null },
      { id: "l2", description: "Duvet", quantity: null, estimatedQuantity: "2" },
    ],
    approvedQuote: {
      total: 1_420_000,
      fulfilmentCharge: 150_000,
      linesSnapshot: { lines: LINES, areaName: "Lekki", isOutOfArea: false, fulfilmentCharge: 150_000 },
    },
    quoteRevisions: [{ version: 1, status: "APPROVED", approvedAt: CREATED, declinedAt: null }],
    payments: [payment()],
    refunds: [],
    ...overrides,
  };
}

// Every word the receipt shows, for checking what never appears.
function allText(receipt: Receipt): string {
  return JSON.stringify(receipt);
}

describe("buildReceipt", () => {
  it("shows the part-paid example exactly", () => {
    const receipt = buildReceipt(order(), null);
    expect(receipt.store).toEqual({ name: "FreshFold Laundry", logoUrl: null, address: "12 Admiralty Way, Lekki", phone: "+234 803 000 1234" });
    expect(receipt.cancelledNote).toBeNull();
    expect(receipt.orderNumber).toBe("Order number: FF-1024");
    expect(receipt.date).toBe("Date: 30 Oct 2026, 10:42 AM");
    expect(receipt.customer).toBe("Customer: Aisha Bello");
    expect(receipt.phone).toBe("Phone: +234 803 *** 4521");
    expect(receipt.lines.map(({ label, detail, amount }) => [label, detail, amount])).toEqual([
      ["Shirt", "4 × ₦800", "₦3,200"],
      ["Duvet", "2 × ₦5,000", "₦10,000"],
      ["Discount", null, "−₦500"],
      ["Pickup and delivery", null, "₦1,500"],
    ]);
    expect(receipt.total).toMatchObject({ label: "Total", amount: "₦14,200" });
    expect(receipt.priceNote).toBeNull();
    expect(receipt.payments.map((row) => [row.label, row.amount])).toEqual([["Paid in cash, 30 Oct 2026", "₦5,000"]]);
    expect(receipt.balance).toBe("Amount still to pay: ₦9,200");
  });

  it("shows an extra charge with its stored plus sign", () => {
    const lines = [serviceLine("Shirt", 1, 80_000), otherLine("Express service", 200_000)];
    const receipt = buildReceipt(
      order({
        fulfilmentType: "DROP_OFF",
        approvedQuote: { total: 280_000, fulfilmentCharge: 0, linesSnapshot: { lines, areaName: null, isOutOfArea: false, fulfilmentCharge: null } },
      }),
      null,
    );
    expect(receipt.lines.map((row) => [row.label, row.amount])).toEqual([
      ["Shirt", "₦800"],
      ["Express service", "+₦2,000"],
    ]);
  });

  it("takes the total from the approved revision, never from the lines", () => {
    const receipt = buildReceipt(order({ approvedQuote: { ...order().approvedQuote!, total: 9_900_000 } }), null);
    expect(receipt.total?.amount).toBe("₦99,000");
  });

  it("has no pickup line on a drop-off order", () => {
    const dropOff = buildReceipt(order({ fulfilmentType: "DROP_OFF" }), null);
    expect(dropOff.lines.map((row) => row.label)).not.toContain(RECEIPT_TEXT.pickupCharge);
  });

  it("shows a free pickup as \"Pickup and delivery: Free\"", () => {
    const lines = [serviceLine("Shirt", 4, 80_000)];
    const receipt = buildReceipt(
      order({
        approvedQuote: { total: 320_000, fulfilmentCharge: 0, linesSnapshot: { lines, areaName: "Lekki", isOutOfArea: false, fulfilmentCharge: 0 } },
        payments: [payment({ amount: 320_000 })],
      }),
      null,
    );
    expect(receipt.lines.at(-1)).toMatchObject({ label: "Pickup and delivery", amount: "Free" });
    expect(receipt.total?.amount).toBe("₦3,200");
    expect(receipt.balance).toBe("Fully paid");
  });

  it("shows kobo where an amount has it, and the rows add up to the total exactly", () => {
    // 3 × ₦1,500.50 = ₦4,501.50, a ₦0.25 discount, and ₦1,000.75 pickup: ₦5,502.
    const lines = [serviceLine("Shirt", 3, 150_050), otherLine("Loyalty discount", -25)];
    const total = 3 * 150_050 - 25 + 100_075;
    const receipt = buildReceipt(
      order({
        approvedQuote: { total, fulfilmentCharge: 100_075, linesSnapshot: { lines, areaName: "Lekki", isOutOfArea: false, fulfilmentCharge: 100_075 } },
        payments: [payment({ amount: 200_010 })],
      }),
      null,
    );
    expect(receipt.lines.map(({ label, detail, amount }) => [label, detail, amount])).toEqual([
      ["Shirt", "3 × ₦1,500.50", "₦4,501.50"],
      ["Loyalty discount", null, "−₦0.25"],
      ["Pickup and delivery", null, "₦1,000.75"],
    ]);
    const kobo = (text: string) => Math.round(Number(text.replace(/[₦,+]/g, "").replace("−", "-")) * 100);
    const rowsSum = receipt.lines.reduce((sum, row) => sum + kobo(row.amount!), 0);
    expect(rowsSum).toBe(total);
    expect(receipt.total?.amount).toBe("₦5,502");
    expect(receipt.payments[0].amount).toBe("₦2,000.10");
    expect(receipt.balance).toBe("Amount still to pay: ₦3,501.90");
  });

  it("lists active payments and refunds together in date order", () => {
    const receipt = buildReceipt(
      order({
        stage: "CANCELLED",
        payments: [
          payment({ id: "b", method: "POS", amount: 200_000, confirmedAt: new Date(CREATED.getTime() + DAY) }),
          payment({ id: "a", method: "PAYSTACK", amount: 300_000 }),
          payment({ id: "c", method: "OTHER", amount: 100_000, confirmedAt: new Date(CREATED.getTime() + 3 * DAY) }),
          payment({ id: "d", method: "BANK_TRANSFER", amount: 100_000, confirmedAt: new Date(CREATED.getTime() + 4 * DAY) }),
        ],
        refunds: [
          refund({ id: "r1", method: "BANK_TRANSFER", paidAt: new Date(CREATED.getTime() + 2 * DAY) }),
          refund({ id: "r2", method: "CASH", paidAt: new Date(CREATED.getTime() + 5 * DAY) }),
          refund({ id: "r3", method: "POS", paidAt: new Date(CREATED.getTime() + 6 * DAY) }),
          refund({ id: "r4", method: "OTHER", paidAt: new Date(CREATED.getTime() + 7 * DAY) }),
        ],
      }),
      null,
    );
    expect(receipt.payments.map((row) => row.label)).toEqual([
      "Paid online, 30 Oct 2026",
      "Paid by card (POS), 31 Oct 2026",
      "Refunded by bank transfer, 1 Nov 2026",
      "Paid (other), 2 Nov 2026",
      "Paid by bank transfer, 3 Nov 2026",
      "Refunded in cash, 4 Nov 2026",
      "Refunded by card (POS), 5 Nov 2026",
      "Refunded (other), 6 Nov 2026",
    ]);
  });

  it("never includes voided records or pending and failed online attempts", () => {
    const receipt = buildReceipt(
      order({
        payments: [
          payment(),
          payment({ id: "voided", status: "VOIDED", voidedAt: CREATED, amount: 999_900 }),
          payment({ id: "pending", method: "PAYSTACK", status: "PENDING", confirmedAt: null, amount: 888_800 }),
          payment({ id: "failed", method: "PAYSTACK", status: "FAILED", confirmedAt: null, amount: 777_700 }),
        ],
        refunds: [refund({ voidedAt: CREATED, amount: 666_600 })],
      }),
      null,
    );
    expect(receipt.payments).toHaveLength(1);
    expect(allText(receipt)).not.toMatch(/9,999|8,888|7,777|6,666/);
    expect(receipt.balance).toBe("Amount still to pay: ₦9,200");
  });

  it("shows each balance in plain words, from getBalance", () => {
    const paid = buildReceipt(order({ payments: [payment({ amount: 1_420_000 })] }), null);
    expect(paid.balance).toBe("Fully paid");
    const over = buildReceipt(order({ payments: [payment({ amount: 1_500_000 })] }), null);
    expect(over.balance).toBe("Amount to be refunded to you: ₦800");
  });

  it("keeps a cancelled order's approved total, with the balance from getBalance", () => {
    const owed = order({ stage: "CANCELLED" });
    const receipt = buildReceipt(owed, null);
    expect(receipt.cancelledNote).toBe("This order was cancelled");
    expect(receipt.total?.amount).toBe("₦14,200");
    expect(receipt.balance).toBe("Amount to be refunded to you: ₦5,000");
    expect(receipt.balance).toBe(describeReceiptBalance(getBalance(owed)));

    const settled = buildReceipt(order({ stage: "CANCELLED", refunds: [refund({ amount: 500_000 })] }), null);
    expect(settled.balance).toBe("Nothing to pay");
  });

  it("never lets a price update waiting for approval change any figure", () => {
    const pending = order({
      quoteRevisions: [
        { version: 1, status: "APPROVED", approvedAt: CREATED, declinedAt: null },
        { version: 2, status: "PENDING", approvedAt: null, declinedAt: null },
      ],
    });
    const receipt = buildReceipt(pending, null);
    const before = buildReceipt(order(), null);
    expect(receipt.priceNote).toBe(
      "The store has proposed a new price you haven't approved yet. This receipt shows the price you agreed.",
    );
    expect({ ...receipt, priceNote: null }).toEqual(before);
  });

  it("shows a deposit before approval as names and quantities only", () => {
    const receipt = buildReceipt(
      order({
        approvedQuote: null,
        quoteRevisions: [{ version: 1, status: "PENDING", approvedAt: null, declinedAt: null }],
        payments: [payment({ amount: 200_000 })],
      }),
      null,
    );
    expect(receipt.lines.map(({ label, detail, amount }) => [label, detail, amount])).toEqual([
      ["Shirt", "× 4", null],
      ["Duvet", "× 2", null],
    ]);
    expect(receipt.total).toBeNull();
    expect(receipt.balance).toBeNull();
    expect(receipt.priceNote).toBe("Final price to be confirmed by the store");
    expect(receipt.payments.map((row) => [row.label, row.amount])).toEqual([["Paid in cash, 30 Oct 2026", "₦2,000"]]);
    // Only the payment's own amount: no price or total from the working lines.
    expect(allText(receipt).match(/₦[\d,]+/g)).toEqual(["₦2,000"]);
  });

  it("never shows the full phone, an address of the customer's, or internal terms", () => {
    const text = allText(buildReceipt(order({ quoteRevisions: [{ version: 2, status: "PENDING", approvedAt: null, declinedAt: null }] }), null));
    expect(text).not.toContain("+2348031234521");
    expect(text).not.toContain("803 123 4521");
    expect(text).not.toMatch(/revision|adjustment|others|balance state|source|ADJUSTMENT|SERVICE|CONFIRMED|PAYSTACK|STORE_COLLECTED/i);
    // The receipt has no field for fees, references, notes, or staff names.
    expect(Object.keys(buildReceipt(order(), null)).sort()).toEqual(
      ["balance", "cancelledNote", "customer", "date", "lines", "orderNumber", "payments", "phone", "priceNote", "store", "total"].sort(),
    );
  });
});

describe("hasActiveConfirmedPayment", () => {
  it("needs a confirmed payment that isn't voided", () => {
    expect(hasActiveConfirmedPayment([payment()])).toBe(true);
    expect(hasActiveConfirmedPayment([])).toBe(false);
    expect(hasActiveConfirmedPayment([payment({ status: "VOIDED", voidedAt: CREATED })])).toBe(false);
    expect(hasActiveConfirmedPayment([payment({ status: "PENDING", confirmedAt: null })])).toBe(false);
    expect(hasActiveConfirmedPayment([payment({ status: "FAILED", confirmedAt: null })])).toBe(false);
  });

  it("is never satisfied by refunds alone", () => {
    // Refunds aren't payments: an order with only refunds has no payments to pass.
    expect(hasActiveConfirmedPayment(order({ payments: [], refunds: [refund()] }).payments)).toBe(false);
  });
});

describe("receipt wording", () => {
  it("matches the plain wording table exactly", () => {
    expect(RECEIPT_TEXT).toEqual({
      noPayment: "A receipt will be available once a payment is recorded",
      items: "Items",
      pickupCharge: "Pickup and delivery",
      total: "Total",
      payments: "Payments",
      cancelled: "This order was cancelled",
      pendingPriceUpdate: "The store has proposed a new price you haven't approved yet. This receipt shows the price you agreed.",
      priceToBeConfirmed: "Final price to be confirmed by the store",
      fullyPaid: "Fully paid",
      nothingToPay: "Nothing to pay",
      free: "Free",
    });
  });
});
