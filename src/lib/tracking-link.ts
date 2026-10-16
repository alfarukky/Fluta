import "server-only";

import { getServerEnv } from "./env";

// An order's tracking link, /o/{token} on Fluta's domain. Every tracking link
// is built here (the booking confirmation, "Get tracking link", and later SMS
// and WhatsApp messages), never by hand. The raw token exists only in the
// link: never store or log the result.
export function getTrackingUrl(token: string, baseUrl: string = getServerEnv().BETTER_AUTH_URL): string {
  return new URL(`/o/${encodeURIComponent(token)}`, baseUrl).toString();
}
