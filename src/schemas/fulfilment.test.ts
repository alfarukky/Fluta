import { describe, expect, it } from "vitest";

import { getLocalDateKey } from "@/lib/time";

import { closedDateFormSchema, scheduleFormSchema, serviceAreaFormSchema } from "./fulfilment";

function areaError(values: { name?: string; chargeType?: string; fixedCharge?: string }) {
  const result = serviceAreaFormSchema.safeParse({ name: "Karu", chargeType: "FIXED", fixedCharge: "1,500", ...values });
  return result.success ? null : { field: result.error.issues[0].path[0], message: result.error.issues[0].message };
}

describe("serviceAreaFormSchema", () => {
  it("trims the name and stores a fixed charge in kobo", () => {
    expect(serviceAreaFormSchema.parse({ name: "  Wuse 2 ", chargeType: "FIXED", fixedCharge: "₦1,500" })).toEqual({
      name: "Wuse 2",
      chargeType: "FIXED",
      fixedCharge: 150_000,
    });
  });

  it("allows a ₦0 (free) charge and up to ₦1,000,000", () => {
    expect(serviceAreaFormSchema.parse({ name: "Karu", chargeType: "FIXED", fixedCharge: "0" }).fixedCharge).toBe(0);
    expect(areaError({ fixedCharge: "1,000,000" })).toBeNull();
    expect(areaError({ fixedCharge: "1,000,000.01" })).toMatchObject({ field: "fixedCharge" });
  });

  it("requires a charge for Fixed and none for Quote required", () => {
    expect(areaError({ fixedCharge: "" })).toMatchObject({ field: "fixedCharge" });
    expect(areaError({ chargeType: "QUOTE_REQUIRED", fixedCharge: "500" })).toMatchObject({ field: "fixedCharge" });
    expect(serviceAreaFormSchema.parse({ name: "Karu", chargeType: "QUOTE_REQUIRED", fixedCharge: " " })).toEqual({
      name: "Karu",
      chargeType: "QUOTE_REQUIRED",
      fixedCharge: null,
    });
  });

  it("checks the name length and charge format", () => {
    expect(areaError({ name: " K " })).toMatchObject({ field: "name" });
    expect(areaError({ name: "K".repeat(61) })).toMatchObject({ field: "name" });
    expect(areaError({ fixedCharge: "-500" })).toMatchObject({ field: "fixedCharge" });
    expect(areaError({ chargeType: "PER_KM" })).toMatchObject({ field: "chargeType" });
  });
});

function scheduleErrors(pickupOn: boolean, values: { activeDays?: string[]; openTime?: string; closeTime?: string }) {
  const result = scheduleFormSchema(pickupOn).safeParse({ activeDays: ["1"], openTime: "08:00", closeTime: "17:00", ...values });
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.message]));
}

describe("scheduleFormSchema", () => {
  it("stores days as sorted numbers and empty hours as null", () => {
    expect(scheduleFormSchema(true).parse({ activeDays: ["6", "0", "3"], openTime: "08:00", closeTime: "17:00" })).toEqual({
      activeDays: [0, 3, 6],
      openTime: "08:00",
      closeTime: "17:00",
    });
    expect(scheduleFormSchema(false).parse({ activeDays: [], openTime: "", closeTime: "" })).toEqual({
      activeDays: [],
      openTime: null,
      closeTime: null,
    });
  });

  it("refuses invalid or duplicate days", () => {
    expect(scheduleErrors(true, { activeDays: ["7"] })).toHaveProperty("activeDays");
    expect(scheduleErrors(true, { activeDays: ["1.5"] })).toHaveProperty("activeDays");
    expect(scheduleErrors(true, { activeDays: ["1", "1"] })).toHaveProperty("activeDays");
  });

  it("requires a day and both times while pickup & delivery is on", () => {
    expect(scheduleErrors(true, { activeDays: [] })).toHaveProperty("activeDays");
    expect(scheduleErrors(true, { openTime: "", closeTime: "" })).toMatchObject({
      openTime: expect.any(String),
      closeTime: expect.any(String),
    });
    expect(scheduleErrors(false, { activeDays: [], openTime: "", closeTime: "" })).toEqual({});
  });

  it("requires both times once either is entered", () => {
    expect(scheduleErrors(false, { closeTime: "" })).toHaveProperty("closeTime");
    expect(scheduleErrors(false, { openTime: "" })).toHaveProperty("openTime");
  });

  it("requires closing after opening, on the 15-minute step", () => {
    expect(scheduleErrors(true, { openTime: "17:00", closeTime: "08:00" })).toHaveProperty("closeTime");
    expect(scheduleErrors(true, { openTime: "08:00", closeTime: "08:00" })).toHaveProperty("closeTime");
    expect(scheduleErrors(true, { openTime: "08:10" })).toHaveProperty("openTime");
    expect(scheduleErrors(true, { openTime: "8:00" })).toHaveProperty("openTime");
    expect(scheduleErrors(true, { openTime: "07:45", closeTime: "18:15" })).toEqual({});
  });

  it("reports a bad time on its own field", () => {
    expect(scheduleErrors(true, { closeTime: "17:05" })).toEqual({ closeTime: "Use 15-minute steps, like 08:00, 08:15 or 08:30" });
    expect(scheduleErrors(true, { closeTime: "25:00" })).toEqual({ closeTime: "Enter times as HH:MM, like 08:00" });
    expect(scheduleErrors(true, { openTime: "08:10" })).toEqual({ openTime: "Use 15-minute steps, like 08:00, 08:15 or 08:30" });
    expect(Object.keys(scheduleErrors(true, { openTime: "8am", closeTime: "17:05" })).sort()).toEqual(["closeTime", "openTime"]);
  });
});

describe("closedDateFormSchema", () => {
  // 23:30 UTC on 6 October: already 7 October in Lagos.
  const now = new Date("2026-10-06T23:30:00Z");
  const today = getLocalDateKey(now, "Africa/Lagos");
  const schema = closedDateFormSchema(today);

  it("allows today in the store's time zone, and later dates", () => {
    expect(schema.parse({ date: "2026-10-07", note: "  Public holiday " })).toEqual({
      date: "2026-10-07",
      note: "Public holiday",
    });
    expect(schema.parse({ date: "2026-12-25", note: "" }).note).toBeNull();
  });

  it("refuses past dates, even one that is still today in UTC", () => {
    expect(schema.safeParse({ date: "2026-10-06", note: "" }).success).toBe(false);
  });

  it("refuses invalid dates and long notes", () => {
    expect(schema.safeParse({ date: "2026-02-30", note: "" }).success).toBe(false);
    expect(schema.safeParse({ date: "", note: "" }).success).toBe(false);
    expect(schema.safeParse({ date: "2026-10-08", note: "x".repeat(101) }).success).toBe(false);
  });
});
