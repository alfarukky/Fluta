import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TIME_ZONE,
  describeTimeZone,
  formatCalendarDate,
  formatLongDate,
  formatTwelveHour,
  fromTwelveHour,
  getGreeting,
  getHourInTimeZone,
  getLocalDateKey,
  parseDateKey,
  resolveTimeZone,
  toTwelveHour,
} from "./time";

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

describe("getLocalDateKey", () => {
  it("gives the calendar date in the store's time zone", () => {
    // 23:30 UTC on 6 October is already 7 October in Lagos, still 6 October in New York.
    const late = new Date("2026-10-06T23:30:00Z");
    expect(getLocalDateKey(late, LAGOS)).toBe("2026-10-07");
    expect(getLocalDateKey(late, NEW_YORK)).toBe("2026-10-06");
  });
});

describe("parseDateKey", () => {
  it("accepts real dates written YYYY-MM-DD", () => {
    expect(parseDateKey("2026-10-07")).toBe("2026-10-07");
    expect(parseDateKey("2028-02-29")).toBe("2028-02-29");
  });

  it("refuses anything else", () => {
    for (const text of ["2026-02-30", "2026-13-01", "7/10/2026", "2026-10-7", ""]) expect(parseDateKey(text)).toBeNull();
  });
});

describe("formatCalendarDate", () => {
  it("shows the date itself, whatever the runtime's time zone", () => {
    expect(formatCalendarDate("2026-10-09")).toBe("Fri, 9 Oct 2026");
  });
});

describe("describeTimeZone", () => {
  it("names the zone and its ID", () => {
    expect(describeTimeZone(LAGOS, new Date("2026-10-07T12:00:00Z"))).toMatch(/^West Africa .*Time \(Africa\/Lagos\)$/);
  });
});

describe("12-hour clock times", () => {
  const cases = [
    ["00:00", "12:00 AM"],
    ["00:15", "12:15 AM"],
    ["08:00", "8:00 AM"],
    ["11:45", "11:45 AM"],
    ["12:00", "12:00 PM"],
    ["12:30", "12:30 PM"],
    ["13:15", "1:15 PM"],
    ["23:45", "11:45 PM"],
  ] as const;

  it.each(cases)("formats %s as %s", (stored, shown) => {
    expect(formatTwelveHour(stored)).toBe(shown);
  });

  it.each(cases)("converts %s to 12-hour parts and back", (stored) => {
    const parts = toTwelveHour(stored);
    expect(parts).not.toBeNull();
    expect(fromTwelveHour(parts!)).toBe(stored);
  });

  it("splits a time into hour, minutes and AM/PM", () => {
    expect(toTwelveHour("08:00")).toEqual({ hour: 8, minute: "00", period: "AM" });
    expect(toTwelveHour("12:00")).toEqual({ hour: 12, minute: "00", period: "PM" });
    expect(toTwelveHour("00:00")).toEqual({ hour: 12, minute: "00", period: "AM" });
    expect(toTwelveHour("00:15")).toEqual({ hour: 12, minute: "15", period: "AM" });
  });

  it("builds stored times from 12-hour parts", () => {
    expect(fromTwelveHour({ hour: 12, minute: "00", period: "AM" })).toBe("00:00");
    expect(fromTwelveHour({ hour: 12, minute: "15", period: "AM" })).toBe("00:15");
    expect(fromTwelveHour({ hour: 12, minute: "00", period: "PM" })).toBe("12:00");
    expect(fromTwelveHour({ hour: 8, minute: "30", period: "PM" })).toBe("20:30");
  });

  it("rejects anything that isn't HH:MM", () => {
    for (const text of ["8:00", "24:00", "12:60", "", "noon"]) expect(toTwelveHour(text)).toBeNull();
    expect(formatTwelveHour("noon")).toBe("noon");
  });
});
