// A customer's shared location (Feature 15b). It only helps staff and riders
// find the typed address: it never decides the area, the price, the distance,
// or whether pickup is available, and it is shown only to the store's own
// members (never in messages, tracking pages, or logs).

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const COORDINATE_DECIMALS = 6;

// Both values must be finite numbers in range (latitude −90 to 90, longitude
// −180 to 180). They are rounded to 6 decimal places, as stored. Anything
// else is null: a location is optional and never blocks a booking.
export function parseCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

function roundCoordinate(value: number): number {
  const rounded = Number(value.toFixed(COORDINATE_DECIMALS));
  // toFixed can give "-0.000000" for tiny negatives.
  return Object.is(rounded, -0) ? 0 : rounded;
}

// A stored location (Prisma Decimals, or nothing) as numbers. Null unless
// both are set.
export function fromStoredCoordinates(
  latitude: { toString(): string } | null,
  longitude: { toString(): string } | null,
): Coordinates | null {
  if (latitude === null || longitude === null) return null;
  return parseCoordinates(Number(latitude.toString()), Number(longitude.toString()));
}

// The one "Open in Maps" link: Google Maps at that spot, no API key.
export function getGoogleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
