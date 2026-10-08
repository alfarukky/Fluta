// The pickup & delivery schedule: clock times, active days, and the fixed
// 2-hour windows customers choose from. Pure and shared by the server
// (validation, src/server/domain/pickup-schedule.ts) and the fulfilment page's
// live preview. Times are "HH:MM" (24-hour) in the store's time zone.

import { formatTwelveHour } from "./time";

export const TIME_STEP_MINUTES = 15;
export const PICKUP_WINDOW_MINUTES = 120;

// 0 = Sunday … 6 = Saturday (Store.activeDays), listed Monday first.
export const WEEK_DAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Minutes after midnight, or null unless the text is exactly "HH:MM".
export function parseClockTime(text: string): number | null {
  const match = CLOCK_TIME.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatClockTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type HoursProblem = "INVALID_TIME" | "OFF_STEP" | "CLOSE_NOT_AFTER_OPEN";

// Null when the time is "HH:MM" on the 15-minute step.
export function getClockTimeProblem(time: string): "INVALID_TIME" | "OFF_STEP" | null {
  const minutes = parseClockTime(time);
  if (minutes === null) return "INVALID_TIME";
  return minutes % TIME_STEP_MINUTES === 0 ? null : "OFF_STEP";
}

// Null when both times are valid, on the 15-minute step, and closing is after
// opening on the same day (no overnight hours).
export function getHoursProblem(openTime: string, closeTime: string): HoursProblem | null {
  const problem = getClockTimeProblem(openTime) ?? getClockTimeProblem(closeTime);
  if (problem) return problem;
  return (parseClockTime(closeTime) ?? 0) <= (parseClockTime(openTime) ?? 0) ? "CLOSE_NOT_AFTER_OPEN" : null;
}

// Whole numbers 0–6 with no duplicates.
export function areValidActiveDays(days: readonly number[]): boolean {
  return days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(days).size === days.length;
}

export interface PickupSchedule {
  activeDays: readonly number[];
  openTime: string | null;
  closeTime: string | null;
}

// At least one active day, and valid hours.
export function isValidSchedule({ activeDays, openTime, closeTime }: PickupSchedule): boolean {
  return (
    activeDays.length > 0 &&
    areValidActiveDays(activeDays) &&
    openTime !== null &&
    closeTime !== null &&
    getHoursProblem(openTime, closeTime) === null
  );
}

export interface PickupWindow {
  start: string;
  end: string;
}

// Fixed 2-hour windows from opening time; the last one ends at closing time
// even if shorter (08:00–17:00 → 08:00–10:00 … 14:00–16:00, 16:00–17:00).
// Empty when the hours aren't valid.
export function getPickupWindows(openTime: string, closeTime: string): PickupWindow[] {
  if (getHoursProblem(openTime, closeTime) !== null) return [];
  const open = parseClockTime(openTime) ?? 0;
  const close = parseClockTime(closeTime) ?? 0;
  const windows: PickupWindow[] = [];
  for (let start = open; start < close; start += PICKUP_WINDOW_MINUTES) {
    windows.push({ start: formatClockTime(start), end: formatClockTime(Math.min(start + PICKUP_WINDOW_MINUTES, close)) });
  }
  return windows;
}

// "8:00 AM–10:00 AM": stored 24-hour times shown in 12-hour form.
export function formatPickupWindow({ start, end }: PickupWindow): string {
  return `${formatTwelveHour(start)}–${formatTwelveHour(end)}`;
}
