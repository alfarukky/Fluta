import "server-only";

import { cache } from "react";

import { getBookingDateOptions } from "@/lib/booking";
import { getLogoUrl } from "@/lib/logo-url";
import { formatPhone } from "@/lib/phone";
import { getLocalDateKey, getMinutesInTimeZone } from "@/lib/time";
import type { BookingInput } from "@/schemas/booking";
import { findPublicStoreBySlug, type PublicStoreRecord } from "@/server/data/booking";
import { getFulfilmentOptionsAndSchedule, listActiveServiceAreas, listClosedDateKeys } from "@/server/data/fulfilment";
import { listActiveServices } from "@/server/data/services";
import { isPickupAvailable } from "@/server/domain/pickup-schedule";
import { getStoreAccess } from "@/server/domain/store-access";
import type { BookingAvailability, BookingOptions, BookingPageData, PublicStore } from "@/types/booking";

import { createOnlineOrder, type CreateOnlineOrderResult } from "./order-entry";

// Customer booking (/store/{slug}): the page's data and the booking itself.
// The store comes only from the slug. A Deactivated store is treated exactly
// like an unknown one, so its link shows nothing about it.

export interface BookableStore {
  id: string;
  timeZone: string;
  // Fluta's own R2 key (never an address): icons and previews draw from it.
  logoKey: string | null;
  store: PublicStore;
  canAcceptNewOrders: boolean;
}

// Null for an unknown slug or a Deactivated store. Shared by the page, its
// metadata, the manifest, and the icons within one request.
export const findBookableStore = cache(async (slug: string, now: Date = new Date()): Promise<BookableStore | null> => {
  const record = await findPublicStoreBySlug(slug);
  if (!record || record.status === "DEACTIVATED") return null;
  const access = getStoreAccess(record, record.subscription, now);
  return {
    id: record.id,
    timeZone: record.timeZone,
    logoKey: getLogoUrl(record) ? record.logoKey : null,
    store: toPublicStore(record),
    canAcceptNewOrders: access.canAcceptNewOrders,
  };
});

// What the store's customer pages show about it (booking and tracking).
export type PublicStoreFields = Pick<
  PublicStoreRecord,
  "name" | "slug" | "description" | "phone" | "logoKey" | "brandPrimaryColor" | "brandAccentColor"
>;

export function toPublicStore(record: PublicStoreFields): PublicStore {
  return {
    name: record.name,
    slug: record.slug,
    description: record.description,
    phone: record.phone ? formatPhone(record.phone) : null,
    phoneHref: record.phone ? `tel:${record.phone}` : null,
    logoUrl: getLogoUrl(record),
    brandPrimaryColor: record.brandPrimaryColor,
    brandAccentColor: record.brandAccentColor,
  };
}

// What the customer can choose right now: active services, the options the
// store has on (pickup only when isPickupAvailable and a date is left), the
// active areas and any default fee, and the dates and windows.
async function loadBookingOptions(storeId: string, timeZone: string, now: Date): Promise<BookingOptions> {
  const today = getLocalDateKey(now, timeZone);
  const [services, areas, settings, closedDates] = await Promise.all([
    listActiveServices(storeId),
    listActiveServiceAreas(storeId),
    getFulfilmentOptionsAndSchedule(storeId),
    listClosedDateKeys(storeId, today),
  ]);
  const pickupAvailable = isPickupAvailable({ ...settings, activeAreaCount: areas.length });
  const dates = pickupAvailable
    ? getBookingDateOptions({ today, minutes: getMinutesInTimeZone(now, timeZone) }, settings, new Set(closedDates))
    : [];
  const pickup = dates.length > 0;
  return {
    today,
    services,
    dropOff: settings.dropOffEnabled,
    pickup,
    areas: pickup ? areas : [],
    defaultFee: pickup ? settings.defaultDeliveryFee : null,
    dates,
  };
}

function getAvailability(canAcceptNewOrders: boolean, options: BookingOptions): BookingAvailability {
  if (!canAcceptNewOrders) return "NOT_ACCEPTING";
  if (options.services.length === 0 || (!options.dropOff && !options.pickup)) return "NO_ONLINE_BOOKING";
  return "OPEN";
}

export async function loadBookingPage(slug: string, now: Date): Promise<BookingPageData | null> {
  const bookable = await findBookableStore(slug, now);
  if (!bookable) return null;
  const options = await loadBookingOptions(bookable.id, bookable.timeZone, now);
  return { store: bookable.store, availability: getAvailability(bookable.canAcceptNewOrders, options), options };
}

export type SubmitBookingResult =
  | CreateOnlineOrderResult
  | { ok: false; error: "STORE_UNAVAILABLE" | "NOT_ACCEPTING"; fieldErrors: Record<string, string> };

// The store is looked up again, and must still accept bookings.
export async function submitBooking(
  slug: string,
  input: BookingInput,
  ipHash: string,
  now: Date,
): Promise<SubmitBookingResult> {
  const bookable = await findPublicStoreBySlug(slug);
  if (!bookable || bookable.status === "DEACTIVATED") return { ok: false, error: "STORE_UNAVAILABLE", fieldErrors: {} };
  const access = getStoreAccess(bookable, bookable.subscription, now);
  if (!access.canAcceptNewOrders) return { ok: false, error: "NOT_ACCEPTING", fieldErrors: {} };
  // The order-entry service re-checks the store's services, options, area,
  // and pickup time.
  return createOnlineOrder({ storeId: bookable.id, timeZone: bookable.timeZone, ipHash }, input, now);
}
