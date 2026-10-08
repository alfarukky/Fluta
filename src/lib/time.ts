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

// "YYYY-MM-DD": the calendar date at `date` in `timeZone`.
export function getLocalDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: resolveTimeZone(timeZone),
  }).format(date);
}

// A calendar date (a @db.Date column, which Prisma returns as UTC midnight) as
// "YYYY-MM-DD", and back. It has no time of day, so no time zone applies.
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

// Null unless the text is a real calendar date written "YYYY-MM-DD".
export function parseDateKey(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = fromDateKey(text);
  return !Number.isNaN(date.getTime()) && toDateKey(date) === text ? text : null;
}

// "Fri, 9 Oct 2026" for a "YYYY-MM-DD" calendar date. Built from parts so
// Node.js and browsers agree.
export function formatCalendarDate(key: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(fromDateKey(key));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}

// "West Africa Standard Time (Africa/Lagos)": the zone's name and its ID.
export function describeTimeZone(timeZone: string, now: Date): string {
  const zone = resolveTimeZone(timeZone);
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "long" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  return name && name !== zone ? `${name} (${zone})` : zone;
}

// Clock times are stored as 24-hour "HH:MM" and shown in 12-hour form.
export type Meridiem = "AM" | "PM";

export interface TwelveHourTime {
  hour: number; // 1–12
  minute: string; // "00"–"59"
  period: Meridiem;
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "08:00" → 8:00 AM, "12:00" → 12:00 PM, "00:15" → 12:15 AM. Null unless the
// text is exactly "HH:MM".
export function toTwelveHour(time: string): TwelveHourTime | null {
  const match = CLOCK_TIME.exec(time);
  if (!match) return null;
  const hour24 = Number(match[1]);
  return { hour: hour24 % 12 || 12, minute: match[2], period: hour24 < 12 ? "AM" : "PM" };
}

// 8:00 AM → "08:00", 12:00 AM → "00:00", 12:00 PM → "12:00".
export function fromTwelveHour({ hour, minute, period }: TwelveHourTime): string {
  const hour24 = (hour % 12) + (period === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

// "08:00" → "8:00 AM". Anything that isn't "HH:MM" is returned unchanged.
export function formatTwelveHour(time: string): string {
  const parts = toTwelveHour(time);
  return parts ? `${parts.hour}:${parts.minute} ${parts.period}` : time;
}
