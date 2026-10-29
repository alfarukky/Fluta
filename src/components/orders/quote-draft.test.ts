import { describe, expect, it } from "vitest";

import type { OrderEntryArea, OrderEntryService, QuoteEditorData } from "@/types/orders";

import { OUT_OF_AREA } from "./order-draft";
import {
  addQuoteService,
  CURRENT_AREA,
  initialQuoteDraft,
  reviewQuoteDraft,
  toIssueRevisionRequest,
  validateQuotePrices,
  type QuoteDraft,
} from "./quote-draft";

const EDITOR: QuoteEditorData = {
  orderId: "o1",
  displayNumber: "FF-1001",
  stage: "IN_PROGRESS",
  fulfilmentType: "PICKUP_DELIVERY",
  latestVersion: 2,
  lines: [
    // Added at ₦700; the catalogue says ₦800 today.
    { id: "l1", name: "Shirt", pricingType: "PER_ITEM", requiresQuote: false, unitPrice: 70_000, quantity: 3, estimate: null },
    { id: "l2", name: "Duvet", pricingType: "PER_ITEM", requiresQuote: true, unitPrice: 150_000, quantity: null, estimate: 2 },
  ],
  adjustments: [{ description: "Loyalty discount", amount: -20_000 }],
  pickup: { areaName: "Wuse 2", isOutOfArea: false, chargeEntered: false, charge: 150_000 },
  approvedTotal: 340_000,
  hasPendingRevision: false,
  reasonRequired: true,
};
const SHIRT: OrderEntryService = { id: "shirt", name: "Shirt", category: null, pricingType: "PER_ITEM", price: 80_000, requiresQuote: false };
const GOWN: OrderEntryService = { id: "gown", name: "Wedding gown", category: null, pricingType: "PER_ITEM", price: 0, requiresQuote: true };

// The draft with one line changed.
function withLine(draft: QuoteDraft, key: string, update: Partial<QuoteDraft["lines"][number]>): QuoteDraft {
  return { ...draft, lines: draft.lines.map((line) => (line.key === key ? { ...line, ...update } : line)) };
}
const AREAS: OrderEntryArea[] = [
  { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED", fixedCharge: null },
  { id: "garki", name: "Garki", chargeType: "FIXED", fixedCharge: 100_000 },
];

describe("the edit-quote draft", () => {
  it("starts from the order's lines, Others, and charge", () => {
    const draft = initialQuoteDraft(EDITOR);
    expect(draft.lines.map((line) => [line.name, line.unitPrice, line.quantity])).toEqual([
      ["Shirt", 70_000, "3"],
      ["Duvet", 150_000, ""],
    ]);
    expect(draft.adjustments).toEqual([{ key: "adjustment-0", description: "Loyalty discount", kind: "DISCOUNT", amount: "200" }]);
    expect(draft).toMatchObject({ areaChoice: CURRENT_AREA, charge: "1,500", reason: "" });
  });

  it("adds a service as a new line at today's price, leaving the existing line's price alone", () => {
    const draft = initialQuoteDraft(EDITOR);
    const once = addQuoteService(draft.lines, SHIRT, "k1");
    const twice = addQuoteService(once, SHIRT, "k2");
    expect(twice.map((line) => [line.name, line.unitPrice, line.quantity, line.source.kind])).toEqual([
      ["Shirt", 70_000, "3", "existing"],
      ["Duvet", 150_000, "", "existing"],
      ["Shirt", 80_000, "2", "new"],
    ]);
  });

  it("previews the total and the difference from the last approved total", () => {
    const draft = initialQuoteDraft(EDITOR);
    const counted = { ...draft, lines: draft.lines.map((line) => (line.key === "l2" ? { ...line, quantity: "4" } : line)) };
    expect(reviewQuoteDraft(draft, EDITOR, AREAS)).toMatchObject({ fullyPriced: false });
    // ₦2,100 + ₦6,000 − ₦200 + ₦1,500 = ₦9,400, ₦6,000 more than ₦3,400.
    expect(reviewQuoteDraft(counted, EDITOR, AREAS)).toMatchObject({ total: 940_000, difference: 600_000, fullyPriced: true, charge: 150_000 });
    // A fixed area's own charge, or the typed one for a quote-required area.
    expect(reviewQuoteDraft({ ...counted, areaChoice: "garki" }, EDITOR, AREAS).charge).toBe(100_000);
    expect(reviewQuoteDraft({ ...counted, areaChoice: "maitama", charge: "" }, EDITOR, AREAS)).toMatchObject({ charge: null, fullyPriced: false });
  });

  it("sends IDs, quantities, the area choice, and a price only for quote-required lines", () => {
    const draft = { ...initialQuoteDraft(EDITOR), areaChoice: OUT_OF_AREA, outOfAreaName: "Kubwa", charge: "3,000", reason: "Moved house" };
    const lines = addQuoteService(draft.lines, SHIRT, "k1");
    expect(toIssueRevisionRequest({ ...draft, lines }, EDITOR, AREAS)).toEqual({
      orderId: "o1",
      basedOnVersion: 2,
      lines: [
        { kind: "existing", lineId: "l1", quantity: "3" },
        { kind: "existing", lineId: "l2", quantity: "", unitPrice: "1,500" },
        { kind: "new", serviceId: "shirt", quantity: "1" },
      ],
      adjustments: [{ description: "Loyalty discount", kind: "DISCOUNT", amount: "200" }],
      area: { kind: "outOfArea", name: "Kubwa" },
      charge: "3,000",
      reason: "Moved house",
    });
    // A fixed area: no charge is sent at all.
    expect(toIssueRevisionRequest({ ...draft, areaChoice: CURRENT_AREA }, EDITOR, AREAS).charge).toBe("");
  });

  describe("pricing quote-required lines", () => {
    it("pre-fills a quote-required line's price, and leaves fixed-price lines without one", () => {
      const draft = initialQuoteDraft(EDITOR);
      expect(draft.lines.map((line) => [line.name, line.requiresQuote, line.price])).toEqual([
        ["Shirt", false, ""],
        ["Duvet", true, "1,500"],
      ]);
      // "Price on inspection" starts at ₦0.
      const gown = addQuoteService(draft.lines, GOWN, "k1").at(-1);
      expect(gown).toMatchObject({ requiresQuote: true, unitPrice: 0, price: "0", quantity: "1" });
    });

    it("previews line and order totals from the typed unit price × the quantity", () => {
      const counted = withLine(initialQuoteDraft(EDITOR), "l2", { quantity: "4", price: "₦2,000" });
      const draft = { ...counted, lines: addQuoteService(counted.lines, GOWN, "k1") };
      const priced = withLine(draft, "k1", { price: "45,000" });
      const review = reviewQuoteDraft(priced, EDITOR, AREAS);
      // 4 × ₦2,000 = ₦8,000; gown ₦45,000. ₦2,100 + ₦8,000 + ₦45,000 − ₦200 + ₦1,500 = ₦56,400.
      expect(review.lineTotals.get("l2")).toBe(800_000);
      expect(review.lineTotals.get("k1")).toBe(4_500_000);
      expect(review).toMatchObject({ total: 5_640_000, fullyPriced: true });
      // A fixed line ignores anything typed into its (hidden) price.
      expect(reviewQuoteDraft(withLine(priced, "l1", { price: "1" }), EDITOR, AREAS).lineTotals.get("l1")).toBe(210_000);
    });

    it("treats a missing or invalid price as not priced yet", () => {
      const counted = withLine(initialQuoteDraft(EDITOR), "l2", { quantity: "4" });
      for (const price of ["", "abc", "-5", "10,000,000.01"]) {
        const review = reviewQuoteDraft(withLine(counted, "l2", { price }), EDITOR, AREAS);
        expect(review.lineTotals.get("l2")).toBeNull();
        expect(review.fullyPriced).toBe(false);
      }
    });

    it("checks typed prices before sending, keyed like the server's errors", () => {
      const draft = initialQuoteDraft(EDITOR);
      expect(validateQuotePrices(draft)).toEqual({});
      expect(validateQuotePrices(withLine(draft, "l2", { price: "0" }))).toEqual({});
      expect(validateQuotePrices(withLine(draft, "l2", { price: "10,000,000" }))).toEqual({});
      expect(validateQuotePrices(withLine(draft, "l2", { price: " " }))).toEqual({ "lines.1.unitPrice": "Enter the price, or 0" });
      expect(validateQuotePrices(withLine(draft, "l2", { price: "-500" }))).toEqual({
        "lines.1.unitPrice": "Enter an amount in Naira, like 500 or 1,500.50",
      });
      expect(validateQuotePrices(withLine(draft, "l2", { price: "10,000,000.01" }))).toEqual({
        "lines.1.unitPrice": "Price must be ₦10,000,000 or less",
      });
      // A fixed-price line is never checked: it has no price field.
      expect(validateQuotePrices(withLine(draft, "l1", { price: "nonsense" }))).toEqual({});
    });
  });
});
