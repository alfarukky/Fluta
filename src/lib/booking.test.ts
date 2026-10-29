import { describe, expect, it } from "vitest";

import {
  getBookingDateOptions,
  getBookingPriceSummary,
  isBookablePickup,
  toBookingLineAmount,
  type BookingLineService,
} from "./booking";

// Monday to Saturday, 8:00 AM to 6:00 PM: five 2-hour windows a day.
const SCHEDULE = { activeDays: [1, 2, 3, 4, 5, 6], openTime: "08:00", closeTime: "18:00" };
const ALL_WINDOWS = ["08:00", "10:00", "12:00", "14:00", "16:00"];
const NO_CLOSED_DATES = new Set<string>();

// 2026-10-15 is a Thursday.
const THURSDAY_7AM = { today: "2026-10-15", minutes: 7 * 60 };

describe("getBookingDateOptions", () => {
  it("offers today through 14 days after today, inclusive", () => {
    const everyDay = { ...SCHEDULE, activeDays: [0, 1, 2, 3, 4, 5, 6] };
    const dates = getBookingDateOptions({ today: "2026-10-15", minutes: 0 }, everyDay, NO_CLOSED_DATES).map((o) => o.date);
    expect(dates).toHaveLength(15);
    expect(dates[0]).toBe("2026-10-15");
    expect(dates.at(-1)).toBe("2026-10-29");
  });

  it("leaves out inactive days and closed dates", () => {
    const dates = getBookingDateOptions(THURSDAY_7AM, SCHEDULE, new Set(["2026-10-16"])).map((o) => o.date);
    expect(dates).not.toContain("2026-10-16"); // closed Friday
    expect(dates).not.toContain("2026-10-18"); // Sunday
    expect(dates).not.toContain("2026-10-25"); // Sunday
    expect(dates).toContain("2026-10-17");
    expect(dates).toHaveLength(12);
  });

  it("removes windows starting less than 2 hours from now", () => {
    const at = (minutes: number) =>
      getBookingDateOptions({ today: "2026-10-15", minutes }, SCHEDULE, NO_CLOSED_DATES)[0];
    expect(at(6 * 60).windows.map((w) => w.start)).toEqual(ALL_WINDOWS);
    expect(at(6 * 60 + 1).windows.map((w) => w.start)).toEqual(ALL_WINDOWS.slice(1));
    expect(at(10 * 60).windows.map((w) => w.start)).toEqual(["12:00", "14:00", "16:00"]);
    // Tomorrow keeps every window.
    expect(getBookingDateOptions({ today: "2026-10-15", minutes: 10 * 60 }, SCHEDULE, NO_CLOSED_DATES)[1].windows).toHaveLength(5);
  });

  it("drops today once no window is 2 hours away", () => {
    const options = getBookingDateOptions({ today: "2026-10-15", minutes: 14 * 60 + 1 }, SCHEDULE, NO_CLOSED_DATES);
    expect(options[0].date).toBe("2026-10-16");
  });

  it("counts the lead time across midnight", () => {
    const night = { activeDays: [0, 1, 2, 3, 4, 5, 6], openTime: "00:00", closeTime: "04:00" };
    const options = getBookingDateOptions({ today: "2026-10-15", minutes: 23 * 60 }, night, NO_CLOSED_DATES);
    expect(options[0].date).toBe("2026-10-16");
    expect(options[0].windows.map((w) => w.start)).toEqual(["02:00"]);
  });

  it("offers nothing without valid hours", () => {
    expect(getBookingDateOptions(THURSDAY_7AM, { ...SCHEDULE, openTime: null }, NO_CLOSED_DATES)).toEqual([]);
  });
});

describe("isBookablePickup", () => {
  const options = getBookingDateOptions(THURSDAY_7AM, SCHEDULE, NO_CLOSED_DATES);

  it("accepts one of the offered windows", () => {
    expect(isBookablePickup(options, { date: "2026-10-15", start: "10:00", end: "12:00" })).toBe(true);
  });

  it("refuses a made-up window, a window too soon, and a date out of range", () => {
    expect(isBookablePickup(options, { date: "2026-10-15", start: "09:00", end: "11:00" })).toBe(false);
    expect(isBookablePickup(options, { date: "2026-10-15", start: "08:00", end: "10:00" })).toBe(false);
    expect(isBookablePickup(options, { date: "2026-10-30", start: "10:00", end: "12:00" })).toBe(false);
  });
});

const SHIRT: BookingLineService = { price: 80_000, pricingType: "PER_ITEM", requiresQuote: false };
const DUVET: BookingLineService = { price: 300_000, pricingType: "PER_ITEM", requiresQuote: true };
const WEDDING_GOWN: BookingLineService = { price: 0, pricingType: "PER_ITEM", requiresQuote: true };
const BEDDING_BUNDLE: BookingLineService = { price: 150_000, pricingType: "PER_PACKAGE", requiresQuote: true };

const line = (service: BookingLineService, amount: number | null) => ({ ...service, ...toBookingLineAmount(service, amount) });

describe("toBookingLineAmount", () => {
  it("bills fixed-price items and keeps quote-required amounts as estimates", () => {
    expect(toBookingLineAmount(SHIRT, 3)).toEqual({ quantity: 3, estimate: null });
    expect(toBookingLineAmount(DUVET, 2)).toEqual({ quantity: null, estimate: 2 });
  });
});

describe("getBookingPriceSummary", () => {
  it("gives the total of a fully priced order, with a fixed pickup charge", () => {
    expect(
      getBookingPriceSummary({ fulfilmentType: "PICKUP_DELIVERY", lines: [line(SHIRT, 3)], fulfilmentCharge: 150_000 }),
    ).toEqual({ kind: "total", total: 390_000 });
    expect(getBookingPriceSummary({ fulfilmentType: "DROP_OFF", lines: [line(SHIRT, 3)], fulfilmentCharge: null })).toEqual({
      kind: "total",
      total: 240_000,
    });
  });

  it("gives an indicative total from estimates and starting prices when every part can be estimated", () => {
    expect(
      getBookingPriceSummary({
        fulfilmentType: "PICKUP_DELIVERY",
        lines: [line(SHIRT, 2), line(BEDDING_BUNDLE, 2), line(DUVET, 1)],
        fulfilmentCharge: 0,
      }),
    ).toEqual({ kind: "estimate", total: 160_000 + 300_000 + 300_000 });
  });

  it("shows no number when an item is priced on inspection (FF-1013: a jacket and a gown)", () => {
    const leatherJacket: BookingLineService = { price: 500_000, pricingType: "PER_ITEM", requiresQuote: true };
    expect(
      getBookingPriceSummary({
        fulfilmentType: "DROP_OFF",
        lines: [line(leatherJacket, 2), line(WEDDING_GOWN, 1)],
        fulfilmentCharge: null,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("shows no number when the store will confirm the pickup charge, even if everything else is priced", () => {
    expect(
      getBookingPriceSummary({ fulfilmentType: "PICKUP_DELIVERY", lines: [line(SHIRT, 2)], fulfilmentCharge: null }),
    ).toEqual({ kind: "unknown" });
  });
});
