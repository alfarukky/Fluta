import { describe, expect, it } from "vitest";

import { buildQuoteSnapshot, getPickupProblem, NO_FULFILMENT, type PickupContext, type PickupRequest } from "./orders";

// 2099-06-15 is a Monday; the store picks up Monday–Friday, 8:00 AM–5:00 PM.
const context: PickupContext = {
  today: "2099-06-15",
  schedule: { activeDays: [1, 2, 3, 4, 5], openTime: "08:00", closeTime: "17:00" },
  isClosedDate: false,
};
const normal: PickupRequest = { date: "2099-06-15", windowStart: "08:00", windowEnd: "10:00", outsideSchedule: false };

describe("getPickupProblem", () => {
  it("accepts a normal window on an active day", () => {
    expect(getPickupProblem(normal, context)).toBeNull();
    expect(getPickupProblem({ ...normal, date: "2099-06-19", windowStart: "16:00", windowEnd: "17:00" }, context)).toBeNull();
  });

  it("refuses a date before today", () => {
    expect(getPickupProblem({ ...normal, date: "2099-06-14" }, context)).toEqual({
      field: "pickupDate",
      reason: "DATE_IN_PAST",
    });
  });

  it("refuses an inactive day and a closed date", () => {
    expect(getPickupProblem({ ...normal, date: "2099-06-21" }, context)?.reason).toBe("INACTIVE_DAY"); // Sunday
    expect(getPickupProblem(normal, { ...context, isClosedDate: true })?.reason).toBe("CLOSED_DATE");
  });

  it("refuses a time that isn't one of the windows", () => {
    for (const [windowStart, windowEnd] of [
      ["19:00", "21:00"],
      ["09:00", "11:00"],
      ["08:00", "09:00"],
    ]) {
      expect(getPickupProblem({ ...normal, windowStart, windowEnd }, context)?.reason).toBe("WINDOW_NOT_OFFERED");
    }
  });

  it("offers no windows when the store has no hours", () => {
    const noHours = { ...context, schedule: { ...context.schedule, openTime: null, closeTime: null } };
    expect(getPickupProblem(normal, noHours)?.reason).toBe("WINDOW_NOT_OFFERED");
  });

  describe("outside the normal schedule", () => {
    const sundayEvening: PickupRequest = { date: "2099-06-21", windowStart: "19:00", windowEnd: "20:00", outsideSchedule: true };

    it("allows any day, closed dates, and custom times", () => {
      expect(getPickupProblem(sundayEvening, context)).toBeNull();
      expect(getPickupProblem({ ...sundayEvening, date: "2099-06-15" }, { ...context, isClosedDate: true })).toBeNull();
    });

    it("still refuses a date before today", () => {
      expect(getPickupProblem({ ...sundayEvening, date: "2099-06-14" }, context)?.reason).toBe("DATE_IN_PAST");
    });

    it("needs valid times with the end after the start", () => {
      expect(getPickupProblem({ ...sundayEvening, windowEnd: "19:00" }, context)?.reason).toBe("END_NOT_AFTER_START");
      expect(getPickupProblem({ ...sundayEvening, windowEnd: "18:00" }, context)?.reason).toBe("END_NOT_AFTER_START");
      expect(getPickupProblem({ ...sundayEvening, windowStart: "19:10" }, context)?.reason).toBe("INVALID_TIME");
      expect(getPickupProblem({ ...sundayEvening, windowEnd: "" }, context)?.reason).toBe("INVALID_TIME");
    });
  });
});

describe("buildQuoteSnapshot", () => {
  const shirts = {
    lineType: "SERVICE" as const,
    serviceId: "shirt",
    description: "Shirt",
    pricingType: "PER_ITEM" as const,
    requiresQuote: false,
    unitPrice: 80_000,
    quantity: 3,
    estimate: null,
    lineTotal: 240_000,
  };
  const duvet = {
    ...shirts,
    serviceId: "duvet",
    description: "Duvet",
    requiresQuote: true,
    unitPrice: 150_000,
  };
  const discount = {
    lineType: "ADJUSTMENT" as const,
    serviceId: null,
    description: "Loyalty discount",
    pricingType: null,
    requiresQuote: false,
    unitPrice: null,
    quantity: null,
    estimate: null,
    lineTotal: -20_000,
  };

  it("freezes priced lines, adjustments, the area, and the charge", () => {
    const snapshot = buildQuoteSnapshot([shirts, discount], { areaName: "Wuse 2", isOutOfArea: false, charge: 150_000 });
    expect(snapshot).toMatchObject({ itemsSubtotal: 220_000, fulfilmentCharge: 150_000, total: 370_000 });
    expect(snapshot.linesSnapshot).toMatchObject({ areaName: "Wuse 2", isOutOfArea: false, fulfilmentCharge: 150_000 });
    expect(snapshot.linesSnapshot.lines[0]).toEqual({
      lineType: "SERVICE",
      serviceId: "shirt",
      description: "Shirt",
      pricingType: "PER_ITEM",
      requiresQuote: false,
      unitPrice: 80_000,
      quantity: "3",
      quantityIsEstimate: false,
      lineTotal: 240_000,
    });
  });

  it("shows a line still to be counted at the customer's estimate", () => {
    const snapshot = buildQuoteSnapshot([{ ...duvet, quantity: null, estimate: 2, lineTotal: null }], NO_FULFILMENT);
    expect(snapshot.linesSnapshot.lines).toEqual([expect.objectContaining({ quantity: "2", quantityIsEstimate: true, lineTotal: 300_000 })]);
    expect(snapshot).toMatchObject({ itemsSubtotal: 300_000, fulfilmentCharge: 0, total: 300_000 });
  });

  it("leaves out a line still to be counted without an estimate", () => {
    const snapshot = buildQuoteSnapshot([shirts, { ...duvet, quantity: null, lineTotal: null }], NO_FULFILMENT);
    expect(snapshot.linesSnapshot.lines).toHaveLength(1);
    expect(snapshot.total).toBe(240_000);
  });
});
