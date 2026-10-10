import { describe, expect, it } from "vitest";

import { getOrderTotal, isOrderFullyPriced, mergeServiceLines } from "./order-pricing";

describe("mergeServiceLines", () => {
  it("combines repeated services into one line, in first-seen order", () => {
    const merged = mergeServiceLines([
      { serviceId: "shirt", quantity: 200, estimate: null },
      { serviceId: "duvet", quantity: 100, estimate: null },
      { serviceId: "shirt", quantity: 300, estimate: null },
    ]);
    expect(merged).toEqual([
      { serviceId: "shirt", quantity: 500, estimate: null },
      { serviceId: "duvet", quantity: 100, estimate: null },
    ]);
  });

  it("adds weights and estimates", () => {
    expect(
      mergeServiceLines([
        { serviceId: "wash", quantity: 250, estimate: 300 },
        { serviceId: "wash", quantity: 125, estimate: null },
      ]),
    ).toEqual([{ serviceId: "wash", quantity: 375, estimate: 300 }]);
  });

  it("keeps the line unweighed if any part is still to be weighed", () => {
    expect(
      mergeServiceLines([
        { serviceId: "wash", quantity: 250, estimate: null },
        { serviceId: "wash", quantity: null, estimate: 400 },
      ]),
    ).toEqual([{ serviceId: "wash", quantity: null, estimate: 400 }]);
  });

  it("leaves the input untouched", () => {
    const lines = [
      { serviceId: "shirt", quantity: 200, estimate: null },
      { serviceId: "shirt", quantity: 300, estimate: null },
    ];
    mergeServiceLines(lines);
    expect(lines[0].quantity).toBe(200);
  });
});

describe("getOrderTotal", () => {
  it("adds service lines, adjustments, and the charge", () => {
    expect(
      getOrderTotal({ serviceLineTotals: [240_000, 375_000], adjustments: [50_000, -20_000], fulfilmentCharge: 150_000 }),
    ).toBe(795_000);
  });

  it("counts only what is priced so far", () => {
    expect(getOrderTotal({ serviceLineTotals: [240_000, null], adjustments: [], fulfilmentCharge: null })).toBe(240_000);
  });

  it("can come out negative (the caller refuses that)", () => {
    expect(getOrderTotal({ serviceLineTotals: [80_000], adjustments: [-100_000], fulfilmentCharge: 0 })).toBe(-20_000);
  });
});

describe("isOrderFullyPriced", () => {
  const priced = { requiresQuote: false, quantity: 200 };
  const weighed = { requiresQuote: true, quantity: 250 };
  const unweighed = { requiresQuote: true, quantity: null };

  it("is priced when every quote-required line has its quantity", () => {
    expect(isOrderFullyPriced({ fulfilmentType: "DROP_OFF", lines: [priced, weighed], fulfilmentCharge: null })).toBe(true);
  });

  it("isn't while a quote-required line is unweighed", () => {
    expect(isOrderFullyPriced({ fulfilmentType: "DROP_OFF", lines: [priced, unweighed], fulfilmentCharge: null })).toBe(
      false,
    );
  });

  it("needs a pickup order's charge, ₦0 included", () => {
    expect(isOrderFullyPriced({ fulfilmentType: "PICKUP_DELIVERY", lines: [priced], fulfilmentCharge: null })).toBe(false);
    expect(isOrderFullyPriced({ fulfilmentType: "PICKUP_DELIVERY", lines: [priced], fulfilmentCharge: 0 })).toBe(true);
  });
});
