import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TIME_ZONE, formatLongDate, getGreeting, getHourInTimeZone, resolveTimeZone } from "./time";

const LAGOS = "Africa/Lagos"; // UTC+1, no daylight saving
const LONDON = "Europe/London"; // UTC+1 in October (BST)
const NEW_YORK = "America/New_York"; // UTC-4 in October (EDT)

describe("formatLongDate", () => {
  it("formats the date in the given time zone", () => {
    expect(formatLongDate(new Date("2026-10-05T10:00:00Z"), LAGOS)).toBe("Monday, 5 October 2026");
  });

  it("uses the store's calendar day, not UTC's", () => {
    // 23:30 UTC on 4 October is already 5 October in Lagos…
    expect(formatLongDate(new Date("2026-10-04T23:30:00Z"), LAGOS)).toBe("Monday, 5 October 2026");
    // …and still 4 October in New York.
    expect(formatLongDate(new Date("2026-10-04T23:30:00Z"), NEW_YORK)).toBe("Sunday, 4 October 2026");
  });

  it("handles a year boundary", () => {
    expect(formatLongDate(new Date("2026-12-31T23:30:00Z"), LAGOS)).toBe("Friday, 1 January 2027");
  });
});

describe("getHourInTimeZone", () => {
  it("returns 0–23, with midnight as 0", () => {
    expect(getHourInTimeZone(new Date("2026-10-04T23:00:00Z"), LAGOS)).toBe(0);
    expect(getHourInTimeZone(new Date("2026-10-05T22:59:00Z"), LAGOS)).toBe(23);
  });

  it("follows daylight saving", () => {
    expect(getHourInTimeZone(new Date("2026-07-01T12:00:00Z"), LONDON)).toBe(13);
    expect(getHourInTimeZone(new Date("2026-12-01T12:00:00Z"), LONDON)).toBe(12);
  });
});

describe("getGreeting", () => {
  it.each([
    ["2026-10-04T23:00:00Z", "Good morning"], // 00:00 Lagos
    ["2026-10-05T10:59:00Z", "Good morning"], // 11:59
    ["2026-10-05T11:00:00Z", "Good afternoon"], // 12:00
    ["2026-10-05T15:59:00Z", "Good afternoon"], // 16:59
    ["2026-10-05T16:00:00Z", "Good evening"], // 17:00
    ["2026-10-05T22:59:00Z", "Good evening"], // 23:59
  ])("at %s in Lagos says %s", (iso, greeting) => {
    expect(getGreeting(new Date(iso), LAGOS)).toBe(greeting);
  });

  it("depends on the store's time zone, not the server's", () => {
    const instant = new Date("2026-10-05T13:00:00Z");
    expect(getGreeting(instant, LAGOS)).toBe("Good afternoon"); // 14:00
    expect(getGreeting(instant, NEW_YORK)).toBe("Good morning"); // 09:00
    expect(getGreeting(instant, "Asia/Tokyo")).toBe("Good evening"); // 22:00
  });
});

describe("resolveTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a valid time zone", () => {
    expect(resolveTimeZone(NEW_YORK)).toBe(NEW_YORK);
  });

  it("falls back to Africa/Lagos and warns once for an invalid one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(DEFAULT_TIME_ZONE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps the date and greeting working for an invalid time zone", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const instant = new Date("2026-10-05T16:30:00Z"); // 17:30 in Lagos
    expect(formatLongDate(instant, "not a zone")).toBe("Monday, 5 October 2026");
    expect(getGreeting(instant, "not a zone")).toBe("Good evening");
  });
});
