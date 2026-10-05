// Timestamps are stored in UTC and shown in the store's time zone.

// The schema default for Store.timeZone.
export const DEFAULT_TIME_ZONE = "Africa/Lagos";

const warnedTimeZones = new Set<string>();

// A store's time zone if the runtime recognises it, otherwise the default, so
// one bad value can't crash the workspace. Fluta admins set it (Feature 23
// validates it then); until then a bad value is logged once per zone.
export function resolveTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    if (!warnedTimeZones.has(timeZone)) {
      warnedTimeZones.add(timeZone);
      console.warn(`Invalid store time zone "${timeZone}"; using ${DEFAULT_TIME_ZONE}.`);
    }
    return DEFAULT_TIME_ZONE;
  }
}

// "Monday, 5 October 2026". Built from parts because browsers and Node.js
// punctuate en-GB long dates differently, and the server and browser must agree.
export function formatLongDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: resolveTimeZone(timeZone),
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}

// The hour of the day (0–23) at `date` in `timeZone`.
export function getHourInTimeZone(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: resolveTimeZone(timeZone),
  })
    .formatToParts(date)
    .find((part) => part.type === "hour");
  return Number(hour?.value);
}

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

// Morning until 12:00, afternoon until 17:00, evening otherwise.
export function getGreeting(date: Date, timeZone: string): Greeting {
  const hour = getHourInTimeZone(date, timeZone);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
