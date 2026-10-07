import { describe, expect, it } from "vitest";

import {
  areValidActiveDays,
  formatPickupWindow,
  getHoursProblem,
  getPickupWindows,
  isValidSchedule,
  parseClockTime,
} from "./pickup-schedule";

const shown = (open: string, close: string) => getPickupWindows(open, close).map(formatPickupWindow);

describe("parseClockTime", () => {
  it("reads 24-hour HH:MM as minutes after midnight", () => {
    expect(parseClockTime("00:00")).toBe(0);
    expect(parseClockTime("08:15")).toBe(495);
    expect(parseClockTime("23:45")).toBe(1425);
  });

  it("refuses anything else", () => {
    for (const text of ["8:00", "24:00", "12:60", "08:00:00", " 08:00", "", "noon"]) {
      expect(parseClockTime(text)).toBeNull();
    }
  });
});

describe("getHoursProblem", () => {
  it("accepts valid hours on the 15-minute step", () => {
    expect(getHoursProblem("08:00", "17:00")).toBeNull();
    expect(getHoursProblem("07:45", "18:15")).toBeNull();
  });

  it("requires closing after opening, with no overnight hours", () => {
    expect(getHoursProblem("09:00", "09:00")).toBe("CLOSE_NOT_AFTER_OPEN");
    expect(getHoursProblem("18:00", "08:00")).toBe("CLOSE_NOT_AFTER_OPEN");
    expect(getHoursProblem("22:00", "02:00")).toBe("CLOSE_NOT_AFTER_OPEN");
  });

  it("requires the 15-minute step", () => {
    expect(getHoursProblem("08:10", "17:00")).toBe("OFF_STEP");
    expect(getHoursProblem("08:00", "17:05")).toBe("OFF_STEP");
  });

  it("refuses malformed times", () => {
    expect(getHoursProblem("8am", "17:00")).toBe("INVALID_TIME");
    expect(getHoursProblem("08:00", "")).toBe("INVALID_TIME");
  });
});

describe("areValidActiveDays", () => {
  it("accepts whole numbers 0–6 without duplicates", () => {
    expect(areValidActiveDays([])).toBe(true);
    expect(areValidActiveDays([0, 1, 2, 3, 4, 5, 6])).toBe(true);
  });

  it("refuses out-of-range, fractional and duplicate days", () => {
    expect(areValidActiveDays([7])).toBe(false);
    expect(areValidActiveDays([-1])).toBe(false);
    expect(areValidActiveDays([1.5])).toBe(false);
    expect(areValidActiveDays([1, 1])).toBe(false);
  });
});

describe("isValidSchedule", () => {
  it("needs at least one day and valid hours", () => {
    expect(isValidSchedule({ activeDays: [1], openTime: "08:00", closeTime: "17:00" })).toBe(true);
    expect(isValidSchedule({ activeDays: [], openTime: "08:00", closeTime: "17:00" })).toBe(false);
    expect(isValidSchedule({ activeDays: [1], openTime: null, closeTime: "17:00" })).toBe(false);
    expect(isValidSchedule({ activeDays: [1], openTime: "17:00", closeTime: "08:00" })).toBe(false);
  });
});

describe("getPickupWindows", () => {
  it("splits evenly into 2-hour windows", () => {
    expect(shown("08:00", "16:00")).toEqual(["08:00–10:00", "10:00–12:00", "12:00–14:00", "14:00–16:00"]);
  });

  it("ends the last window at closing time when it is shorter", () => {
    expect(shown("08:00", "17:00")).toEqual([
      "08:00–10:00",
      "10:00–12:00",
      "12:00–14:00",
      "14:00–16:00",
      "16:00–17:00",
    ]);
    expect(shown("07:30", "10:15")).toEqual(["07:30–09:30", "09:30–10:15"]);
  });

  it("gives one window when the hours are shorter than 2 hours", () => {
    expect(shown("09:00", "10:30")).toEqual(["09:00–10:30"]);
    expect(shown("09:00", "09:15")).toEqual(["09:00–09:15"]);
  });

  it("gives no windows for invalid hours", () => {
    expect(shown("17:00", "08:00")).toEqual([]);
    expect(shown("08:10", "17:00")).toEqual([]);
  });
});
