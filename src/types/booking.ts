import type { AreaChargeType, PricingType } from "@/generated/prisma/enums";

import type { BookingDateOption } from "@/lib/booking";

// What the booking page shows. Built on the server from the store's own data:
// every price, area, and window comes from here.

export interface PublicStore {
  name: string;
  slug: string;
  description: string | null;
  phone: string | null; // formatted for display
  phoneHref: string | null; // tel: link
  logoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

// OPEN: the booking form. NOT_ACCEPTING: services, the message, no booking
// button. NO_ONLINE_BOOKING: no form (no active services, or no way to get
// the laundry to the store).
export type BookingAvailability = "OPEN" | "NOT_ACCEPTING" | "NO_ONLINE_BOOKING";

export interface BookingService {
  id: string;
  name: string;
  category: string | null;
  pricingType: PricingType;
  price: number;
  requiresQuote: boolean;
}

export interface BookingArea {
  id: string;
  name: string;
  chargeType: AreaChargeType;
  fixedCharge: number | null;
}

export interface BookingOptions {
  today: string; // "YYYY-MM-DD" in the store's time zone
  services: BookingService[];
  dropOff: boolean;
  pickup: boolean;
  areas: BookingArea[];
  // Kobo: offered as "My area isn't listed" when set (0 is free). Null means
  // only the listed areas can book pickup.
  defaultFee: number | null;
  dates: BookingDateOption[];
}

export interface BookingPageData {
  store: PublicStore;
  availability: BookingAvailability;
  options: BookingOptions;
}

export const BOOKING_STEPS = ["services", "fulfilment", "pickup", "details", "review"] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];
