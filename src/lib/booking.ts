import type { FulfilmentType, PricingType } from "@/generated/prisma/enums";

import { lineTotalKobo } from "./money";
import { isOrderFullyPriced } from "./order-pricing";
import { getPickupWindows, parseClockTime, type PickupSchedule, type PickupWindow } from "./pickup-schedule";
import { addDaysToDateKey, fromDateKey } from "./time";

// Customer booking rules shared by the booking page and the server, which
// re-checks everything when the booking is sent. Pure: "now" is passed in as
// the store's local date and time.

// Pickup dates run from today through this many days after today (15 dates).
export const BOOKING_DAYS_AHEAD = 14;
// A window must start at least this long from now to be offered.
export const MIN_PICKUP_LEAD_MINUTES = 120;

const MINUTES_PER_DAY = 24 * 60;

export interface StoreClock {
  today: string; // "YYYY-MM-DD" in the store's time zone
  minutes: number; // minutes after midnight in the store's time zone
}

export interface BookingDateOption {
  date: string; // "YYYY-MM-DD"
  windows: PickupWindow[];
}

// The dates (today through 14 days after today) and windows a customer can
// request: active days only, never a closed date, and only windows starting
// at least 2 hours from now. A date with no window left isn't offered.
export function getBookingDateOptions(
  clock: StoreClock,
  schedule: PickupSchedule,
  closedDates: ReadonlySet<string>,
): BookingDateOption[] {
  const { openTime, closeTime } = schedule;
  const windows = openTime && closeTime ? getPickupWindows(openTime, closeTime) : [];
  const options: BookingDateOption[] = [];
  for (let offset = 0; offset <= BOOKING_DAYS_AHEAD; offset++) {
    const date = addDaysToDateKey(clock.today, offset);
    if (!schedule.activeDays.includes(fromDateKey(date).getUTCDay()) || closedDates.has(date)) continue;
    const open = windows.filter(
      (window) => offset * MINUTES_PER_DAY + (parseClockTime(window.start) ?? 0) - clock.minutes >= MIN_PICKUP_LEAD_MINUTES,
    );
    if (open.length > 0) options.push({ date, windows: open });
  }
  return options;
}

// Whether the requested date and window are still one of the options.
export function isBookablePickup(options: readonly BookingDateOption[], request: { date: string } & PickupWindow): boolean {
  return options.some(
    (option) =>
      option.date === request.date &&
      option.windows.some((window) => window.start === request.start && window.end === request.end),
  );
}

// ───────────── Prices on the review step ─────────────

export interface BookingLineService {
  price: number; // kobo; a starting price when requiresQuote
  pricingType: PricingType;
  requiresQuote: boolean;
}

// What the customer entered for a service: how many items or packages, or
// the estimated weight (optional), in hundredths.
export interface BookingLineAmount {
  quantity: number | null;
  estimate: number | null;
}

// Online, only fixed-price lines are counted for the bill. What the customer
// enters on a quote-required line (per kg always, and items or packages the
// store inspects) is an estimate: the store weighs or counts it later.
export function toBookingLineAmount(service: Pick<BookingLineService, "requiresQuote">, amount: number | null): BookingLineAmount {
  return service.requiresQuote ? { quantity: null, estimate: amount } : { quantity: amount, estimate: null };
}

export type BookingPriceSummary =
  // Fully priced: the total the customer agrees to by booking.
  | { kind: "total"; total: number }
  // Needs a price from the store, but every part has an estimate.
  | { kind: "estimate"; total: number }
  // Something is still unknown (a weight without an estimate, an item priced
  // on inspection, or a pickup charge the store will confirm): no number at
  // all, never a partial sum.
  | { kind: "unknown" };

export interface BookingPriceInput {
  fulfilmentType: FulfilmentType;
  lines: readonly (BookingLineService & BookingLineAmount)[];
  // A pickup's charge, or null when the store will confirm it. Ignored for drop-off.
  fulfilmentCharge: number | null;
}

export function getBookingPriceSummary({ fulfilmentType, lines, fulfilmentCharge }: BookingPriceInput): BookingPriceSummary {
  const charge = fulfilmentType === "PICKUP_DELIVERY" ? fulfilmentCharge : 0;
  const fullyPriced = isOrderFullyPriced({ fulfilmentType, lines, fulfilmentCharge: charge });
  const amounts = lines.map((line) => line.quantity ?? line.estimate);
  // A "Price on inspection" item (no starting price) can't be estimated:
  // counting it as ₦0 would show a partial sum.
  const unpriceable = lines.some((line) => line.requiresQuote && line.price === 0);
  if (charge === null || unpriceable || amounts.some((amount) => amount === null)) return { kind: "unknown" };

  const total = lines.reduce((sum, line, i) => sum + lineTotalKobo(line.price, amounts[i] ?? 0), charge);
  return fullyPriced ? { kind: "total", total } : { kind: "estimate", total };
}
