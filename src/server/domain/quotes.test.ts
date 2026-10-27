import { describe, expect, it } from "vitest";

import { NO_FULFILMENT } from "./orders";
import {
  buildRevision,
  priceRevisionLines,
  resolveRevisionFulfilment,
  type CatalogueServicePrice,
  type ExistingOrderLine,
  type OrderFulfilment,
} from "./quotes";

// Shirts were ₦700 when added; the catalogue now says ₦800.
const EXISTING_SHIRT: ExistingOrderLine = {
  id: "line-shirt",
  lineType: "SERVICE",
  serviceId: "shirt",
  description: "Shirt",
  pricingType: "PER_ITEM",
  requiresQuote: false,
  unitPrice: 70_000,
  estimate: null,
};
// Quote-required from ₦1,500; the customer booked an estimated 5.
const EXISTING_CURTAIN: ExistingOrderLine = {
  id: "line-curtain",
  lineType: "SERVICE",
  serviceId: "curtain",
  description: "Curtain",
  pricingType: "PER_ITEM",
  requiresQuote: true,
  unitPrice: 150_000,
  estimate: 5,
};
const OTHERS_LINE: ExistingOrderLine = {
  id: "line-other",
  lineType: "ADJUSTMENT",
  serviceId: null,
  description: "Express",
  pricingType: null,
  requiresQuote: false,
  unitPrice: null,
  estimate: null,
};

// "Price on inspection": quote-required at ₦0.
const EXISTING_GOWN: ExistingOrderLine = {
  id: "line-gown",
  lineType: "SERVICE",
  serviceId: "gown",
  description: "Wedding gown",
  pricingType: "PER_ITEM",
  requiresQuote: true,
  unitPrice: 0,
  estimate: 1,
};

const CATALOGUE = new Map<string, CatalogueServicePrice>([
  ["shirt", { id: "shirt", name: "Shirt", pricingType: "PER_ITEM", price: 80_000, requiresQuote: false }],
  ["duvet", { id: "duvet", name: "Duvet", pricingType: "PER_ITEM", price: 250_000, requiresQuote: false }],
  ["jacket", { id: "jacket", name: "Leather jacket", pricingType: "PER_ITEM", price: 500_000, requiresQuote: true }],
]);

describe("priceRevisionLines", () => {
  it("keeps an existing line's original price and prices new lines from today's catalogue", () => {
    const result = priceRevisionLines([EXISTING_SHIRT, EXISTING_CURTAIN], CATALOGUE, {
      lines: [
        { kind: "existing", lineId: "line-shirt", quantity: 3 },
        { kind: "existing", lineId: "line-curtain", quantity: 4 },
        { kind: "new", serviceId: "shirt", quantity: 1 },
      ],
      adjustments: [{ description: "Stain removal", amount: 50_000 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((line) => [line.description, line.unitPrice, line.quantity, line.lineTotal])).toEqual([
      ["Shirt", 70_000, 3, 210_000],
      // Counted 4 (the customer estimated 5) at the "from" price.
      ["Curtain", 150_000, 4, 600_000],
      ["Shirt", 80_000, 1, 80_000],
      ["Stain removal", null, null, 50_000],
    ]);
    // The customer's estimate stays on the line, never billed.
    expect(result.lines[1].estimate).toBe(5);
  });

  it("merges new lines for the same service", () => {
    const result = priceRevisionLines([], CATALOGUE, {
      lines: [
        { kind: "new", serviceId: "duvet", quantity: 1 },
        { kind: "new", serviceId: "duvet", quantity: 2 },
      ],
      adjustments: [],
    });
    expect(result).toMatchObject({ ok: true, lines: [{ description: "Duvet", quantity: 3, lineTotal: 750_000 }] });
  });

  it("requires every quantity, so the revision is fully priced", () => {
    const result = priceRevisionLines([EXISTING_CURTAIN], CATALOGUE, {
      lines: [{ kind: "existing", lineId: "line-curtain", quantity: null }],
      adjustments: [],
    });
    expect(result).toEqual({ ok: false, problem: "INVALID_QUANTITY", fieldErrors: { "lines.0.quantity": "Enter how many" } });
  });

  it("refuses lines that aren't the order's, or are sent twice, and services that aren't available", () => {
    expect(
      priceRevisionLines([EXISTING_SHIRT, OTHERS_LINE], CATALOGUE, {
        lines: [
          { kind: "existing", lineId: "line-other", quantity: 1 },
          { kind: "existing", lineId: "line-shirt", quantity: 1 },
          { kind: "existing", lineId: "line-shirt", quantity: 1 },
          { kind: "existing", lineId: "someone-elses", quantity: 1 },
        ],
        adjustments: [],
      }),
    ).toMatchObject({ ok: false, problem: "LINE_UNAVAILABLE", fieldErrors: { "lines.0": expect.any(String), "lines.2": expect.any(String), "lines.3": expect.any(String) } });
    expect(
      priceRevisionLines([], CATALOGUE, { lines: [{ kind: "new", serviceId: "disabled", quantity: 1 }], adjustments: [] }),
    ).toMatchObject({ ok: false, problem: "SERVICE_UNAVAILABLE", fieldErrors: { "lines.0.serviceId": expect.any(String) } });
  });

  it("needs at least one service line", () => {
    expect(priceRevisionLines([EXISTING_SHIRT], CATALOGUE, { lines: [], adjustments: [{ description: "Fee", amount: 100 }] })).toMatchObject({
      ok: false,
      problem: "NO_SERVICES",
    });
  });
});

describe("priceRevisionLines with unit prices", () => {
  const price = (lines: Parameters<typeof priceRevisionLines>[2]["lines"]) =>
    priceRevisionLines([EXISTING_SHIRT, EXISTING_CURTAIN, EXISTING_GOWN], CATALOGUE, { lines, adjustments: [] });
  const summary = (result: ReturnType<typeof priceRevisionLines>) =>
    result.ok ? result.lines.map((line) => [line.description, line.unitPrice, line.quantity, line.lineTotal]) : result;

  it("prices quote-required lines, from ₦0 and from a starting price", () => {
    const result = price([
      { kind: "existing", lineId: "line-shirt", quantity: 3 },
      // 4 at ₦2,000 each (up from ₦1,500 "from").
      { kind: "existing", lineId: "line-curtain", quantity: 4, unitPrice: 200_000 },
      // "Price on inspection" priced at ₦45,000.
      { kind: "existing", lineId: "line-gown", quantity: 1, unitPrice: 4_500_000 },
    ]);
    expect(summary(result)).toEqual([
      ["Shirt", 70_000, 3, 210_000],
      ["Curtain", 200_000, 4, 800_000],
      ["Wedding gown", 4_500_000, 1, 4_500_000],
    ]);
  });

  it("multiplies a unit price with kobo exactly", () => {
    // 3 × ₦1,234.57 = ₦3,703.71.
    const result = price([{ kind: "existing", lineId: "line-curtain", quantity: 3, unitPrice: 123_457 }]);
    expect(summary(result)).toEqual([["Curtain", 123_457, 3, 370_371]]);
  });

  it("refuses a fractional quantity sent directly", () => {
    expect(price([{ kind: "existing", lineId: "line-curtain", quantity: 1.5 }])).toEqual({
      ok: false,
      problem: "INVALID_QUANTITY",
      fieldErrors: { "lines.0.quantity": "Enter a whole number" },
    });
  });

  it("keeps a quote-required line's current price when none is sent", () => {
    for (const unitPrice of [undefined, null]) {
      const result = price([
        { kind: "existing", lineId: "line-curtain", quantity: 2, unitPrice },
        { kind: "existing", lineId: "line-gown", quantity: 1, unitPrice },
      ]);
      expect(summary(result)).toEqual([
        ["Curtain", 150_000, 2, 300_000],
        ["Wedding gown", 0, 1, 0],
      ]);
    }
  });

  it("allows ₦0 and ₦10,000,000 exactly", () => {
    expect(summary(price([{ kind: "existing", lineId: "line-gown", quantity: 1, unitPrice: 0 }]))).toEqual([
      ["Wedding gown", 0, 1, 0],
    ]);
    expect(summary(price([{ kind: "existing", lineId: "line-gown", quantity: 1, unitPrice: 1_000_000_000 }]))).toEqual([
      ["Wedding gown", 1_000_000_000, 1, 1_000_000_000],
    ]);
  });

  it("refuses the whole revision when a price is sent for a fixed-price line", () => {
    const result = price([
      { kind: "existing", lineId: "line-shirt", quantity: 3, unitPrice: 1 },
      { kind: "existing", lineId: "line-gown", quantity: 1, unitPrice: 4_500_000 },
    ]);
    expect(result).toEqual({
      ok: false,
      problem: "PRICE_NOT_ALLOWED",
      fieldErrors: { "lines.0.unitPrice": "This service has a fixed price. Reload the page and try again." },
    });
    // The same for a newly added fixed-price service, and even when the price sent matches.
    expect(price([{ kind: "new", serviceId: "shirt", quantity: 1, unitPrice: 80_000 }])).toMatchObject({
      ok: false,
      problem: "PRICE_NOT_ALLOWED",
    });
    expect(price([{ kind: "existing", lineId: "line-shirt", quantity: 1, unitPrice: 70_000 }])).toMatchObject({
      ok: false,
      problem: "PRICE_NOT_ALLOWED",
    });
  });

  it("refuses a negative price, one above ₦10,000,000, and part of a kobo", () => {
    for (const unitPrice of [-1, 1_000_000_001, 150_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(price([{ kind: "existing", lineId: "line-curtain", quantity: 2, unitPrice }])).toEqual({
        ok: false,
        problem: "INVALID_PRICE",
        fieldErrors: { "lines.0.unitPrice": "Enter a price from ₦0 to ₦10,000,000" },
      });
    }
  });

  it("starts a newly added quote-required service at today's price, and prices it when sent", () => {
    expect(summary(price([{ kind: "new", serviceId: "jacket", quantity: 1 }]))).toEqual([
      ["Leather jacket", 500_000, 1, 500_000],
    ]);
    // Added twice: one line, at the first price sent.
    expect(
      summary(
        price([
          { kind: "new", serviceId: "jacket", quantity: 1, unitPrice: 750_000 },
          { kind: "new", serviceId: "jacket", quantity: 2, unitPrice: 900_000 },
        ]),
      ),
    ).toEqual([["Leather jacket", 750_000, 3, 2_250_000]]);
  });
});

describe("buildRevision", () => {
  const shirts = priceRevisionLines([EXISTING_SHIRT], CATALOGUE, {
    lines: [{ kind: "existing", lineId: "line-shirt", quantity: 2 }],
    adjustments: [],
  });
  if (!shirts.ok) throw new Error("fixture");

  it("totals the lines, Others, and the charge", () => {
    const result = buildRevision({
      fulfilmentType: "PICKUP_DELIVERY",
      lines: [...shirts.lines, { ...shirts.lines[0], lineType: "ADJUSTMENT", serviceId: null, pricingType: null, unitPrice: null, quantity: null, lineTotal: -20_000 }],
      fulfilment: { areaName: "Wuse 2", isOutOfArea: false, charge: 150_000 },
      hasApprovedQuote: false,
      reason: null,
    });
    expect(result).toMatchObject({ ok: true, itemsSubtotal: 120_000, fulfilmentCharge: 150_000, total: 270_000 });
  });

  it("requires a reason only once the order has an approved quote", () => {
    const base = { fulfilmentType: "DROP_OFF" as const, lines: shirts.lines, fulfilment: NO_FULFILMENT };
    expect(buildRevision({ ...base, hasApprovedQuote: false, reason: null }).ok).toBe(true);
    expect(buildRevision({ ...base, hasApprovedQuote: true, reason: null })).toEqual({
      ok: false,
      problem: "REASON_REQUIRED",
      field: "reason",
    });
    expect(buildRevision({ ...base, hasApprovedQuote: true, reason: "Extra item" }).ok).toBe(true);
  });

  it("refuses a negative total", () => {
    const discount = { ...shirts.lines[0], lineType: "ADJUSTMENT" as const, serviceId: null, pricingType: null, unitPrice: null, quantity: null, lineTotal: -200_000 };
    expect(
      buildRevision({ fulfilmentType: "DROP_OFF", lines: [...shirts.lines, discount], fulfilment: NO_FULFILMENT, hasApprovedQuote: false, reason: null }),
    ).toEqual({ ok: false, problem: "NEGATIVE_TOTAL", field: "adjustments" });
  });

  it("refuses a pickup order without its charge", () => {
    expect(
      buildRevision({
        fulfilmentType: "PICKUP_DELIVERY",
        lines: shirts.lines,
        fulfilment: { areaName: "Maitama", isOutOfArea: false, charge: null },
        hasApprovedQuote: false,
        reason: null,
      }),
    ).toEqual({ ok: false, problem: "NOT_FULLY_PRICED", field: "charge" });
  });
});

describe("resolveRevisionFulfilment", () => {
  const fixedArea = { id: "wuse", name: "Wuse 2", chargeType: "FIXED" as const, fixedCharge: 150_000 };
  const quotedArea = { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED" as const, fixedCharge: null };
  const order: OrderFulfilment = {
    fulfilmentType: "PICKUP_DELIVERY",
    serviceAreaId: "wuse",
    serviceAreaName: "Wuse 2",
    isOutOfArea: false,
    fulfilmentCharge: 120_000, // the area's charge when the order was made
  };

  it("keeps a fixed area's charge on the order, whatever is sent", () => {
    expect(
      resolveRevisionFulfilment({ order, currentArea: fixedArea, chosenArea: null, request: { area: { kind: "current" }, charge: 1 } }),
    ).toMatchObject({ ok: true, fields: { serviceAreaId: "wuse", fulfilmentCharge: 120_000 } });
  });

  it("takes a newly chosen fixed area's charge from the area", () => {
    expect(
      resolveRevisionFulfilment({
        order: { ...order, serviceAreaId: "maitama", serviceAreaName: "Maitama" },
        currentArea: quotedArea,
        chosenArea: fixedArea,
        request: { area: { kind: "area", areaId: "wuse" }, charge: 1 },
      }),
    ).toEqual({
      ok: true,
      fields: { serviceAreaId: "wuse", serviceAreaName: "Wuse 2", isOutOfArea: false, fulfilmentCharge: 150_000 },
      snapshot: { areaName: "Wuse 2", isOutOfArea: false, charge: 150_000 },
    });
  });

  it("uses the entered charge for a quote-required area or outside the areas, and requires it", () => {
    const quoted = { ...order, serviceAreaId: "maitama", serviceAreaName: "Maitama" };
    expect(
      resolveRevisionFulfilment({ order: quoted, currentArea: quotedArea, chosenArea: null, request: { area: { kind: "current" }, charge: 200_000 } }),
    ).toMatchObject({ ok: true, fields: { fulfilmentCharge: 200_000 } });
    expect(
      resolveRevisionFulfilment({ order: quoted, currentArea: quotedArea, chosenArea: null, request: { area: { kind: "current" }, charge: null } }),
    ).toMatchObject({ ok: false, field: "charge" });
    expect(
      resolveRevisionFulfilment({
        order,
        currentArea: fixedArea,
        chosenArea: null,
        request: { area: { kind: "outOfArea", name: "Kubwa" }, charge: 300_000 },
      }),
    ).toEqual({
      ok: true,
      fields: { serviceAreaId: null, serviceAreaName: "Kubwa", isOutOfArea: true, fulfilmentCharge: 300_000 },
      snapshot: { areaName: "Kubwa", isOutOfArea: true, charge: 300_000 },
    });
  });

  it("refuses an area that isn't available", () => {
    expect(
      resolveRevisionFulfilment({ order, currentArea: fixedArea, chosenArea: null, request: { area: { kind: "area", areaId: "gone" }, charge: null } }),
    ).toMatchObject({ ok: false, field: "area" });
  });

  it("has no area or charge on a drop-off order", () => {
    expect(
      resolveRevisionFulfilment({
        order: { ...order, fulfilmentType: "DROP_OFF" },
        currentArea: null,
        chosenArea: null,
        request: { area: { kind: "outOfArea", name: "x" }, charge: 5 },
      }),
    ).toMatchObject({ ok: true, fields: { fulfilmentCharge: null, serviceAreaName: null }, snapshot: NO_FULFILMENT });
  });
});
