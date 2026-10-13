import { describe, expect, it } from "vitest";

import type { OrderEntryArea, OrderEntryService, QuoteEditorData } from "@/types/orders";

import { OUT_OF_AREA } from "./order-draft";
import { addQuoteService, CURRENT_AREA, initialQuoteDraft, reviewQuoteDraft, toIssueRevisionRequest } from "./quote-draft";

const EDITOR: QuoteEditorData = {
  orderId: "o1",
  displayNumber: "FF-1001",
  stage: "IN_PROGRESS",
  fulfilmentType: "PICKUP_DELIVERY",
  latestVersion: 2,
  lines: [
    // Added at ₦700; the catalogue says ₦800 today.
    { id: "l1", name: "Shirt", pricingType: "PER_ITEM", requiresQuote: false, unitPrice: 70_000, quantity: 300, estimate: null },
    { id: "l2", name: "Wash & fold", pricingType: "PER_KG", requiresQuote: true, unitPrice: 150_000, quantity: null, estimate: 500 },
  ],
  adjustments: [{ description: "Loyalty discount", amount: -20_000 }],
  pickup: { areaName: "Wuse 2", isOutOfArea: false, chargeEntered: false, charge: 150_000 },
  approvedTotal: 340_000,
  hasPendingRevision: false,
  reasonRequired: true,
};
const SHIRT: OrderEntryService = { id: "shirt", name: "Shirt", category: null, pricingType: "PER_ITEM", price: 80_000, requiresQuote: false };
const AREAS: OrderEntryArea[] = [
  { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED", fixedCharge: null },
  { id: "garki", name: "Garki", chargeType: "FIXED", fixedCharge: 100_000 },
];

describe("the edit-quote draft", () => {
  it("starts from the order's lines, Others, and charge", () => {
    const draft = initialQuoteDraft(EDITOR);
    expect(draft.lines.map((line) => [line.name, line.unitPrice, line.quantity])).toEqual([
      ["Shirt", 70_000, "3"],
      ["Wash & fold", 150_000, ""],
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
      ["Wash & fold", 150_000, "", "existing"],
      ["Shirt", 80_000, "2", "new"],
    ]);
  });

  it("previews the total and the difference from the last approved total", () => {
    const draft = initialQuoteDraft(EDITOR);
    const weighed = { ...draft, lines: draft.lines.map((line) => (line.key === "l2" ? { ...line, quantity: "4.2" } : line)) };
    expect(reviewQuoteDraft(draft, EDITOR, AREAS)).toMatchObject({ fullyPriced: false });
    // ₦2,100 + ₦6,300 − ₦200 + ₦1,500 = ₦9,700, ₦6,300 more than ₦3,400.
    expect(reviewQuoteDraft(weighed, EDITOR, AREAS)).toMatchObject({ total: 970_000, difference: 630_000, fullyPriced: true, charge: 150_000 });
    // A fixed area's own charge, or the typed one for a quote-required area.
    expect(reviewQuoteDraft({ ...weighed, areaChoice: "garki" }, EDITOR, AREAS).charge).toBe(100_000);
    expect(reviewQuoteDraft({ ...weighed, areaChoice: "maitama", charge: "" }, EDITOR, AREAS)).toMatchObject({ charge: null, fullyPriced: false });
  });

  it("sends IDs, quantities, and the area choice, never a price", () => {
    const draft = { ...initialQuoteDraft(EDITOR), areaChoice: OUT_OF_AREA, outOfAreaName: "Kubwa", charge: "3,000", reason: "Moved house" };
    const lines = addQuoteService(draft.lines, SHIRT, "k1");
    expect(toIssueRevisionRequest({ ...draft, lines }, EDITOR, AREAS)).toEqual({
      orderId: "o1",
      basedOnVersion: 2,
      lines: [
        { kind: "existing", lineId: "l1", quantity: "3" },
        { kind: "existing", lineId: "l2", quantity: "" },
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
});
