import { createHash, randomBytes } from "node:crypto";

const HOUR_MS = 60 * 60 * 1000;

export function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * HOUR_MS);
}

export function hoursAfter(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

// A calendar date (for @db.Date columns) as seen in Lagos, `offsetDays` from `date`.
export function lagosDate(date: Date, offsetDays = 0): Date {
  const shifted = new Date(date.getTime() + offsetDays * 24 * HOUR_MS);
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(shifted)
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// Seeded orders get a real-looking token hash; the raw token is discarded, so
// staff "resend link" to get a working one (as with any lost link).
export function seedTrackingTokenHash(): string {
  const token = randomBytes(32).toString("base64url");
  return createHash("sha256").update(token).digest("hex");
}
