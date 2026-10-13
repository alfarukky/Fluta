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
const EXISTING_WASH: ExistingOrderLine = {
  id: "line-wash",
  lineType: "SERVICE",
  serviceId: "wash",
  description: "Wash & fold",
  pricingType: "PER_KG",
  requiresQuote: true,
  unitPrice: 150_000,
  estimate: 500,
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

const CATALOGUE = new Map<string, CatalogueServicePrice>([
  ["shirt", { id: "shirt", name: "Shirt", pricingType: "PER_ITEM", price: 80_000, requiresQuote: false }],
  ["duvet", { id: "duvet", name: "Duvet", pricingType: "PER_ITEM", price: 250_000, requiresQuote: false }],
]);

describe("priceRevisionLines", () => {
  it("keeps an existing line's original price and prices new lines from today's catalogue", () => {
    const result = priceRevisionLines([EXISTING_SHIRT, EXISTING_WASH], CATALOGUE, {
      lines: [
        { kind: "existing", lineId: "line-shirt", quantity: 300 },
        { kind: "existing", lineId: "line-wash", quantity: 425 },
        { kind: "new", serviceId: "shirt", quantity: 100 },
      ],
      adjustments: [{ description: "Stain removal", amount: 50_000 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((line) => [line.description, line.unitPrice, line.quantity, line.lineTotal])).toEqual([
      ["Shirt", 70_000, 300, 210_000],
      // 4.25 kg × ₦1,500, rounded once to the nearest kobo.
      ["Wash & fold", 150_000, 425, 637_500],
      ["Shirt", 80_000, 100, 80_000],
      ["Stain removal", null, null, 50_000],
    ]);
    // The customer's estimate stays on the weighed line.
    expect(result.lines[1].estimate).toBe(500);
  });

  it("merges new lines for the same service", () => {
    const result = priceRevisionLines([], CATALOGUE, {
      lines: [
        { kind: "new", serviceId: "duvet", quantity: 100 },
        { kind: "new", serviceId: "duvet", quantity: 200 },
      ],
      adjustments: [],
    });
    expect(result).toMatchObject({ ok: true, lines: [{ description: "Duvet", quantity: 300, lineTotal: 750_000 }] });
  });

  it("requires every quantity, so the revision is fully priced", () => {
    const result = priceRevisionLines([EXISTING_WASH], CATALOGUE, {
      lines: [{ kind: "existing", lineId: "line-wash", quantity: null }],
      adjustments: [],
    });
    expect(result).toEqual({ ok: false, problem: "INVALID_QUANTITY", fieldErrors: { "lines.0.quantity": "Enter the weight" } });
  });

  it("refuses lines that aren't the order's, or are sent twice, and services that aren't available", () => {
    expect(
      priceRevisionLines([EXISTING_SHIRT, OTHERS_LINE], CATALOGUE, {
        lines: [
          { kind: "existing", lineId: "line-other", quantity: 100 },
          { kind: "existing", lineId: "line-shirt", quantity: 100 },
          { kind: "existing", lineId: "line-shirt", quantity: 100 },
          { kind: "existing", lineId: "someone-elses", quantity: 100 },
        ],
        adjustments: [],
      }),
    ).toMatchObject({ ok: false, problem: "LINE_UNAVAILABLE", fieldErrors: { "lines.0": expect.any(String), "lines.2": expect.any(String), "lines.3": expect.any(String) } });
    expect(
      priceRevisionLines([], CATALOGUE, { lines: [{ kind: "new", serviceId: "disabled", quantity: 100 }], adjustments: [] }),
    ).toMatchObject({ ok: false, problem: "SERVICE_UNAVAILABLE", fieldErrors: { "lines.0.serviceId": expect.any(String) } });
  });

  it("needs at least one service line", () => {
    expect(priceRevisionLines([EXISTING_SHIRT], CATALOGUE, { lines: [], adjustments: [{ description: "Fee", amount: 100 }] })).toMatchObject({
      ok: false,
      problem: "NO_SERVICES",
    });
  });
});

describe("buildRevision", () => {
  const shirts = priceRevisionLines([EXISTING_SHIRT], CATALOGUE, {
    lines: [{ kind: "existing", lineId: "line-shirt", quantity: 200 }],
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
