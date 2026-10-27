import { describe, expect, it } from "vitest";

import { getOrderTotal, isOrderFullyPriced, mergeServiceLines } from "./order-pricing";

describe("mergeServiceLines", () => {
  it("combines repeated services into one line, in first-seen order", () => {
    const merged = mergeServiceLines([
      { serviceId: "shirt", quantity: 2, estimate: null },
      { serviceId: "duvet", quantity: 1, estimate: null },
      { serviceId: "shirt", quantity: 3, estimate: null },
    ]);
    expect(merged).toEqual([
      { serviceId: "shirt", quantity: 5, estimate: null },
      { serviceId: "duvet", quantity: 1, estimate: null },
    ]);
  });

  it("adds estimates", () => {
    expect(
      mergeServiceLines([
        { serviceId: "gown", quantity: null, estimate: 2 },
        { serviceId: "gown", quantity: null, estimate: 1 },
      ]),
    ).toEqual([{ serviceId: "gown", quantity: null, estimate: 3 }]);
  });

  it("keeps the line waiting for its quantity if any part is still to be counted", () => {
    expect(
      mergeServiceLines([
        { serviceId: "gown", quantity: 2, estimate: null },
        { serviceId: "gown", quantity: null, estimate: 4 },
      ]),
    ).toEqual([{ serviceId: "gown", quantity: null, estimate: 4 }]);
  });

  it("leaves the input untouched", () => {
    const lines = [
      { serviceId: "shirt", quantity: 2, estimate: null },
      { serviceId: "shirt", quantity: 3, estimate: null },
    ];
    mergeServiceLines(lines);
    expect(lines[0].quantity).toBe(2);
  });
});

describe("getOrderTotal", () => {
  it("adds service lines, adjustments, and the charge", () => {
    expect(
      getOrderTotal({ serviceLineTotals: [240_000, 300_000], adjustments: [50_000, -20_000], fulfilmentCharge: 150_000 }),
    ).toBe(720_000);
  });

  it("counts only what is priced so far", () => {
    expect(getOrderTotal({ serviceLineTotals: [240_000, null], adjustments: [], fulfilmentCharge: null })).toBe(240_000);
  });

  it("can come out negative (the caller refuses that)", () => {
    expect(getOrderTotal({ serviceLineTotals: [80_000], adjustments: [-100_000], fulfilmentCharge: 0 })).toBe(-20_000);
  });
});

describe("isOrderFullyPriced", () => {
  const priced = { requiresQuote: false, quantity: 2 };
  const counted = { requiresQuote: true, quantity: 3 };
  const uncounted = { requiresQuote: true, quantity: null };

  it("is priced when every quote-required line has its quantity", () => {
    expect(isOrderFullyPriced({ fulfilmentType: "DROP_OFF", lines: [priced, counted], fulfilmentCharge: null })).toBe(true);
  });

  it("isn't while a quote-required line has no quantity yet", () => {
    expect(isOrderFullyPriced({ fulfilmentType: "DROP_OFF", lines: [priced, uncounted], fulfilmentCharge: null })).toBe(
      false,
    );
  });

  it("needs a pickup order's charge, ₦0 included", () => {
    expect(isOrderFullyPriced({ fulfilmentType: "PICKUP_DELIVERY", lines: [priced], fulfilmentCharge: null })).toBe(false);
    expect(isOrderFullyPriced({ fulfilmentType: "PICKUP_DELIVERY", lines: [priced], fulfilmentCharge: 0 })).toBe(true);
  });
});
