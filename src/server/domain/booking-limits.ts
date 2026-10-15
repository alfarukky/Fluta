import "server-only";

// Online booking limits (pilot defaults). Counted from recent orders in
// PostgreSQL. Staff-entered orders have no limit.

const HOUR_MS = 60 * 60 * 1000;

// Online bookings per phone number, per store, in 24 hours.
export const PHONE_BOOKING_LIMIT = 5;
export const PHONE_BOOKING_WINDOW_MS = 24 * HOUR_MS;

// Online bookings per IP address, across all stores, in an hour. Generous,
// because Nigerian mobile networks share IP addresses.
export const IP_BOOKING_LIMIT = 20;
export const IP_BOOKING_WINDOW_MS = HOUR_MS;

// A booking's IP hash is kept no longer than the longest window that counts it.
export const IP_HASH_RETENTION_MS = 24 * HOUR_MS;

export interface RecentBookings {
  // This phone number's online bookings at this store in the last 24 hours.
  phone: number;
  // This IP's online bookings at any store in the last hour.
  ip: number;
}

// Whether one more booking would go over either limit.
export function isBookingLimitReached(recent: RecentBookings): boolean {
  return recent.phone >= PHONE_BOOKING_LIMIT || recent.ip >= IP_BOOKING_LIMIT;
}
